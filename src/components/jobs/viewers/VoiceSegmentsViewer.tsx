import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Play,
  Pause,
  Download,
  RefreshCw,
  Clock,
  Volume2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  EyeOff,
  XCircle,
  AudioLines,
  Square,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";

interface VoiceSegment {
  scene_number: number;
  audio_url: string | null;
  duration: number;
  character_count: number;
  status: 'pending' | 'generating' | 'completed' | 'approved' | 'rejected' | 'excluded' | 'failed';
  cost?: number;
  error?: string;
}

interface VoiceSegmentsViewerProps {
  segments: VoiceSegment[];
  totalDuration: number;
  totalCharacters: number;
  voiceId: string;
  onExclude: (sceneNumber: number) => void;
  onRegenerate: (sceneNumber: number) => void;
  isRegeneratingSegment?: number | null;
}

export function VoiceSegmentsViewer({
  segments,
  totalDuration,
  totalCharacters,
  voiceId,
  onExclude,
  onRegenerate,
  isRegeneratingSegment = null,
}: VoiceSegmentsViewerProps) {
  const [expandedSegment, setExpandedSegment] = useState<number | null>(null);
  const [playingSegment, setPlayingSegment] = useState<number | null>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState<number>(-1);
  const audioRefs = useRef<Map<number, HTMLAudioElement>>(new Map());
  const playAllAudioRef = useRef<HTMLAudioElement | null>(null);

  const excludedCount = segments.filter(s => s.status === 'excluded' || s.status === 'rejected').length;
  const failedCount = segments.filter(s => s.status === 'failed').length;
  const totalCount = segments.length;
  const activeCount = totalCount - excludedCount;

  // Get playable segments (sorted by scene number, excluding failed/excluded)
  const playableSegments = segments
    .filter(s => s.audio_url && s.status !== 'excluded' && s.status !== 'rejected' && s.status !== 'failed')
    .sort((a, b) => a.scene_number - b.scene_number);

  // Play all segments sequentially
  const playNextSegment = useCallback((index: number) => {
    if (index >= playableSegments.length) {
      // Finished playing all
      setIsPlayingAll(false);
      setPlayAllIndex(-1);
      setPlayingSegment(null);
      if (playAllAudioRef.current) {
        playAllAudioRef.current = null;
      }
      return;
    }

    const segment = playableSegments[index];
    if (!segment.audio_url) {
      // Skip to next if no audio
      playNextSegment(index + 1);
      return;
    }

    setPlayAllIndex(index);
    setPlayingSegment(segment.scene_number);

    const audio = new Audio(segment.audio_url);
    playAllAudioRef.current = audio;

    audio.onended = () => {
      playNextSegment(index + 1);
    };

    audio.onerror = () => {
      console.warn(`Failed to play segment ${segment.scene_number}`);
      playNextSegment(index + 1);
    };

    audio.play().catch(() => {
      playNextSegment(index + 1);
    });
  }, [playableSegments]);

  const handlePlayAll = useCallback(() => {
    if (isPlayingAll) {
      // Stop playing
      if (playAllAudioRef.current) {
        playAllAudioRef.current.pause();
        playAllAudioRef.current = null;
      }
      setIsPlayingAll(false);
      setPlayAllIndex(-1);
      setPlayingSegment(null);
    } else {
      // Stop any individual segment playing
      if (playingSegment !== null) {
        const currentAudio = audioRefs.current.get(playingSegment);
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        }
      }
      // Start playing all
      setIsPlayingAll(true);
      playNextSegment(0);
    }
  }, [isPlayingAll, playingSegment, playNextSegment]);

  const handleSkipToNext = useCallback(() => {
    if (isPlayingAll && playAllAudioRef.current) {
      playAllAudioRef.current.pause();
      playNextSegment(playAllIndex + 1);
    }
  }, [isPlayingAll, playAllIndex, playNextSegment]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playAllAudioRef.current) {
        playAllAudioRef.current.pause();
        playAllAudioRef.current = null;
      }
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
  };

  const handlePlayPause = (sceneNumber: number, audioUrl: string | null) => {
    if (!audioUrl) return;

    // Stop "play all" mode if active
    if (isPlayingAll) {
      if (playAllAudioRef.current) {
        playAllAudioRef.current.pause();
        playAllAudioRef.current = null;
      }
      setIsPlayingAll(false);
      setPlayAllIndex(-1);
    }

    // Stop any currently playing audio
    if (playingSegment !== null && playingSegment !== sceneNumber) {
      const currentAudio = audioRefs.current.get(playingSegment);
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    }

    const audio = audioRefs.current.get(sceneNumber);
    if (!audio) {
      // Create audio element if it doesn't exist
      const newAudio = new Audio(audioUrl);
      newAudio.onended = () => setPlayingSegment(null);
      audioRefs.current.set(sceneNumber, newAudio);
      newAudio.play();
      setPlayingSegment(sceneNumber);
    } else if (playingSegment === sceneNumber) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingSegment(null);
    } else {
      audio.play();
      setPlayingSegment(sceneNumber);
    }
  };

  const handleDownload = async (audioUrl: string, sceneNumber: number) => {
    try {
      const filename = `voice_segment_scene_${sceneNumber}.mp3`;
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(audioUrl)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`Scene ${sceneNumber} audio download started`);
    } catch (error) {
      toast.error("Failed to download audio");
    }
  };

  // Empty state when no segments
  if (segments.length === 0) {
    return (
      <EmptyState
        icon={AudioLines}
        title="No voice segments yet"
        message="Voice segments will appear here after generation"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-lg">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Voice Segments</span>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-sm">
              <Volume2 className="h-4 w-4" />
              {activeCount} / {totalCount} Active
            </Badge>
            {excludedCount > 0 && (
              <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm text-muted-foreground">
                <EyeOff className="h-3 w-3" />
                {excludedCount} Excluded
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge variant="destructive" className="gap-1.5 px-3 py-1 text-sm">
                <AlertCircle className="h-4 w-4" />
                {failedCount} Failed
              </Badge>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(totalDuration)} total
            </span>
            <span>
              {totalCharacters.toLocaleString()} characters
            </span>
          </div>
        </div>

        {/* Play All & Actions */}
        <div className="flex items-center gap-2">
          {/* Play All Button */}
          {playableSegments.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                variant={isPlayingAll ? "default" : "outline"}
                size="sm"
                onClick={handlePlayAll}
                className="gap-1.5"
              >
                {isPlayingAll ? (
                  <>
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Play All
                  </>
                )}
              </Button>
              {isPlayingAll && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSkipToNext}
                  className="gap-1 px-2"
                  title="Skip to next segment"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
              )}
              {isPlayingAll && playAllIndex >= 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  {playAllIndex + 1}/{playableSegments.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Segment Cards */}
      <div className="space-y-2">
        {segments.map((segment, index) => {
          const isExpanded = expandedSegment === segment.scene_number;
          const isExcluded = segment.status === 'excluded' || segment.status === 'rejected';
          const isFailed = segment.status === 'failed';
          const isRegenerating = isRegeneratingSegment === segment.scene_number;
          const isPlaying = playingSegment === segment.scene_number;

          return (
            <Card
              key={`segment-${segment.scene_number}-${index}`}
              className={cn(
                "border-l-4 transition-all duration-300",
                isExcluded && "border-l-muted-foreground/30 bg-muted/30 opacity-60",
                isFailed && "border-l-destructive bg-destructive/5",
                !isExcluded && !isFailed && "border-l-primary/50 hover:border-l-primary"
              )}
            >
              <Collapsible open={isExpanded} onOpenChange={() => setExpandedSegment(isExpanded ? null : segment.scene_number)}>
                {/* Collapsed Header */}
                <CollapsibleTrigger asChild>
                  <div className="p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Play Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayPause(segment.scene_number, segment.audio_url);
                          }}
                          disabled={!segment.audio_url || isFailed}
                        >
                          {isPlaying ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>

                        <span className="text-sm font-medium">Scene {segment.scene_number}</span>

                        {isExcluded && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            <EyeOff className="h-3 w-3 mr-1" />
                            Excluded
                          </Badge>
                        )}
                        {isFailed && <XCircle className="h-4 w-4 text-destructive" />}
                        {isRegenerating && <RefreshCw className="h-4 w-4 animate-spin text-primary" />}
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs gap-1">
                          <Clock className="h-3 w-3" />
                          {segment.duration}s
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {segment.character_count} chars
                        </Badge>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>

                {/* Expanded Content */}
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4 px-4 space-y-4 border-t">
                    {/* Error Message */}
                    {isFailed && segment.error && (
                      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                        <AlertCircle className="h-4 w-4 inline mr-2" />
                        {segment.error}
                      </div>
                    )}

                    {/* Audio Player */}
                    {segment.audio_url && !isFailed && (
                      <div className="space-y-2">
                        <SegmentAudioPlayer
                          audioUrl={segment.audio_url}
                          sceneNumber={segment.scene_number}
                        />
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2 border-t">
                      {segment.audio_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(segment.audio_url!, segment.scene_number)}
                        >
                          <Download className="h-4 w-4 mr-1" /> Download
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRegenerate(segment.scene_number)}
                        disabled={isRegenerating}
                      >
                        <RefreshCw className={cn("h-4 w-4 mr-1", isRegenerating && "animate-spin")} />
                        {isFailed ? 'Retry' : 'Regenerate'}
                      </Button>
                      {!isExcluded && !isFailed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onExclude(segment.scene_number)}
                        >
                          <EyeOff className="h-4 w-4 mr-1" /> Exclude
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Info message about excluded segments */}
      {excludedCount > 0 && (
        <div className="p-3 bg-muted/30 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">
            {excludedCount} segment{excludedCount !== 1 ? 's' : ''} excluded. Excluded segments will be skipped during video generation.
          </p>
        </div>
      )}
    </div>
  );
}

// Internal component for individual audio player with seek
function SegmentAudioPlayer({ audioUrl, sceneNumber }: { audioUrl: string; sceneNumber: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-muted/30 rounded-lg p-4 space-y-3">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full"
          onClick={togglePlayPause}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 ml-0.5" />
          )}
        </Button>

        <div className="flex-1 space-y-1">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
