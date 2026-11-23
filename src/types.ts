export type Credit = Partial<Record<string, string>>;

export type SceneImage = {
  src: string;
  visualBeat?: string;
  credit?: Credit | null;
};

export type Scene = {
  title: string;
  body: string;
  highlight?: string;
  seconds?: number;
  image?: string | null;
  imageCredit?: Credit | null;
  images?: SceneImage[];
};

export type TimeRange = { start: number; end: number };
export type Timeline = { intro: TimeRange; scenes: TimeRange[]; outro: TimeRange };
export type SubtitleCue = { start: number; end: number; text: string };

export type VideoData = {
  title: string;
  subtitle: string;
  introSeconds: number;
  outroSeconds: number;
  scenes: Scene[];
  voiceoverSeconds?: number | null;
  timeline?: Timeline;
  subtitleCues?: SubtitleCue[];
  audio?: { voiceover?: string | null; music?: string | null };
};
