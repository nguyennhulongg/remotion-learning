import fs from "node:fs/promises";
import path from "node:path";
import type { Scene, VideoData } from "../src/types";
import { buildVoiceover } from "./lib/audio";
import { env, paths, VERSION } from "./lib/config";
import { buildSceneImages, imageSourceCounts, loadImageCache } from "./lib/images";
import { loadOrGenerateScript, type SceneScript } from "./lib/script";
import { buildNarrationParts, buildSubtitleCues, buildTimeline } from "./lib/timeline";
import { fileExists } from "./lib/util";

const TARGET_VOICEOVER_SECONDS = { min: 105, max: 135 };
const MUSIC_CANDIDATES = ["music.mp3", "music.wav", "background-music.mp3"];

const args = process.argv.slice(2);
const resume = args.includes("--resume");
const topic = args.filter((arg) => arg !== "--resume").join(" ").trim();

if (!topic) {
  console.error('Cách dùng: npm run generate -- "một sự thật kỳ lạ về đại dương"');
  process.exit(1);
}
if (!env.geminiApiKey) {
  console.error("Thiếu GEMINI_API_KEY. Hãy tạo file .env từ .env.example và điền Gemini API key.");
  process.exit(1);
}

await fs.mkdir(paths.scenes, { recursive: true });
await fs.mkdir(paths.cache, { recursive: true });

if (env.generateImages) {
  console.log(`FACTS LAB v${VERSION} | Hybrid Image Recovery + Vision-Resilient Fallback | Nguồn ảnh hybrid | Vision: ${env.visionModel} | Fallback AI: ${env.imageModel}`);
}

// 1. Script
const script = await loadOrGenerateScript(topic, resume);

// 2. Images
type OutputScene = SceneScript & Scene;
const scenes: OutputScene[] = [];
const imageCache = await loadImageCache();

for (const [index, scene] of script.scenes.entries()) {
  const images = env.generateImages
    ? await buildSceneImages(scene, index, script.scenes.length, imageCache)
    : [];
  scenes.push({ ...scene, image: images[0]?.src ?? null, imageCredit: images[0]?.credit ?? null, images });

  // Lets Remotion Studio preview partial results while the remaining scenes are still being fetched.
  const pending = script.scenes.slice(index + 1).map((s) => ({ ...s, image: null, imageCredit: null, images: [] }));
  await fs.writeFile(paths.progress, JSON.stringify({ ...script, scenes: [...scenes, ...pending] }, null, 2), "utf8");
}

// 3. Voiceover + timeline
const narration = buildNarrationParts(script);
let voiceover: string | null = null;
let voiceoverSeconds: number | null = null;
let timeline;

if (env.generateVoice) {
  const result = await buildVoiceover(narration);
  voiceover = "assets/voiceover.wav";
  voiceoverSeconds = result.seconds;
  if (voiceoverSeconds < TARGET_VOICEOVER_SECONDS.min || voiceoverSeconds > TARGET_VOICEOVER_SECONDS.max) {
    console.warn(
      `\nCẢNH BÁO: Thời lượng audio thực tế là ${voiceoverSeconds.toFixed(1)} giây ` +
        `(mục tiêu khoảng 120 giây). Hãy điều chỉnh độ dài lời thoại nếu muốn sát 2 phút hơn.`,
    );
  } else {
    console.log(`  Thời lượng voiceover thực tế: ${voiceoverSeconds.toFixed(1)} giây.`);
  }
  timeline = buildTimeline(narration, result.durations);
} else {
  const plannedSeconds =
    script.introSeconds + script.scenes.reduce((sum, scene) => sum + scene.seconds, 0) + script.outroSeconds;
  timeline = buildTimeline(narration, narration.map((part) => Math.max(1, part.text.length)), plannedSeconds);
}

let music: string | null = null;
for (const candidate of MUSIC_CANDIDATES) {
  if (await fileExists(path.join(paths.assets, candidate))) {
    music = `assets/${candidate}`;
    break;
  }
}

const output: VideoData = {
  ...script,
  scenes,
  voiceoverSeconds,
  timeline,
  subtitleCues: buildSubtitleCues(narration, timeline),
  audio: { voiceover, music },
};
await fs.writeFile(paths.output, JSON.stringify(output, null, 2), "utf8");

printSummary();

function printSummary() {
  const { stock, ai, vector } = imageSourceCounts;
  console.log(`\nFACTS LAB v${VERSION} hoàn tất!`);
  console.log(`- Kịch bản: ${paths.output}`);
  console.log(
    `- Ảnh: ${env.generateImages ? `Ảnh tư liệu/stock: ${stock} | Gemini AI: ${ai} | Vector dự phòng: ${vector}` : "đã tắt"}`,
  );
  if (env.generateImages && vector > 0) {
    const ratio = vector / (stock + ai + vector);
    console.warn(
      ratio >= 0.5
        ? "⚠️ CẢNH BÁO: Phần lớn hình hiện là vector dự phòng, chưa đạt chất lượng hình ảnh tư liệu. Hãy kiểm tra API key/quota và chạy lại với --resume sau khi khắc phục."
        : "⚠️ Một số cảnh đang dùng vector dự phòng; nên kiểm tra lại trước khi render bản cuối.",
    );
  }
  console.log(`- Giọng đọc: ${voiceover ? "public/assets/voiceover.wav" : "đã tắt"}`);
  console.log("\nChạy npm run dev để xem trước, sau đó npm run render để xuất MP4.");
  console.log(`Muốn tiếp tục với kịch bản đã lưu: npm run generate -- "${topic}" --resume`);
}
