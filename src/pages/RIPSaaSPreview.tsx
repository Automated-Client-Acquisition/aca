import { Player } from "@remotion/player";
import {
  RIPSaaSVideo,
  DEFAULT_RIP_SAAS_PROPS,
} from "@/components/video-editor/remotion/RIPSaaSVideo";

const FPS = 30;
const HOOK_DURATION_SEC = 4;
const SCENE_DURATION_SEC = 5;
const TRANSITION_FRAMES = 10;
const NUM_SCENES = 7; // hook + 6 body scenes

// hook + 6 scenes - 6 transitions
const totalFrames = Math.round(
  (HOOK_DURATION_SEC + 6 * SCENE_DURATION_SEC) * FPS - 6 * TRANSITION_FRAMES
);

export default function RIPSaaSPreview() {
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
        R.I.P SaaS - Viral LinkedIn Video
      </h1>

      <div
        style={{
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 0 60px rgba(239,68,68,0.15)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Player
          component={RIPSaaSVideo}
          inputProps={DEFAULT_RIP_SAAS_PROPS}
          durationInFrames={totalFrames}
          fps={FPS}
          compositionWidth={1080}
          compositionHeight={1920}
          style={{ width: 380, height: 675 }}
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
        {(totalFrames / FPS).toFixed(1)}s total / portrait 1080x1920
      </p>
    </div>
  );
}
