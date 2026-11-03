import { keepPreviousData, useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Progress status type
export type ProgressStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'replied' | 'skipped' | 'handed_off' | 'pending_review' | 'sender_disconnected';

// Pseudo-status used only as a filter value (not a real DB status). The
// search_campaign_leads RPC interprets this as "leads whose error_message
// starts with 'Sequence modified'" — i.e. leads stranded by a sequence edit.
export type ProgressFilterStatus = ProgressStatus | 'sequence_changed';
export type CampaignLeadFilter = ProgressFilterStatus | 'all' | 'in_sequence' | 'filtered';

/** Verify the RLS-protected parent before invoking older SECURITY DEFINER RPCs. */
async function requireCampaignOrganization(campaignId: string | undefined, organizationId: string | undefined) {
  if (!campaignId || !organizationId) throw new Error("Campaign and organization are required");
  const { error } = await supabase.from("linkedin_campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
}

function invalidateCampaignProgress(queryClient: QueryClient, campaignId: string, organizationId: string | undefined) {
  for (const queryKey of [
    ["campaign-progress-paginated", campaignId, organizationId],
    ["campaign-progress", campaignId, organizationId],
    ["campaign-progress-stats", campaignId, organizationId],
    ["linkedin-campaign", organizationId, campaignId],
    ["linkedin-campaigns", organizationId],
  ]) queryClient.invalidateQueries({ queryKey });
}

// Campaign lead progress interface
export interface CampaignLeadProgress {
  id: string;
  campaign_id: string;
  contact_id: string;
  sender_account_id: string | null;
  status: ProgressStatus;
  current_node_id: string | null;
  next_action_at: string | null;
  connection_sent_at: string | null;
  connection_accepted_at: string | null;
  last_message_at: string | null;
  replied_at: string | null;
  variation_index: number;
  error_message: string | null;
  retry_count: number;
  generated_data?: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  // Joined data
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    linkedin_url: string | null;
    company: string | null;
    job_title: string | null;
    avatar_url: string | null;
  };
  sender_account?: {
    id: string;
    display_name: string | null;
    status: string | null;
  };
}

// Campaign action log interface
export interface CampaignActionLog {
  id: string;
  campaign_id: string;
  progress_id: string;
  contact_id: string;
  sender_account_id: string | null;
  node_id: string;
  node_type: string;
  action_type: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  message_content: string | null;
  variation_index: number;
  error_message: string | null;
  external_id: string | null;
  executed_at: string | null;
  created_at: string;
}

// Progress statistics
export interface CampaignProgressStats {
  total: number;
  pending: number;
  inProgress: number;
  waiting: number;
  completed: number;
  failed: number;
  replied: number;
  skipped: number;
  handedOff: number;
  pendingReview: number;
  senderDisconnected: number;
  /** Distinct leads with an invitation or message sent. */
  reached: number;
  connectionsSent: number;
  connectionsAccepted: number;
  connectionRate: number;
  replyRate: number;
  /** Leads terminated at a condition step whose outcome branch was never wired
   *  (error_message "Filtered out at …; no path is configured for this outcome").
   *  These are silently dropped, not contacted — surfaced as a campaign warning. */
  filteredOut: number;
  /** Most common filtered-out reason (e.g. "ICP Score check"), for the banner. */
  topFilteredReason: string | null;
}

type ProgressStatsRow = Pick<CampaignLeadProgress,
  'status' | 'connection_sent_at' | 'connection_accepted_at' | 'last_message_at' | 'error_message'>;

export function calculateCampaignProgressStats(rows: ProgressStatsRow[]): CampaignProgressStats {
  const stats: CampaignProgressStats = {
    total: rows.length, pending: 0, inProgress: 0, waiting: 0, completed: 0,
    failed: 0, replied: 0, skipped: 0, handedOff: 0, pendingReview: 0,
    senderDisconnected: 0, reached: 0, connectionsSent: 0,
    connectionsAccepted: 0, connectionRate: 0, replyRate: 0,
    filteredOut: 0, topFilteredReason: null,
  };
  const statusKeys: Record<ProgressStatus, keyof CampaignProgressStats> = {
    pending: 'pending', in_progress: 'inProgress', waiting: 'waiting',
    completed: 'completed', failed: 'failed', replied: 'replied', skipped: 'skipped',
    handed_off: 'handedOff', pending_review: 'pendingReview', sender_disconnected: 'senderDisconnected',
  };
  const reasonCounts = new Map<string, number>();
  for (const row of rows) {
    const key = statusKeys[row.status];
    if (key) (stats[key] as number)++;
    if (row.connection_sent_at || row.last_message_at) stats.reached++;
    if (row.connection_sent_at) stats.connectionsSent++;
    if (row.connection_accepted_at) stats.connectionsAccepted++;
    if (row.status === 'completed' && row.error_message?.startsWith('Filtered out at ')) {
      stats.filteredOut++;
      const step = row.error_message.slice('Filtered out at '.length).split(' — ')[0].trim();
      reasonCounts.set(step, (reasonCounts.get(step) || 0) + 1);
    }
  }
  let topReasonCount = 0;
  for (const [step, count] of reasonCounts) {
    if (count > topReasonCount) { stats.topFilteredReason = step; topReasonCount = count; }
  }
  stats.connectionRate = stats.connectionsSent > 0
    ? Math.round(stats.connectionsAccepted / stats.connectionsSent * 10000) / 100 : 0;
  stats.replyRate = stats.reached > 0
    ? Math.round(stats.replied / stats.reached * 10000) / 100 : 0;
  return stats;
}

/**
 * Hook to fetch campaign lead progress
 */
export function useCampaignProgress(campaignId: string | undefined) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["campaign-progress", campaignId, currentOrganization?.id],
    queryFn: async () => {
      await requireCampaignOrganization(campaignId, currentOrganization?.id);

      const { data, error } = await supabase
        .from("campaign_lead_progress")
        .select(`
          *,
          contact:crm_contacts(id, first_name, last_name, display_name, linkedin_url:primary_linkedin_url, company, job_title, avatar_url),
          sender_account:unipile_accounts(id, display_name, status)
        `)
        .eq("campaign_id", campaignId!)
        .eq("is_test_contact", false)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []) as CampaignLeadProgress[];
    },
    enabled: !!user && !!currentOrganization && !!campaignId,
  });
}

/**
 * Hook to fetch campaign progress statistics
 * Pages all non-test rows to avoid PostgREST's 1000-row default limit.
 */
export function useCampaignProgressStats(
  campaignId: string | undefined,
  options?: { live?: boolean },
) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    // Poll while the campaign is actively processing so counts move on screen.
    refetchInterval: options?.live ? 10000 : false,
    queryKey: ["campaign-progress-stats", campaignId, currentOrganization?.id],
    queryFn: async () => {
      await requireCampaignOrganization(campaignId, currentOrganization?.id);

      // Fetch all rows with only the columns we need, bypassing the 1000-row default
      // by paginating through all results
      let allProgress: ProgressStatsRow[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("campaign_lead_progress")
          .select("status, connection_sent_at, connection_accepted_at, last_message_at, error_message")
          .eq("campaign_id", campaignId!)
          .eq("is_test_contact", false)
          .order("id")
          .range(from, from + batchSize - 1);

        if (error) throw error;

        const batch = data || [];
        allProgress = allProgress.concat(batch as ProgressStatsRow[]);
        hasMore = batch.length === batchSize;
        from += batchSize;
      }

      return calculateCampaignProgressStats(allProgress);
    },
    enabled: !!user && !!currentOrganization && !!campaignId,
  });
}

/**
 * Hook to fetch campaign action logs
 */
export function useCampaignActionLogs(campaignId: string | undefined, limit = 100) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["campaign-action-logs", campaignId, limit, currentOrganization?.id],
    queryFn: async () => {
      await requireCampaignOrganization(campaignId, currentOrganization?.id);

      const { data, error } = await supabase
        .from("campaign_action_log")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []) as CampaignActionLog[];
    },
    enabled: !!user && !!currentOrganization && !!campaignId,
  });
}

/**
 * Hook to fetch progress for a specific lead
 */
export function useLeadCampaignProgress(contactId: string | undefined) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-campaign-progress", contactId, currentOrganization?.id],
    queryFn: async () => {
      if (!contactId) throw new Error("Contact ID is required");

      const { data, error } = await supabase
        .from("campaign_lead_progress")
        .select(`
          *,
          campaign:linkedin_campaigns!inner(id, name, status, organization_id)
        `)
        .eq("contact_id", contactId)
        .eq("campaign.organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []) as (CampaignLeadProgress & {
        campaign: { id: string; name: string; status: string };
      })[];
    },
    enabled: !!user && !!currentOrganization && !!contactId,
  });
}

// ---- Paginated progress hook ----

export type SortField = 'created_at' | 'next_action_at';
export type SortDir = 'asc' | 'desc';

export interface CampaignProgressFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: Exclude<CampaignLeadFilter, "all">;
  sortBy?: SortField;
  sortDir?: SortDir;
}

export function usePaginatedCampaignProgress(
  campaignId: string | undefined,
  filters: CampaignProgressFilters,
  options?: { live?: boolean; enabled?: boolean },
) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    // Poll while the campaign is actively processing so lead rows update live.
    refetchInterval: options?.live ? 10000 : false,
    queryKey: [
      "campaign-progress-paginated",
      campaignId,
      currentOrganization?.id,
      filters.page,
      filters.pageSize,
      filters.search,
      filters.status,
      filters.sortBy,
      filters.sortDir,
    ],
    // Preserve rows while filtering/paging only within the same organization and campaign.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === campaignId && previousQuery?.queryKey[2] === currentOrganization?.id
        ? keepPreviousData(previous) : undefined,
    queryFn: async () => {
      await requireCampaignOrganization(campaignId, currentOrganization?.id);

      // Synthetic views need a set of statuses or the filtered-out marker.
      // Use ordinary RLS-protected queries for these; pagination and search stay on the server.
      if (filters.status === 'in_sequence' || filters.status === 'filtered') {
        let query = supabase.from("campaign_lead_progress")
          .select(`*, contact:crm_contacts!inner(id, first_name, last_name, display_name,
            linkedin_url:primary_linkedin_url, company, job_title, avatar_url, primary_email),
            sender_account:unipile_accounts(id, display_name, status)`, { count: "exact" })
          .eq("campaign_id", campaignId!)
          .eq("is_test_contact", false);
        if (filters.status === 'in_sequence') {
          query = query.in("status", ['pending', 'in_progress', 'waiting']);
        } else {
          query = query.eq("status", "completed").like("error_message", "Filtered out at %");
        }
        if (filters.search?.trim()) {
          // Quote a literal pattern so punctuation cannot become PostgREST filter syntax.
          const escaped = filters.search.trim().replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
          const pattern = JSON.stringify(`%${escaped}%`);
          query = query.or(['display_name', 'first_name', 'last_name', 'primary_email', 'company', 'job_title']
            .map(column => `${column}.ilike.${pattern}`).join(','), { referencedTable: "contact" });
        }
        const from = (filters.page - 1) * filters.pageSize;
        const { data, count, error } = await query
          .order(filters.sortBy || "created_at", { ascending: filters.sortDir === 'asc', nullsFirst: false })
          .order("id", { ascending: false })
          .range(from, from + filters.pageSize - 1);
        if (error) throw error;
        return { data: (data || []) as CampaignLeadProgress[], total: count || 0,
          totalPages: Math.ceil((count || 0) / filters.pageSize) };
      }

      // Single server-side RPC handles ordinary search + status filter + pagination + sort
      const { data, error } = await supabase.rpc("search_campaign_leads", {
        p_campaign_id: campaignId!,
        p_search: filters.search || null,
        p_status: filters.status || null,
        p_page: filters.page,
        p_page_size: filters.pageSize,
        p_sort_by: filters.sortBy || 'created_at',
        p_sort_dir: filters.sortDir || 'desc',
      });

      if (error) throw error;

      const row = (data as unknown as { leads: CampaignLeadProgress[]; total_count: number }[])?.[0]
        || { leads: [], total_count: 0 };
      const leads = (row.leads || []) as CampaignLeadProgress[];
      const total = Number(row.total_count) || 0;

      return {
        data: leads,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      };
    },
    enabled: options?.enabled !== false && !!user && !!currentOrganization && !!campaignId,
  });
}

// ---- Mutation hooks ----

export function useUpdateCampaignLeadStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      campaignId,
      status,
    }: {
      id: string;
      campaignId: string;
      status: ProgressStatus;
    }) => {
      const organizationId = currentOrganization?.id;
      await requireCampaignOrganization(campaignId, organizationId);
      const updates: Record<string, unknown> = { status };
      if (status === 'pending') {
        updates.sender_account_id = null;
        updates.current_node_id = null;
        updates.error_message = null;
        updates.retry_count = 0;
      }
      const { error } = await supabase
        .from("campaign_lead_progress")
        .update(updates)
        .eq("id", id)
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return { campaignId, organizationId };
    },
    onSuccess: ({ campaignId, organizationId }) => {
      invalidateCampaignProgress(queryClient, campaignId, organizationId);
    },
    onError: () => toast.error("Failed to update lead status"),
  });
}

export function useRemoveCampaignLead() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, campaignId }: { id: string; campaignId: string }) => {
      const organizationId = currentOrganization?.id;
      await requireCampaignOrganization(campaignId, organizationId);
      const { error } = await supabase
        .from("campaign_lead_progress")
        .delete()
        .eq("id", id)
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return { campaignId, organizationId };
    },
    onSuccess: ({ campaignId, organizationId }) => {
      invalidateCampaignProgress(queryClient, campaignId, organizationId);
      toast.success("Lead removed from campaign");
    },
    onError: () => toast.error("Failed to remove lead"),
  });
}

export function useBulkUpdateCampaignLeadStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      ids,
      campaignId,
      status,
    }: {
      ids: string[];
      campaignId: string;
      status: ProgressStatus;
    }) => {
      const organizationId = currentOrganization?.id;
      await requireCampaignOrganization(campaignId, organizationId);
      const updates: Record<string, unknown> = { status };
      if (status === 'pending') {
        updates.sender_account_id = null;
        updates.current_node_id = null;
        updates.error_message = null;
        updates.retry_count = 0;
      }
      const { error } = await supabase
        .from("campaign_lead_progress")
        .update(updates)
        .in("id", ids)
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return { campaignId, organizationId };
    },
    onSuccess: ({ campaignId, organizationId }) => {
      invalidateCampaignProgress(queryClient, campaignId, organizationId);
      toast.success("Lead statuses updated");
    },
    onError: () => toast.error("Failed to update lead statuses"),
  });
}

export function useBulkRemoveCampaignLeads() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ ids, campaignId }: { ids: string[]; campaignId: string }) => {
      const organizationId = currentOrganization?.id;
      await requireCampaignOrganization(campaignId, organizationId);
      const { error } = await supabase
        .from("campaign_lead_progress")
        .delete()
        .in("id", ids)
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return { campaignId, organizationId };
    },
    onSuccess: ({ campaignId, organizationId }) => {
      invalidateCampaignProgress(queryClient, campaignId, organizationId);
      toast.success("Leads removed from campaign");
    },
    onError: () => toast.error("Failed to remove leads"),
  });
}
