import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Scissors,
  Play,
  Pause,
  RotateCcw,
  Check,
  X,
  Loader2,
  ChevronUp,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useVideoTrim, TrimRange, CutRange } from '@/hooks/useVideoTrim';
import { toast } from 'sonner';
import { AudioWaveform } from './AudioWaveform';

interface VideoTrimmerProps {
  videoUrl: string;
  onSave: (newVideoUrl: string) => void;
  onCancel?: () => void;
  compact?: boolean;
}

type EditMode = 'trim' | 'cut' | null;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export function VideoTrimmer({ videoUrl, onSave, onCancel, compact = false }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [trimRange, setTrimRange] = useState<TrimRange>({ start: 0, end: 0 });
  const [cutRange, setCutRange] = useState<CutRange>({ start: 0, end: 0 });

  // Preview URL for edited video
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const {
    trimVideo,
    cutVideo,
    preloadFFmpeg,
    isLoading: isFFmpegLoading,
    isProcessing,
    progress,
    error
  } = useVideoTrim({
    onError: (err) => toast.error(err),
  });

  // Initialize duration when video loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setTrimRange({ start: 0, end: video.duration });
      // Default cut range to middle 20% of video
      const midStart = video.duration * 0.4;
      const midEnd = video.duration * 0.6;
      setCutRange({ start: midStart, end: midEnd });
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);

      // Loop within trim range during trim mode
      if (editMode === 'trim' && video.currentTime >= trimRange.end) {
        video.currentTime = trimRange.start;
      }

      // Skip cut section during cut mode preview
      if (editMode === 'cut' && video.currentTime >= cutRange.start && video.currentTime < cutRange.end) {
        video.currentTime = cutRange.end;
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [editMode, trimRange, cutRange]);

  // Preload FFmpeg when expanded
  useEffect(() => {
    if (isExpanded) {
      preloadFFmpeg();
    }
  }, [isExpanded, preloadFFmpeg]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      // Start from trim start if in trim mode
      if (editMode === 'trim' && video.currentTime < trimRange.start) {
        video.currentTime = trimRange.start;
      }
      video.play();
    }
  }, [isPlaying, editMode, trimRange.start]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleTrimChange = useCallback((values: number[]) => {
    setTrimRange({ start: values[0], end: values[1] });
  }, []);

  const handleCutChange = useCallback((values: number[]) => {
    setCutRange({ start: values[0], end: values[1] });
  }, []);

  const startTrimMode = useCallback(() => {
    setEditMode('trim');
    setTrimRange({ start: 0, end: duration });
    setPreviewUrl(null);
  }, [duration]);

  const startCutMode = useCallback(() => {
    setEditMode('cut');
    const midStart = duration * 0.4;
    const midEnd = duration * 0.6;
    setCutRange({ start: midStart, end: midEnd });
    setPreviewUrl(null);
  }, [duration]);

  const cancelEdit = useCallback(() => {
    setEditMode(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, [previewUrl]);

  const applyEdit = useCallback(async () => {
    try {
      let resultUrl: string;

      if (editMode === 'trim') {
        resultUrl = await trimVideo(videoUrl, trimRange);
      } else if (editMode === 'cut') {
        resultUrl = await cutVideo(videoUrl, cutRange, duration);
      } else {
        return;
      }

      setPreviewUrl(resultUrl);
      toast.success('Video processed! Preview and save when ready.');
    } catch (err) {
      // Error handled by hook
    }
  }, [editMode, videoUrl, trimRange, cutRange, duration, trimVideo, cutVideo]);

  const saveEdit = useCallback(() => {
    if (previewUrl) {
      onSave(previewUrl);
      setEditMode(null);
      setPreviewUrl(null);
      setIsExpanded(false);
      toast.success('Video saved!');
    }
  }, [previewUrl, onSave]);

  const displayUrl = previewUrl || videoUrl;
  const newDuration = editMode === 'trim'
    ? trimRange.end - trimRange.start
    : editMode === 'cut'
      ? duration - (cutRange.end - cutRange.start)
      : duration;

  if (!isExpanded && compact) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsExpanded(true)}
        className="gap-1.5"
      >
        <Scissors className="h-3.5 w-3.5" />
        Trim/Cut
      </Button>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border border-border bg-muted/30",
      compact ? "p-3" : "p-4"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Video Editor</span>
          {isFFmpegLoading && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading editor...
            </span>
          )}
        </div>
        {compact && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => {
              cancelEdit();
              setIsExpanded(false);
            }}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Video Preview */}
      <div className="relative rounded-md overflow-hidden bg-black mb-3">
        <video
          ref={videoRef}
          src={displayUrl}
          className="w-full h-auto max-h-48"
          muted={isMuted}
          playsInline
        />

        {/* Playback overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/20">
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 text-white"
            onClick={togglePlay}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
        </div>

        {/* Time display */}
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-xs">
          {formatTime(currentTime)} / {formatTime(previewUrl ? newDuration : duration)}
        </div>

        {/* Mute toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-2 right-2 h-6 w-6 p-0 bg-black/50 hover:bg-black/70 text-white"
          onClick={toggleMute}
        >
          {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </Button>

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <Loader2 className="h-8 w-8 animate-spin text-white mb-2" />
            <span className="text-white text-sm">Processing... {progress}%</span>
          </div>
        )}
      </div>

      {/* Mode Selection (when not editing) */}
      {!editMode && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={startTrimMode}
            disabled={isFFmpegLoading || duration === 0}
            className="flex-1"
          >
            <Scissors className="h-3.5 w-3.5 mr-1.5" />
            Trim (Start/End)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={startCutMode}
            disabled={isFFmpegLoading || duration === 0}
            className="flex-1"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Cut (Remove Middle)
          </Button>
        </div>
      )}

      {/* Trim Controls */}
      {editMode === 'trim' && !previewUrl && (
        <div className="space-y-3">
          {/* Info bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>Start: {formatTime(trimRange.start)}</span>
            <span className="font-medium text-foreground">Duration: {formatTime(trimRange.end - trimRange.start)}</span>
            <span>End: {formatTime(trimRange.end)}</span>
          </div>

          {/* Waveform with trim handles */}
          <AudioWaveform
            videoUrl={videoUrl}
            duration={duration}
            currentTime={currentTime}
            onSeek={seekTo}
            trimStart={trimRange.start}
            trimEnd={trimRange.end}
            onTrimChange={(start, end) => setTrimRange({ start, end })}
            mode="trim"
          />

          {/* Quick seek buttons */}
          <div className="flex gap-1 justify-center">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => seekTo(trimRange.start)}>
              Go to Start
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => seekTo(trimRange.end - 1)}>
              Go to End
            </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEdit} className="flex-1">
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={applyEdit}
              disabled={isProcessing || trimRange.end - trimRange.start < 0.5}
              className="flex-1"
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Apply Trim
            </Button>
          </div>
        </div>
      )}

      {/* Cut Controls */}
      {editMode === 'cut' && !previewUrl && (
        <div className="space-y-3">
          {/* Info bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>Keep: 0 - {formatTime(cutRange.start)}</span>
            <span className="font-medium text-destructive">Remove: {formatTime(cutRange.end - cutRange.start)}</span>
            <span>Keep: {formatTime(cutRange.end)} - {formatTime(duration)}</span>
          </div>

          {/* Waveform with cut handles */}
          <AudioWaveform
            videoUrl={videoUrl}
            duration={duration}
            currentTime={currentTime}
            onSeek={seekTo}
            cutStart={cutRange.start}
            cutEnd={cutRange.end}
            onCutChange={(start, end) => setCutRange({ start, end })}
            mode="cut"
          />

          {/* Quick seek buttons */}
          <div className="flex gap-1 justify-center">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => seekTo(cutRange.start - 1)}>
              Before Cut
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => seekTo(cutRange.end)}>
              After Cut
            </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEdit} className="flex-1">
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={applyEdit}
              disabled={isProcessing || cutRange.end - cutRange.start < 0.5}
              className="flex-1"
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Apply Cut
            </Button>
          </div>
        </div>
      )}

      {/* Preview & Save */}
      {previewUrl && (
        <div className="space-y-3">
          <div className="text-center text-sm text-muted-foreground">
            Preview ready! New duration: {formatTime(newDuration)}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEdit} className="flex-1">
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Redo
            </Button>
            <Button
              variant="cta"
              size="sm"
              onClick={saveEdit}
              className="flex-1"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
