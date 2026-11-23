import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Scene, Timeline, VideoData } from "./types";

const FPS = 30;
const FONT = '"Segoe UI Variable", "Segoe UI", Inter, "Noto Sans", Arial, sans-serif';
const CYAN = "#65e6ed";

const getTimeline = (video: VideoData): Timeline => {
  if (video.timeline && video.timeline.scenes?.length === video.scenes.length) {
    return video.timeline;
  }

  let cursor = video.introSeconds;
  const scenes = video.scenes.map((scene) => {
    const start = cursor;
    cursor += scene.seconds ?? 6;
    return { start, end: cursor };
  });
  const contentSeconds = cursor;
  const outroDuration = Math.max(
    video.outroSeconds,
    (video.voiceoverSeconds ?? 0) - contentSeconds,
  );
  return {
    intro: { start: 0, end: video.introSeconds },
    scenes,
    outro: { start: cursor, end: cursor + outroDuration },
  };
};

export const getVideoDuration = (video: VideoData) => {
  const timeline = getTimeline(video);
  return Math.ceil((Math.max(timeline.outro.end, video.voiceoverSeconds ?? 0) + 0.3) * FPS);
};

const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 70) * 18;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 32%, #172b3b 0%, #080e17 55%, #03060b 100%)" }}>
      <div
        style={{
          position: "absolute",
          inset: -80,
          opacity: 0.12,
          backgroundImage:
            "linear-gradient(rgba(120,210,255,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(120,210,255,.10) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
          transform: `translate(${drift}px, ${-drift}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: CYAN,
          filter: "blur(180px)",
          opacity: 0.09,
          left: "8%",
          top: "18%",
        }}
      />
    </AbsoluteFill>
  );
};

const ImageBeat: React.FC<{ src: string; index: number }> = ({ src, index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeFrames = 8;
  const opacity = interpolate(
    frame,
    [0, fadeFrames, Math.max(fadeFrames + 1, durationInFrames - fadeFrames), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const progress = frame / Math.max(1, durationInFrames);
  const zoomStart = index % 2 === 0 ? 1.025 : 1.09;
  const zoomEnd = index % 2 === 0 ? 1.09 : 1.025;
  const zoom = interpolate(progress, [0, 1], [zoomStart, zoomEnd]);
  const drift = interpolate(progress, [0, 1], [index % 2 === 0 ? -14 : 14, index % 2 === 0 ? 14 : -14]);
  const rotate = index % 3 === 1 ? interpolate(progress, [0, 1], [-0.25, 0.25]) : 0;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", transform: `translateX(${drift}px) scale(${zoom}) rotate(${rotate}deg)`, filter: "saturate(1.07) contrast(1.045)" }} />
    </AbsoluteFill>
  );
};

const MultiImageBackground: React.FC<{ images?: Scene["images"]; fallback?: string | null; sceneIndex: number }> = ({ images, fallback, sceneIndex }) => {
  const { durationInFrames } = useVideoConfig();
  const validImages = (images ?? []).filter((item) => item?.src);
  const list = validImages.length ? validImages : fallback ? [{ src: fallback }] : [];
  if (!list.length) return <Backdrop />;
  const beatDuration = durationInFrames / list.length;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#070b11" }}>
      {list.map((item, index) => {
        const fadeOverlap = 8;
        const from = index === 0 ? 0 : Math.max(0, Math.round(index * beatDuration) - fadeOverlap);
        const end = index === list.length - 1 ? durationInFrames : Math.min(durationInFrames, Math.round((index + 1) * beatDuration) + fadeOverlap);
        return (
          <Sequence key={`image-beat-${sceneIndex}-${index}`} from={from} durationInFrames={Math.max(1, end - from)}>
            <ImageBeat src={item.src} index={index + sceneIndex} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const TextScene: React.FC<{
  title: string;
  intro?: boolean;
  outro?: boolean;
  image?: string | null;
  images?: Scene["images"];
  sceneIndex?: number;
}> = ({ title, intro, outro, image, images, sceneIndex = 0 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeIn = 12;
  const fadeOut = 14;
  const opacity = interpolate(
    frame,
    [0, fadeIn, Math.max(fadeIn + 1, durationInFrames - fadeOut), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const titleY = interpolate(frame, [0, 24], [24, 0], { extrapolateRight: "clamp" });
  const titleSize = title.length > 42 ? 54 : title.length > 28 ? 60 : intro ? 76 : 68;

  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity, backgroundColor: "#070b11" }}>
      {(images?.length || image) ? (
        <>
          <MultiImageBackground images={images} fallback={image} sceneIndex={sceneIndex} />
          <AbsoluteFill
            style={{
              background: "linear-gradient(180deg, rgba(3,7,13,.34) 0%, rgba(3,7,13,.08) 28%, rgba(3,7,13,.10) 58%, rgba(3,7,13,.56) 100%)",
            }}
          />
          <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,.22) 100%)" }} />
        </>
      ) : (
        <Backdrop />
      )}

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 82px",
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div style={{ width: "100%", textAlign: "center", marginTop: intro ? -80 : -30 }}>
          <div
            style={{
              fontFamily: FONT,
              color: CYAN,
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: 5,
              textTransform: "uppercase",
              marginBottom: 28,
              textShadow: "0 2px 18px rgba(0,0,0,.55)",
            }}
          >
            {intro ? "FACTS LAB  /  KHÁM PHÁ ĐIỀU KỲ DIỆU" : outro ? "FACTS LAB  /  TÌM HIỂU THÊM" : "SỰ THẬT BẠN CHƯA BIẾT"}
          </div>
          <div
            style={{
              fontFamily: FONT,
              color: "#fff",
              fontWeight: 850,
              fontSize: titleSize,
              lineHeight: 1.13,
              letterSpacing: -1.5,
              maxWidth: 930,
              margin: "0 auto",
              textShadow: "0 4px 26px rgba(0,0,0,.72), 0 1px 3px rgba(0,0,0,.8)",
            }}
          >
            {title}
          </div>
          <div
            style={{
              width: 84,
              height: 5,
              borderRadius: 10,
              background: CYAN,
              margin: "30px auto 0",
              boxShadow: "0 0 22px rgba(101,230,237,.35)",
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Subtitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeOutStart = Math.max(5, durationInFrames - 6);
  const opacity = interpolate(frame, [0, 4, fadeOutStart, fadeOutStart + 6], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [0, 7], [12, 0], { extrapolateRight: "clamp" });
  const fontSize = text.length > 35 ? 34 : 39;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 72px 172px",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${y}px)`,
          maxWidth: 940,
          color: "#fff",
          fontFamily: FONT,
          fontSize,
          lineHeight: 1.28,
          fontWeight: 750,
          textAlign: "center",
          letterSpacing: -0.4,
          textShadow: "0 2px 4px rgba(0,0,0,.95), 0 4px 18px rgba(0,0,0,.95)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};


const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = Math.min(100, (frame / durationInFrames) * 100);
  return (
    <div style={{ height: "100%", width: `${progress}%`, background: CYAN }} />
  );
};

export const FactsVideo: React.FC<{ video: VideoData }> = ({ video }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const timeline = getTimeline(video);
  const toFrame = (seconds: number) => Math.max(0, Math.round(seconds * fps));

  const sequences = video.scenes.map((scene, index) => {
    const range = timeline.scenes[index];
    const from = toFrame(range.start);
    const duration = Math.max(1, toFrame(range.end) - from);
    return (
      <Sequence key={`scene-${index}`} from={from} durationInFrames={duration}>
        <TextScene title={scene.title} image={scene.image} images={scene.images} sceneIndex={index} />
      </Sequence>
    );
  });

  const introFrom = toFrame(timeline.intro.start);
  const introDuration = Math.max(1, toFrame(timeline.intro.end) - introFrom);
  const outroFrom = toFrame(timeline.outro.start);
  const outroDuration = Math.max(1, toFrame(timeline.outro.end) - outroFrom);

  const voiceVolume = (frame: number) =>
    interpolate(frame, [0, 15, Math.max(16, durationInFrames - 15), durationInFrames], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const musicVolume = (frame: number) =>
    interpolate(frame, [0, 45, Math.max(46, durationInFrames - 45), durationInFrames], [0, 0.085, 0.085, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const subtitleSequences = (video.subtitleCues ?? [])
    .filter((cue) => cue.end > cue.start && cue.text.trim())
    .map((cue, index) => {
      const from = toFrame(cue.start);
      const duration = Math.max(1, toFrame(cue.end) - from);
      return (
        <Sequence key={`subtitle-${index}`} from={from} durationInFrames={duration}>
          <Subtitle text={cue.text} />
        </Sequence>
      );
    });

  return (
    <AbsoluteFill style={{ backgroundColor: "#05080d" }}>
      <Backdrop />
      <Sequence from={introFrom} durationInFrames={introDuration}>
        <TextScene title={video.title} intro />
      </Sequence>
      {sequences}
      <Sequence from={outroFrom} durationInFrames={outroDuration}>
        <TextScene title="Bạn sẽ nhìn thế giới khác đi chứ?" outro />
      </Sequence>
      {subtitleSequences}

      {video.audio?.voiceover && (
        <Audio src={staticFile(video.audio.voiceover)} volume={voiceVolume} />
      )}
      {video.audio?.music && (
        <Audio src={staticFile(video.audio.music)} volume={musicVolume} />
      )}

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          justifyContent: "flex-end",
          padding: "0 48px 24px",
        }}
      >
        <div style={{ height: 5, background: "rgba(255,255,255,.30)", borderRadius: 9, overflow: "hidden" }}>
          <ProgressBar />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

