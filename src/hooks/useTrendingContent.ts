import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chunkedMutate } from "@/hooks/crm/useContacts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { LIST_COLUMNS, type ScrapedContent } from "@/hooks/useScrapedContent";

/** A row from get_trending_content (see supabase/migrations/20260923160000_trending_content.sql). */
export interface TrendingPost {
  id: string;
  platform: string;
  title: string | null;
  thumbnail_url: string | null;
  url: string;
  author_name: string | null;
  author_handle: string | null;
  author_avatar_url: string | null;
  published_at: string;
  engagement: { viewCount?: number; likeCount?: number; commentCount?: number; shareCount?: number } | null;
  source: string;
  score: number;
  baseline: number;
  /** What "usual" means for this post: author median → audience size → search term → platform */
  baseline_basis: "author" | "audience" | "search_term" | "platform";
  ratio: number;
  percentile: number;
  velocity_per_day: number;
  /** Engagement gained over the last 7 days across re-scrapes (null until 2+ snapshots) */
  growth_7d: number | null;
  fit_score: number | null;
  fit_reason: string | null;
  analyzed: boolean;
  format: string | null;
  hook_type: string | null;
  formula: string | null;
  /** ratio weighted by fit — the default sort */
  worth: number;
  /** When the engagement numbers were last read from the platform (metrics refresh, else the scrape that added the post) */
  numbers_as_of: string | null;
  /** Saved as an idea already. */
  idea_id: string | null;
}

export function useTrendingContent(platform: string | null, days: number) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["trending-content", currentOrganization?.id, platform, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trending_content" as never, {
        p_org: currentOrganization!.id,
        p_platform: platform,
        p_days: days,
        p_min_ratio: 2,
        p_limit: 90,
      } as never);
      if (error) throw error;
      const posts = (data as unknown as TrendingPost[]) || [];

      // The RPC doesn't carry freshness; one small lookup by id keeps its signature untouched.
      const asOf = new Map<string, string | null>();
      const savedAs = new Map<string, string>();
      if (posts.length > 0) {
        const { data: fresh } = await supabase
          .from("research_content")
          .select("id, metrics_checked_at, created_at, idea_id")
          .in("id", posts.map((p) => p.id));
        for (const r of (fresh as unknown as { id: string; metrics_checked_at: string | null; created_at: string | null; idea_id: string | null }[]) || []) {
          asOf.set(r.id, r.metrics_checked_at || r.created_at);
          if (r.idea_id) savedAs.set(r.id, r.idea_id);
        }
      }

      return posts.map((p) => ({
        ...p,
        numbers_as_of: asOf.get(p.id) ?? null,
        idea_id: savedAs.get(p.id) ?? null,
        score: Number(p.score),
        baseline: Number(p.baseline),
        ratio: Number(p.ratio),
        percentile: Number(p.percentile),
        velocity_per_day: Number(p.velocity_per_day),
        growth_7d: p.growth_7d === null ? null : Number(p.growth_7d),
        fit_score: p.fit_score === null ? null : Number(p.fit_score),
        worth: Number(p.worth),
      }));
    },
    enabled: !!currentOrganization,
  });
}

/** Full research_content row for the details dialog (trending rows are a projection). */
export function useScrapedContentById(id: string | null) {
  const { currentOrganization } = useAuth();
  return useQuery({
    // Under the "research-content" prefix so analyze/transcribe invalidations refresh it
    queryKey: ["research-content", "row", currentOrganization?.id, id],
    enabled: !!id && !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase.from("research_content").select(LIST_COLUMNS).eq("organization_id", currentOrganization!.id).eq("id", id!).single();
      if (error) throw error;
      return data as unknown as ScrapedContent;
    },
  });
}

/** Permanently removes posts from the research feed (and the Posts tab). */
export function useDeleteTrendingPosts() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from("research_content")
          .delete()
          .eq("organization_id", currentOrganization!.id)
          .in("id", chunk),
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["trending-content"] });
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      toast.success(`Deleted ${ids.length} ${ids.length === 1 ? "post" : "posts"}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });
}
