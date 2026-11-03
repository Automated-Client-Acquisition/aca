import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVideoEditor } from "./context/VideoEditorContext";
import { useVideoExport } from "@/hooks/useVideoExport";
import { useDynamicComposition } from "@/hooks/useDynamicComposition";
import { getResolution } from "@/types/videoEditor";
import type { ResolutionPreset, FpsPreset } from "@/types/videoEditor";
import { Download, Loader2, CheckCircle, XCircle, Film, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: Props) {
  const { state, totalDuration, updateSettings } = useVideoEditor();
  const { project } = state;

  const hasRemotionCode = !!project.remotion_code?.trim();
  const dynamicResult = useDynamicComposition(hasRemotionCode ? project.remotion_code! : "");

  const resolution = getResolution(project.settings.aspect_ratio, project.settings.resolution, project.settings.fps);
  const width = hasRemotionCode && dynamicResult.component ? dynamicResult.width : resolution.width;
  const height = hasRemotionCode && dynamicResult.component ? dynamicResult.height : resolution.height;
  const fps = hasRemotionCode && dynamicResult.component ? dynamicResult.fps : resolution.fps;
  const durationInFrames = hasRemotionCode && dynamicResult.component
    ? dynamicResult.durationInFrames
    : Math.max(Math.ceil(totalDuration * fps), fps);

  const { status, outputUrl, error, exportVideo, reset } = useVideoExport(project.id, project);

  const handleExport = async () => {
    await exportVideo(project);
  };

  const isExporting = status === "exporting";

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-md"
        onInteractOutside={(e) => { if (isExporting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isExporting) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="h-4 w-4" />
            Export Video
          </DialogTitle>
          <DialogDescription>
            Render on the server - you can close this tab while it processes
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Project summary */}
          <div className="rounded-md bg-muted p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Scenes</span>
              <span>{project.scenes.length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Duration</span>
              <span>{(durationInFrames / fps).toFixed(1)}s ({durationInFrames} frames)</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Resolution</span>
              {status === "idle" ? (
                <Select
                  value={project.settings.resolution || "1080p"}
                  onValueChange={(val: ResolutionPreset) => updateSettings({ resolution: val })}
                >
                  <SelectTrigger className="h-6 w-[120px] text-xs border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="1080p">1080p (HD)</SelectItem>
                    <SelectItem value="4k">4K</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span>{width}x{height}</span>
              )}
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Frame Rate</span>
              {status === "idle" ? (
                <Select
                  value={String(project.settings.fps || 30)}
                  onValueChange={(val) => updateSettings({ fps: Number(val) as FpsPreset })}
                >
                  <SelectTrigger className="h-6 w-[120px] text-xs border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24 fps (Film)</SelectItem>
                    <SelectItem value="30">30 fps</SelectItem>
                    <SelectItem value="60">60 fps (Smooth)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span>{fps} fps</span>
              )}
            </div>
            {project.voiceover?.url && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Voiceover</span>
                <span className="capitalize">{project.voiceover.source}</span>
              </div>
            )}
            {project.music?.url && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Music</span>
                <span>{project.music.title || "Custom"}</span>
              </div>
            )}
          </div>

          {/* Exporting */}
          {isExporting && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
                <Loader2 className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-400">
                    Rendering on server...
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    You can safely close this dialog - we'll notify you when it's done
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Completed */}
          {status === "completed" && outputUrl && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-400">Export Complete!</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Your video is ready to download
                </p>
              </div>
            </div>
          )}

          {/* Failed */}
          {status === "failed" && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-red-500/10 border border-red-500/20">
              <XCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-400">Export Failed</p>
                <p className="text-xs text-muted-foreground">
                  {error || "An unexpected error occurred"}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {status === "idle" && (
              <Button
                variant="cta"
                className="flex-1"
                onClick={handleExport}
                disabled={project.scenes.length === 0 && !hasRemotionCode}
              >
                <Download className="h-4 w-4 mr-2" />
                Export MP4
              </Button>
            )}

            {status === "completed" && outputUrl && (
              <Button variant="cta" className="flex-1" asChild>
                <a href={outputUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download className="h-4 w-4 mr-2" />
                  Download MP4
                </a>
              </Button>
            )}

            {status === "failed" && (
              <Button variant="cta" className="flex-1" onClick={handleExport}>
                Retry Export
              </Button>
            )}

            <Button
              variant="outline"
              onClick={handleClose}
            >
              {status === "completed" ? "Done" : isExporting ? "Close" : "Cancel"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
