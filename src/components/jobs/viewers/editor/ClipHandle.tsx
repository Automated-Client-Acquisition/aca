import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';

interface ClipHandleProps {
  /** Current trim start in seconds */
  trimStart: number;
  /** Current trim end in seconds */
  trimEnd: number;
  /** Total source duration in seconds */
  sourceDuration: number;
  /** Callback when handles are dragged */
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  /** Minimum trim region in seconds */
  minDuration?: number;
}

export function ClipHandle({
  trimStart,
  trimEnd,
  sourceDuration,
  onTrimChange,
  minDuration = 0.2,
}: ClipHandleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const toPercent = (sec: number) =>
    sourceDuration > 0 ? (sec / sourceDuration) * 100 : 0;

  const startPct = toPercent(trimStart);
  const endPct = toPercent(trimEnd);
  const regionPct = endPct - startPct;

  // ── Mouse / touch dragging ───────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (handle: 'start' | 'end') => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(handle);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / rect.width));
      const seconds = fraction * sourceDuration;

      if (dragging === 'start') {
        const newStart = Math.min(seconds, trimEnd - minDuration);
        onTrimChange(Math.max(0, newStart), trimEnd);
      } else {
        const newEnd = Math.max(seconds, trimStart + minDuration);
        onTrimChange(trimStart, Math.min(sourceDuration, newEnd));
      }
    },
    [dragging, sourceDuration, trimStart, trimEnd, minDuration, onTrimChange],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  // ── Keyboard accessibility ───────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (handle: 'start' | 'end') => (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 1 : 0.1;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? step : -step;
        if (handle === 'start') {
          const newStart = Math.max(0, Math.min(trimEnd - minDuration, trimStart + delta));
          onTrimChange(newStart, trimEnd);
        } else {
          const newEnd = Math.min(sourceDuration, Math.max(trimStart + minDuration, trimEnd + delta));
          onTrimChange(trimStart, newEnd);
        }
      }
    },
    [trimStart, trimEnd, sourceDuration, minDuration, onTrimChange],
  );

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="space-y-2">
      {/* Visual handle bar */}
      <div
        ref={containerRef}
        className="relative h-10 bg-muted/30 dark:bg-muted/20 rounded-md border border-border overflow-hidden select-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Excluded region: before start */}
        <div
          className="absolute inset-y-0 left-0 bg-muted-foreground/10 dark:bg-muted-foreground/5"
          style={{ width: `${startPct}%` }}
        />

        {/* Active region */}
        <div
          className="absolute inset-y-0 bg-cta/15 dark:bg-cta/10 border-y border-cta/30"
          style={{ left: `${startPct}%`, width: `${regionPct}%` }}
        />

        {/* Excluded region: after end */}
        <div
          className="absolute inset-y-0 right-0 bg-muted-foreground/10 dark:bg-muted-foreground/5"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Start handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Trim start"
          aria-valuenow={trimStart}
          aria-valuemin={0}
          aria-valuemax={trimEnd - minDuration}
          onPointerDown={handlePointerDown('start')}
          onKeyDown={handleKeyDown('start')}
          className={cn(
            'absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize z-10',
            'flex items-center justify-center',
            'bg-cta/80 hover:bg-cta rounded-l-sm transition-colors',
            dragging === 'start' && 'bg-cta scale-x-125',
          )}
          style={{ left: `${startPct}%` }}
        >
          <GripVertical className="h-4 w-4 text-cta-foreground" />
        </div>

        {/* End handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Trim end"
          aria-valuenow={trimEnd}
          aria-valuemin={trimStart + minDuration}
          aria-valuemax={sourceDuration}
          onPointerDown={handlePointerDown('end')}
          onKeyDown={handleKeyDown('end')}
          className={cn(
            'absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize z-10',
            'flex items-center justify-center',
            'bg-cta/80 hover:bg-cta rounded-r-sm transition-colors',
            dragging === 'end' && 'bg-cta scale-x-125',
          )}
          style={{ left: `${endPct}%` }}
        >
          <GripVertical className="h-4 w-4 text-cta-foreground" />
        </div>
      </div>

      {/* Time labels */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>Start: {formatTime(trimStart)}</span>
        <span className="font-medium text-foreground">
          Duration: {formatTime(trimEnd - trimStart)}
        </span>
        <span>End: {formatTime(trimEnd)}</span>
      </div>
    </div>
  );
}
