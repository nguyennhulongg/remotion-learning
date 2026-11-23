import fs from "node:fs/promises";
import path from "node:path";
import type { Credit, SceneImage } from "../../../src/types";
import type { SceneScript } from "../script";
import { IMAGE_VARIANTS, paths } from "../config";
import { fileExists, sha256 } from "../util";
import { AI_IMAGE_SOURCE, createLocalGraphic, generateAiImage, LOCAL_GRAPHIC_SOURCE } from "./fallback";
import { CandidatePool, searchAllSources } from "./sources";
import { reviewImageCandidates } from "./vision";

export type SelectedImage = {
  bytes: Buffer;
  extension: string;
  source: string;
  credit: Credit;
};

type CachedImage = { file: string; credit: Credit | null; source: string };
export type ImageCache = Record<string, { fingerprint: string; images: CachedImage[] }>;

// Changing these invalidates every cached scene image.
const FINGERPRINT_SALT = "multi-image-v3.9.3";
const FILE_PREFIX = "single-fact-v3.9.3";

export const imageSourceCounts = { stock: 0, ai: 0, vector: 0 };

function countImageSource(source: string | undefined) {
  if (source === LOCAL_GRAPHIC_SOURCE) imageSourceCounts.vector++;
  else if (source === AI_IMAGE_SOURCE) imageSourceCounts.ai++;
  else imageSourceCounts.stock++;
}

export async function loadImageCache(): Promise<ImageCache> {
  try {
    return JSON.parse(await fs.readFile(paths.imageCache, "utf8"));
  } catch {
    return {};
  }
}

/** Vector fallbacks are never treated as cached so the next run retries real sources. */
async function isCacheUsable(entry: ImageCache[string] | undefined, fingerprint: string): Promise<boolean> {
  const images = Array.isArray(entry?.images) ? entry.images : [];
  if (entry?.fingerprint !== fingerprint || images.length !== IMAGE_VARIANTS.length) return false;
  if (images.some((item) => item.source === LOCAL_GRAPHIC_SOURCE || item.file.toLowerCase().endsWith(".svg"))) {
    return false;
  }
  const exists = await Promise.all(images.map((item) => fileExists(path.join(paths.scenes, item.file))));
  return exists.every(Boolean);
}

export async function buildSceneImages(
  scene: SceneScript,
  sceneIndex: number,
  sceneCount: number,
  cache: ImageCache,
): Promise<SceneImage[]> {
  const sceneNumber = sceneIndex + 1;
  const cacheKey = String(sceneNumber);
  const fingerprint = sha256(
    `${scene.title}|${scene.body}|${scene.visualPrompt}|${scene.imageQuery}|${FINGERPRINT_SALT}`,
  );
  const cached = cache[cacheKey];

  if (cached && (await isCacheUsable(cached, fingerprint))) {
    console.log(`[2/3] Dùng cache v3.9 cho cảnh ${sceneNumber}/${sceneCount}: 3 ảnh`);
    return cached.images.map((item, index) => {
      countImageSource(item.source);
      return {
        src: `assets/scenes/${item.file}`,
        credit: item.credit ?? null,
        visualBeat: IMAGE_VARIANTS[index]?.label ?? "visual detail",
      };
    });
  }

  console.log(`[2/3] Tạo bộ 3 ảnh cho cảnh ${sceneNumber}/${sceneCount}: "${scene.imageQuery}"`);
  const usedHashes = new Set<string>();
  const images: SceneImage[] = [];
  const cacheItems: CachedImage[] = [];

  for (const [imageIndex, variant] of IMAGE_VARIANTS.entries()) {
    console.log(`  Ảnh ${imageIndex + 1}/${IMAGE_VARIANTS.length}: ${variant.label}`);
    // Framing chỉ đưa vào visualPrompt: thêm "wide shot / close up" vào imageQuery
    // làm Wikimedia/Pexels bỏ lỡ ảnh đúng chủ thể.
    const variantScene: SceneScript = {
      ...scene,
      visualPrompt: `${scene.visualPrompt}. Camera framing: ${variant.label}. Show a distinct but factually consistent visual angle; do not repeat the same composition.`,
    };
    const selected = await selectImage(variantScene, sceneNumber, imageIndex, variant.label, usedHashes);
    countImageSource(selected.source);

    const fileName = `${FILE_PREFIX}-scene-${sceneNumber}-image-${imageIndex + 1}.${selected.extension}`;
    await fs.writeFile(path.join(paths.scenes, fileName), selected.bytes);
    images.push({ src: `assets/scenes/${fileName}`, credit: selected.credit, visualBeat: variant.label });
    cacheItems.push({ file: fileName, credit: selected.credit, source: selected.source });
    console.log(`  ✓ Đã lưu ảnh ${imageIndex + 1}/3 từ ${selected.source}`);
  }

  cache[cacheKey] = { fingerprint, images: cacheItems };
  await fs.writeFile(paths.imageCache, JSON.stringify(cache, null, 2), "utf8");
  return images;
}

/** Stock/archive image verified by Vision → AI-generated image → local SVG. */
async function selectImage(
  scene: SceneScript,
  sceneNumber: number,
  imageIndex: number,
  visualBeat: string,
  usedHashes: Set<string>,
): Promise<SelectedImage> {
  const found = await findVerifiedImage(scene, sceneNumber, usedHashes);
  if (found && claimUnique(found.bytes, usedHashes)) return found;

  console.warn(`  Không có ảnh stock/tư liệu khác biệt đạt chuẩn. Dùng AI fallback cho ảnh ${imageIndex + 1}...`);
  try {
    const generated = await generateAiImage(scene, sceneNumber);
    if (generated && claimUnique(generated.bytes, usedHashes)) return generated;
  } catch (error) {
    console.warn(`  AI image fallback ảnh ${imageIndex + 1} thất bại: ${String(error)}`);
  }

  console.warn(`  ✓ Dùng vector graphic fallback cho ảnh ${imageIndex + 1}.`);
  return createLocalGraphic(scene, visualBeat, imageIndex);
}

function claimUnique(bytes: Buffer, usedHashes: Set<string>): boolean {
  const hash = sha256(bytes);
  if (usedHashes.has(hash)) return false;
  usedHashes.add(hash);
  return true;
}

const VISUAL_QUERY_NOISE =
  /\b(cinematic|photorealistic|realistic|dramatic|beautiful|highly detailed|vertical composition|no text|no logo)\b/gi;

/** First sentence of the visual prompt, stripped of style words, as a more specific search query. */
const toVisualQuery = (visualPrompt: string) =>
  visualPrompt.split(/[.!?]/)[0].replace(VISUAL_QUERY_NOISE, "").replace(/\s+/g, " ").trim().slice(0, 75);

async function findVerifiedImage(
  scene: SceneScript,
  sceneNumber: number,
  usedHashes: ReadonlySet<string>,
): Promise<SelectedImage | null> {
  const pool = new CandidatePool();
  const primaryQuery = scene.imageQuery.trim();
  await searchAllSources(primaryQuery, pool);
  let reviewed = await reviewImageCandidates(scene, pool.items, sceneNumber, usedHashes);

  const visualQuery = toVisualQuery(scene.visualPrompt);
  if (!reviewed && visualQuery && visualQuery.toLowerCase() !== primaryQuery.toLowerCase()) {
    console.log(`  Không có ảnh đạt ở lượt đầu. Tìm lại theo mô tả cụ thể: "${visualQuery}"`);
    const previousCount = pool.items.length;
    await searchAllSources(visualQuery, pool);
    reviewed = await reviewImageCandidates(scene, pool.items.slice(previousCount), sceneNumber, usedHashes);
  }

  if (!reviewed) return null;
  const { candidate, bytes } = reviewed;
  return { bytes, extension: candidate.extension, source: candidate.source, credit: candidate.credit };
}
