import React from "react";
import { AbsoluteFill, Sequence, Audio } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { SceneRenderer } from "./SceneRenderer";
import { CaptionLayer } from "./CaptionLayer";
import type { VideoScene, VideoSettings, VoiceoverTrack, MusicTrack, SoundEffect } from "@/types/videoEditor";

export const TRANSITION_FRAMES = 8;
const PREMOUNT_FRAMES = 15;

/** Only allow audio URLs that look valid and are likely CORS-safe */
function isPlayableUrl(url: string | undefined): boolean {
  if (!url) return false;
  // Skip placeholder paths that don't exist
  if (url.startsWith("/music/")) return false;
  // Skip known CORS-blocked domains
  if (url.includes("bensound.com")) return false;
  return true;
}

export interface EditorCompositionProps {
  scenes: VideoScene[];
  settings: VideoSettings;
  voiceover?: VoiceoverTrack;
  music?: MusicTrack;
  sound_effects?: SoundEffect[];
  fps: number;
  /** When set, renders this compiled Remotion component instead of the scenes array */
  remotionComponent?: React.ComponentType<Record<string, unknown>>;
}

function getTransitionPresentation(type: VideoScene["transition"]) {
  switch (type) {
    case "fade":
      return fade();
    case "slide":
      return slide({ direction: "from-right" });
    case "wipe":
      return wipe({ direction: "from-left" });
    case "none":
    default:
      return undefined;
  }
}

export const EditorComposition: React.FC<EditorCompositionProps> = ({
  scenes,
  settings,
  voiceover,
  music,
  sound_effects,
  fps,
  remotionComponent: RemotionComponent,
}) => {
  const sortedScenes = [...scenes].sort((a, b) => a.order - b.order);
  const clipFrames = sortedScenes.map((s) => Math.round(s.duration * fps));

  // Calculate entry frame for each scene (for text animation timing)
  let cumulativeFrame = 0;
  const entryFrames = clipFrames.map((frames, i) => {
    const entry = cumulativeFrame;
    cumulativeFrame += frames - (i < clipFrames.length - 1 ? TRANSITION_FRAMES : 0);
    return entry;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Remotion code component — takes over the video layer when present */}
      {RemotionComponent ? (
        <RemotionComponent />
      ) : sortedScenes.length > 0 ? (
        /* Scene clips with transitions */
        <TransitionSeries>
          {sortedScenes.map((scene, i) => {
            const transition = i > 0 ? getTransitionPresentation(scene.transition) : undefined;
            return (
              <React.Fragment key={scene.id}>
                {i > 0 && transition && (
                  <TransitionSeries.Transition
                    presentation={transition}
                    timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
                  />
                )}
                <TransitionSeries.Sequence
                  durationInFrames={clipFrames[i]}
                  premountFor={PREMOUNT_FRAMES}
                >
                  <SceneRenderer scene={scene} entryFrame={entryFrames[i]} />
                </TransitionSeries.Sequence>
              </React.Fragment>
            );
          })}
        </TransitionSeries>
      ) : (
        /* Empty state */
        <AbsoluteFill
          style={{
            backgroundColor: "#0f0f23",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.4)",
              fontSize: 32,
              fontFamily: "Arial, sans-serif",
            }}
          >
            Add scenes to get started
          </div>
        </AbsoluteFill>
      )}

      {/* Voiceover */}
      {isPlayableUrl(voiceover?.url) && (
        <Sequence from={0}>
          <Audio src={voiceover!.url} volume={1.0} />
        </Sequence>
      )}

      {/* Background music */}
      {isPlayableUrl(music?.url) && (
        <Sequence from={0}>
          <Audio src={music!.url} volume={music!.volume ?? 0.1} />
        </Sequence>
      )}

      {/* Sound effects */}
      {sound_effects?.map((sfx) =>
        isPlayableUrl(sfx.url) ? (
          <Sequence
            key={sfx.id}
            from={Math.round(sfx.timestamp * fps)}
            durationInFrames={Math.round(sfx.duration * fps)}
          >
            <Audio src={sfx.url} volume={sfx.volume ?? 0.5} />
          </Sequence>
        ) : null
      )}

      {/* Captions */}
      {settings.caption_style &&
        settings.caption_style !== "none" &&
        voiceover?.word_timestamps &&
        voiceover.word_timestamps.length > 0 && (
          <CaptionLayer
            words={voiceover.word_timestamps}
            style={settings.caption_style}
            position={settings.caption_position}
            fontSize={settings.caption_font_size}
            brand={settings.brand}
          />
        )}
    </AbsoluteFill>
  );
};
