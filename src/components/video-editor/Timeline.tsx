import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVideoEditor } from "./context/VideoEditorContext";
import { useDynamicComposition } from "@/hooks/useDynamicComposition";
import { cn } from "@/lib/utils";
import { Music, Mic, Plus, Zap, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { VideoScene } from "@/types/videoEditor";
import { getResolution } from "@/types/videoEditor";
import { TRANSITION_FRAMES } from "./remotion/EditorComposition";

const SCENE_COLORS = [
  "bg-blue-500/40 border-blue-500/60",
  "bg-purple-500/40 border-purple-500/60",
  "bg-emerald-500/40 border-emerald-500/60",
  "bg-amber-500/40 border-amber-500/60",
  "bg-rose-500/40 border-rose-500/60",
  "bg-cyan-500/40 border-cyan-500/60",
  "bg-indigo-500/40 border-indigo-500/60",
  "bg-orange-500/40 border-orange-500/60",
];

// TRANSITION_OVERLAP derived from TRANSITION_FRAMES at runtime (see sceneLayouts)
const TRACK_HEIGHT = 24;
const LABEL_WIDTH = 120;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

export function Timeline() {
  const {
    state,
    selectScene,
    addScene,
    totalDuration,
    updateScene,
    setPanel,
    seekRef,
  } = useVideoEditor();
  const { project, selectedSceneId, currentFrame } = state;
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1); // 1 = fit-to-view, higher = zoomed in

  // Use code metadata for fps/duration when remotion_code exists
  const hasRemotionCode = !!project.remotion_code?.trim();
  const dynamicResult = useDynamicComposition(hasRemotionCode ? project.remotion_code! : "");

  const resolution = getResolution(project.settings.aspect_ratio, project.settings.resolution, project.settings.fps);
  const fps = hasRemotionCode && dynamicResult.component ? dynamicResult.fps : resolution.fps;
  const codeDuration = hasRemotionCode && dynamicResult.component
    ? dynamicResult.durationInFrames / dynamicResult.fps
    : 0;
  const currentTime = currentFrame / fps;

  const sortedScenes = useMemo(
    () => [...project.scenes].sort((a, b) => a.order - b.order),
    [project.scenes]
  );
  // Calculate each scene's start time (accounting for transition overlaps)
  // Use TRANSITION_FRAMES / fps to match exactly what EditorComposition renders
  const transitionOverlapSec = TRANSITION_FRAMES / fps;
  const sceneLayouts = useMemo(() => {
    let startTime = 0;
    return sortedScenes.map((scene, i) => {
      const layout = { startTime, duration: scene.duration };
      const overlap = i < sortedScenes.length - 1 && scene.transition !== "none"
        ? transitionOverlapSec
        : 0;
      startTime += scene.duration - overlap;
      return layout;
    });
  }, [sortedScenes, transitionOverlapSec]);

  // Effective duration must encompass all content: scenes, code duration, music, voiceover
  const scenesEndTime = sceneLayouts.length > 0
    ? sceneLayouts[sceneLayouts.length - 1].startTime + sortedScenes[sortedScenes.length - 1].duration
    : totalDuration;
  const effectiveDuration = Math.max(codeDuration || 0, scenesEndTime, totalDuration, 1);

  // Time ruler ticks - more ticks when zoomed in
  const ticks = useMemo(() => {
    const result: number[] = [];
    const visibleDuration = effectiveDuration / zoom;
    const step = visibleDuration <= 5 ? 0.5 : visibleDuration <= 10 ? 1 : visibleDuration <= 30 ? 3 : visibleDuration <= 60 ? 5 : 10;
    for (let t = 0; t <= effectiveDuration; t += step) {
      result.push(t);
    }
    return result;
  }, [effectiveDuration, zoom]);

  const handleAddScene = useCallback(() => {
    const newScene: VideoScene = {
      id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      order: project.scenes.length,
      duration: 5,
      media: { type: "color", url: "#1a1a2e", source: "uploaded" },
      transition: "fade",
    };
    addScene(newScene);
    selectScene(newScene.id);
  }, [project.scenes.length, addScene, selectScene]);

  // Zoom controls
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.5, 20)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.5, 1)), []);
  const zoomFit = useCallback(() => setZoom(1), []);

  // Ctrl+scroll to zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const container = scrollContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pointerRatio = (e.clientX - rect.left + container.scrollLeft) / (rect.scrollWidth);

      setZoom((prev) => {
        const next = Math.max(1, Math.min(20, prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        // After zoom, scroll to keep pointer position stable
        requestAnimationFrame(() => {
          if (!container) return;
          const newScrollWidth = container.scrollWidth;
          container.scrollLeft = pointerRatio * newScrollWidth - (e.clientX - rect.left);
        });
        return next;
      });
    },
    []
  );

  // Sync ruler scroll with track scroll
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = scrollContainerRef.current.scrollLeft;
    }
  }, []);

  const playheadPercent =
    totalDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;

  // Auto-scroll to keep playhead visible when playing
  useEffect(() => {
    if (zoom <= 1) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const playheadPx = (playheadPercent / 100) * container.scrollWidth;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    if (playheadPx < viewLeft + 20 || playheadPx > viewRight - 20) {
      container.scrollLeft = playheadPx - container.clientWidth / 2;
    }
  }, [playheadPercent, zoom]);

  // Seek to position from pointer event on the track area
  const seekToPointer = useCallback(
    (clientX: number) => {
      const rect = trackAreaRef.current?.getBoundingClientRect();
      if (!rect || effectiveDuration === 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = ratio * effectiveDuration;
      const targetFrame = Math.round(targetTime * fps);
      seekRef.current?.(targetFrame);
    },
    [effectiveDuration, fps, seekRef]
  );

  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only seek if clicking on the background, not on a scene block
      if ((e.target as HTMLElement).dataset.trackBg !== "true") return;
      seekToPointer(e.clientX);
      const onMove = (ev: MouseEvent) => seekToPointer(ev.clientX);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [seekToPointer]
  );

  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const onMove = (ev: MouseEvent) => seekToPointer(ev.clientX);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [seekToPointer]
  );

  const hasSfx = (project.sound_effects?.length ?? 0) > 0;
  const totalTracks = sortedScenes.length + 2 + (hasSfx ? 1 : 0); // scenes + voiceover + music + sfx

  return (
    <div className="flex flex-col bg-card border-t border-border select-none">
      {/* Header: time display + ruler */}
      <div className="flex" style={{ marginLeft: LABEL_WIDTH }}>
        <div ref={rulerScrollRef} className="flex-1 overflow-hidden relative h-5 border-b border-border/50">
          <div className="relative h-full" style={{ width: `${zoom * 100}%` }}>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 bottom-0 flex flex-col items-center"
                style={{ left: `${(t / effectiveDuration) * 100}%` }}
              >
                <span className="text-[8px] text-muted-foreground/60 leading-none mt-0.5">
                  {formatTime(t)}
                </span>
                <div className="flex-1 w-px bg-border/30" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tracks area */}
      <div className="flex relative">
        {/* Labels column */}
        <div
          className="flex-shrink-0 border-r border-border/30"
          style={{ width: LABEL_WIDTH }}
        >
          {sortedScenes.map((scene, i) => (
            <div
              key={scene.id}
              className={cn(
                "flex items-center gap-1.5 px-2 cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/10",
                selectedSceneId === scene.id && "bg-muted/50"
              )}
              style={{ height: TRACK_HEIGHT }}
              onClick={() => selectScene(scene.id)}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: `hsl(${(i * 45) % 360}, 60%, 55%)`,
                }}
              />
              <span className="text-[10px] font-medium text-foreground/80 truncate">
                {i + 1}-{scene.skill_composition?.id
                  ? scene.skill_composition.id.replace(/^inbox_cost_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                  : `Scene ${i + 1}`}
              </span>
            </div>
          ))}
          {/* Voiceover label */}
          <div
            className="flex items-center gap-1.5 px-2 cursor-pointer hover:bg-blue-500/10 transition-colors border-b border-border/10"
            style={{ height: TRACK_HEIGHT }}
            onClick={() => setPanel("voiceover")}
          >
            <Mic className="h-2.5 w-2.5 text-blue-400 flex-shrink-0" />
            <span className="text-[10px] text-blue-400/80">Voiceover</span>
          </div>
          {/* Music label */}
          <div
            className="flex items-center gap-1.5 px-2 cursor-pointer hover:bg-purple-500/10 transition-colors border-b border-border/10"
            style={{ height: TRACK_HEIGHT }}
            onClick={() => setPanel("music")}
          >
            <Music className="h-2.5 w-2.5 text-purple-400 flex-shrink-0" />
            <span className="text-[10px] text-purple-400/80">Music</span>
          </div>
          {/* SFX label */}
          {hasSfx && (
            <div
              className="flex items-center gap-1.5 px-2 cursor-pointer hover:bg-amber-500/10 transition-colors"
              style={{ height: TRACK_HEIGHT }}
              onClick={() => setPanel("sfx")}
            >
              <Zap className="h-2.5 w-2.5 text-amber-400 flex-shrink-0" />
              <span className="text-[10px] text-amber-400/80">SFX ({project.sound_effects?.length})</span>
            </div>
          )}
        </div>

        {/* Track blocks area - scrollable when zoomed */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden"
          style={{ height: totalTracks * TRACK_HEIGHT }}
          onWheel={handleWheel}
          onScroll={handleScroll}
        >
        <div
          ref={trackAreaRef}
          className="relative cursor-crosshair h-full"
          style={{ width: `${zoom * 100}%` }}
          onMouseDown={handleTrackMouseDown}
        >
          {/* Grid lines */}
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute top-0 bottom-0 w-px bg-border/10"
              style={{ left: `${(t / effectiveDuration) * 100}%` }}
              data-track-bg="true"
            />
          ))}

          {/* Row backgrounds */}
          {Array.from({ length: totalTracks }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-b border-border/10"
              style={{ top: i * TRACK_HEIGHT, height: TRACK_HEIGHT }}
              data-track-bg="true"
            />
          ))}

          {/* Scene blocks */}
          {sortedScenes.map((scene, index) => {
            const layout = sceneLayouts[index];
            const leftPercent = (layout.startTime / effectiveDuration) * 100;
            const widthPercent = (layout.duration / effectiveDuration) * 100;
            const colorClass = SCENE_COLORS[index % SCENE_COLORS.length];

            return (
              <div
                key={scene.id}
                className={cn(
                  "absolute flex items-center border rounded-sm cursor-pointer transition-colors",
                  "hover:brightness-125",
                  colorClass,
                  selectedSceneId === scene.id && "ring-1 ring-primary ring-offset-1 ring-offset-card"
                )}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  top: index * TRACK_HEIGHT + 2,
                  height: TRACK_HEIGHT - 4,
                  minWidth: 20,
                }}
                onClick={(e) => { e.stopPropagation(); selectScene(scene.id); }}
              >
                <span className="text-[9px] text-white/80 truncate px-1.5 font-medium">
                  {scene.duration}s
                </span>

                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30 rounded-r-sm"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startDuration = scene.duration;
                    const containerWidth =
                      trackAreaRef.current?.getBoundingClientRect().width ?? 500;
                    const pxPerSecond = containerWidth / effectiveDuration;

                    const onMove = (ev: MouseEvent) => {
                      const delta = ev.clientX - startX;
                      const newDuration = Math.max(
                        0.5,
                        Math.round((startDuration + delta / pxPerSecond) * 2) / 2
                      );
                      updateScene(scene.id, { duration: newDuration });
                    };

                    const onUp = () => {
                      document.removeEventListener("mousemove", onMove);
                      document.removeEventListener("mouseup", onUp);
                    };

                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                  }}
                />
              </div>
            );
          })}

          {/* Voiceover block - spans the video duration */}
          {project.voiceover?.url && (
            <div
              className="absolute bg-blue-500/20 border border-blue-500/30 rounded-sm flex items-center px-1.5"
              style={{
                left: 0,
                width: `${Math.min((scenesEndTime / effectiveDuration) * 100, 100)}%`,
                top: sortedScenes.length * TRACK_HEIGHT + 2,
                height: TRACK_HEIGHT - 4,
              }}
              onClick={(e) => { e.stopPropagation(); setPanel("voiceover"); }}
            >
              <span className="text-[9px] text-blue-400 truncate">Voiceover</span>
            </div>
          )}

          {/* Music block - spans the video duration */}
          {project.music?.url && (
            <div
              className="absolute bg-purple-500/20 border border-purple-500/30 rounded-sm flex items-center px-1.5"
              style={{
                left: 0,
                width: `${Math.min((scenesEndTime / effectiveDuration) * 100, 100)}%`,
                top: (sortedScenes.length + 1) * TRACK_HEIGHT + 2,
                height: TRACK_HEIGHT - 4,
              }}
              onClick={(e) => { e.stopPropagation(); setPanel("music"); }}
            >
              <span className="text-[9px] text-purple-400 truncate">
                {project.music.title || "Music"} ({Math.round(project.music.volume * 100)}%)
              </span>
            </div>
          )}

          {/* SFX blocks */}
          {hasSfx && project.sound_effects?.map((sfx) => {
            const leftPct = (sfx.timestamp / effectiveDuration) * 100;
            const widthPct = (sfx.duration / effectiveDuration) * 100;
            const sfxTrackTop = (sortedScenes.length + 2) * TRACK_HEIGHT + 2;
            return (
              <div
                key={sfx.id}
                className="absolute bg-amber-500/25 border border-amber-500/40 rounded-sm flex items-center px-1 hover:brightness-125 cursor-pointer"
                style={{
                  left: leftPct + "%",
                  width: Math.max(widthPct, 0.5) + "%",
                  top: sfxTrackTop,
                  height: TRACK_HEIGHT - 4,
                  minWidth: 16,
                }}
                title={sfx.name + " @ " + sfx.timestamp + "s (" + sfx.duration + "s)"}
                onClick={(e) => { e.stopPropagation(); setPanel("sfx"); }}
              >
                <span className="text-[8px] text-amber-400 truncate">{sfx.name}</span>
              </div>
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
            style={{ left: `${playheadPercent}%` }}
          >
            <div
              className="absolute -top-1 left-1/2 -translate-x-1/2 pointer-events-auto cursor-col-resize"
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-red-500" />
            </div>
          </div>
        </div>{/* /trackArea (zoomed inner) */}
        </div>{/* /scrollContainer */}

        {/* Add scene button */}
        <button
          className="flex-shrink-0 w-7 flex items-center justify-center border-l border-border/30 hover:bg-muted/30 transition-colors"
          onClick={handleAddScene}
          title="Add scene"
        >
          <Plus className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      {/* Footer: current time + zoom controls */}
      <div className="flex items-center px-2 py-0.5 border-t border-border/30">
        <span className="text-[9px] font-mono text-muted-foreground">
          {formatTime(currentTime)}
        </span>
        <span className="text-[9px] text-muted-foreground/40 ml-1">
          / {formatTime(effectiveDuration)}
        </span>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 ml-auto mr-2">
          <button
            className="p-0.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-30"
            onClick={zoomOut}
            disabled={zoom <= 1}
            title="Zoom out"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <input
            type="range"
            min={1}
            max={20}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-16 h-1 accent-muted-foreground/50 cursor-pointer"
            title={`Zoom: ${Math.round(zoom * 100)}%`}
          />
          <button
            className="p-0.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground/60 hover:text-muted-foreground"
            onClick={zoomIn}
            title="Zoom in"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <button
            className="p-0.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-30 ml-0.5"
            onClick={zoomFit}
            disabled={zoom === 1}
            title="Fit to view"
          >
            <Maximize2 className="h-2.5 w-2.5" />
          </button>
          <span className="text-[8px] text-muted-foreground/40 w-7 text-right tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        <span className="text-[9px] text-muted-foreground/40">
          {fps}fps - {sortedScenes.length} scenes
        </span>
      </div>
    </div>
  );
}
