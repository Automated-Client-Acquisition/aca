import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import { MIN_GAP_MINUTES, type StalledAutopilot, attachStats, groupRows, normPlatform, ruleFor, supportsStory, validatePost, type Media, type PostFormat, type RowStats, type SchedulerPost, type SchedulerRow } from "@/lib/scheduler";

// publish_queue's generated types predate the Scheduler columns (source,
// post_group_id, agent_rationale, publish_content).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queue = () => supabase.from("publish_queue" as any) as any;

// Only the output fields a preview needs (outputPreview), never the whole
// stage_data: video outputs keep full compositions there, and the calendar
// refetches every minute.
const ROW_SELECT = `
  id, organization_id, autopilot_id, output_id, account_id, platform, scheduled_for, status, attempts,
  last_error, published_at, is_repost, source, post_group_id, agent_rationale, publish_content, created_at,
  autopilot:autopilots!publish_queue_autopilot_id_fkey (id, name),
  output:content_outputs!publish_queue_output_id_fkey (
    id, pipeline, job_id, source,
    d_title:data->title, d_text:data->text, d_caption:data->caption, d_image_url:data->image_url,
    s_caption:stage_data->caption, s_post_caption:stage_data->post_caption,
    s_final_url:stage_data->final->url, s_final_video:stage_data->final->video_url, s_final_caption:stage_data->final->caption,
    s_image:stage_data->image, s_slides:stage_data->carousel_slides->slides,
    s_video_url:stage_data->video->url, s_video_video:stage_data->video->video_url,
    s_comp_url:stage_data->composition->url, s_comp_video:stage_data->composition->video_url
  )
`;

/** Rebuild the output's data/stage_data shape from the slim select. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): SchedulerRow {
  const o = r.output;
  return {
    ...r,
    output: o
      ? {
          id: o.id,
          pipeline: o.pipeline,
          job_id: o.job_id,
          source: o.source,
          data: { title: o.d_title, text: o.d_text, caption: o.d_caption, image_url: o.d_image_url },
          stage_data: {
            caption: o.s_caption,
            post_caption: o.s_post_caption,
            final: { url: o.s_final_url, video_url: o.s_final_video, caption: o.s_final_caption },
            image: o.s_image,
            carousel_slides: { slides: o.s_slides },
            video: { url: o.s_video_url, video_url: o.s_video_video },
            composition: { url: o.s_comp_url, video_url: o.s_comp_video },
          },
        }
      : null,
  };
}

const PAGE = 1000;

/** PostgREST caps a response at 1000 rows; read page by page (up to 5000). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows(build: (from: number, to: number) => any): Promise<SchedulerRow[]> {
  const rows: SchedulerRow[] = [];
  for (let from = 0; from < 5 * PAGE; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    // PGRST103: the range starts past the last row (the previous page was exactly full).
    if (error?.code === "PGRST103") break;
    if (error) throw error;
    rows.push(...(data ?? []).map(toRow));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const EDITABLE = ["draft", "pending", "failed"];

function invalidateScheduler(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["scheduler-posts"] });
  queryClient.invalidateQueries({ queryKey: ["scheduler-attention"] });
  queryClient.invalidateQueries({ queryKey: ["publish-queue"] });
  queryClient.invalidateQueries({ queryKey: ["publish-queue-count"] });
}

// ============================================================================
// Queries
// ============================================================================

/** Every queue row in a window, grouped into posts (one post → several accounts). */
export function useSchedulerPosts(from: Date, to: Date) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["scheduler-posts", currentOrganization?.id, from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const rows = await fetchAllRows((a, b) =>
        queue()
          .select(ROW_SELECT)
          .eq("organization_id", currentOrganization!.id)
          .gte("scheduled_for", from.toISOString())
          .lte("scheduled_for", to.toISOString())
          .order("scheduled_for", { ascending: true })
          .order("id", { ascending: true })
          .range(a, b),
      );
      const posts = groupRows(rows);
      const published = rows.filter((r) => r.status === "published" && r.account_id.startsWith("zernio:")).map((r) => r.id);
      return attachStats(posts, await fetchRowStats(published));
    },
    enabled: !!currentOrganization,
    // Publishing flips rows within minutes; keep the calendar honest.
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

const STATS_SELECT = "id, queue_id, account_id, platform, status, impressions, reach, likes, comments, shares, saves, views, clicks, engagement_rate, post_url, fetched_at, last_error";

/** Stats for published rows, by queue row id. Stats are extra: a failed read never breaks the calendar. */
async function fetchRowStats(queueIds: string[]): Promise<Map<string, RowStats>> {
  const out = new Map<string, RowStats>();
  for (let i = 0; i < queueIds.length; i += 200) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("social_post_metrics" as any) as any).select(STATS_SELECT).in("queue_id", queueIds.slice(i, i + 200));
    if (error) {
      console.warn("[scheduler] post stats unavailable:", error.message);
      return out;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of (data ?? []) as any[]) {
      out.set(m.queue_id, {
        id: m.id,
        queueId: m.queue_id,
        accountId: m.account_id,
        platform: normPlatform(m.platform),
        status: m.status,
        impressions: m.impressions ?? 0,
        reach: m.reach ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
        shares: m.shares ?? 0,
        saves: m.saves ?? 0,
        views: m.views ?? 0,
        clicks: m.clicks ?? 0,
        engagementRate: m.engagement_rate === null || m.engagement_rate === undefined ? null : Number(m.engagement_rate),
        postUrl: m.post_url,
        fetchedAt: m.fetched_at,
        error: m.last_error,
      });
    }
  }
  return out;
}

/** Reads the latest numbers for some posts now (the stats panel's Refresh). */
export function useRefreshPostStats() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (queueIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("refresh-post-metrics", {
        body: { organization_id: currentOrganization!.id, queue_ids: queueIds.slice(0, 25) },
      });
      if (error) throw new Error("Couldn't reach the stats service. Try again in a minute.");
      if (!data?.success) throw new Error(data?.error || "Couldn't refresh the stats");
      return data as { results: Array<{ queue_id: string; status: string }> };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["scheduler-posts"] }),
    onError: (error: Error) => toast.error(error.message),
  });
}

/** What needs a person: recent failures and drafts/proposals ahead. */
export function useSchedulerAttention() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["scheduler-attention", currentOrganization?.id],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const [failed, drafts] = await Promise.all([
        queue().select(ROW_SELECT).eq("organization_id", currentOrganization!.id).eq("status", "failed")
          .gte("scheduled_for", since).order("scheduled_for", { ascending: false }).limit(200),
        queue().select(ROW_SELECT).eq("organization_id", currentOrganization!.id).eq("status", "draft")
          .order("scheduled_for", { ascending: true }).limit(300),
      ]);
      if (failed.error) throw failed.error;
      if (drafts.error) throw drafts.error;
      return {
        failed: groupRows((failed.data ?? []).map(toRow)),
        drafts: groupRows((drafts.data ?? []).map(toRow)),
      };
    },
    enabled: !!currentOrganization,
    refetchInterval: 60_000,
  });
}

const OUTCOMES = ["published", "publish_queued", "no_ideas_available", "auto_approval_failed"];

/**
 * Active autopilots whose latest run outcome this week is a failure (out of
 * ideas, approval failing): their runs still sit on the calendar but won't
 * produce a post.
 */
export function useAutopilotHealth(autopilots: Array<{ id: string; name: string }>) {
  const { currentOrganization } = useAuth();
  const ids = autopilots.map((a) => a.id).sort();
  return useQuery({
    queryKey: ["autopilot-health", currentOrganization?.id, ids.join(",")],
    queryFn: async (): Promise<StalledAutopilot[]> => {
      const { data, error } = await supabase
        .from("automation_logs")
        .select("autopilot_id, event_type, created_at")
        .in("autopilot_id", ids)
        .in("event_type", OUTCOMES)
        .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const out: StalledAutopilot[] = [];
      for (const ap of autopilots) {
        const events = (data ?? []).filter((e) => e.autopilot_id === ap.id);
        const latest = events[0];
        if (!latest || latest.event_type === "published" || latest.event_type === "publish_queued") continue;
        const posted = events.find((e) => e.event_type === "published");
        out.push({
          id: ap.id,
          name: ap.name,
          reason: latest.event_type === "no_ideas_available" ? "no_ideas" : "approval_failed",
          lastPosted: posted ? new Date(posted.created_at) : undefined,
        });
      }
      return out;
    },
    enabled: !!currentOrganization && ids.length > 0,
    staleTime: 5 * 60_000,
  });
}

/**
 * LinkedIn profiles and company pages ACA publishes to natively (Unipile), not through GHL.
 * Empty when the org has none, or when the function isn't reachable: GHL accounts still work.
 */
export function useNativeDestinations() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["scheduler-destinations", currentOrganization?.id],
    queryFn: async (): Promise<ConnectedAccount[]> => {
      const { data, error } = await supabase.functions.invoke("scheduler-destinations", { body: { organization_id: currentOrganization!.id } });
      if (error || !data?.success) return [];
      type Destination = {
        id: string;
        provider?: "unipile" | "zernio";
        platform?: string;
        name: string;
        username?: string;
        avatar_url?: string;
        kind: "profile" | "page" | "account";
        account_name: string;
      };
      return (data.destinations as Destination[]).map((d) => ({
        id: d.id,
        type: "social" as const,
        platform: d.platform || "linkedin",
        name: d.name,
        username: d.kind === "page" ? `Company page · ${d.account_name}` : d.kind === "profile" ? "Profile" : d.username ? `@${d.username}` : undefined,
        avatarUrl: d.avatar_url,
        isActive: true,
        isValid: true,
        metadata: { native: true, kind: d.kind, provider: d.provider || "unipile" },
      }));
    },
    enabled: !!currentOrganization,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

// ============================================================================
// Composer save (create or edit)
// ============================================================================

export interface SavePostInput {
  /** The post being edited; omit to create. */
  existing?: SchedulerPost | null;
  accounts: Array<{ id: string; platform: string }>;
  /** Final caption per platform (normalized platform id). */
  captions: Record<string, string>;
  media: Media;
  firstComment?: string;
  scheduledFor: Date;
  status: "draft" | "pending";
  title?: string;
  /** "story" posts Instagram/Facebook rows as Stories; other channels post normally. */
  format?: PostFormat;
}

function contentFor(input: SavePostInput, platform: string, fallback: string) {
  // Each channel gets only the pictures it takes (one for TikTok, Google,
  // Pinterest, YouTube), so a post never fails on a picture it couldn't use.
  const rule = ruleFor(platform);
  return {
    caption: input.captions[normPlatform(platform)] ?? fallback,
    images: input.media.video ? [] : input.media.images.slice(0, rule.multiImage ? rule.maxImages : 1),
    ...(input.media.video ? { videoUrl: input.media.video } : {}),
    ...(input.firstComment?.trim() ? { followUpComment: input.firstComment.trim() } : {}),
    ...(input.format === "story" && supportsStory(platform) ? { postType: "story" } : {}),
  };
}

export function useSavePost() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: SavePostInput) => {
      const orgId = currentOrganization!.id;
      const primary = Object.values(input.captions).find((c) => c.trim()) ?? "";
      const at = input.scheduledFor.toISOString();

      if (!input.existing) {
        const kind = input.media.video ? "video" : input.media.images.length > 1 ? "carousel" : input.media.images.length ? "image" : "text";
        const { data: output, error: outputError } = await supabase
          .from("content_outputs")
          .insert({
            organization_id: orgId,
            pipeline: "social_media_post",
            type: kind,
            status: "approved",
            source: "manual",
            data: { title: input.title || primary.split("\n")[0].slice(0, 120), text: primary, scheduler: true },
            stage_data: {
              caption: { content: primary },
              ...(input.media.images[0] ? { image: { url: input.media.images[0] } } : {}),
            },
          })
          .select("id")
          .single();
        if (outputError) throw outputError;
        const groupId = crypto.randomUUID();
        const { error } = await queue().insert(
          input.accounts.map((a) => ({
            organization_id: orgId,
            output_id: output.id,
            account_id: a.id,
            platform: normPlatform(a.platform),
            scheduled_for: at,
            status: input.status,
            source: "manual",
            post_group_id: groupId,
            publish_content: contentFor(input, a.platform, primary),
          })),
        );
        if (error) throw error;
        return { created: true };
      }

      // Edit: rows that already went out stay as they are.
      const rows = input.existing.rows.filter((r) => EDITABLE.includes(r.status));
      const groupId = input.existing.rows[0].post_group_id ?? crypto.randomUUID();
      const keep = new Set(input.accounts.map((a) => a.id));
      const removed = rows.filter((r) => !keep.has(r.account_id));
      const existingIds = new Set(input.existing.rows.map((r) => r.account_id));
      const added = input.accounts.filter((a) => !existingIds.has(a.id));

      for (const r of rows.filter((r) => keep.has(r.account_id))) {
        const { error } = await queue()
          .update({
            scheduled_for: at,
            status: input.status,
            post_group_id: groupId,
            publish_content: contentFor(input, r.platform ?? "", primary),
            ...(r.status === "failed" ? { attempts: 0, last_error: null } : {}),
          })
          .eq("id", r.id)
          .eq("organization_id", orgId)
          .in("status", EDITABLE);
        if (error) throw error;
      }
      if (removed.length) {
        const { error } = await queue().delete().in("id", removed.map((r) => r.id)).eq("organization_id", orgId).in("status", EDITABLE);
        if (error) throw error;
      }
      if (added.length) {
        const template = input.existing.rows[0];
        const { error } = await queue().insert(
          added.map((a) => ({
            organization_id: orgId,
            output_id: template.output_id,
            autopilot_id: template.autopilot_id,
            account_id: a.id,
            platform: normPlatform(a.platform),
            scheduled_for: at,
            status: input.status,
            source: template.source ?? (template.autopilot_id ? "autopilot" : "manual"),
            post_group_id: groupId,
            publish_content: contentFor(input, a.platform, primary),
          })),
        );
        if (error) throw error;
      }
      return { created: false };
    },
    onSuccess: (_res, input) => {
      invalidateScheduler(queryClient);
      const verb = input.status === "draft" ? "Draft saved" : input.existing ? "Post updated" : "Post scheduled";
      toast.success(verb);
    },
    onError: (error: Error) => toast.error(`Couldn't save the post: ${error.message}`),
  });
}

// ============================================================================
// Calendar actions
// ============================================================================

/** Move a post (all its unsent rows) to a new time. Optimistic. */
export function useReschedulePost() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async ({ post, at }: { post: SchedulerPost; at: Date }) => {
      const orgId = currentOrganization!.id;
      const moving = post.rows.filter((r) => r.status === "pending" || r.status === "draft").map((r) => r.id);
      // A failed row moved to a new time is a retry: back to pending, attempts reset.
      const retrying = post.rows.filter((r) => r.status === "failed").map((r) => r.id);
      if (!moving.length && !retrying.length) throw new Error("This post has already gone out");
      await updateRows(orgId, moving, { scheduled_for: at.toISOString() }, ["pending", "draft"]);
      await updateRows(orgId, retrying, { scheduled_for: at.toISOString(), status: "pending", attempts: 0, last_error: null }, ["failed"]);
    },
    onMutate: async ({ post, at }) => {
      await queryClient.cancelQueries({ queryKey: ["scheduler-posts"] });
      const snapshots = queryClient.getQueriesData<SchedulerPost[]>({ queryKey: ["scheduler-posts"] });
      queryClient.setQueriesData<SchedulerPost[]>({ queryKey: ["scheduler-posts"] }, (old) =>
        old
          ?.map((p) => (p.key === post.key ? { ...p, at, status: p.status === "failed" ? "pending" : p.status } : p))
          .sort((a, b) => a.at.getTime() - b.at.getTime()),
      );
      return { snapshots };
    },
    onError: (error: Error, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(`Couldn't move the post: ${error.message}`);
    },
    onSettled: () => invalidateScheduler(queryClient),
  });
}

async function updateRows(orgId: string, ids: string[], patch: Record<string, unknown>, fromStatus: string[]) {
  if (!ids.length) return 0;
  const { data, error } = await queue().update(patch).in("id", ids).eq("organization_id", orgId).in("status", fromStatus).select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Drafts and agent proposals → scheduled. Past times move to a few minutes
 * from now. A post that would be rejected (Instagram with no picture, over a
 * limit) stays a draft: approving it would only schedule a failure.
 */
export function useApprovePosts() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (posts: SchedulerPost[]) => {
      const soon = Date.now() + 5 * 60_000;
      const gap = MIN_GAP_MINUTES * 60_000;
      // Past-due drafts move forward one gap apart per account, not all to "now".
      const nextFree = new Map<string, number>();
      let approved = 0;
      let moved = 0;
      const blocked: string[] = [];
      for (const post of [...posts].sort((a, b) => a.at.getTime() - b.at.getTime())) {
        const errors = validatePost({ platforms: post.platforms, captions: post.captions, media: post.media, format: post.format }).filter((i) => i.level === "error");
        if (errors.length) {
          blocked.push(errors[0].message);
          continue;
        }
        const ids = post.rows.filter((r) => r.status === "draft").map((r) => r.id);
        const patch: Record<string, unknown> = { status: "pending" };
        if (post.at.getTime() < soon) {
          const accounts = post.rows.map((r) => r.account_id);
          const at = Math.max(soon, ...accounts.map((a) => nextFree.get(a) ?? 0));
          for (const a of accounts) nextFree.set(a, at + gap);
          patch.scheduled_for = new Date(at).toISOString();
          moved++;
        }
        approved += (await updateRows(currentOrganization!.id, ids, patch, ["draft"])) > 0 ? 1 : 0;
      }
      return { approved, blocked, moved };
    },
    onSuccess: ({ approved, blocked, moved }) => {
      invalidateScheduler(queryClient);
      if (approved) {
        toast.success(approved === 1 ? "Post approved and scheduled" : `${approved} posts approved and scheduled`, {
          description: moved ? `${moved} had a time that already passed and now go out ${MIN_GAP_MINUTES} minutes apart, starting in 5 minutes.` : undefined,
        });
      }
      if (blocked.length) {
        toast.warning(`${blocked.length} ${blocked.length === 1 ? "post needs" : "posts need"} a fix before approval`, {
          description: `${blocked[0]}. Open ${blocked.length === 1 ? "it" : "them"} from Drafts & proposals to fix.`,
        });
      }
    },
    onError: (error: Error) => toast.error(`Couldn't approve: ${error.message}`),
  });
}

/** Failed → back in the queue now. */
export function useRetryPosts() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (posts: SchedulerPost[]) => {
      const ids = posts.flatMap((p) => p.rows.filter((r) => r.status === "failed").map((r) => r.id));
      return updateRows(currentOrganization!.id, ids, { status: "pending", attempts: 0, last_error: null, scheduled_for: new Date().toISOString() }, ["failed"]);
    },
    onSuccess: (count) => {
      invalidateScheduler(queryClient);
      toast.success(`${count} ${count === 1 ? "post" : "posts"} back in the queue. ${count === 1 ? "It goes" : "They go"} out within 5 minutes.`);
    },
    onError: (error: Error) => toast.error(`Couldn't retry: ${error.message}`),
  });
}

/** Scheduled or draft → out at the next queue run (every 5 minutes). */
export function usePublishNow() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (post: SchedulerPost) => {
      const ids = post.rows.filter((r) => EDITABLE.includes(r.status)).map((r) => r.id);
      return updateRows(currentOrganization!.id, ids, { status: "pending", attempts: 0, last_error: null, scheduled_for: new Date().toISOString() }, EDITABLE);
    },
    onSuccess: () => {
      invalidateScheduler(queryClient);
      toast.success("Queued to publish. It goes out within 5 minutes.");
    },
    onError: (error: Error) => toast.error(`Couldn't publish: ${error.message}`),
  });
}

export function useDeletePosts() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (posts: SchedulerPost[]) => {
      // Only unsent rows: a published sibling stays as the record of what went out.
      const ids = posts.flatMap((p) => p.rows.filter((r) => EDITABLE.includes(r.status)).map((r) => r.id));
      if (!ids.length) return 0;
      const { error } = await queue().delete().in("id", ids).eq("organization_id", currentOrganization!.id).in("status", EDITABLE);
      if (error) throw error;
      return posts.length;
    },
    onSuccess: (count) => {
      invalidateScheduler(queryClient);
      toast.success(count === 1 ? "Post removed" : `${count} posts removed`);
    },
    onError: (error: Error) => toast.error(`Couldn't remove: ${error.message}`),
  });
}

// ============================================================================
// Agent
// ============================================================================

async function invokeAgent<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("scheduler-agent", { body });
  if (error) throw new Error(error.message || "The agent is unavailable");
  if (!data?.success) throw new Error(data?.error || "The agent could not finish");
  return data as T;
}

export interface PlanRequest {
  instruction: string;
  rangeStart: Date;
  rangeEnd: Date;
  accounts: Array<{ id: string; platform: string; name: string }>;
  brandVoiceId?: string;
  productId?: string;
}

export function useAgentPlan() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: (req: PlanRequest) =>
      invokeAgent<{ summary: string; created: number; group_ids: string[] }>({
        action: "plan",
        organization_id: currentOrganization!.id,
        instruction: req.instruction,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        range_start: req.rangeStart.toISOString(),
        range_end: req.rangeEnd.toISOString(),
        accounts: req.accounts,
        brand_voice_id: req.brandVoiceId,
        product_id: req.productId,
      }),
    onSuccess: () => invalidateScheduler(queryClient),
  });
}

export interface AssistRequest {
  text: string;
  instruction?: string;
  platforms?: string[];
  count?: number;
  brandVoiceId?: string;
}

export function useAgentAssist() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: (req: AssistRequest) =>
      invokeAgent<{ text?: string; options?: string[]; variants?: Record<string, string> }>({
        action: "assist",
        organization_id: currentOrganization!.id,
        text: req.text,
        instruction: req.instruction,
        platforms: req.platforms,
        count: req.count,
        brand_voice_id: req.brandVoiceId,
      }),
    onError: (error: Error) => toast.error(error.message),
  });
}

// ============================================================================
// Connect accounts (the org's own Zernio workspace)
// ============================================================================

export class ZernioConnectError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export interface ZernioConnectResult {
  ok: boolean;
  platform?: string;
  username?: string;
  error?: string;
}

/** Resolves with what /connect/zernio reports, or a "closed" result when the person closes the popup. */
function waitForZernioPopup(popup: Window): Promise<ZernioConnectResult | null> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "ZERNIO_CONNECT_RESULT") return;
      done(event.data.result as ZernioConnectResult);
    };
    const timer = window.setInterval(() => {
      if (popup.closed) done(null);
    }, 500);
    function done(result: ZernioConnectResult | null) {
      window.clearInterval(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    }
    window.addEventListener("message", onMessage);
  });
}

/**
 * Connects a social account through the org's own Zernio key: Zernio's hosted sign-in opens in a
 * popup (opened on the click itself so browsers don't block it), and the Scheduler's accounts
 * refresh when the popup reports back or closes.
 */
export function useConnectZernioAccount() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (platform: string): Promise<ZernioConnectResult | null> => {
      const popup = window.open("about:blank", "zernio-connect", "width=560,height=760");
      try {
        const { data, error } = await supabase.functions.invoke("zernio-connect", {
          body: { organization_id: currentOrganization!.id, platform },
        });
        if (error) {
          const context = (error as { context?: Response }).context;
          // No response at all (network, or the function isn't deployed): supabase-js only says
          // "Failed to send a request to the Edge Function".
          if (!(context instanceof Response)) throw new ZernioConnectError("Couldn't reach the connect service. Check your connection and try again.");
          const body = await context.json().catch(() => null);
          throw new ZernioConnectError(body?.error || error.message || "Could not start the connection", body?.code);
        }
        if (!data?.success || typeof data.auth_url !== "string") throw new ZernioConnectError(data?.error || "Could not start the connection", data?.code);
        if (!popup || popup.closed) {
          window.location.assign(data.auth_url);
          return null;
        }
        popup.location.href = data.auth_url;
        return await waitForZernioPopup(popup);
      } catch (err) {
        popup?.close();
        throw err;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["scheduler-destinations"] }),
  });
}

// ============================================================================
// Media
// ============================================================================

export function useUploadSchedulerMedia() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (file: File) => {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `${user!.id}/scheduler/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("content-media").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("content-media").getPublicUrl(path);
      return { url: data.publicUrl, kind: file.type.startsWith("video/") ? ("video" as const) : ("image" as const) };
    },
    onError: (error: Error) => toast.error(`Upload failed: ${error.message}`),
  });
}
