import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { GripVertical, Film, ImageIcon, Camera } from 'lucide-react';
import type { Clip, Transition, TransitionType } from '@/hooks/useVideoEditor';

interface TimelineProps {
  clips: Clip[];
  transitions: Transition[];
  totalDurationInFrames: number;
  fps: number;
  currentFrame: number;
  onSeekFrame: (frame: number) => void;
  onReorderClips: (fromIndex: number, toIndex: number) => void;
  onSelectClip: (index: number) => void;
  selectedClipIndex: number | null;
  onTransitionClick?: (afterClipIndex: number) => void;
}

/** Palette of clip colors, cycling through for visual distinction */
const CLIP_COLORS = [
  'bg-blue-500/60 dark:bg-blue-600/50',
  'bg-emerald-500/60 dark:bg-emerald-600/50',
  'bg-violet-500/60 dark:bg-violet-600/50',
  'bg-amber-500/60 dark:bg-amber-600/50',
  'bg-rose-500/60 dark:bg-rose-600/50',
  'bg-cyan-500/60 dark:bg-cyan-600/50',
];

const TRANSITION_ICONS: Record<TransitionType, string> = {
  cut: '',
  crossfade: 'X',
  slide_left: '<',
  slide_up: '^',
  zoom: 'Z',
};

function formatFrameTime(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export function Timeline({
  clips,
  transitions,
  totalDurationInFrames,
  fps,
  currentFrame,
  onSeekFrame,
  onReorderClips,
  onSelectClip,
  selectedClipIndex,
  onTransitionClick,
}: TimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // ── Time ruler ticks ─────────────────────────────────────────────────────

  const totalSeconds = totalDurationInFrames / fps;
  const tickIntervalSec = totalSeconds < 10 ? 1 : totalSeconds < 60 ? 5 : 10;
  const ticks: number[] = [];
  for (let s = 0; s <= totalSeconds; s += tickIntervalSec) {
    ticks.push(s);
  }

  // ── Seek on click ────────────────────────────────────────────────────────

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect || totalDurationInFrames === 0) return;

      const x = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / rect.width));
      onSeekFrame(Math.round(fraction * totalDurationInFrames));
    },
    [totalDurationInFrames, onSeekFrame],
  );

  // ── Drag and drop reorder ────────────────────────────────────────────────

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== index) {
        setDropIndex(index);
      }
    },
    [dragIndex],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
        onReorderClips(dragIndex, dropIndex);
      }
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, dropIndex, onReorderClips],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  // ── Playhead position ────────────────────────────────────────────────────

  const playheadPercent =
    totalDurationInFrames > 0 ? (currentFrame / totalDurationInFrames) * 100 : 0;

  // ── Empty state ──────────────────────────────────────────────────────────

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Film className="h-6 w-6" />
        <span className="text-sm">No clips in timeline</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Time ruler */}
      <div className="relative h-5 select-none" ref={timelineRef} onClick={handleTimelineClick}>
        <div className="absolute inset-0 bg-muted/50 dark:bg-muted/30 rounded-t-md" />
        {ticks.map((sec) => {
          const pct = totalSeconds > 0 ? (sec / totalSeconds) * 100 : 0;
          return (
            <div
              key={sec}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${pct}%` }}
            >
              <div className="w-px h-2 bg-muted-foreground/40" />
              <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
                {Math.floor(sec / 60)}:{String(Math.floor(sec % 60)).padStart(2, '0')}
              </span>
            </div>
          );
        })}

        {/* Playhead on ruler */}
        <div
          className="absolute top-0 w-0.5 h-full bg-cta z-10 pointer-events-none"
          style={{ left: `${playheadPercent}%` }}
        />
      </div>

      {/* Clip track */}
      <div
        className="relative flex h-14 rounded-b-md bg-muted/20 dark:bg-muted/10 border border-border overflow-hidden cursor-pointer"
        onClick={handleTimelineClick}
      >
        {clips.map((clip, index) => {
          const widthPct =
            totalDurationInFrames > 0
              ? (clip.durationInFrames / totalDurationInFrames) * 100
              : 0;

          const color = CLIP_COLORS[index % CLIP_COLORS.length];
          const isSelected = selectedClipIndex === index;
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index;

          // Find transition before this clip
          const transition = transitions.find((t) => t.afterClipIndex === index);

          return (
            <div
              key={clip.id}
              className="relative flex items-center h-full group"
              style={{ width: `${widthPct}%`, minWidth: '24px' }}
            >
              {/* Transition marker */}
              {index > 0 && (
                <button
                  className={cn(
                    'absolute -left-2 top-1/2 -translate-y-1/2 z-20 w-4 h-8 rounded-sm flex items-center justify-center',
                    'bg-background border border-border text-[9px] font-bold text-muted-foreground',
                    'hover:border-cta hover:text-cta transition-colors',
                    transition && transition.type !== 'cut' && 'border-cta/60 text-cta',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransitionClick?.(index);
                  }}
                  title={transition ? `Transition: ${transition.type}` : 'Add transition'}
                >
                  {transition ? TRANSITION_ICONS[transition.type] || '' : '+'}
                </button>
              )}

              {/* Clip block */}
              <div
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectClip(index);
                }}
                className={cn(
                  'flex-1 h-full rounded-sm flex items-center gap-1 transition-all overflow-hidden relative',
                  clip.type !== 'image' && color,
                  isSelected && 'ring-2 ring-cta ring-offset-1 ring-offset-background',
                  isDragging && 'opacity-50',
                  isDropTarget && 'ring-2 ring-cta/50',
                )}
              >
                {/* Image thumbnail background for image clips */}
                {clip.type === 'image' && (
                  <img
                    src={clip.src}
                    alt={clip.label}
                    className="absolute inset-0 w-full h-full object-cover"
                    draggable={false}
                  />
                )}

                {/* Semi-transparent overlay for readability on image clips */}
                {clip.type === 'image' && (
                  <div className="absolute inset-0 bg-black/30" />
                )}

                {/* Content layer */}
                <div className="relative z-10 flex items-center gap-1 px-1.5 w-full h-full">
                  <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-white/70 cursor-grab active:cursor-grabbing" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      {clip.type === 'image' ? (
                        <ImageIcon className="h-2.5 w-2.5 flex-shrink-0 text-white/80" />
                      ) : (
                        <Film className="h-2.5 w-2.5 flex-shrink-0 text-white/80" />
                      )}
                      <p className="text-[10px] font-medium text-white truncate">
                        {clip.label || `Clip ${index + 1}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-white/70">
                        {formatFrameTime(clip.durationInFrames, fps)}
                      </span>
                      {clip.type === 'image' && clip.cameraMove && clip.cameraMove !== 'static' && (
                        <span className="text-[8px] text-white/60 flex items-center gap-0.5">
                          <Camera className="h-2 w-2" />
                          {clip.cameraMove.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 w-0.5 h-full bg-cta z-30 pointer-events-none"
          style={{ left: `${playheadPercent}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-cta rounded-full border-2 border-background" />
        </div>
      </div>

      {/* Duration readout */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
        <span>{formatFrameTime(currentFrame, fps)}</span>
        <span>{clips.length} clips</span>
        <span>{formatFrameTime(totalDurationInFrames, fps)}</span>
      </div>
    </div>
  );
}
