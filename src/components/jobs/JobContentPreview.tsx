import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, FileText, ImageOff, Loader2, Music, Video } from "lucide-react";
import type { JobContentPiece } from "@/hooks/useJobContentSummaries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface JobContentPreviewProps {
  jobId: string;
  outputs: JobContentPiece[];
  isLoading: boolean;
  hasError: boolean;
  jobStatus: string;
  editorId?: string | null;
}

/** Preview actual output assets; input/reference images are never used. */
export function JobContentPreview({ jobId, outputs, isLoading, hasError, jobStatus, editorId }: JobContentPreviewProps) {
  const [index, setIndex] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const media = outputs.flatMap((output) => output.images.length
    ? output.images.map((url, slide) => ({ output, url, slide }))
    : [{ output, url: null, slide: 0 }]);
  const selected = media[Math.min(index, Math.max(0, media.length - 1))];
  const output = selected?.output;
  const href = editorId ? `/editor/${editorId}` : `/jobs/${jobId}${output ? `?piece=${output.id}` : ""}`;
  const active = ["queued", "processing"].includes(jobStatus);
  const unavailable = selected?.url && selected.url === failedUrl;
  const Icon = hasError || unavailable ? ImageOff : active && !output ? Loader2 : output?.kind === "video" ? Video : output?.kind === "audio" ? Music : FileText;

  return (
    <div className="relative w-24 self-start overflow-hidden rounded-lg border bg-muted/30 sm:w-36 lg:w-40">
      {isLoading ? <Skeleton className="aspect-square w-full" /> : (
        <Link to={href} className="flex aspect-square items-center justify-center overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:aspect-square" aria-label={output ? `Open generated content: ${output.title}` : "Open run details"}>
          {selected?.url && !unavailable ? (
            <img src={selected.url} alt={`${output?.title || "Generated image"}${output && output.images.length > 1 ? ` · slide ${selected.slide + 1}` : ""}`} loading="lazy" className="h-full w-full object-contain" onError={() => setFailedUrl(selected.url)} />
          ) : output?.videoUrl ? (
            <video src={output.videoUrl} muted playsInline preload="metadata" className="h-full w-full object-contain" aria-label={`Generated video: ${output.title}`} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-3 text-center text-muted-foreground">
              <Icon className={`h-7 w-7 ${active && !output && !hasError ? "animate-spin" : ""}`} />
              <span className="text-xs">{hasError ? "Preview unavailable" : unavailable ? "Image unavailable" : output?.kind === "audio" ? "Audio" : output?.kind === "video" ? "Video in progress" : output ? "Text content" : active ? "Generating" : jobStatus === "failed" ? "No output yet" : "No media"}</span>
            </div>
          )}
        </Link>
      )}
      {media.length > 1 && (
        <div className="flex items-center justify-between border-t bg-background px-1 py-0.5">
          <Button variant="ghost" size="icon" className="h-10 w-8 sm:h-8" aria-label="Previous preview" disabled={index === 0} onClick={() => setIndex((n) => Math.max(0, n - 1))}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <span className="text-[11px] tabular-nums text-muted-foreground">{Math.min(index + 1, media.length)} / {media.length}</span>
          <Button variant="ghost" size="icon" className="h-10 w-8 sm:h-8" aria-label="Next preview" disabled={index >= media.length - 1} onClick={() => setIndex((n) => Math.min(media.length - 1, n + 1))}><ChevronRight className="h-3.5 w-3.5" /></Button>
        </div>
      )}
    </div>
  );
}
