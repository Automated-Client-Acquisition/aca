import { Player } from "@remotion/player";
import {
  AINewsVideo,
  DEFAULT_NEWS_PROPS,
} from "@/components/video-editor/remotion/AINewsVideo";

const FPS = 30;
const SCENE_DURATION_SEC = 5;
const INTRO_DURATION_SEC = 3;
const OUTRO_DURATION_SEC = 3;
const TRANSITION_FRAMES = 12;

export default function AINewsPreview() {
  const totalScenes = DEFAULT_NEWS_PROPS.newsItems.length;
  // intro + (news scenes) + outro - transitions overlap
  const totalTransitions = totalScenes + 1; // transitions between intro->scenes and scenes->outro
  const totalFrames = Math.round(
    (INTRO_DURATION_SEC +
      totalScenes * SCENE_DURATION_SEC +
      OUTRO_DURATION_SEC) *
      FPS -
      totalTransitions * TRANSITION_FRAMES
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a1a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        gap: 24,
      }}
    >
      <h1
        style={{
          color: "white",
          fontFamily: "Arial, sans-serif",
          fontSize: 24,
          fontWeight: 700,
          margin: 0,
        }}
      >
        AI News Video Preview
      </h1>

      <div
        style={{
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 0 60px rgba(99,102,241,0.15)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Player
          component={AINewsVideo}
          inputProps={DEFAULT_NEWS_PROPS}
          durationInFrames={totalFrames}
          fps={FPS}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{ width: 960, height: 540 }}
          controls
          autoPlay={false}
          loop
          acknowledgeRemotionLicense
        />
      </div>

      <p
        style={{
          color: "rgba(255,255,255,0.4)",
          fontFamily: "monospace",
          fontSize: 14,
          margin: 0,
        }}
      >
        {totalFrames} frames / {FPS} fps /{" "}
        {(totalFrames / FPS).toFixed(1)}s total
      </p>
    </div>
  );
}
