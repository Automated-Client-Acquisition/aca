import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExternalLink,
  Calendar,
  Eye,
  ThumbsUp,
  MessageCircle,
  Clock,
  FileText,
  ImagePlus,
  Wand2,
  BrainCircuit,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { ScrapedContent } from "@/hooks/useScrapedContent";
import { SaveAsIdeaButton } from "@/components/research/SaveAsIdeaButton";
import { useSaveResearchAsIdeas } from "@/hooks/useSaveAsIdea";
import { AddLibraryImageDialog } from "@/components/AddLibraryImageDialog";
import { ContentTeardownPanel } from "@/components/ideas/ContentTeardownPanel";
import { ReverseEngineerBlueprintDialog } from "@/components/ideas/ReverseEngineerBlueprintDialog";
import {
  useAnalyzeScrapedContent,
  useScrapedContentTranscript,
  useTranscribeScrapedContent,
  type ContentTeardown,
} from "@/hooks/useContentTeardown";

const TRANSCRIBABLE_PLATFORMS = [
  "youtube",
  "youtube-shorts",
  "tiktok",
  "instagram",
];

interface ScrapedContentDetailsDialogProps {
  content: ScrapedContent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatNumber(value: number | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
}

function getBestImageUrl(content: ScrapedContent) {
  const raw = content.raw_data;
  const candidate =
    raw?.image_url ||
    raw?.imageUrl ||
    raw?.media_url ||
    raw?.images?.[0]?.url ||
    raw?.images?.[0] ||
    raw?.media?.[0]?.url ||
    raw?.media?.[0]?.image_url ||
    raw?.articleImage ||
    raw?.article_image;
  const url = typeof candidate === "string" ? candidate : content.thumbnail_url;
  if (
    !url ||
    (content.platform === "linkedin" && url.includes("feedshare-shrink_20"))
  )
    return null;
  return content.platform === "tiktok"
    ? url.replace(/1080x1920/, "540x960").replace(/1080p/, "720p")
    : url;
}

function getLegacyTranscript(
  content: ScrapedContent,
  hasSpokenContent: boolean,
) {
  const data =
    content.raw_data?.transcript ||
    content.raw_data?.subtitles ||
    (hasSpokenContent ? content.raw_data?.text : null);
  if (typeof data === "string") return data;
  if (Array.isArray(data))
    return data
      .map((item) =>
        typeof item === "string" ? item : item?.plaintext || item?.text || "",
      )
      .join("\n");
  return data?.plaintext || null;
}

export function ScrapedContentDetailsDialog({
  content,
  open,
  onOpenChange,
}: ScrapedContentDetailsDialogProps) {
  // Reopening or choosing another post starts with its original content.
  return content ? (
    <PostDetails
      key={`${content.id}-${open}`}
      content={content}
      open={open}
      onOpenChange={onOpenChange}
    />
  ) : null;
}

function PostDetails({
  content,
  open,
  onOpenChange,
}: Omit<ScrapedContentDetailsDialogProps, "content"> & {
  content: ScrapedContent;
}) {
  const [view, setView] = useState("post");
  const [showSaveImageDialog, setShowSaveImageDialog] = useState(false);
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const transcribe = useTranscribeScrapedContent();
  const analyze = useAnalyzeScrapedContent();
  const saveAsIdea = useSaveResearchAsIdeas();
  const {
    data: fullTranscript,
    isLoading: transcriptLoading,
    isError: transcriptFailed,
    refetch: refetchTranscript,
  } = useScrapedContentTranscript(
    content.id,
    open &&
      (content.transcript_status === "completed" ||
        transcribe.data?.results?.[content.id] === "completed"),
  );
  const analysisResult = analyze.data?.results?.find(
    (result) => result.id === content.id,
  );
  const teardown =
    analysisResult?.analysis ||
    (content.analyzed_at && content.ai_analysis?._meta
      ? (content.ai_analysis as ContentTeardown)
      : null);
  const isTranscribable =
    TRANSCRIBABLE_PLATFORMS.includes(content.platform) &&
    (content.platform !== "instagram" ||
      !!(content.platform_data?.isVideo || content.raw_data?.videoUrl));
  const transcript =
    fullTranscript ||
    content.transcript_preview ||
    getLegacyTranscript(
      content,
      isTranscribable ||
        !!(content.platform_data?.isVideo || content.raw_data?.videoUrl),
    );
  const hasTranscriptTab =
    !!transcript || isTranscribable || !!content.transcript_url;
  const transcriptStatus =
    transcribe.data?.results?.[content.id] || content.transcript_status;
  const transcriptProcessing =
    transcribe.isPending || transcriptStatus === "processing";
  const imageUrl = getBestImageUrl(content);
  useEffect(() => setImageFailed(false), [imageUrl]);
  const creator =
    content.author_name || content.author_handle || "Unknown creator";
  const saveImageName =
    [content.author_handle || content.author_name, content.title?.slice(0, 60)]
      .filter(Boolean)
      .join(" · ") || "Saved image";
  const saveImageTags = [
    content.author_handle || content.author_name,
    content.platform,
    "inspiration",
  ].filter((tag): tag is string => !!tag);
  const views = content.engagement?.viewCount;
  const engagementRate =
    views > 0 &&
    (content.engagement?.likeCount != null ||
      content.engagement?.commentCount != null)
      ? (((content.engagement.likeCount || 0) +
          (content.engagement.commentCount || 0)) /
          views) *
        100
      : null;
  const sourceUrl =
    content.url && /^https?:\/\//.test(content.url) ? content.url : null;
  const transcriptUrl =
    content.transcript_url && /^https?:\/\//.test(content.transcript_url)
      ? content.transcript_url
      : null;
  const analysisError = analyze.error?.message || analysisResult?.error;
  const metricsAsOf =
    content.metrics_checked_at || content.created_at;
  const metricsDate = metricsAsOf ? new Date(metricsAsOf) : null;
  const validMetricsDate =
    metricsDate && !Number.isNaN(metricsDate.getTime()) ? metricsDate : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="shrink-0 space-y-4 border-b px-5 pb-5 pt-6 text-left sm:px-7">
          <div className="flex items-center gap-3 pr-8">
            <Avatar className="h-10 w-10 shrink-0 border">
              <AvatarImage
                src={content.author_avatar_url || undefined}
                referrerPolicy="no-referrer"
              />
              <AvatarFallback className="text-xs">
                {creator.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{creator}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="capitalize">
                  {content.platform.replace(/-/g, " ")}
                </span>
                {content.published_at && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(content.published_at)}
                  </span>
                )}
                {!!content.duration_seconds && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {Math.floor(content.duration_seconds / 60)}:
                    {(content.duration_seconds % 60)
                      .toString()
                      .padStart(2, "0")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogTitle className="line-clamp-2 break-words text-xl leading-snug sm:text-2xl">
            {content.title || "Research post"}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SaveAsIdeaButton
              size="default"
              saved={!!content.idea_id}
              saving={saveAsIdea.isPending}
              onSave={(target) =>
                saveAsIdea.mutate({
                  contentIds: [content.id],
                  source: "post",
                  target,
                })
              }
            />
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setShowReverseDialog(true)}
              title="Create a blueprint using this post's format"
            >
              <Wand2 className="h-4 w-4" />
              Copy format
            </Button>
            {sourceUrl && (
              <Button asChild variant="ghost" className="gap-2">
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  Original post
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        </DialogHeader>

        <Tabs
          value={view}
          onValueChange={setView}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b px-5 sm:px-7">
            <TabsList className="h-12 w-full justify-start gap-4 rounded-none bg-transparent p-0 sm:gap-6">
              <TabsTrigger
                value="post"
                className="h-full gap-2 rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <FileText className="h-4 w-4" />
                Post
              </TabsTrigger>
              <TabsTrigger
                value="breakdown"
                className="h-full gap-2 rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <BrainCircuit className="h-4 w-4" />
                Breakdown
              </TabsTrigger>
              {hasTranscriptTab && (
                <TabsTrigger
                  value="transcript"
                  className="h-full gap-2 rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <FileText className="h-4 w-4" />
                  Transcript
                  {transcriptProcessing && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
            <TabsContent value="post" className="m-0 space-y-6">
              <div
                className={
                  imageUrl
                    ? "grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_260px]"
                    : ""
                }
              >
                <div className="min-w-0">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Original content
                  </p>
                  {content.description ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
                      {content.description}
                    </p>
                  ) : (
                    <p className="text-sm leading-7 text-muted-foreground">
                      {content.title
                        ? "This post has no additional description. Open the original post to see the full content."
                        : "No post text was captured. Open the original post for more context."}
                    </p>
                  )}
                </div>
                {imageUrl && (
                  <aside className="space-y-2">
                    <div className="flex min-h-28 items-center justify-center overflow-hidden rounded-xl border bg-muted/30">
                      {imageFailed ? (
                        <p className="p-5 text-center text-sm text-muted-foreground">
                          Image preview unavailable.
                        </p>
                      ) : (
                        <img
                          src={imageUrl}
                          alt={content.title || "Post image"}
                          className="max-h-72 w-full object-contain"
                          onError={() => setImageFailed(true)}
                        />
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setShowSaveImageDialog(true)}
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      Save image to library
                    </Button>
                  </aside>
                )}
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Performance</h3>
                  <span
                    className="text-right text-xs text-muted-foreground"
                    title={validMetricsDate?.toLocaleString()}
                  >
                    {validMetricsDate
                      ? `As of ${validMetricsDate.toLocaleString("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`
                      : "Refresh time unavailable"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
                  {[
                    { label: "Views", icon: Eye, value: formatNumber(views) },
                    {
                      label: "Likes",
                      icon: ThumbsUp,
                      value: formatNumber(content.engagement?.likeCount),
                    },
                    {
                      label: "Comments",
                      icon: MessageCircle,
                      value: formatNumber(content.engagement?.commentCount),
                    },
                    {
                      label: "Engagement",
                      icon: TrendingUp,
                      value:
                        engagementRate == null
                          ? "—"
                          : `${engagementRate.toFixed(2)}%`,
                    },
                  ].map(({ label, icon: Icon, value }) => (
                    <div key={label}>
                      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {engagementRate != null && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Engagement = likes and comments divided by views.
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="breakdown" className="m-0 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">
                    What makes this post work
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Find a pattern to adapt to your own content.
                  </p>
                </div>
                <Button
                  variant={teardown ? "outline" : "cta"}
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    analyze.mutate({
                      contentIds: [content.id],
                      force: !!teardown,
                    })
                  }
                  disabled={analyze.isPending}
                >
                  {analyze.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BrainCircuit className="h-3.5 w-3.5" />
                  )}
                  {analyze.isPending
                    ? "Analyzing…"
                    : teardown
                      ? "Re-analyze"
                      : "Analyze post"}
                </Button>
              </div>
              {analysisError && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  Analysis failed: {analysisError}. You can try again.
                </p>
              )}
              {teardown ? (
                <ContentTeardownPanel teardown={teardown} />
              ) : (
                <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/15 px-6 py-12 text-center">
                  <div className="mb-4 rounded-full bg-amber-500/10 p-3">
                    {analyze.isPending ? (
                      <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
                    ) : (
                      <BrainCircuit className="h-6 w-6 text-amber-600" />
                    )}
                  </div>
                  <h4 className="font-semibold">
                    {analyze.isPending
                      ? "Finding the pattern…"
                      : "Turn inspiration into a repeatable format"}
                  </h4>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    {analyze.isPending
                      ? "Breaking down the hook, structure, voice and call to action. This takes about 30 seconds."
                      : "Analyze this post to see its hook, content structure, audience and engagement drivers."}
                  </p>
                </div>
              )}
            </TabsContent>

            {hasTranscriptTab && (
              <TabsContent value="transcript" className="m-0 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">Transcript</h3>
                    {content.transcript_source && (
                      <Badge variant="outline" className="text-xs font-normal">
                        {content.transcript_source === "whisper"
                          ? "Whisper"
                          : "Captions"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isTranscribable && (
                      <Button
                        variant={transcript ? "outline" : "cta"}
                        size="sm"
                        className="gap-2"
                        onClick={() => transcribe.mutate([content.id])}
                        disabled={transcriptProcessing}
                      >
                        {transcriptProcessing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {transcriptProcessing
                          ? "Transcribing…"
                          : transcript
                            ? "Re-transcribe"
                            : transcriptStatus
                              ? "Retry transcription"
                              : "Transcribe"}
                      </Button>
                    )}
                    {transcriptUrl && (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="gap-2"
                      >
                        <a
                          href={transcriptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Full transcript
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
                {transcriptFailed && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                  >
                    <p className="text-sm text-destructive">
                      Couldn't load the full transcript.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchTranscript()}
                    >
                      Retry loading
                    </Button>
                  </div>
                )}
                {transcribe.error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/20 p-3 text-sm text-destructive"
                  >
                    {transcribe.error.message}
                  </p>
                )}
                {transcriptLoading && (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading full transcript…
                  </p>
                )}
                {transcript ? (
                  <div className="rounded-xl border p-5 sm:p-6">
                    {!fullTranscript && content.transcript_preview && (
                      <p className="mb-4 text-xs font-medium text-muted-foreground">
                        Transcript preview
                        {transcriptUrl
                          ? " · Open the full transcript for the complete text."
                          : ""}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm leading-7">
                      {transcript}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-6 py-12 text-center">
                    <FileText className="mx-auto mb-4 h-7 w-7 text-muted-foreground" />
                    <h4 className="font-semibold">
                      {transcriptProcessing
                        ? "Transcription in progress"
                        : "No transcript available yet"}
                    </h4>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                      {transcriptProcessing
                        ? "This usually takes under a minute. The transcript will appear when it's ready."
                        : content.transcript_error ||
                          "Transcribe the video to read, search and reuse its spoken content."}
                    </p>
                  </div>
                )}
              </TabsContent>
            )}
          </div>
        </Tabs>
        <ReverseEngineerBlueprintDialog
          contentIds={[content.id]}
          open={showReverseDialog}
          onOpenChange={setShowReverseDialog}
        />
        {imageUrl && (
          <AddLibraryImageDialog
            open={showSaveImageDialog}
            onOpenChange={setShowSaveImageDialog}
            initialName={saveImageName}
            initialTags={saveImageTags}
            initialImageUrls={[imageUrl]}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
