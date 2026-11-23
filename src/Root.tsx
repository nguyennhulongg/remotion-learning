import React from "react";
import {Composition} from "remotion";
import {FactsVideo, getVideoDuration} from "./Composition";
import video from "../public/assets/video.json";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="FactsVideo"
    component={FactsVideo}
    durationInFrames={getVideoDuration(video)}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{video}}
  />
);
