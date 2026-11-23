import type { Credit } from "../../../src/types";
import { env, USER_AGENT } from "../config";
import { fetchWithRetry } from "../http";
import { extractTerms, scoreTerms, stripHtml } from "../util";

export type ImageCandidate = {
  source: string;
  imageUrl: string;
  extension: string;
  mimeType: string;
  searchText: string;
  credit: Credit;
};

const MAX_POOL_SIZE = 8;
/** Sources with a single best hit stop contributing once the pool has this many. */
const SINGLE_HIT_SOURCE_LIMIT = 4;

const mimeForExtension = (extension: string) =>
  extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";

const extensionFromUrl = (url: string) =>
  /\.png(?:[?#]|$)/i.test(url) ? "png" : /\.webp(?:[?#]|$)/i.test(url) ? "webp" : "jpg";

export class CandidatePool {
  readonly items: ImageCandidate[] = [];
  private readonly seenUrls = new Set<string>();

  add(candidate: Omit<ImageCandidate, "mimeType">) {
    if (!candidate.imageUrl || this.seenUrls.has(candidate.imageUrl) || this.items.length >= MAX_POOL_SIZE) return;
    this.seenUrls.add(candidate.imageUrl);
    this.items.push({ ...candidate, mimeType: mimeForExtension(candidate.extension) });
  }

  addRemote(source: string, imageUrl: string, pageUrl: string, title: string, attribution: string, searchText = title) {
    this.add({
      source,
      imageUrl,
      extension: extensionFromUrl(imageUrl),
      searchText,
      credit: { source, photographer: title || "Unknown", photoUrl: pageUrl, attribution },
    });
  }
}

/** Hybrid: tư liệu chuyên ngành + stock phổ thông. Vision sẽ quyết định ảnh nào thực sự đúng cảnh. */
export async function searchAllSources(query: string, pool: CandidatePool) {
  await Promise.all([
    addPexels(query, pool),
    addCommons(query, pool),
    addNasa(query, pool),
    addSmithsonian(query, pool),
    addPixabay(query, pool),
  ]);
}

let pexelsDisabledForRun = false;

async function addPexels(query: string, pool: CandidatePool) {
  if (!env.pexelsApiKey || pexelsDisabledForRun || pool.items.length >= SINGLE_HIT_SOURCE_LIMIT) return;
  try {
    const photo = await searchPexelsPhoto(query, env.pexelsApiKey);
    if (!photo) return;
    const imageUrl = photo.src.large2x || photo.src.large || photo.src.original || photo.src.portrait;
    const photographer = String(photo.photographer || "Unknown");
    pool.add({
      source: "Pexels",
      imageUrl,
      extension: "jpg",
      searchText: String(photo.alt || ""),
      credit: {
        source: "Pexels",
        photographer,
        photographerUrl: String(photo.photographer_url || ""),
        photoUrl: String(photo.url || ""),
        attribution: `Photo by ${photographer} on Pexels`,
      },
    });
  } catch (error) {
    const message = String(error);
    if (/401|unauthorized|invalid api key/i.test(message)) {
      pexelsDisabledForRun = true;
      console.warn("  Pexels bị tắt trong lần chạy này vì API key không hợp lệ (HTTP 401). Các nguồn ảnh khác vẫn tiếp tục hoạt động.");
    } else {
      console.warn(`  Pexels search lỗi với "${query}": ${message}`);
    }
  }
}

async function addCommons(query: string, pool: CandidatePool) {
  if (pool.items.length >= SINGLE_HIT_SOURCE_LIMIT) return;
  try {
    for (const photo of await searchCommonsPhotos(query)) {
      pool.add({
        source: "Wikimedia Commons",
        imageUrl: photo.imageUrl,
        extension: photo.extension,
        searchText: photo.title,
        credit: {
          source: "Wikimedia Commons",
          photographer: photo.artist,
          license: photo.license,
          photoUrl: photo.pageUrl,
          attribution: `Image: ${photo.artist} — ${photo.license} — Wikimedia Commons`,
        },
      });
    }
  } catch (error) {
    console.warn(`  Wikimedia search lỗi với "${query}": ${String(error)}`);
  }
}

async function addNasa(query: string, pool: CandidatePool) {
  try {
    const params = new URLSearchParams({ q: query, media_type: "image", page_size: "8" });
    const response = await fetchWithRetry(`https://images-api.nasa.gov/search?${params}`, {}, `NASA Images ${query}`);
    if (!response.ok) return;
    const payload: any = await response.json();
    for (const item of (payload?.collection?.items ?? []).slice(0, 5)) {
      const data = item.data?.[0] ?? {};
      const link = (item.links ?? []).find((x: any) => x.render === "image")?.href;
      if (!link || data.media_type !== "image") continue;
      const pageUrl = data.nasa_id ? `https://images.nasa.gov/details/${data.nasa_id}` : link;
      pool.addRemote("NASA Image and Video Library", link, pageUrl, data.title || "NASA", `NASA — ${data.title || "Image"}`);
    }
  } catch (error) {
    console.warn(`  NASA search lỗi: ${String(error)}`);
  }
}

async function addSmithsonian(query: string, pool: CandidatePool) {
  if (!env.smithsonianApiKey) return;
  try {
    const params = new URLSearchParams({ q: query, api_key: env.smithsonianApiKey, rows: "8", online_media_type: "Images" });
    const response = await fetchWithRetry(`https://api.si.edu/openaccess/api/v1.0/search?${params}`, {}, `Smithsonian ${query}`);
    if (!response.ok) return;
    const payload: any = await response.json();
    for (const item of (payload?.response?.rows ?? []).slice(0, 5)) {
      const content = item.content ?? {};
      const media = content.descriptiveNonRepeating?.online_media?.media ?? content.online_media?.media ?? [];
      const first = media.find((m: any) => m.type === "Images" || m.type === "image") ?? media[0];
      const url = first?.content;
      if (!url) continue;
      const title = content.freetext?.title?.[0]?.content || item.title || "Smithsonian collection";
      const pageUrl = item.id ? `https://www.si.edu/object/${item.id}` : url;
      pool.addRemote("Smithsonian Open Access", url, pageUrl, title, `Smithsonian Open Access — ${title}`);
    }
  } catch (error) {
    console.warn(`  Smithsonian search lỗi: ${String(error)}`);
  }
}

async function addPixabay(query: string, pool: CandidatePool) {
  if (!env.pixabayApiKey) return;
  try {
    const params = new URLSearchParams({
      key: env.pixabayApiKey, q: query, image_type: "photo", orientation: "vertical", safesearch: "true", per_page: "20",
    });
    const response = await fetchWithRetry(`https://pixabay.com/api/?${params}`, {}, `Pixabay ${query}`);
    if (!response.ok) return;
    const payload: any = await response.json();
    for (const photo of (payload?.hits ?? []).slice(0, 5)) {
      const user = photo.user || "Pixabay contributor";
      pool.addRemote(
        "Pixabay",
        photo.largeImageURL || photo.webformatURL,
        photo.pageURL,
        `Photo by ${user}`,
        `Photo by ${user} on Pixabay`,
        String(photo.tags || ""),
      );
    }
  } catch (error) {
    console.warn(`  Pixabay search lỗi: ${String(error)}`);
  }
}

const COMMONS_IGNORED_TERMS = new Set(["underwater", "ocean", "sea", "deep", "water", "photo", "image", "the", "and"]);

type CommonsPhoto = {
  title: string;
  imageUrl: string;
  width: number;
  height: number;
  extension: string;
  artist: string;
  license: string;
  pageUrl: string;
};

async function searchCommonsPhotos(query: string): Promise<CommonsPhoto[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "1920",
    format: "json",
    origin: "*",
  });

  const response = await fetchWithRetry(
    `https://commons.wikimedia.org/w/api.php?${params}`,
    { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, Referer: "https://commons.wikimedia.org/" } },
    `Tìm ảnh ${query}`,
  );
  const payload = (await response.json()) as any;
  if (!response.ok) throw new Error(`Wikimedia Commons API trả lỗi ${response.status}`);

  const photos: CommonsPhoto[] = [];
  for (const page of Object.values(payload?.query?.pages ?? {}) as any[]) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl && !info?.url) continue;
    const mime: string = info.mime || "";
    if (!mime.startsWith("image/") || mime === "image/svg+xml") continue;
    const metadata = info.extmetadata ?? {};
    photos.push({
      title: page.title || "",
      imageUrl: info.thumburl || info.url,
      width: Number(info.width ?? 0),
      height: Number(info.height ?? 0),
      extension: mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg",
      artist: stripHtml(metadata.Artist?.value || metadata.Credit?.value || "Không rõ tác giả"),
      license: stripHtml(metadata.LicenseShortName?.value || "Kiểm tra giấy phép tại trang nguồn"),
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    });
  }

  // Xếp hạng theo từ khóa đặc trưng trong tên file để giảm ảnh không liên quan.
  const terms = extractTerms(query, COMMONS_IGNORED_TERMS, 4);
  const ranked = photos
    .map((photo) => {
      const score = scoreTerms(photo.title, terms, 7);
      const resolutionBonus = score > 0 && photo.width >= 1600 && photo.height >= 900 ? 0.5 : 0;
      return { photo, score: score + resolutionBonus };
    })
    .sort((a, b) => b.score - a.score);

  if (terms.length > 0 && (!ranked[0] || ranked[0].score < 1)) return [];
  return ranked
    .filter((item) => item.score >= (terms.length ? 1 : 0))
    .slice(0, 5)
    .map((item) => item.photo);
}

const PEXELS_IGNORED_TERMS = new Set([
  "photo", "image", "picture", "the", "and", "with", "from",
  "cinematic", "photorealistic", "realistic", "dramatic", "beautiful",
]);

async function searchPexelsPhoto(query: string, key: string): Promise<any | null> {
  const params = new URLSearchParams({ query, orientation: "portrait", size: "large", per_page: "30" });
  const response = await fetchWithRetry(
    `https://api.pexels.com/v1/search?${params}`,
    { headers: { Authorization: key } },
    `Tìm ảnh Pexels ${query}`,
  );
  const payload = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Pexels API trả lỗi ${response.status}: ${payload?.error || JSON.stringify(payload)}`);
  }

  const photos: any[] = Array.isArray(payload.photos) ? payload.photos : [];
  const terms = extractTerms(query, PEXELS_IGNORED_TERMS, 3);

  const best = photos
    .map((photo) => {
      const altScore = scoreTerms(String(photo.alt ?? ""), terms, 6);
      const ratio = photo.width > 0 ? photo.height / photo.width : 0;
      const portraitBonus = ratio >= 1.45 ? 2 : ratio >= 1.2 ? 1 : 0;
      const resolutionBonus =
        photo.width >= 1200 && photo.height >= 1800 ? 2 : photo.width >= 900 && photo.height >= 1350 ? 1 : 0;
      return { photo, score: altScore + portraitBonus + resolutionBonus, altScore, ratio };
    })
    .filter((item) => item.ratio >= 1.15 && item.photo.width >= 700 && item.photo.height >= 1100)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) return null;
  // Alt text không khớp từ khóa: chỉ chấp nhận khi ảnh dọc đủ lớn.
  if (terms.length > 0 && best.altScore === 0 && (best.photo.width < 1200 || best.photo.height < 1800)) return null;
  return best.photo;
}
