import fs from "node:fs/promises";
import path from "node:path";
import { env, paths } from "./config";
import { narrationSegmentName, type NarrationPart } from "./timeline";
import { fileExists, sha256, sleep } from "./util";

type PcmFormat = { sampleRate: number; channels: number; bitsPerSample: number };
type PcmAudio = PcmFormat & { pcm: Buffer };

const ELEVENLABS_SAMPLE_RATE = 24000;

const bytesPerSecond = ({ sampleRate, channels, bitsPerSample }: PcmFormat) =>
  (sampleRate * channels * bitsPerSample) / 8;

const sameFormat = (a: PcmFormat, b: PcmFormat) =>
  a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitsPerSample === b.bitsPerSample;

/**
 * Synthesizes each narration part separately (cached by text hash) and concatenates them,
 * so per-part durations can drive the video timeline.
 */
export async function buildVoiceover(parts: NarrationPart[]): Promise<{ seconds: number; durations: number[] }> {
  if (env.ttsProvider !== "elevenlabs") {
    throw new Error(`TTS_PROVIDER chưa được hỗ trợ: ${env.ttsProvider}. Hiện hỗ trợ elevenlabs.`);
  }
  if (!env.elevenLabsApiKey || !env.elevenLabsVoiceId) {
    throw new Error("Thiếu ELEVENLABS_API_KEY hoặc ELEVENLABS_VOICE_ID trong file .env.");
  }
  console.log(`[3/3] Đang tạo giọng đọc bằng ElevenLabs (${env.elevenLabsModelId})...`);
  await fs.mkdir(paths.voiceSegments, { recursive: true });

  const segments: PcmAudio[] = [];
  const durations: number[] = [];

  for (const [index, part] of parts.entries()) {
    const segmentName = narrationSegmentName(part);
    const hash = sha256(`${env.ttsProvider}|${env.elevenLabsModelId}|${env.elevenLabsVoiceId}|vi-VN|${part.text}`);
    const segmentPath = path.join(paths.voiceSegments, `${segmentName}-${hash}.wav`);

    let audio: PcmAudio;
    if (await fileExists(segmentPath)) {
      audio = wavToPcm(await fs.readFile(segmentPath));
      console.log(`  Dùng lại audio cache: ${segmentName}`);
    } else {
      console.log(`  Đang tạo audio ${index + 1}/${parts.length}: ${segmentName}...`);
      audio = await synthesizeElevenLabs(part.text, env.elevenLabsApiKey, env.elevenLabsVoiceId);
      await fs.writeFile(segmentPath, pcmToWav(audio));
    }

    if (segments.length && !sameFormat(segments[0], audio)) {
      throw new Error("Các đoạn TTS có định dạng âm thanh khác nhau; không thể ghép an toàn.");
    }
    const duration = audio.pcm.length / bytesPerSecond(audio);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Thời lượng audio không hợp lệ ở đoạn ${segmentName}.`);
    }
    segments.push(audio);
    durations.push(duration);
  }

  if (!segments.length) throw new Error("Không tạo đủ các đoạn audio TTS.");

  const combined: PcmAudio = { ...segments[0], pcm: Buffer.concat(segments.map((s) => s.pcm)) };
  await fs.writeFile(paths.voiceover, pcmToWav(combined));
  return { seconds: combined.pcm.length / bytesPerSecond(combined), durations };
}

async function synthesizeElevenLabs(text: string, apiKey: string, voiceId: string, maxAttempts = 5): Promise<PcmAudio> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_${ELEVENLABS_SAMPLE_RATE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "application/octet-stream" },
        body: JSON.stringify({
          text,
          model_id: env.elevenLabsModelId,
          language_code: "vi",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
        }),
      },
    );

    if (response.ok) {
      const pcm = Buffer.from(await response.arrayBuffer());
      if (pcm.length < 2) throw new Error("ElevenLabs trả về audio rỗng.");
      return { pcm, sampleRate: ELEVENLABS_SAMPLE_RATE, channels: 1, bitsPerSample: 16 };
    }

    const errorText = await response.text();
    const quotaError =
      response.status === 401 || response.status === 403 ||
      /quota|subscription|insufficient|character.*limit/i.test(errorText);
    if (quotaError || ![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
      throw new Error(`ElevenLabs TTS trả lỗi HTTP ${response.status}: ${errorText}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Math.min(
      60_000,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * 2 ** (attempt - 1),
    );
    console.warn(`  ElevenLabs trả HTTP ${response.status}. Thử lại lần ${attempt + 1}/${maxAttempts} sau ${Math.ceil(waitMs / 1000)} giây...`);
    await sleep(waitMs);
  }
  throw new Error("ElevenLabs TTS không thể hoàn tất sau nhiều lần thử.");
}

function pcmToWav({ pcm, sampleRate, channels, bitsPerSample }: PcmAudio): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavToPcm(wav: Buffer): PcmAudio {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("File audio cache không phải WAV hợp lệ.");
  }
  let offset = 12;
  let format: PcmFormat = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
  let audioFormat = 1;
  let pcm: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (dataStart + chunkSize > wav.length) break;
    if (chunkId === "fmt ") {
      audioFormat = wav.readUInt16LE(dataStart);
      format = {
        channels: wav.readUInt16LE(dataStart + 2),
        sampleRate: wav.readUInt32LE(dataStart + 4),
        bitsPerSample: wav.readUInt16LE(dataStart + 14),
      };
    } else if (chunkId === "data") {
      pcm = wav.subarray(dataStart, dataStart + chunkSize);
      break;
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  if (!pcm || audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Chỉ hỗ trợ WAV PCM 16-bit để ghép voiceover.");
  }
  return { ...format, pcm };
}
