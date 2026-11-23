import type { SubtitleCue, Timeline } from "../../src/types";
import type { VideoScript } from "./script";

export type NarrationPart =
  | { kind: "intro"; text: string }
  | { kind: "scene"; sceneIndex: number; text: string }
  | { kind: "outro"; text: string };

const OUTRO_TEXT =
  "Nếu điều này khiến bạn nhìn thế giới khác đi, hãy để lại suy nghĩ bên dưới và theo dõi FACTS LAB để khám phá thêm.";

export const buildNarrationParts = (script: VideoScript): NarrationPart[] => [
  { kind: "intro", text: `${script.title}. ${script.subtitle}` },
  ...script.scenes.map((scene, sceneIndex) => ({ kind: "scene" as const, sceneIndex, text: scene.body })),
  { kind: "outro", text: OUTRO_TEXT },
];

export const narrationSegmentName = (part: NarrationPart) =>
  part.kind === "scene" ? `scene-${part.sceneIndex + 1}` : part.kind;

/** When `scaleToTotal` is given, durations are treated as weights and scaled to that total. */
export function buildTimeline(parts: NarrationPart[], durations: number[], scaleToTotal?: number): Timeline {
  const weightSum = durations.reduce((a, b) => a + b, 0);
  const adjusted = scaleToTotal ? durations.map((d) => (d / weightSum) * scaleToTotal) : durations;

  const timeline: Timeline = { intro: { start: 0, end: 0 }, scenes: [], outro: { start: 0, end: 0 } };
  let cursor = 0;
  parts.forEach((part, index) => {
    const range = { start: cursor, end: cursor + (adjusted[index] ?? 0) };
    if (part.kind === "intro") timeline.intro = range;
    else if (part.kind === "scene") timeline.scenes[part.sceneIndex] = range;
    else timeline.outro = range;
    cursor = range.end;
  });
  return timeline;
}

/** Chia phụ đề thành các cụm ngắn, không cắt ngang từ. */
function splitSubtitle(text: string, maxChars = 32): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Spreads each part's chunks across its time range, weighted by chunk length. */
export function buildSubtitleCues(parts: NarrationPart[], timeline: Timeline): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const part of parts) {
    const range =
      part.kind === "intro" ? timeline.intro : part.kind === "scene" ? timeline.scenes[part.sceneIndex] : timeline.outro;
    if (!range || range.end <= range.start) continue;

    const chunks = splitSubtitle(part.text);
    const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0);
    let cursor = range.start;
    chunks.forEach((chunk, index) => {
      const duration =
        index === chunks.length - 1
          ? range.end - cursor
          : ((range.end - range.start) * Math.max(1, chunk.length)) / totalWeight;
      cues.push({ start: cursor, end: cursor + duration, text: chunk });
      cursor += duration;
    });
  }
  return cues;
}
