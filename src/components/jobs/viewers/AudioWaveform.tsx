import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { cn } from '@/lib/utils';
import { GripVertical, Loader2 } from 'lucide-react';

interface AudioWaveformProps {
  videoUrl: string;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  // Trim mode props
  trimStart?: number;
  trimEnd?: number;
  onTrimChange?: (start: number, end: number) => void;
  // Cut mode props
  cutStart?: number;
  cutEnd?: number;
  onCutChange?: (start: number, end: number) => void;
  // Mode
  mode: 'trim' | 'cut' | null;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export function AudioWaveform({
  videoUrl,
  duration,
  currentTime,
  onSeek,
  trimStart = 0,
  trimEnd,
  onTrimChange,
  cutStart,
  cutEnd,
  onCutChange,
  mode,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragging, setDragging] = useState<'trimStart' | 'trimEnd' | 'cutStart' | 'cutEnd' | null>(null);

  const effectiveTrimEnd = trimEnd ?? duration;
  const effectiveCutStart = cutStart ?? duration * 0.4;
  const effectiveCutEnd = cutEnd ?? duration * 0.6;

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !videoUrl) return;

    setIsLoading(true);
    setError(null);

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#6b7280',
      progressColor: 'hsl(var(--primary))',
      cursorColor: '#ec4899',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 60,
      normalize: true,
      interact: false, // We handle interaction ourselves
      hideScrollbar: true,
    });

    wavesurferRef.current = wavesurfer;

    wavesurfer.on('ready', () => {
      setIsLoading(false);
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    });

    wavesurfer.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      setError('Failed to load audio waveform');
      setIsLoading(false);
    });

    // Load audio from video URL
    wavesurfer.load(videoUrl);

    return () => {
      wavesurfer.destroy();
    };
  }, [videoUrl]);

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Sync playhead position
  useEffect(() => {
    if (wavesurferRef.current && duration > 0) {
      const progress = currentTime / duration;
      wavesurferRef.current.seekTo(Math.min(Math.max(progress, 0), 1));
    }
  }, [currentTime, duration]);

  // Handle click on waveform to seek
  const handleWaveformClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || duration <= 0 || dragging) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    const time = progress * duration;
    onSeek(Math.max(0, Math.min(time, duration)));
  }, [duration, onSeek, dragging]);

  // Handle drag for trim/cut handles
  const handleMouseDown = useCallback((handle: 'trimStart' | 'trimEnd' | 'cutStart' | 'cutEnd') => {
    setDragging(handle);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !containerRef.current || duration <= 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(x / rect.width, 1));
    const time = progress * duration;

    if (mode === 'trim' && onTrimChange) {
      if (dragging === 'trimStart') {
        onTrimChange(Math.min(time, effectiveTrimEnd - 0.5), effectiveTrimEnd);
      } else if (dragging === 'trimEnd') {
        onTrimChange(trimStart, Math.max(time, trimStart + 0.5));
      }
    } else if (mode === 'cut' && onCutChange) {
      if (dragging === 'cutStart') {
        onCutChange(Math.min(time, effectiveCutEnd - 0.5), effectiveCutEnd);
      } else if (dragging === 'cutEnd') {
        onCutChange(effectiveCutStart, Math.max(time, effectiveCutStart + 0.5));
      }
    }
  }, [dragging, duration, mode, onTrimChange, onCutChange, trimStart, effectiveTrimEnd, effectiveCutStart, effectiveCutEnd]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Add/remove global mouse listeners for dragging
  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // Calculate positions as percentages
  const getPosition = (time: number) => {
    if (duration <= 0) return 0;
    return (time / duration) * 100;
  };

  // Render drag handle
  const renderHandle = (
    type: 'trimStart' | 'trimEnd' | 'cutStart' | 'cutEnd',
    time: number,
    color: string
  ) => {
    const position = getPosition(time);
    const isStart = type.includes('Start');
    const isDraggingThis = dragging === type;

    return (
      <div
        className={cn(
          "absolute top-0 bottom-0 flex flex-col items-center z-20 cursor-ew-resize select-none",
          isDraggingThis && "z-30"
        )}
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          handleMouseDown(type);
        }}
      >
        {/* Time label */}
        <div
          className={cn(
            "text-[10px] font-medium px-1 rounded whitespace-nowrap mb-0.5",
            color === 'purple' ? "bg-primary text-white" : "bg-red-500 text-white"
          )}
        >
          {formatTime(time)}
        </div>

        {/* Handle bar */}
        <div
          className={cn(
            "w-4 flex-1 flex items-center justify-center rounded-sm transition-colors",
            color === 'purple'
              ? "bg-primary hover:bg-primary/90"
              : "bg-red-500 hover:bg-red-600",
            isDraggingThis && (color === 'purple' ? "bg-primary/80" : "bg-red-600")
          )}
        >
          <GripVertical className="h-4 w-4 text-white/80" />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {/* Waveform container */}
      <div
        ref={containerRef}
        className="relative rounded-md overflow-hidden bg-muted/50 cursor-pointer"
        onClick={handleWaveformClick}
        style={{ minHeight: 80 }}
      >
        {/* Loading state */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-30">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Loading waveform...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-30">
            <span className="text-xs text-muted-foreground">{error}</span>
          </div>
        )}

        {/* Waveform will be rendered here by WaveSurfer */}

        {/* Overlay for trim mode - dim areas outside selection */}
        {mode === 'trim' && !isLoading && (
          <>
            {/* Before trim start - dimmed */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-black/40 z-10 pointer-events-none"
              style={{ width: `${getPosition(trimStart)}%` }}
            />
            {/* After trim end - dimmed */}
            <div
              className="absolute top-0 bottom-0 right-0 bg-black/40 z-10 pointer-events-none"
              style={{ width: `${100 - getPosition(effectiveTrimEnd)}%` }}
            />
            {/* Selected region highlight */}
            <div
              className="absolute top-0 bottom-0 bg-primary/10 border-y-2 border-primary/30 z-5 pointer-events-none"
              style={{
                left: `${getPosition(trimStart)}%`,
                width: `${getPosition(effectiveTrimEnd) - getPosition(trimStart)}%`
              }}
            />
            {/* Trim handles */}
            {renderHandle('trimStart', trimStart, 'purple')}
            {renderHandle('trimEnd', effectiveTrimEnd, 'purple')}
          </>
        )}

        {/* Overlay for cut mode - highlight section to remove */}
        {mode === 'cut' && !isLoading && (
          <>
            {/* Cut region - red overlay */}
            <div
              className="absolute top-0 bottom-0 bg-red-500/30 border-y-2 border-red-500/50 z-10 pointer-events-none"
              style={{
                left: `${getPosition(effectiveCutStart)}%`,
                width: `${getPosition(effectiveCutEnd) - getPosition(effectiveCutStart)}%`
              }}
            />
            {/* Cut handles */}
            {renderHandle('cutStart', effectiveCutStart, 'red')}
            {renderHandle('cutEnd', effectiveCutEnd, 'red')}
          </>
        )}

        {/* Playhead indicator */}
        {!isLoading && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-pink-500 z-15 pointer-events-none"
            style={{ left: `${getPosition(currentTime)}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-pink-500 rounded-full" />
          </div>
        )}
      </div>

      {/* Time markers */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
