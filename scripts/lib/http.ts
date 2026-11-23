import { sleep } from "./util";

/** Retries only 429/503/504; other non-OK responses are returned to the caller. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  operation: string,
  maxAttempts = 5,
): Promise<Response> {
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || ![429, 503, 504].includes(response.status)) return response;

    lastResponse = response;
    if (attempt === maxAttempts) break;

    let waitMs = 5000 * 2 ** (attempt - 1);
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(seconds)) waitMs = Math.max(1000, seconds * 1000);
      else if (Number.isFinite(date)) waitMs = Math.max(1000, date - Date.now());
    }
    waitMs = Math.min(waitMs, 120_000);

    console.log(
      `${operation}: HTTP ${response.status}. Thử lại sau ${Math.ceil(waitMs / 1000)} giây...`,
    );
    await sleep(waitMs);
  }

  throw new Error(
    `${operation} thất bại sau ${maxAttempts} lần thử. HTTP ${lastResponse?.status}`,
  );
}
