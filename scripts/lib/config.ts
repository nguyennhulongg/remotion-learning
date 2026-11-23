import "dotenv/config";
import path from "node:path";

export const VERSION = "3.9.3";

const isEnabled = (name: string) =>
  (process.env[name] || "true").toLowerCase() !== "false";

const textModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

export const env = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  textModel,
  imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
  visionModel: process.env.GEMINI_VISION_MODEL || textModel,
  visionIntervalMs: Number(process.env.GEMINI_VISION_INTERVAL_MS || 8000),

  pexelsApiKey: process.env.PEXELS_API_KEY,
  pixabayApiKey: process.env.PIXABAY_API_KEY,
  smithsonianApiKey: process.env.SMITHSONIAN_API_KEY,

  ttsProvider: (process.env.TTS_PROVIDER || "elevenlabs").toLowerCase(),
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",

  generateImages: isEnabled("GENERATE_IMAGES"),
  generateVoice: isEnabled("GENERATE_VOICE"),
};

const assets = path.resolve("public/assets");
const cache = path.join(assets, "cache");

export const paths = {
  assets,
  scenes: path.join(assets, "scenes"),
  cache,
  scriptCache: path.join(cache, "script-v3.6-single-fact.json"),
  legacyScriptCache: path.join(cache, "script-v3.5-single-fact.json"),
  imageCache: path.join(cache, "images-v3.9-multi-image-hybrid.json"),
  voiceSegments: path.join(cache, "voice-segments"),
  voiceover: path.join(assets, "voiceover.wav"),
  progress: path.join(assets, "video-progress.json"),
  output: path.join(assets, "video.json"),
};

export const USER_AGENT = "FactsLab/3.9.2 (hybrid-image-recovery)";

export const IMAGE_VARIANTS = [
  { label: "wide establishing shot" },
  { label: "close-up subject detail" },
  { label: "action or contextual detail" },
] as const;
