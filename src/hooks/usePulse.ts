import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { toast } from "sonner";
import { assignIdeasToFeed, invalidateIdeaFeeds } from "@/hooks/useIdeaFeeds";
import type { FeedTarget } from "@/lib/idea-feeds";

// Tables from supabase/migrations/20260924150000_pulse_stories.sql aren't in the
// generated types yet; keep the casts in this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PulseSettings {
  organization_id: string;
  enabled: boolean;
  /** labs, products, tools: a launch post from one of these is a story */
  official_accounts: string[];
  /** people and news accounts: min_accounts of them on a new name within 3h is a story */
  insider_accounts: string[];
  min_accounts: number;
  digest_enabled: boolean;
  last_run_at: string | null;
  last_run_summary: Record<string, unknown> | null;
}

export interface PulseStory {
  id: string;
  key_term: string;
  headline: string | null;
  summary: string | null;
  angle: string | null;
  actionable: boolean | null;
  fit_score: number | null;
  fit_reason: string | null;
  accounts: string[];
  official_accounts: string[];
  item_ids: number[];
  first_post_at: string | null;
  last_post_at: string | null;
  detected_at: string;
  judged_at: string | null;
  idea_id: string | null;
}

export interface PulseItem {
  id: number;
  url: string | null;
  body: string | null;
  author: string | null;
  published_at: string | null;
  score: number;
}

export interface AccountActivity {
  author: string;
  posts: number;
  last_post_at: string | null;
}

const DEFAULT_SETTINGS: Omit<PulseSettings, "organization_id"> = {
  enabled: false,
  official_accounts: [],
  insider_accounts: [],
  min_accounts: 4,
  digest_enabled: true,
  last_run_at: null,
  last_run_summary: null,
};

export function usePulseSettings() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["pulse-settings", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async (): Promise<PulseSettings> => {
      const { data, error } = await db
        .from("pulse_settings")
        .select("organization_id, enabled, official_accounts, insider_accounts, min_accounts, digest_enabled, last_run_at, last_run_summary")
        .eq("organization_id", currentOrganization!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? { organization_id: currentOrganization!.id, ...DEFAULT_SETTINGS };
    },
  });
}

export function useSavePulseSettings() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<PulseSettings>) => {
      const { error } = await db
        .from("pulse_settings")
        .upsert({ organization_id: currentOrganization!.id, ...patch, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pulse-settings", currentOrganization?.id] }),
    onError: (error: Error) => toast.error(`Couldn't save: ${error.message}`),
  });
}

/** Stories from the last 7 days, refreshed every 5 min (the scan runs every 30). */
export function usePulseStories(enabled: boolean) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["pulse-stories", currentOrganization?.id],
    enabled: !!currentOrganization && enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<PulseStory[]> => {
      const { data, error } = await db
        .from("pulse_stories")
        .select(
          "id, key_term, headline, summary, angle, actionable, fit_score, fit_reason, accounts, official_accounts, item_ids, first_post_at, last_post_at, detected_at, judged_at, idea_id"
        )
        .eq("organization_id", currentOrganization!.id)
        .eq("dismissed", false)
        .gte("detected_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order("detected_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useStoryPosts(story: PulseStory | null) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["pulse-story-posts", story?.id, story?.item_ids.length],
    enabled: !!currentOrganization && !!story,
    queryFn: async (): Promise<PulseItem[]> => {
      const { data, error } = await db
        .from("pulse_items")
        .select("id, url, body, author, published_at, score")
        .eq("organization_id", currentOrganization!.id)
        .in("id", story!.item_ids.slice(-200));
      if (error) throw error;
      const official = new Set(story!.official_accounts);
      return ((data || []) as PulseItem[])
        .sort((a, b) => Number(official.has(b.author || "")) - Number(official.has(a.author || "")) || b.score - a.score)
        .slice(0, 8);
    },
  });
}

/** Posts per followed account in the last 7 days (0 = wrong handle or quiet). */
export function useAccountActivity(enabled: boolean) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["pulse-account-activity", currentOrganization?.id],
    enabled: !!currentOrganization && enabled,
    queryFn: async (): Promise<AccountActivity[]> => {
      const { data, error } = await db.rpc("pulse_account_activity", { p_org: currentOrganization!.id });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useRunPulse() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: () => invokeEdgeFunction("pulse-ingest", { organization_id: currentOrganization!.id }),
    onSuccess: () => {
      ["pulse-settings", "pulse-stories", "pulse-account-activity"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      toast.success("Signals refreshed");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDismissStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("pulse_stories").update({ dismissed: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pulse-stories"] }),
    onError: (error: Error) => toast.error(`Couldn't dismiss: ${error.message}`),
  });
}

/** Turn a story into an idea with its summary, angle and source posts; optionally hand it to an autopilot. */
export function useCreateIdeaFromStory() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async ({ story, target }: { story: PulseStory; target?: FeedTarget }) => {
      const { data: items } = await db
        .from("pulse_items")
        .select("url, score")
        .eq("organization_id", currentOrganization!.id)
        .in("id", story.item_ids.slice(-200))
        .order("score", { ascending: false })
        .limit(20);
      // reposts of one post share its url: keep each source once
      const urls = [...new Set(((items || []) as { url: string | null }[]).map((i) => i.url).filter(Boolean) as string[])].slice(0, 5);
      const { data, error } = await supabase
        .from("content_ideas")
        .insert({
          organization_id: currentOrganization!.id,
          title: (story.headline || story.key_term).slice(0, 250),
          free_text: [
            story.summary,
            story.angle ? `Angle: ${story.angle}` : null,
            story.fit_reason ? `Why it fits: ${story.fit_reason}` : null,
            urls.length ? `Source posts:\n${urls.join("\n")}` : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
          source_urls: urls.join("\n") || null,
          keywords: [story.key_term],
          metadata: { source: "signals", story_id: story.id },
        })
        .select("id")
        .single();
      if (error) throw error;
      await db.from("pulse_stories").update({ idea_id: data.id }).eq("id", story.id);
      if (target) await assignIdeasToFeed(currentOrganization!.id, [data.id], target);
    },
    onSuccess: (_, { target }) => {
      invalidateIdeaFeeds(queryClient, target?.autopilotId);
      queryClient.invalidateQueries({ queryKey: ["pulse-stories"] });
      toast.success(target ? `Saved as an idea for ${target.autopilotName}` : "Saved as an idea");
    },
    onError: (error: Error) => toast.error(`Couldn't create idea: ${error.message}`),
  });
}
