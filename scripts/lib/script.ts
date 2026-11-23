import fs from "node:fs/promises";
import { z } from "zod";
import { env, paths } from "./config";
import { generateContentWithRetry } from "./gemini";
import { fileExists } from "./util";

export const SceneSchema = z.object({
  title: z.string().min(4).max(90),
  body: z.string().min(40).max(650),
  highlight: z
    .string()
    .transform((value) => value.trim().slice(0, 60))
    .optional()
    .default(""),
  visualPrompt: z.string().min(20).max(700),
  imageQuery: z.string().min(2).max(100),
  seconds: z.number().int().min(8).max(16),
});

export const VideoSchema = z.object({
  title: z.string().min(8).max(90),
  subtitle: z.string().min(10).max(160),
  introSeconds: z.number().int().min(3).max(6),
  outroSeconds: z.number().int().min(3).max(6),
  scenes: z.array(SceneSchema).min(8).max(10),
});

export type SceneScript = z.infer<typeof SceneSchema>;
export type VideoScript = z.infer<typeof VideoSchema>;

const responseJsonSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    subtitle: { type: "STRING" },
    introSeconds: { type: "INTEGER" },
    outroSeconds: { type: "INTEGER" },
    scenes: {
      type: "ARRAY",
      minItems: 8,
      maxItems: 10,
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          body: { type: "STRING" },
          highlight: { type: "STRING" },
          visualPrompt: { type: "STRING" },
          imageQuery: { type: "STRING" },
          seconds: { type: "INTEGER" },
        },
        required: ["title", "body", "highlight", "visualPrompt", "imageQuery", "seconds"],
      },
    },
  },
  required: ["title", "subtitle", "introSeconds", "outroSeconds", "scenes"],
};

const buildPrompt = (topic: string) => `Bạn là biên kịch kiêm biên tập viên kênh FACTS LAB, chuyên làm video kiến thức bằng tiếng Việt.

Hãy tạo MỘT video dọc 9:16 dài mục tiêu khoảng 2 phút, chỉ khai thác MỘT sự thật duy nhất từ chủ đề được cung cấp. Không được biến thành danh sách nhiều sự thật.

Kịch bản cần có mạch kể chuyện: mở đầu gây tò mò, nêu sự thật trung tâm, giải thích cơ chế/nguyên nhân, đưa ví dụ hoặc bằng chứng dễ hiểu, mở rộng một chi tiết bất ngờ, rồi kết luận đáng nhớ. Không lặp ý để kéo dài thời lượng.

Tạo từ 8 đến 10 phân cảnh nối tiếp nhau. Mỗi phân cảnh có title ngắn, body là lời thuyết minh tiếng Việt khoảng 25-40 từ (không viết cụt thành gạch đầu dòng), highlight ngắn, visualPrompt và imageQuery. Tổng lời thuyết minh toàn video, bao gồm title/subtitle và lời kết, nên vào khoảng 260-300 từ để gần 2 phút khi đọc tự nhiên.

Nội dung phải chính xác, có thể kiểm chứng; không bịa số liệu, nghiên cứu, lời trích dẫn hoặc khẳng định tuyệt đối. Nếu kiến thức còn tranh luận, hãy diễn đạt có điều kiện. Không dùng câu “sự thật thứ nhất/thứ hai” vì video chỉ có một fact.

visualPrompt viết bằng tiếng Anh, mô tả một hình ảnh điện ảnh chân thực, cụ thể, phù hợp chính xác với phân cảnh. imageQuery là cụm tìm kiếm ảnh bằng tiếng Anh, 2-5 từ, tập trung vào chủ thể nhìn thấy được. Các phân cảnh cần có hình ảnh đa dạng nhưng nhất quán với cùng chủ đề. Không yêu cầu chữ, logo hoặc watermark trong ảnh; không tạo collage.

Chỉ trả về JSON đúng schema.

Chủ đề video: ${topic}

Hãy chọn một fact thú vị nhất, có đủ chiều sâu để kể thành câu chuyện khoảng 2 phút cho người xem Việt Nam.`;

async function saveScriptCache(topic: string, script: VideoScript) {
  await fs.writeFile(paths.scriptCache, JSON.stringify({ topic, script }, null, 2), "utf8");
}

async function loadCachedScript(topic: string): Promise<VideoScript> {
  try {
    const cachePath = (await fileExists(paths.scriptCache)) ? paths.scriptCache : paths.legacyScriptCache;
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (cached.topic !== topic) throw new Error("Chủ đề không khớp cache");
    const script = VideoSchema.parse(cached.script);
    if (cachePath !== paths.scriptCache) await saveScriptCache(topic, script);
    return script;
  } catch {
    throw new Error(
      'Không có kịch bản cache hợp lệ. Hãy chạy npm run generate -- "chủ đề" trước, không thêm --resume.',
    );
  }
}

export async function loadOrGenerateScript(topic: string, resume: boolean): Promise<VideoScript> {
  if (resume) {
    const script = await loadCachedScript(topic);
    console.log("\n[1/3] Đang dùng lại kịch bản đã lưu (không gọi Gemini)...");
    return script;
  }

  console.log(`\n[1/3] Đang tạo kịch bản bằng ${env.textModel}...`);
  const response = await generateContentWithRetry({
    model: env.textModel,
    contents: buildPrompt(topic),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema,
      temperature: 0.7,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini không trả về nội dung. Kiểm tra model, API key và hạn mức.");

  const script = VideoSchema.parse(JSON.parse(raw));
  await saveScriptCache(topic, script);
  console.log(`Đã lưu bản kịch bản cache: ${paths.scriptCache}`);
  return script;
}
