import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Player } from "@remotion/player";
import type { PlayerRef } from "@remotion/player";
import { EditorComposition, TRANSITION_FRAMES } from "./remotion/EditorComposition";
import type { EditorCompositionProps } from "./remotion/EditorComposition";
import { useVideoEditor } from "./context/VideoEditorContext";
import { useDynamicComposition } from "@/hooks/useDynamicComposition";
import { getResolution } from "@/types/videoEditor";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Maximize2, Loader2, AlertCircle } from "lucide-react";

/** Parse @aspect from code comments synchronously (no compilation needed) */
function parseCodeAspect(code: string): { width: number; height: number } | null {
  const match = code.match(/\/\/\s*@aspect\s+(portrait|landscape|square)/i);
  if (!match) return null;
  const a = match[1].toLowerCase();
  if (a === "portrait") return { width: 1080, height: 1920 };
  if (a === "landscape") return { width: 1920, height: 1080 };
  if (a === "square") return { width: 1080, height: 1080 };
  return null;
}

export function VideoPreview() {
  const { state, dispatch, totalDuration, captureFrameRef, seekRef } = useVideoEditor();
  const playerRef = useRef<PlayerRef>(null);
  const { project } = state;

  // Compile remotion_code if present
  const hasRemotionCode = !!project.remotion_code?.trim();
  const dynamicResult = useDynamicComposition(hasRemotionCode ? project.remotion_code! : "");

  // Parse aspect from code synchronously (available immediately, unlike compilation)
  const codeAspect = useMemo(
    () => hasRemotionCode ? parseCodeAspect(project.remotion_code!) : null,
    [hasRemotionCode, project.remotion_code]
  );

  const resolution = getResolution(project.settings.aspect_ratio, project.settings.resolution, project.settings.fps);

  // Use compiled metadata when ready, fall back to synchronously parsed aspect, then project settings
  const fps = dynamicResult.component ? dynamicResult.fps : resolution.fps;
  // Calculate durationInFrames exactly like EditorComposition does:
  // sum of per-scene frames minus transition overlap between scenes
  const durationInFrames = dynamicResult.component
    ? dynamicResult.durationInFrames
    : (() => {
        const sortedScenes = [...project.scenes].sort((a, b) => a.order - b.order);
        if (sortedScenes.length === 0) return Math.max(Math.ceil(totalDuration * fps), fps);
        const transitionCount = sortedScenes.filter(
          (s, i) => i < sortedScenes.length - 1 && s.transition !== "none"
        ).length;
        const totalFrames = sortedScenes.reduce(
          (sum, s) => sum + Math.round(s.duration * fps),
          0
        ) - transitionCount * TRANSITION_FRAMES;
        return Math.max(totalFrames, fps);
      })();
  const compositionWidth = dynamicResult.component
    ? dynamicResult.width
    : codeAspect?.width ?? resolution.width;
  const compositionHeight = dynamicResult.component
    ? dynamicResult.height
    : codeAspect?.height ?? resolution.height;

  // Always go through EditorComposition — pass compiled component as prop
  const compositionProps: EditorCompositionProps = useMemo(
    () => ({
      scenes: project.scenes,
      settings: project.settings,
      voiceover: project.voiceover,
      music: project.music,
      sound_effects: project.sound_effects,
      fps,
      remotionComponent: hasRemotionCode && dynamicResult.component
        ? dynamicResult.component as React.ComponentType<Record<string, unknown>>
        : undefined,
    }),
    [project.scenes, project.settings, project.voiceover, project.music, project.sound_effects, fps, hasRemotionCode, dynamicResult.component]
  );

  // Sync player state - re-run when Player mounts/unmounts (triggered by compilation state)
  const showCompiling = hasRemotionCode && !dynamicResult.component && dynamicResult.isCompiling;
  const showError = hasRemotionCode && !dynamicResult.component && dynamicResult.error && !dynamicResult.isCompiling;
  const playerMounted = !showCompiling && !showError;

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onPlay = () => dispatch({ type: "SET_PLAYING", isPlaying: true });
    const onPause = () => dispatch({ type: "SET_PLAYING", isPlaying: false });
    const onFrameUpdate = (e: { detail: { frame: number } }) => {
      dispatch({ type: "SET_FRAME", frame: e.detail.frame });
    };

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("frameupdate", onFrameUpdate as any);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("frameupdate", onFrameUpdate as any);
    };
  }, [dispatch, playerMounted]);

  // Register seek function into context so Timeline can use it
  useEffect(() => {
    seekRef.current = (frame: number) => {
      playerRef.current?.seekTo(frame);
    };
    return () => {
      seekRef.current = null;
    };
  }, [seekRef, playerMounted]);

  // Register frame capture function into context so ChatPanel can use it
  useEffect(() => {
    captureFrameRef.current = async () => {
      const container = playerRef.current?.getContainerNode();
      if (!container) return null;
      const { default: html2canvas } = await import("html2canvas");
      return html2canvas(container, {
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
    };
    return () => {
      captureFrameRef.current = null;
    };
  }, [captureFrameRef, playerMounted]);

  const togglePlay = useCallback(() => {
    playerRef.current?.toggle();
  }, []);

  const seekToStart = useCallback(() => {
    playerRef.current?.seekTo(0);
  }, []);

  const seekToEnd = useCallback(() => {
    playerRef.current?.seekTo(durationInFrames - 1);
  }, [durationInFrames]);

  const requestFullscreen = useCallback(() => {
    playerRef.current?.requestFullscreen();
  }, []);

  const currentTime = (state.currentFrame / fps).toFixed(1);
  const totalTime = hasRemotionCode && dynamicResult.component
    ? (durationInFrames / fps).toFixed(1)
    : totalDuration.toFixed(1);

  // showCompiling / showError / playerMounted are defined above (before effects)

  const isEmpty = !hasRemotionCode && project.scenes.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Player container */}
      <div className="flex-1 flex items-center justify-center bg-black/50 rounded-lg overflow-hidden min-h-0">
        <div className="relative w-full h-full flex items-center justify-center p-4">
          {isEmpty ? (
            <div className="flex flex-col items-center max-w-[460px] rounded-2xl bg-[#141414] border border-white/10 p-8 shadow-2xl">
              {/* Title */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 mb-5">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[11px] text-amber-300 font-semibold tracking-wide uppercase">MCP-Powered</span>
                </div>
                <h3 className="text-[20px] text-white font-bold tracking-tight">
                  Video Editor
                </h3>
                <p className="text-[13px] text-neutral-400 mt-2">
                  Create videos from your terminal. Preview and export here.
                </p>
              </div>

              {/* Steps with connecting line */}
              <div className="w-full relative">
                {/* Vertical connecting line */}
                <div className="absolute left-[19px] top-[28px] bottom-[28px] w-px bg-gradient-to-b from-amber-400/40 via-amber-400/20 to-emerald-400/40" />

                <div className="space-y-6">
                  {/* Step 1 */}
                  <div className="flex gap-4 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center relative z-10">
                      <span className="text-[14px] font-bold text-amber-300">1</span>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-[14px] text-white font-semibold leading-snug">
                        Install the ACA plugin
                      </p>
                      <p className="text-[12px] text-neutral-400 mt-1.5 leading-relaxed">
                        Add the ACA MCP server to Claude Code or Openclaw. This connects your AI agent to your workspace.
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-4 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center relative z-10">
                      <span className="text-[14px] font-bold text-amber-300">2</span>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-[14px] text-white font-semibold leading-snug">
                        Run a video skill in your terminal
                      </p>
                      <div className="mt-2.5 rounded-lg bg-black border border-white/10 p-3 font-mono text-[13px] space-y-1.5">
                        <div>
                          <span className="text-amber-400 font-bold">$</span>
                          <span className="text-white ml-2">/video-production</span>
                        </div>
                        <div>
                          <span className="text-amber-400 font-bold">$</span>
                          <span className="text-white ml-2">/storyboard-video</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-4 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center relative z-10">
                      <span className="text-[14px] font-bold text-emerald-300">3</span>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-[14px] text-white font-semibold leading-snug">
                        Preview and export
                      </p>
                      <p className="text-[12px] text-neutral-400 mt-1.5 leading-relaxed">
                        The <span className="font-mono text-emerald-300 font-semibold">push_remotion_code</span> MCP tool syncs the video here automatically. Tweak and export when ready.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : showCompiling ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin opacity-40" />
              <p className="text-xs">Compiling composition...</p>
            </div>
          ) : showError ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <AlertCircle className="h-8 w-8 text-destructive/60" />
              <p className="text-xs text-center text-destructive/80 max-w-[300px] leading-relaxed">
                {dynamicResult.error}
              </p>
            </div>
          ) : (
            <Player
              ref={playerRef}
              component={EditorComposition}
              inputProps={compositionProps}
              durationInFrames={durationInFrames}
              fps={fps}
              compositionWidth={compositionWidth}
              compositionHeight={compositionHeight}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                aspectRatio: `${compositionWidth}/${compositionHeight}`,
              }}
              controls={false}
              autoPlay={false}
              loop
              numberOfSharedAudioTags={5}
              acknowledgeRemotionLicense
            />
          )}
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-card border-t border-border">
        <span className="text-xs text-muted-foreground font-mono min-w-[100px]">
          {currentTime}s / {totalTime}s
        </span>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={seekToStart}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={togglePlay}>
            {state.isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={seekToEnd}>
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 min-w-[100px] justify-end">
          <span className="text-xs text-muted-foreground">
            {compositionWidth}x{compositionHeight}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={requestFullscreen}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
