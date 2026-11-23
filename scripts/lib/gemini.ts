import { GoogleGenAI } from "@google/genai";
import { env } from "./config";
import { sleep } from "./util";

let client: GoogleGenAI | undefined;
const getClient = () => (client ??= new GoogleGenAI({ apiKey: env.geminiApiKey }));

type GenerateContentRequest = Parameters<GoogleGenAI["models"]["generateContent"]>[0];

/** Gemini đôi khi trả 503 khi model quá tải. Tự thử lại với backoff. */
export async function generateContentWithRetry(
  request: GenerateContentRequest,
  maxAttempts = 5,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getClient().models.generateContent(request);
    } catch (error: any) {
      const status = Number(error?.status ?? error?.code ?? error?.error?.code);
      const retryable =
        [408, 429, 500, 502, 503, 504].includes(status) ||
        /fetch failed|network|socket|timeout|temporar|high demand/i.test(
          String(error?.message ?? error),
        );
      if (!retryable || attempt === maxAttempts) throw error;

      const waitMs = Math.min(5000 * 2 ** (attempt - 1), 60000);
      console.warn(
        `Gemini tạm thời lỗi${status ? ` HTTP ${status}` : " mạng"}. ` +
          `Thử lại lần ${attempt + 1}/${maxAttempts} sau ${Math.ceil(waitMs / 1000)} giây...`,
      );
      await sleep(waitMs);
    }
  }
  throw new Error("Gemini không thể hoàn tất yêu cầu sau nhiều lần thử.");
}

const MIN_MEDIA_REQUEST_INTERVAL_MS = 21_000;
const MAX_MEDIA_RETRY_WAIT_MS = 120_000;
let lastMediaRequestAt = 0;

/** Raw REST call for image models, throttled to respect free-tier rate limits. */
export async function generateMedia(
  modelName: string,
  body: Record<string, unknown>,
  maxAttempts = 6,
): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const throttleWait = Math.max(0, MIN_MEDIA_REQUEST_INTERVAL_MS - (Date.now() - lastMediaRequestAt));
    if (throttleWait > 0) {
      console.log(`  Chờ ${Math.ceil(throttleWait / 1000)} giây để tuân thủ giới hạn Gemini...`);
      await sleep(throttleWait);
    }
    lastMediaRequestAt = Date.now();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json()) as any;
    if (response.ok) return payload;

    const message: string = payload?.error?.message || JSON.stringify(payload);

    // Quota/model limit không thể tự hồi phục bằng retry trong cùng lần chạy.
    if (/per day limit exceeded|requests per day limit exceeded|limit:\s*0|free_tier|resource_exhausted|quota exceeded/i.test(message)) {
      throw new Error(
        `Gemini API (${modelName}) không khả dụng do quota hoặc giới hạn model. ` +
          `Hãy kiểm tra quota của model/dự án Google AI Studio.\n${message}`,
      );
    }

    const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`Gemini API (${modelName}) trả lỗi ${response.status}: ${message}`);
    }

    const serverDelaySeconds = parseServerRetryDelay(payload, message);
    const backoffMs = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
    const waitMs = Math.min(Math.max(serverDelaySeconds * 1000, backoffMs) + 1_000, MAX_MEDIA_RETRY_WAIT_MS);

    console.warn(
      `  Gemini trả HTTP ${response.status}. ` +
        `Tự thử lại lần ${attempt + 1}/${maxAttempts} sau ${Math.ceil(waitMs / 1000)} giây...`,
    );
    await sleep(waitMs);
  }
  throw new Error(`Gemini API (${modelName}) không thể hoàn tất sau ${maxAttempts} lần thử.`);
}

function parseServerRetryDelay(payload: any, message: string): number {
  const retryInfo = payload?.error?.details?.find?.((item: any) =>
    String(item?.["@type"] ?? "").includes("RetryInfo"),
  );
  const fromDetails = Number(String(retryInfo?.retryDelay ?? "").match(/([0-9.]+)s/)?.[1]);
  if (Number.isFinite(fromDetails) && fromDetails > 0) return fromDetails;
  const fromMessage = Number(message.match(/retry in ([0-9.]+)s/i)?.[1]);
  return Number.isFinite(fromMessage) && fromMessage > 0 ? fromMessage : 0;
}
