import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type LeadListSourceType = "linkedin_post" | "linkedin_creator";
export type LeadListSourceStatus = "active" | "paused" | "error" | "expired";

export interface LeadListSourceConfig {
  include_reactors?: boolean;
  include_commenters?: boolean;
  reaction_types?: string[];
  watch_days?: number;
  post_lookback_days?: number;
  max_posts_per_poll?: number;
}

export interface LeadListSource {
  id: string;
  organization_id: string;
  list_id: string;
  parent_source_id: string | null;
  source_type: LeadListSourceType;
  source_url: string;
  source_key: string;
  account_id: string | null;
  config: LeadListSourceConfig;
  state: Record<string, unknown>;
  status: LeadListSourceStatus;
  error_message: string | null;
  consecutive_errors: number;
  poll_interval_minutes: number;
  next_poll_at: string;
  expires_at: string | null;
  last_polled_at: string | null;
  last_new_leads_at: string | null;
  total_imported: number;
  created_at: string;
  updated_at: string;
}

/**
 * Parse a LinkedIn post URL into its activity id (the normalized source_key).
 * Mirrors extractPostInfo in the linkedin-engagement shared edge module.
 */
export function parsePostUrl(url: string): string | null {
  const postsMatch = url.match(/linkedin\.com\/posts\/[^_/]+_.*activity-(\d+)/i);
  if (postsMatch) return postsMatch[1];
  const activityMatch = url.match(/activity-(\d+)/i);
  if (activityMatch) return activityMatch[1];
  const urnMatch = url.match(/urn:li:(?:activity|share):(\d+)/i);
  if (urnMatch) return urnMatch[1];
  return null;
}

/**
 * Parse a LinkedIn profile URL into its slug (the normalized source_key).
 */
export function parseProfileUrl(url: string): string | null {
  const match = url.match(/linkedin\.com\/(?:in|company)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

export interface AddSourceInput {
  sourceType: LeadListSourceType;
  url: string;
}

export interface AddSourcesParams {
  listId: string;
  sources: AddSourceInput[];
  accountId?: string | null;
  includeReactors?: boolean;
  includeCommenters?: boolean;
  reactionTypes?: string[];
  watchDays?: number;
  postLookbackDays?: number;
}

export function useLeadListSources(listId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-sources", currentOrganization?.id, listId],
    queryFn: async () => {
      if (!listId) return [];
      const { data, error } = await supabase
        .from("lead_list_sources")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .eq("list_id", listId)
        .order("created_at", { ascending: false });

      if (error) throw new Error(`Failed to fetch list sources: ${error.message}`);
      return (data || []) as LeadListSource[];
    },
    enabled: !!currentOrganization && !!listId,
    staleTime: 30_000,
  });
}

export function useAddLeadListSources() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: AddSourcesParams) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const watchDays = params.watchDays ?? 60;
      const rows = params.sources.map((source) => {
        const sourceKey =
          source.sourceType === "linkedin_post"
            ? parsePostUrl(source.url)
            : parseProfileUrl(source.url) || source.url.trim();

        if (!sourceKey) {
          throw new Error(`Could not parse LinkedIn URL: ${source.url}`);
        }

        const config: LeadListSourceConfig = {
          include_reactors: params.includeReactors !== false,
          include_commenters: params.includeCommenters !== false,
          reaction_types: params.reactionTypes || [],
          watch_days: watchDays,
          ...(source.sourceType === "linkedin_creator"
            ? {
                post_lookback_days: params.postLookbackDays ?? 30,
                max_posts_per_poll: 10,
              }
            : {}),
        };

        return {
          organization_id: currentOrganization.id,
          list_id: params.listId,
          source_type: source.sourceType,
          source_url: source.url.trim(),
          source_key: sourceKey,
          account_id: params.accountId || null,
          config,
          status: "active" as const,
          poll_interval_minutes: source.sourceType === "linkedin_creator" ? 720 : 360,
          next_poll_at: new Date().toISOString(),
          // Posts stop being watched after the window; creators never expire
          expires_at:
            source.sourceType === "linkedin_post"
              ? new Date(Date.now() + watchDays * 86_400_000).toISOString()
              : null,
        };
      });

      const { data, error } = await supabase
        .from("lead_list_sources")
        .upsert(rows, { onConflict: "list_id,source_key", ignoreDuplicates: true })
        .select();

      if (error) throw new Error(`Failed to add sources: ${error.message}`);
      return (data || []) as LeadListSource[];
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({
        queryKey: ["lead-list-sources", currentOrganization?.id, params.listId],
      });
    },
  });
}

export function useUpdateLeadListSource() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Pick<LeadListSource, "status" | "poll_interval_minutes" | "account_id">>;
    }) => {
      const payload: Record<string, unknown> = { ...updates };
      // Resuming clears the error strike counter so the poller retries fresh
      if (updates.status === "active") {
        payload.consecutive_errors = 0;
        payload.error_message = null;
        payload.next_poll_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("lead_list_sources")
        .update(payload)
        .eq("id", id);

      if (error) throw new Error(`Failed to update source: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["lead-list-sources", currentOrganization?.id],
      });
    },
  });
}

export function useDeleteLeadListSource() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Children of a creator source are removed by ON DELETE CASCADE
      const { error } = await supabase.from("lead_list_sources").delete().eq("id", id);
      if (error) throw new Error(`Failed to delete source: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["lead-list-sources", currentOrganization?.id],
      });
    },
  });
}
