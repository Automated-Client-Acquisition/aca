import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { X, RefreshCw, Play, Pause, Maximize2, RotateCw, Loader2, AlertCircle, Download, Copy, Upload, Scissors, EyeOff, Film } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCheckPredictionStatus } from "@/hooks/useCheckPredictionStatus";
import { useRecoverClips } from "@/hooks/useRecoverClips";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { supabase } from "@/integrations/supabase/client";
import { VideoTrimmer } from "./VideoTrimmer";
import { EmptyState } from "./EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SceneClip {
  scene_number: number;
  video_url?: string;
  source_image: string;
  duration: number;
  prompt: string;
  status: 'pending' | 'generating' | 'completed' | 'ready' | 'approved' | 'rejected' | 'excluded' | 'failed';
  error?: string;
  approved_at?: string;
  approved_by?: string;
  started_at?: string;
  prediction_id?: string;
}

interface SceneClipGridProps {
  clips: SceneClip[];
  onClipRegenerate: (sceneNumber: number) => void;
  onClipExclude: (sceneNumber: number) => void;
  isRegeneratingClip?: number | null;
  outputId: string;
}

export function SceneClipGrid({
  clips,
  onClipRegenerate,
  onClipExclude,
  isRegeneratingClip = null,
  outputId,
}: SceneClipGridProps) {
  const [playingClip, setPlayingClip] = useState<number | null>(null);
  const [stuckClips, setStuckClips] = useState<Set<number>>(new Set());
  const [uploadingClip, setUploadingClip] = useState<number | null>(null);
  const [trimmingClip, setTrimmingClip] = useState<number | null>(null);
  const [clipUrls, setClipUrls] = useState<{ [key: number]: string }>({});
  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});
  const checkStatus = useCheckPredictionStatus();
  const recoverClips = useRecoverClips();
  const { uploadMedia, isUploading } = useMediaUpload();

  // Get video URL for a clip (use trimmed version if available)
  const getClipVideoUrl = (clip: SceneClip) => {
    return clipUrls[clip.scene_number] || clip.video_url;
  };

  // Handle trimmed video save
  const handleTrimSave = async (sceneNumber: number, newVideoUrl: string) => {
    // Update local state with the trimmed video
    setClipUrls(prev => ({ ...prev, [sceneNumber]: newVideoUrl }));
    setTrimmingClip(null);

    // Update the clip in the database
    try {
      const { data: output } = await supabase
        .from('job_outputs')
        .select('stage_data')
        .eq('id', outputId)
        .single();

      if (output?.stage_data) {
        const stageData = output.stage_data as any;
        const clipsData = stageData.clips || [];
        const updatedClips = clipsData.map((c: any) => {
          if (c.scene_number === sceneNumber) {
            return { ...c, video_url: newVideoUrl };
          }
          return c;
        });

        await supabase
          .from('job_outputs')
          .update({
            stage_data: { ...stageData, clips: updatedClips }
          })
          .eq('id', outputId);

        toast.success(`Scene ${sceneNumber} clip updated`);
      }
    } catch (error) {
      console.error('Failed to save trimmed clip:', error);
      toast.error('Failed to save trimmed clip');
    }
  };

  const excludedCount = clips.filter(c => c.status === 'excluded').length;
  const failedCount = clips.filter(c => c.status === 'failed').length;
  const activeCount = clips.length - excludedCount;
  const totalCount = clips.length;
  const generatingCount = clips.filter(c => c.status === 'generating').length;
  const hasStuckClips = stuckClips.size > 0;
  const hasReadyClips = clips.some(c => c.status === 'ready' || c.status === 'approved' || c.video_url);

  // Empty state when no clips
  if (clips.length === 0) {
    return (
      <EmptyState
        icon={Film}
        title="No video clips yet"
        message="Video clips will appear here after generation"
      />
    );
  }

  // Track clips stuck in generating for > 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const stuck = new Set<number>();
      
      clips.forEach(clip => {
        if (clip.status === 'generating' && clip.started_at) {
          const startTime = new Date(clip.started_at).getTime();
          const elapsed = now - startTime;
          if (elapsed > 120000) { // 2 minutes
            stuck.add(clip.scene_number);
          }
        }
      });
      
      setStuckClips(stuck);
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [clips]);

  const handlePlayPause = (sceneNumber: number) => {
    setPlayingClip(playingClip === sceneNumber ? null : sceneNumber);
  };

  const handleFullscreen = (videoElement: HTMLVideoElement) => {
    if (videoElement.requestFullscreen) {
      videoElement.requestFullscreen();
    }
  };

  const handleDownload = async (url: string, sceneNumber: number) => {
    try {
      const filename = `clip-scene-${sceneNumber}.mp4`;
      // Use download proxy to add proper Content-Disposition header
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Clip download started");
    } catch (error) {
      toast.error("Failed to download clip");
    }
  };

  const handleCopyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copied to clipboard");
  };

  const handleUploadClick = (sceneNumber: number) => {
    fileInputRefs.current[sceneNumber]?.click();
  };

  const handleFileUpload = async (sceneNumber: number, file: File) => {
    if (!file.type.startsWith('video/')) {
      toast.error("Please upload a video file");
      return;
    }

    setUploadingClip(sceneNumber);
    try {
      const uploadedUrl = await uploadMedia(file);
      if (uploadedUrl) {
        // Fetch current stage_data
        const { data: output, error: fetchError } = await supabase
          .from('content_outputs')
          .select('stage_data')
          .eq('id', outputId)
          .single();

        if (fetchError) throw fetchError;

        const stageData = output.stage_data as any;
        const updatedClips = (stageData?.clips || clips).map((clip: any) => 
          clip.scene_number === sceneNumber 
            ? { ...clip, video_url: uploadedUrl, status: 'pending', error: undefined }
            : clip
        );
        
        const { error } = await supabase
          .from('content_outputs')
          .update({
            stage_data: {
              ...stageData,
              clips: updatedClips
            }
          })
          .eq('id', outputId);

        if (error) throw error;

        toast.success(`Scene ${sceneNumber} video uploaded successfully`);
      }
    } catch (error) {
      toast.error("Failed to upload video");
    } finally {
      setUploadingClip(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium">
              Video Clips: {activeCount} / {totalCount} Active
            </div>
            {excludedCount > 0 && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <EyeOff className="h-3 w-3" />
                {excludedCount} Excluded
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge variant="destructive" className="gap-1">
                <X className="h-3 w-3" />
                {failedCount} Failed
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(generatingCount > 0 || hasStuckClips) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkStatus.mutate(outputId)}
                disabled={checkStatus.isPending}
              >
                {checkStatus.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                <span className="ml-2">Check Status</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Clips List - Compact Vertical Stack */}
      <div className="flex flex-col gap-2">
        {clips.map((clip, index) => {
          const isRegenerating = isRegeneratingClip === clip.scene_number;
          const isFailed = clip.status === 'failed';
          const isExcluded = clip.status === 'excluded';
          const isGenerating = clip.status === 'generating' || isRegenerating;

          return (
          <div
            key={`clip-${clip.scene_number}-${index}`}
            className={cn(
              "flex gap-3 p-2 rounded-lg border transition-all group/clip",
              isExcluded && "border-muted-foreground/30 bg-muted/30 opacity-60",
              isFailed && "border-destructive/30 bg-destructive/5",
              !isExcluded && !isFailed && "border-border hover:border-border/80"
            )}
          >
            {/* Compact Video Preview */}
            <div className="relative w-32 h-20 flex-shrink-0 rounded-md overflow-hidden bg-muted">
              {getClipVideoUrl(clip) ? (
                <>
                  <video
                    id={`clip-${clip.scene_number}`}
                    src={getClipVideoUrl(clip)}
                    className="w-full h-full object-cover"
                    loop
                    playsInline
                    muted={playingClip !== clip.scene_number}
                    onPlay={() => setPlayingClip(clip.scene_number)}
                    onPause={() => setPlayingClip(null)}
                  />
                  {/* Play button overlay */}
                  <button
                    className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover/clip:opacity-100 transition-opacity"
                    onClick={() => {
                      const video = document.getElementById(`clip-${clip.scene_number}`) as HTMLVideoElement;
                      if (video) {
                        if (playingClip === clip.scene_number) {
                          video.pause();
                          video.muted = true;
                        } else {
                          // Pause and mute any currently playing video
                          if (playingClip !== null) {
                            const otherVideo = document.getElementById(`clip-${playingClip}`) as HTMLVideoElement;
                            if (otherVideo) {
                              otherVideo.pause();
                              otherVideo.muted = true;
                            }
                          }
                          video.muted = false;
                          video.play();
                        }
                        handlePlayPause(clip.scene_number);
                      }
                    }}
                  >
                    {playingClip === clip.scene_number ? (
                      <Pause className="h-6 w-6 text-white" />
                    ) : (
                      <Play className="h-6 w-6 text-white" />
                    )}
                  </button>
                  <div className="absolute bottom-1 right-1">
                    <span className="text-[10px] bg-black/60 text-white px-1 rounded">
                      {clip.duration}s
                    </span>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {isGenerating ? (
                    <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  ) : isFailed ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : isExcluded ? (
                    <EyeOff className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-dashed border-muted-foreground/40" />
                  )}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">Scene {clip.scene_number}</span>
                  {isFailed && <X className="h-3.5 w-3.5 text-destructive" />}
                  {isExcluded && <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                  {isGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  {isExcluded && (
                    <span className="text-xs text-muted-foreground">(Excluded)</span>
                  )}
                </div>

                {/* Quick actions - show on hover */}
                <div className="flex gap-1 opacity-0 group-hover/clip:opacity-100 transition-opacity">
                  {getClipVideoUrl(clip) && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => setTrimmingClip(clip.scene_number)}
                        title="Trim/Cut"
                      >
                        <Scissors className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => {
                          const video = document.getElementById(`clip-${clip.scene_number}`) as HTMLVideoElement;
                          if (video) handleFullscreen(video);
                        }}
                      >
                        <Maximize2 className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => handleDownload(getClipVideoUrl(clip)!, clip.scene_number)}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => handleCopyPrompt(clip.prompt)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Prompt - truncated */}
              <p className="text-xs text-muted-foreground line-clamp-1">{clip.prompt}</p>

              {/* Action buttons row */}
              <div className="flex gap-1.5">
                {/* Excluded clips - show regenerate option */}
                {isExcluded ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => onClipRegenerate(clip.scene_number)}
                      disabled={isRegeneratingClip !== null || uploadingClip !== null}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Regenerate
                    </Button>
                    <span className="text-[10px] text-muted-foreground flex items-center">
                      Skipped in final video
                    </span>
                  </>
                ) : isFailed ? (
                  /* Failed clips - show retry and exclude options */
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-6 px-2 text-xs"
                      onClick={() => onClipRegenerate(clip.scene_number)}
                      disabled={isRegeneratingClip !== null || uploadingClip !== null}
                    >
                      <RefreshCw className={cn("h-3 w-3 mr-1", isRegenerating && "animate-spin")} />
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-xs"
                      onClick={() => onClipExclude(clip.scene_number)}
                      disabled={isRegeneratingClip !== null || uploadingClip !== null}
                    >
                      <EyeOff className="h-3 w-3 mr-1" />
                      Exclude
                    </Button>
                    {clip.error && (
                      <span className="text-[10px] text-destructive line-clamp-1">
                        {clip.error}
                      </span>
                    )}
                  </>
                ) : (
                  /* Normal clips - show all options */
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => onClipRegenerate(clip.scene_number)}
                      disabled={isRegeneratingClip !== null || uploadingClip !== null}
                    >
                      <RefreshCw className={cn("h-3 w-3 mr-1", isRegenerating && "animate-spin")} />
                      Regen
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleUploadClick(clip.scene_number)}
                      disabled={isRegeneratingClip !== null || uploadingClip !== null}
                    >
                      {uploadingClip === clip.scene_number ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Upload className="h-3 w-3" />
                      )}
                    </Button>
                    <input
                      ref={(el) => fileInputRefs.current[clip.scene_number] = el}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(clip.scene_number, file);
                        e.target.value = '';
                      }}
                    />
                    {/* Exclude button */}
                    {!isGenerating && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => onClipExclude(clip.scene_number)}
                        disabled={isRegeneratingClip !== null || uploadingClip !== null}
                        title="Exclude this clip from the final video"
                      >
                        <EyeOff className="h-3 w-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
        })}
      </div>

      {/* Trim Dialog */}
      <Dialog open={trimmingClip !== null} onOpenChange={(open) => !open && setTrimmingClip(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="h-4 w-4" />
              Edit Scene {trimmingClip} Clip
            </DialogTitle>
          </DialogHeader>
          {trimmingClip !== null && (() => {
            const clip = clips.find(c => c.scene_number === trimmingClip);
            const videoUrl = clip ? getClipVideoUrl(clip) : null;
            if (!videoUrl) return null;
            return (
              <VideoTrimmer
                videoUrl={videoUrl}
                onSave={(newUrl) => handleTrimSave(trimmingClip, newUrl)}
                onCancel={() => setTrimmingClip(null)}
              />
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
