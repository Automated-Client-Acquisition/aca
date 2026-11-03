import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toPiece as normalizePiece, type PieceState } from "@/lib/piece";
import { deduplicatePublicationTargets } from "@/lib/job-content-state";

export interface JobContentPiece {
  id: string;
  title: string;
  excerpt: string;
  kind: "image" | "video" | "audio" | "text";
  images: string[];
  videoUrl?: string;
  audioUrl?: string;
  status: string | null;
  currentStage: string | null;
  state: PieceState;
}

export interface JobPublicationTarget {
  id: string;
  outputId: string;
  platform: string;
  accountId?: string;
  accountName?: string;
  status: string;
  scheduledFor?: string;
  publishedAt?: string;
  error?: string;
  url?: string;
  postId?: string;
  source?: "provider" | "queue" | "wordpress";
}

export interface JobContentSummary {
  jobId: string;
  outputs: JobContentPiece[];
  targets: JobPublicationTarget[];
}

type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData =>
  value && typeof value === "object" && !Array.isArray(value) ? value as ObjectData : {};
const textValue = (...values: unknown[]) => values.find(value => typeof value === "string" && value.trim()) as string | undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const mediaUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
};
const isVideo = (url?: string) => !!url && /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url);
const isAudio = (url?: string) => !!url && /\.(mp3|wav|m4a|ogg|aac|flac)(?:[?#]|$)/i.test(url);
const isImage = (url?: string) => !!url && /\.(png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/i.test(url);
const stageText = (value: unknown) => typeof value === "string"
  ? value
  : textValue(object(value).content, object(value).text, object(value).caption);

// Normalize before returning query data so large stage payloads never enter this cache.
function toPiece(output: ObjectData): JobContentPiece {
  const piece = normalizePiece(output);
  const status = textValue(output.status) || null;
  const currentStage = textValue(output.current_stage) || null;
  const data = object(output.data);
  const nested = object(data.data);
  const stages = object(output.stage_data);
  const image = object(stages.image);
  const final = object(stages.final);
  const video = object(stages.video);
  const composition = object(stages.composition);
  const genericUrl = mediaUrl(data.url || nested.url);
  const imageStageUrl = mediaUrl(image.url || image.image_url);
  const videoUrl = [final.video_url, final.url, video.video_url, video.url, composition.video_url, composition.url,
    data.video_url, data.videoUrl, nested.video_url, nested.videoUrl,
    image.media_type === "video" ? image.video_url || image.url : undefined,
    isVideo(genericUrl) ? genericUrl : undefined]
    .map(mediaUrl).find(url => !!url && !isImage(url) && !isAudio(url));
  const audioUrl = [stages.audio, stages.tts, stages.voice, stages.full_voiceover, stages.voice_avatar, stages.voiceover]
    .map(stage => mediaUrl(object(stage).audio_url || object(stage).url)).find(url => !!url && !isVideo(url) && !isImage(url))
    || mediaUrl(data.audio_url || nested.audio_url);
  const imageCandidates = [
    ...(image.media_type === "video" ? [] : [imageStageUrl]),
    ...list(object(stages.carousel_slides).slides).filter(slide => !["failed", "error"].includes(textValue(object(slide).status) || "")).map(slide => object(slide).image_url),
    ...list(object(stages.storyboard).scenes).filter(scene => !["failed", "error"].includes(textValue(object(scene).status) || "")).map(scene => object(scene).image_url),
    ...list(object(stages.scenes).scenes).filter(scene => !["failed", "error"].includes(textValue(object(scene).status) || "")).map(scene => object(scene).image_url),
    data.image_url, data.imageUrl, nested.image_url, nested.imageUrl,
    final.thumbnail_url, video.thumbnail_url, composition.thumbnail_url, data.thumbnail_url,
    ...list(image.images), ...list(data.images), ...list(nested.images),
    ...(output.type === "image" || output.pipeline === "image_only" ? [genericUrl] : []),
  ];
  const images = [...new Set(imageCandidates.filter(candidate => !["failed", "error"].includes(textValue(object(candidate).status) || ""))
    .map(candidate => mediaUrl(typeof candidate === "string" ? candidate : object(candidate).url || object(candidate).image_url))
    .filter((url): url is string => !!url && !isVideo(url) && !isAudio(url)))];
  const title = textValue(data.title, nested.title, object(output.content_ideas).title,
    object(stages.outline).title, object(stages.article).title) || "Generated content";
  const excerpt = (textValue(piece.text, stageText(stages.caption), stageText(stages.post_caption),
    data.text, data.content, data.caption, nested.text, nested.caption, stageText(stages.text), stageText(stages.article), stageText(stages.script)) || "")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
  const completedStages = piece.steps.length > 0 && piece.steps.every(step => step.status === "done"
    && (["approved", "completed", "complete", "skipped"].includes(textValue(object(stages[step.id]).status) || "")
      || (step.id === "carousel_slides" && list(object(stages.carousel_slides).slides).length > 0
        && list(object(stages.carousel_slides).slides).every(slide => object(slide).status === "approved"))));
  const readyEvidence = ["review", "completed", "complete"].includes(status || "")
    || currentStage === "complete" || completedStages;
  return {
    id: textValue(output.id) || "", title: title.slice(0, 200), excerpt,
    kind: videoUrl ? "video" : images.length ? "image" : audioUrl ? "audio" : "text",
    images, videoUrl, audioUrl, status, currentStage,
    // Synthetic steps on a legacy row do not prove generation finished.
    state: piece.state === "ready" && !readyEvidence ? "waiting" : piece.state,
  };
}

export function useJobContentSummaries(jobIds: string[], hasActiveJobs = false) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;
  const ids = useMemo(() => [...new Set(jobIds)].sort(), [jobIds]);
  const outputsQuery = useQuery({
    queryKey: ["job-content-summaries", "outputs", organizationId, ids],
    enabled: !!organizationId && ids.length > 0,
    queryFn: async () => {
      if (!organizationId || !ids.length) return [];
      const { data, error } = await supabase.from("content_outputs")
        .select("id,job_id,status,current_stage,pipeline,type,data,stage_data,generation_params,autopilot_id,error_message,content_ideas(title)")
        .eq("organization_id", organizationId).in("job_id", ids)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(output => {
        const outputData = object(output.data);
        const wordpressUrl = mediaUrl(outputData.wordpress_post_url);
        return {
          jobId: output.job_id!, piece: toPiece(output),
          // WordPress persists a URL even for drafts and does not save the WP
          // status, so the only claim supported by this record is 'saved'.
          wordpressTarget: wordpressUrl ? {
            id: `wordpress-${output.id}`, outputId: output.id, platform: "wordpress", status: "saved",
            accountId: textValue(outputData.wordpress_site_id), url: wordpressUrl,
            source: "wordpress",
          } satisfies JobPublicationTarget : undefined,
        };
      });
    },
    refetchInterval: query => hasActiveJobs || query.state.data?.some(output =>
      output.piece.state === "generating") ? 10_000 : 30_000,
    staleTime: 10_000,
  });

  const outputIds = (outputsQuery.data || []).map(output => output.piece.id).sort();
  const publicationQuery = useQuery({
    queryKey: ["job-content-summaries", "publications", organizationId, outputIds],
    enabled: !!organizationId && outputIds.length > 0,
    queryFn: async () => {
      if (!organizationId || !outputIds.length) return { targets: [] as JobPublicationTarget[], errors: [] as string[] };
      const [posts, queue] = await Promise.all([
        supabase.from("ghl_published_posts")
          .select("id,content_output_id,platform,platform_account_id,platform_account_name,status,published_at,scheduled_for,error_message,ghl_post_id")
          .eq("organization_id", organizationId).in("content_output_id", outputIds),
        supabase.from("publish_queue")
          .select("id,output_id,platform,account_id,status,scheduled_for,published_at,last_error")
          .in("output_id", outputIds)
          // Older autopilot rows may have a null org ID; output IDs and RLS still scope them.
          .or(`organization_id.eq.${organizationId},organization_id.is.null`),
      ]);
      const errors = [posts.error?.message, queue.error?.message].filter((value): value is string => !!value);
      const targets: JobPublicationTarget[] = (posts.data || []).map(post => ({
        id: post.id, outputId: post.content_output_id, platform: post.platform,
        accountId: post.platform_account_id, accountName: post.platform_account_name || undefined,
        status: post.status, scheduledFor: post.scheduled_for || undefined,
        publishedAt: post.published_at || undefined, error: post.error_message || undefined,
        postId: post.ghl_post_id || undefined, source: "provider",
        // Only Twitter stores a provider post ID. GHL IDs are not live social URLs.
        url: ["twitter", "x"].includes(post.platform.toLowerCase()) && post.ghl_post_id && /^\d+$/.test(post.ghl_post_id)
          ? `https://twitter.com/i/web/status/${post.ghl_post_id}` : undefined,
      }));
      for (const item of queue.data || []) {
        if (!item.output_id) continue;
        targets.push({
          id: item.id, outputId: item.output_id, platform: item.platform || "unknown",
          accountId: item.account_id,
          accountName: targets.find(target => target.accountId === item.account_id)?.accountName,
          status: item.status || "unknown", scheduledFor: item.scheduled_for,
          publishedAt: item.published_at || undefined,
          // The processor retains last_error after a successful retry.
          error: item.status === "published" ? undefined : item.last_error || undefined,
          source: "queue",
        });
      }
      return { targets: deduplicatePublicationTargets(targets), errors };
    },
    refetchInterval: query => hasActiveJobs || query.state.data?.targets.some(target =>
      ["pending", "publishing", "scheduled"].includes(target.status)) ? 10_000 : 30_000,
    staleTime: 10_000,
  });

  const summaries = useMemo(() => {
    const result: Record<string, JobContentSummary> = {};
    const outputJobs = new Map<string, string>();
    for (const id of ids) result[id] = { jobId: id, outputs: [], targets: [] };
    for (const output of outputsQuery.data || []) {
      if (!result[output.jobId]) continue;
      result[output.jobId].outputs.push(output.piece);
      outputJobs.set(output.piece.id, output.jobId);
      if (output.wordpressTarget) result[output.jobId].targets.push(output.wordpressTarget);
    }
    for (const target of publicationQuery.data?.targets || []) {
      const jobId = outputJobs.get(target.outputId);
      if (jobId) result[jobId].targets.push(target);
    }
    return result;
  }, [ids, outputsQuery.data, publicationQuery.data]);

  const publicationError = useMemo(() => publicationQuery.error ||
    (publicationQuery.data?.errors.length ? new Error(publicationQuery.data.errors.join("; ")) : null),
  [publicationQuery.error, publicationQuery.data]);

  return {
    summaries,
    isLoading: outputsQuery.isLoading,
    isFetching: outputsQuery.isFetching || publicationQuery.isFetching,
    outputsError: outputsQuery.error,
    publicationError,
    isPublicationLoading: publicationQuery.isLoading || (outputsQuery.isLoading && ids.length > 0),
    refetch: async () => {
      // Output IDs may change, so let the dependent publication query refresh
      // after the output query and invalidate its active cache explicitly.
      await outputsQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["job-content-summaries", "publications", organizationId] });
    },
  };
}
