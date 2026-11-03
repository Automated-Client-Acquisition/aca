import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Volume2, Download, RotateCcw } from "lucide-react";
import { ErrorState } from "./ErrorState";
import { toast } from "sonner";

interface AudioContentSectionProps {
  audioUrl: string;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

export function AudioContentSection({
  audioUrl,
  onRegenerate,
  isRegenerating = false,
}: AudioContentSectionProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

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

  const handleVolumeChange = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newVolume = value[0];
    audio.volume = newVolume;
    setVolume(newVolume);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleDownload = async () => {
    try {
      const filename = 'audio.mp3';
      // Use download proxy to add proper Content-Disposition header
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(audioUrl)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Audio download started");
    } catch (error) {
      toast.error("Failed to download audio");
    }
  };

  if (hasError) {
    return (
      <ErrorState
        title="Audio Load Error"
        message="Failed to load audio. The file may be corrupted or the URL is invalid."
        onRetry={() => {
          setHasError(false);
          if (audioRef.current) {
            audioRef.current.load();
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <audio 
        ref={audioRef} 
        src={audioUrl} 
        preload="metadata"
        onError={() => setHasError(true)}
      />

      {/* Audio Player Card */}
      <div className="bg-muted/30 rounded-lg p-6 space-y-4">
        {/* Play/Pause Button */}
        <div className="flex items-center justify-center">
          <Button
            variant="default"
            size="lg"
            onClick={togglePlayPause}
            className="w-16 h-16 rounded-full"
          >
            {isPlaying ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6 ml-1" />
            )}
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
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

        {/* Volume Control */}
        <div className="flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <Slider
            value={[volume]}
            max={1}
            step={0.01}
            onValueChange={handleVolumeChange}
            className="flex-1 cursor-pointer"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleDownload} className="flex-1">
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
        {onRegenerate && (
          <Button
            variant="outline"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="flex-1"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {isRegenerating ? "Regenerating..." : "Regenerate"}
          </Button>
        )}
      </div>
    </div>
  );
}
