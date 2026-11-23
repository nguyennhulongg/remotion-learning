import type { SceneScript } from "../script";
import type { SelectedImage } from "./index";
import { env } from "../config";
import { generateMedia } from "../gemini";
import { xmlEscape } from "../util";

export const AI_IMAGE_SOURCE = "Gemini AI (fallback)";
export const LOCAL_GRAPHIC_SOURCE = "FACTS LAB local graphic fallback";

let geminiImageDisabledForRun = false;

export async function generateAiImage(scene: SceneScript, sceneNumber: number): Promise<SelectedImage | null> {
  if (geminiImageDisabledForRun) return null;
  const prompt = `Create one photorealistic cinematic documentary still image in vertical 9:16 composition. Depict this exact scene: ${scene.visualPrompt}. Context: ${scene.title}. Do not include text, letters, captions, logos, watermarks, borders, collage, split panels, or graphic UI. Make the visible subject specific and scientifically/historically plausible. High detail, natural lighting, editorial documentary photography.`;

  let payload: any;
  try {
    payload = await generateMedia(env.imageModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "9:16" } },
    });
  } catch (error) {
    const message = String(error);
    if (/quota|limit:\s*0|free_tier|resource_exhausted|429/i.test(message)) {
      geminiImageDisabledForRun = true;
      console.warn(`  Gemini Image đã bị tắt cho phần còn lại của lần chạy do quota/giới hạn model: ${message.slice(0, 500)}`);
      return null;
    }
    throw error;
  }

  const parts: any[] = payload?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(
    (part) => part.inlineData?.data && String(part.inlineData?.mimeType || "").startsWith("image/"),
  );
  if (!imagePart) throw new Error(`Gemini image model không trả inline image cho cảnh ${sceneNumber}.`);

  return {
    bytes: Buffer.from(imagePart.inlineData.data, "base64"),
    extension: String(imagePart.inlineData.mimeType).includes("png") ? "png" : "jpg",
    source: AI_IMAGE_SOURCE,
    credit: { source: "Gemini AI", attribution: "AI-generated image using Google Gemini" },
  };
}

const ACCENTS = ["#48d9e8", "#80aaff", "#72e0b2"];

/** Last resort so a scene never ends up without a visual. */
export function createLocalGraphic(scene: SceneScript, visualBeat: string, imageIndex: number): SelectedImage {
  const title = xmlEscape(scene.title.slice(0, 72));
  const query = xmlEscape(scene.imageQuery.slice(0, 90));
  const accent = ACCENTS[imageIndex] ?? ACCENTS[2];
  const offset = imageIndex * 42;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10283c"/><stop offset=".52" stop-color="#071522"/><stop offset="1" stop-color="#030811"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="${accent}" stop-opacity=".38"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse"><path d="M72 0H0V72" fill="none" stroke="#b7eaff" stroke-opacity=".09" stroke-width="1"/></pattern>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/><rect width="1080" height="1920" fill="url(#grid)"/>
  <circle cx="${520 + offset}" cy="650" r="510" fill="url(#glow)"/>
  <g fill="none" stroke="${accent}" stroke-opacity=".48" stroke-width="3">
    <circle cx="540" cy="720" r="250"/><circle cx="540" cy="720" r="340" stroke-opacity=".22"/><circle cx="540" cy="720" r="430" stroke-opacity=".13"/>
    <path d="M120 850 Q270 760 420 850 T720 850 T1020 850"/><path d="M80 930 Q250 840 420 930 T760 930 T1080 930" stroke-opacity=".25"/>
  </g>
  <g fill="${accent}" fill-opacity=".78"><circle cx="250" cy="490" r="9"/><circle cx="820" cy="580" r="13"/><circle cx="710" cy="1080" r="7"/><circle cx="340" cy="1160" r="11"/></g>
  <rect x="84" y="1320" width="912" height="3" fill="${accent}" fill-opacity=".75"/>
  <text x="84" y="1400" fill="${accent}" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="7">FACTS LAB / VISUAL EXPLAINER</text>
  <text x="84" y="1500" fill="#ffffff" font-family="Arial,sans-serif" font-size="54" font-weight="700">${title}</text>
  <text x="84" y="1580" fill="#c4d8e8" font-family="Arial,sans-serif" font-size="27">${query}</text>
  <text x="84" y="1770" fill="#8da8bc" font-family="Arial,sans-serif" font-size="22" letter-spacing="4">${xmlEscape(visualBeat.toUpperCase())}</text>
  </svg>`;
  return {
    bytes: Buffer.from(svg, "utf8"),
    extension: "svg",
    source: LOCAL_GRAPHIC_SOURCE,
    credit: { source: "FACTS LAB", attribution: "Locally generated vector illustration" },
  };
}
