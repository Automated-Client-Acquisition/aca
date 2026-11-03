import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedMutate } from "@/hooks/crm/useContacts";
import type { SortConfig } from "@/lib/tableUtils";

export interface ScrapedContent {
  id: string;
  platform: string;
  title: string | null;
  description: string | null;
  url: string | null;
  thumbnail_url: string | null;
  author_name: string | null;
  author_handle: string | null;
  author_avatar_url: string | null;
  author_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  duration?: string | null;
  engagement: any;
  platform_data: any;
  raw_data: any;
  ai_analysis: any;
  analyzed_at: string | null;
  converted_to_idea: boolean | null;
  converted_to_idea_at: string | null;
  conversion_in_progress?: boolean | null;
  idea_id: string | null;
  creator_id: string | null;
  search_term_id: string | null;
  created_at: string;
  metrics_checked_at?: string | null;
  organization_id: string;
  transcript_preview: string | null;
  transcript_url: string | null;
  /** Full transcript is NOT in the list query (avg ~17k chars) — see useScrapedContentTranscript. */
  transcript_status: "processing" | "completed" | "unavailable" | "failed" | null;
  transcript_source: "subtitles" | "whisper" | null;
  transcript_error: string | null;
  /** scrape = creator/search-term run; url / paste = imported via import-post */
  source: "scrape" | "url" | "paste";
}

// Every column except `transcript`, which is fetched per post on demand.
export const LIST_COLUMNS = [
  "id", "platform", "title", "description", "url", "thumbnail_url",
  "author_name", "author_handle", "author_avatar_url", "author_url",
  "published_at", "duration_seconds", "engagement", "platform_data", "raw_data",
  "ai_analysis", "analyzed_at", "converted_to_idea", "converted_to_idea_at",
  "conversion_in_progress", "idea_id", "creator_id", "search_term_id",
  "created_at", "metrics_checked_at", "organization_id", "transcript_preview", "transcript_url",
  "transcript_status", "transcript_source", "transcript_error", "source",
].join(", ");

/** What the All posts table is showing. Everything here is applied server-side. */
export interface ScrapedContentListParams {
  search?: string;
  platform?: string;
  creatorId?: string;
  searchTermId?: string;
  /** Inclusive ISO bounds on published_at */
  publishedFrom?: string;
  publishedTo?: string;
  savedAsIdeaOnly?: boolean;
  hasCreatorOnly?: boolean;
  /** Keyed by the table's column keys, mapped through SORT_COLUMNS */
  sort?: SortConfig;
}

// Table column key → what PostgREST orders by. Engagement counts live in jsonb.
const SORT_COLUMNS: Record<string, string> = {
  title: "title",
  author_name: "author_name",
  platform: "platform",
  "engagement.viewCount": "engagement->viewCount",
  "engagement.likeCount": "engagement->likeCount",
  "engagement.commentCount": "engagement->commentCount",
  duration: "duration_seconds",
  published_at: "published_at",
  converted_to_idea: "converted_to_idea",
  analyzed: "analyzed_at",
  created_at: "created_at",
};

// PostgREST caps every response at 1000 rows.
const MAX_ROWS_PER_REQUEST = 1000;

// Substring match on title/description/author, taken literally: escape the LIKE
// wildcards, then double-quote the value so commas and parens can't break or().
function searchFilter(search: string) {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const quoted = `"${pattern.replace(/["\\]/g, "\\$&")}"`;
  return ["title", "description", "author_name"].map((col) => `${col}.ilike.${quoted}`).join(",");
}

function listQuery(
  organizationId: string,
  params: ScrapedContentListParams,
  columns: string,
  options?: { count: "exact"; head?: boolean },
) {
  let q = supabase.from("research_content").select(columns, options).eq("organization_id", organizationId);
  const search = params.search?.trim();
  if (search) q = q.or(searchFilter(search));
  if (params.platform) q = q.eq("platform", params.platform);
  if (params.creatorId) q = q.eq("creator_id", params.creatorId);
  if (params.searchTermId) q = q.eq("search_term_id", params.searchTermId);
  if (params.publishedFrom) q = q.gte("published_at", params.publishedFrom);
  if (params.publishedTo) q = q.lte("published_at", params.publishedTo);
  if (params.savedAsIdeaOnly) q = q.eq("converted_to_idea", true);
  if (params.hasCreatorOnly) q = q.not("creator_id", "is", null);

  const { column, direction } = params.sort ?? {};
  const sortColumn = column && direction ? SORT_COLUMNS[column] : undefined;
  q = sortColumn
    ? q.order(sortColumn, { ascending: direction === "asc", nullsFirst: false })
    : q.order("published_at", { ascending: false, nullsFirst: false });
  // Tiebreak, so rows with equal sort values can't shift between pages
  return q.order("id");
}

/** Every row matching `params`, read past the 1000-row cap. Used by export. */
async function fetchAllScrapedContent(organizationId: string, params: ScrapedContentListParams, columns: string) {
  const rows: ScrapedContent[] = [];
  for (let from = 0; ; from += MAX_ROWS_PER_REQUEST) {
    const { data, error } = await listQuery(organizationId, params, columns)
      .range(from, from + MAX_ROWS_PER_REQUEST - 1);
    if (error) throw error;
    rows.push(...(data as unknown as ScrapedContent[]));
    if (data.length < MAX_ROWS_PER_REQUEST) return rows;
  }
}

/** One page of the org's research posts, filtered, sorted and counted in the database. */
export function useScrapedContent(params: ScrapedContentListParams, { page, pageSize }: { page: number; pageSize: number }) {
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;
  const queryClient = useQueryClient();

  const { data, isLoading, isPlaceholderData, error } = useQuery({
    queryKey: ["research-content", organizationId, "list", params, page, pageSize],
    queryFn: async () => {
      const from = (page - 1) * pageSize;
      const { data, error, count } = await listQuery(organizationId!, params, LIST_COLUMNS, { count: "exact" })
        .range(from, from + pageSize - 1);

      // The page ran past the end (rows were deleted): return the real total so the table steps back
      if (error?.code === "PGRST103") {
        const { count: total, error: countError } = await listQuery(organizationId!, params, "id", { count: "exact", head: true });
        if (countError) throw countError;
        return { rows: [] as ScrapedContent[], total: total ?? 0 };
      }
      if (error) throw error;
      return { rows: data as unknown as ScrapedContent[], total: count ?? 0 };
    },
    enabled: !!organizationId,
    // Keep the current page up while the next one loads, but never show another org's rows
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === organizationId ? previous : undefined,
    // Whisper results land asynchronously via webhook
    refetchInterval: (query) =>
      query.state.data?.rows.some((c) => c.transcript_status === "processing") ? 15000 : false,
  });

  const deleteScrapedContent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("research_content")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      toast.success("Content deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete content: ${error.message}`);
    },
  });

  const deleteBulkScrapedContent = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("research_content").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      toast.success(`Successfully deleted ${ids.length} content item${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete content: ${error.message}`);
    },
  });

  return {
    content: data?.rows ?? [],
    totalCount: data?.total ?? 0,
    isLoading,
    /** A new page/filter is loading while the previous rows are still shown */
    isRefreshing: isPlaceholderData,
    error,
    fetchAllMatching: (columns: string) => fetchAllScrapedContent(organizationId!, params, columns),
    deleteScrapedContent: (id: string) => deleteScrapedContent.mutate(id),
    deleteBulkScrapedContent: (ids: string[]) => deleteBulkScrapedContent.mutate(ids),
    isDeleting: deleteScrapedContent.isPending,
    isDeletingBulk: deleteBulkScrapedContent.isPending,
  };
}
