import type { SceneScript } from "../script";
import type { ImageCandidate } from "./sources";
import { env, USER_AGENT } from "../config";
import { generateContentWithRetry } from "../gemini";
import { fetchWithRetry } from "../http";
import { extractTerms, scoreTerms, sha256, sleep } from "../util";

type UsableCandidate = { candidate: ImageCandidate; bytes: Buffer };

const MAX_REVIEWED = 4;
const MIN_CONFIDENCE = 0.72;
const MIN_BYTES = 45_000;
const MAX_BYTES = 12_000_000;

const REFERERS: Record<string, string> = {
  "Wikimedia Commons": "https://commons.wikimedia.org/",
  Pexels: "https://www.pexels.com/",
};

const METADATA_IGNORED_TERMS = new Set([
  "the", "and", "with", "from", "photo", "image", "wide", "shot",
  "close", "up", "action", "detail", "ocean", "sea", "underwater", "water",
]);

let lastVisionRequestAt = 0;

/** Downloads up to 4 candidates and asks Gemini Vision which one actually illustrates the scene. */
export async function reviewImageCandidates(
  scene: SceneScript,
  candidates: ImageCandidate[],
  sceneNumber: number,
  usedImageHashes: ReadonlySet<string>,
): Promise<UsableCandidate | null> {
  if (!candidates.length) return null;
  const usable = await downloadCandidates(candidates.slice(0, MAX_REVIEWED), sceneNumber, usedImageHashes);
  if (!usable.length) return null;

  const waitMs = Math.max(0, env.visionIntervalMs - (Date.now() - lastVisionRequestAt));
  if (waitMs > 0) {
    console.log(`  Chờ ${Math.ceil(waitMs / 1000)} giây trước khi Gemini Vision kiểm tra ảnh...`);
    await sleep(waitMs);
  }
  lastVisionRequestAt = Date.now();

  try {
    const response = await generateContentWithRetry(
      {
        model: env.visionModel,
        contents: [{ role: "user", parts: buildVisionParts(scene, usable) }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "OBJECT",
            properties: {
              bestIndex: { type: "INTEGER" },
              relevance: { type: "STRING", enum: ["direct", "contextual", "generic", "irrelevant"] },
              confidence: { type: "NUMBER" },
              reason: { type: "STRING" },
            },
            required: ["bestIndex", "relevance", "confidence", "reason"],
          },
          temperature: 0.1,
        },
      },
      2,
    );
    const raw = response.text;
    if (!raw) return metadataFallback(scene, usable);

    const verdict = JSON.parse(raw) as { bestIndex: number; relevance: string; confidence: number; reason: string };
    const index = Number(verdict.bestIndex);
    const confidence = Number(verdict.confidence);
    const accepted =
      Number.isInteger(index) && index >= 0 && index < usable.length &&
      ["direct", "contextual"].includes(verdict.relevance) &&
      Number.isFinite(confidence) && confidence >= MIN_CONFIDENCE;
    if (!accepted) {
      console.log(`  Gemini Vision từ chối ${usable.length} ảnh ứng viên: ${verdict.reason || "không đủ liên quan"}`);
      return null;
    }
    return usable[index];
  } catch (error) {
    console.warn(`  Gemini Vision không kiểm tra được ảnh cảnh ${sceneNumber}: ${String(error)}`);
    return metadataFallback(scene, usable);
  }
}

async function downloadCandidates(
  candidates: ImageCandidate[],
  sceneNumber: number,
  usedImageHashes: ReadonlySet<string>,
): Promise<UsableCandidate[]> {
  const usable: UsableCandidate[] = [];
  for (const candidate of candidates) {
    try {
      const headers: Record<string, string> = { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT };
      const referer = REFERERS[candidate.source];
      if (referer) headers.Referer = referer;

      const response = await fetchWithRetry(candidate.imageUrl, { headers }, `Tải ảnh ứng viên cảnh ${sceneNumber}`);
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) continue;
      if (usedImageHashes.has(sha256(bytes))) continue;
      usable.push({ candidate, bytes });
    } catch (error) {
      console.warn(`  Không tải được ảnh ứng viên: ${String(error)}`);
    }
  }
  return usable;
}

function buildVisionParts(scene: SceneScript, usable: UsableCandidate[]) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{
    text: `Bạn là hệ thống kiểm duyệt ảnh minh họa cho video kiến thức. Hãy xem trực tiếp từng ảnh đính kèm và đối chiếu nghiêm ngặt với nội dung cảnh.\n\nTIÊU ĐỀ CẢNH: ${scene.title}\nLỜI THUYẾT MINH: ${scene.body}\nMÔ TẢ HÌNH ẢNH MONG MUỐN: ${scene.visualPrompt}\n\nCó ${usable.length} ảnh, theo thứ tự đính kèm là candidate 0 đến ${usable.length - 1}. Chỉ chấp nhận ảnh khi chủ thể/hành động/bối cảnh nhìn thấy được thực sự minh họa lời thuyết minh. Ảnh chỉ cùng chủ đề rộng, ví dụ ảnh biển chung cho cảnh nói về cơ chế tế bào, phải bị đánh dấu generic hoặc irrelevant. Không suy đoán nội dung không nhìn thấy trong ảnh. Ảnh tư liệu hoặc sơ đồ khoa học chỉ được chấp nhận nếu nội dung hình thật sự thể hiện đúng khái niệm.\n\nTrả JSON đúng schema: {\"bestIndex\": number hoặc -1, \"relevance\": \"direct\"|\"contextual\"|\"generic\"|\"irrelevant\", \"confidence\": number từ 0 đến 1, \"reason\": string ngắn bằng tiếng Việt}. Chỉ chọn direct/contextual với confidence >= ${MIN_CONFIDENCE}. Nếu không ảnh nào đạt, bestIndex=-1.`,
  }];
  usable.forEach(({ candidate, bytes }, index) => {
    parts.push({ text: `Candidate ${index} — nguồn ${candidate.source}.` });
    parts.push({ inlineData: { mimeType: candidate.mimeType, data: bytes.toString("base64") } });
  });
  return parts;
}

/**
 * Only used when Vision is unavailable (503/quota/network) — never when Vision actively
 * rejected the images — and only for candidates whose metadata matches the subject keywords.
 */
function metadataFallback(scene: SceneScript, usable: UsableCandidate[]): UsableCandidate | null {
  const terms = extractTerms(scene.imageQuery, METADATA_IGNORED_TERMS, 3);
  if (!terms.length) return null;
  const best = usable
    .map((item) => ({ item, score: scoreTerms(item.candidate.searchText, terms, 6) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 1) return null;
  console.warn(`  ⚠ Gemini Vision đang lỗi; dùng ảnh ${best.item.candidate.source} có metadata khớp từ khóa (độ tin cậy giới hạn).`);
  return best.item;
}
