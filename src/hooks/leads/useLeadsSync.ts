import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedIn, chunkedMutate } from "@/hooks/crm/useContacts";

// ============================================================================
// Types
// ============================================================================

export interface LeadWithCrmContact {
  id: string;
  campaign_id: string;
  post_id: string;
  commenter_id: string;
  commenter_name: string;
  commenter_profile_url: string | null;
  commenter_headline: string | null;
  comment_id: string;
  comment_text: string;
  matched_keyword: string;
  status: 'pending' | 'dm_sent' | 'dm_failed' | 'replied' | 'converted';
  dm_sent_at: string | null;
  dm_error: string | null;
  captured_at: string;
  crm_contact_id: string | null;
  crm_synced_at: string | null;
  crm_contact?: {
    id: string;
    display_name: string;
    stage_id: string | null;
    pipeline_id: string | null;
    tags: string[];
    stage?: {
      id: string;
      name: string;
      color: string;
    };
  } | null;
  post?: {
    id: string;
    post_url: string;
    post_title: string | null;
    provider: 'LINKEDIN' | 'INSTAGRAM';
  };
  campaign?: {
    id: string;
    name: string;
    account_id: string;
    account?: {
      provider: 'LINKEDIN' | 'INSTAGRAM';
    };
  };
}

export interface LeadSyncResult {
  lead_id: string;
  crm_contact_id: string;
  synced_at: string;
  is_new_contact: boolean;
}

export interface BulkSyncResult {
  synced_count: number;
  failed_count: number;
  errors: Array<{ lead_id: string; error: string }>;
}

export interface LeadsFilters {
  search?: string;
  campaign_id?: string;
  status?: LeadWithCrmContact['status'] | 'all';
  synced?: 'all' | 'synced' | 'unsynced';
  keyword?: string;
  provider?: 'LINKEDIN' | 'INSTAGRAM' | 'all';
  date_from?: string;
  date_to?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'captured_at' | 'commenter_name' | 'status';
  sortDirection?: 'asc' | 'desc';
}

export interface PaginatedLeads {
  data: LeadWithCrmContact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LeadStats {
  total_leads: number;
  synced_count: number;
  unsynced_count: number;
  by_status: Record<string, number>;
  by_campaign: Array<{ campaign_id: string; campaign_name: string; count: number }>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch leads with optional CRM contact data and filters
 */
export function useLeadsWithCrm(filters?: LeadsFilters) {
  const { user, currentOrganization } = useAuth();
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  const sortBy = filters?.sortBy ?? 'captured_at';
  const sortDirection = filters?.sortDirection ?? 'desc';

  return useQuery({
    queryKey: ['leads-with-crm', user?.id, currentOrganization?.id, filters],
    queryFn: async (): Promise<PaginatedLeads> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Get campaign IDs for this organization first
      const { data: campaigns, error: campaignsError } = await supabase
        .from('unipile_campaigns')
        .select('id, name, account:unipile_accounts(provider)')
        .eq('organization_id', currentOrganization.id);

      if (campaignsError) throw campaignsError;

      const campaignIds = (campaigns || []).map(c => c.id);
      if (campaignIds.length === 0) {
        return { data: [], total: 0, page, pageSize, totalPages: 0 };
      }

      // Build count query (slice for URL length safety)
      const safeCampaignIds = campaignIds.slice(0, 200);
      let countQuery = supabase
        .from('unipile_leads')
        .select('id', { count: 'exact' })
        .in('campaign_id', safeCampaignIds);

      // Build data query with joins
      let query = supabase
        .from('unipile_leads')
        .select(`
          *,
          post:unipile_monitored_posts(id, post_id, post_url, post_title, provider),
          campaign:unipile_campaigns(id, name, account_id, account:unipile_accounts(provider))
        `)
        .in('campaign_id', safeCampaignIds)
        .order(sortBy, { ascending: sortDirection === 'asc' });

      // Apply filters
      if (filters?.campaign_id) {
        query = query.eq('campaign_id', filters.campaign_id);
        countQuery = countQuery.eq('campaign_id', filters.campaign_id);
      }

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
        countQuery = countQuery.eq('status', filters.status);
      }

      if (filters?.synced === 'synced') {
        query = query.not('crm_contact_id', 'is', null);
        countQuery = countQuery.not('crm_contact_id', 'is', null);
      } else if (filters?.synced === 'unsynced') {
        query = query.is('crm_contact_id', null);
        countQuery = countQuery.is('crm_contact_id', null);
      }

      if (filters?.keyword) {
        query = query.ilike('matched_keyword', `%${filters.keyword}%`);
        countQuery = countQuery.ilike('matched_keyword', `%${filters.keyword}%`);
      }

      if (filters?.search) {
        const searchFilter = `commenter_name.ilike.%${filters.search}%,comment_text.ilike.%${filters.search}%`;
        query = query.or(searchFilter);
        countQuery = countQuery.or(searchFilter);
      }

      if (filters?.date_from) {
        query = query.gte('captured_at', filters.date_from);
        countQuery = countQuery.gte('captured_at', filters.date_from);
      }

      if (filters?.date_to) {
        query = query.lte('captured_at', filters.date_to);
        countQuery = countQuery.lte('captured_at', filters.date_to);
      }

      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      // Execute queries
      const [{ count, error: countError }, { data: leads, error: leadsError }] = await Promise.all([
        countQuery,
        query,
      ]);

      if (countError) throw countError;
      if (leadsError) throw leadsError;

      // Fetch CRM contact data for synced leads
      const syncedLeadIds = (leads || [])
        .filter(l => l.crm_contact_id)
        .map(l => l.crm_contact_id);

      let crmContacts: Record<string, any> = {};
      if (syncedLeadIds.length > 0) {
        const contacts = await chunkedIn(syncedLeadIds, (chunk) =>
          supabase
            .from('crm_contacts')
            .select(`
              id,
              display_name,
              stage_id,
              pipeline_id,
              tags,
              stage:crm_pipeline_stages(id, name, color)
            `)
            .in('id', chunk)
        );

        if (contacts) {
          crmContacts = Object.fromEntries(contacts.map((c: any) => [c.id, c]));
        }
      }

      // Filter by provider if specified
      let filteredLeads = leads || [];
      if (filters?.provider && filters.provider !== 'all') {
        filteredLeads = filteredLeads.filter(l =>
          l.campaign?.account?.provider === filters.provider
        );
      }

      // Map leads with CRM contact data
      const leadsWithCrm: LeadWithCrmContact[] = filteredLeads.map(lead => ({
        ...lead,
        crm_contact: lead.crm_contact_id ? crmContacts[lead.crm_contact_id] || null : null,
      }));

      const total = count ?? 0;
      const totalPages = Math.ceil(total / pageSize);

      return {
        data: leadsWithCrm,
        total,
        page,
        pageSize,
        totalPages,
      };
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Get lead statistics for the organization
 */
export function useLeadStats() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['lead-stats', user?.id, currentOrganization?.id],
    queryFn: async (): Promise<LeadStats> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Get campaigns for this org
      const { data: campaigns } = await supabase
        .from('unipile_campaigns')
        .select('id, name')
        .eq('organization_id', currentOrganization.id);

      const campaignIds = (campaigns || []).map(c => c.id);
      if (campaignIds.length === 0) {
        return {
          total_leads: 0,
          synced_count: 0,
          unsynced_count: 0,
          by_status: {},
          by_campaign: [],
        };
      }

      // Get all leads
      const allLeads = await chunkedIn(campaignIds, (chunk) =>
        supabase
          .from('unipile_leads')
          .select('id, campaign_id, status, crm_contact_id')
          .in('campaign_id', chunk)
      );

      const syncedLeads = allLeads.filter((l: any) => l.crm_contact_id);

      // Calculate stats
      const byStatus: Record<string, number> = {};
      const byCampaign: Record<string, number> = {};

      for (const lead of allLeads) {
        byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
        byCampaign[lead.campaign_id] = (byCampaign[lead.campaign_id] || 0) + 1;
      }

      const campaignStats = (campaigns || []).map(c => ({
        campaign_id: c.id,
        campaign_name: c.name,
        count: byCampaign[c.id] || 0,
      })).filter(c => c.count > 0);

      return {
        total_leads: allLeads.length,
        synced_count: syncedLeads.length,
        unsynced_count: allLeads.length - syncedLeads.length,
        by_status: byStatus,
        by_campaign: campaignStats,
      };
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Sync a single lead to CRM
 */
export function useSyncLeadToCrm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadId: string): Promise<LeadSyncResult> => {
      const { data, error } = await supabase.rpc('sync_lead_to_crm', {
        p_lead_id: leadId,
      });

      if (error) throw error;

      // Get the updated lead to check if it was a new contact
      const { data: lead } = await supabase
        .from('unipile_leads')
        .select('crm_contact_id, crm_synced_at')
        .eq('id', leadId)
        .single();

      return {
        lead_id: leadId,
        crm_contact_id: data || lead?.crm_contact_id,
        synced_at: lead?.crm_synced_at || new Date().toISOString(),
        is_new_contact: !!data, // If function returns a value, it created a new contact
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Lead synced to CRM');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to sync lead');
    },
  });
}

/**
 * Bulk sync all unsynced leads to CRM
 */
export function useBulkSyncLeadsToCrm() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<BulkSyncResult> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase.rpc('bulk_sync_leads_to_crm', {
        p_organization_id: currentOrganization.id,
      });

      if (error) throw error;

      return data as BulkSyncResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });

      if (result.synced_count > 0) {
        toast.success(`Synced ${result.synced_count} leads to CRM`);
      }
      if (result.failed_count > 0) {
        toast.warning(`${result.failed_count} leads failed to sync`);
      }
      if (result.synced_count === 0 && result.failed_count === 0) {
        toast.info('All leads are already synced');
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to bulk sync leads');
    },
  });
}

/**
 * Sync selected leads to CRM
 */
export function useSyncSelectedLeadsToCrm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadIds: string[]): Promise<{ synced: number; failed: number }> => {
      let synced = 0;
      let failed = 0;

      for (const leadId of leadIds) {
        try {
          const { error } = await supabase.rpc('sync_lead_to_crm', {
            p_lead_id: leadId,
          });
          if (error) {
            failed++;
          } else {
            synced++;
          }
        } catch {
          failed++;
        }
      }

      return { synced, failed };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });

      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} leads to CRM`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} leads failed to sync`);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to sync leads');
    },
  });
}

/**
 * Update lead status
 */
export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leadId,
      status
    }: {
      leadId: string;
      status: LeadWithCrmContact['status']
    }) => {
      const { data, error } = await supabase
        .from('unipile_leads')
        .update({ status })
        .eq('id', leadId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-leads'] });
      toast.success('Lead status updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update lead status');
    },
  });
}

/**
 * Bulk update lead status
 */
export function useBulkUpdateLeadStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leadIds,
      status
    }: {
      leadIds: string[];
      status: LeadWithCrmContact['status']
    }) => {
      await chunkedMutate(leadIds, (chunk) =>
        supabase.from('unipile_leads').update({ status }).in('id', chunk)
      );
    },
    onSuccess: (_, { leadIds }) => {
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-leads'] });
      toast.success(`Updated ${leadIds.length} leads`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update leads');
    },
  });
}

/**
 * Delete leads
 */
export function useDeleteLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadIds: string[]) => {
      await chunkedMutate(leadIds, (chunk) =>
        supabase.from('unipile_leads').delete().in('id', chunk)
      );
    },
    onSuccess: (_, leadIds) => {
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-leads'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success(`Deleted ${leadIds.length} lead(s)`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete leads');
    },
  });
}

/**
 * Export leads to CSV
 */
export function useExportLeads() {
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (leadIds?: string[]): Promise<string> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Get campaigns
      const { data: campaigns } = await supabase
        .from('unipile_campaigns')
        .select('id')
        .eq('organization_id', currentOrganization.id);

      const campaignIds = (campaigns || []).map(c => c.id);

      // Build query (slice campaignIds for URL safety)
      let query = supabase
        .from('unipile_leads')
        .select(`
          *,
          post:unipile_monitored_posts(post_url, provider),
          campaign:unipile_campaigns(name)
        `)
        .in('campaign_id', campaignIds.slice(0, 200))
        .order('captured_at', { ascending: false });

      if (leadIds && leadIds.length > 0) {
        query = query.in('id', leadIds.slice(0, 200));
      }

      const { data: leads, error } = await query;
      if (error) throw error;

      // Generate CSV
      const headers = [
        'Name',
        'Profile URL',
        'Headline',
        'Comment',
        'Keyword',
        'Status',
        'Campaign',
        'Platform',
        'Post URL',
        'Captured At',
        'DM Sent At',
        'CRM Synced',
      ];

      const rows = (leads || []).map(lead => [
        lead.commenter_name,
        lead.commenter_profile_url || '',
        lead.commenter_headline || '',
        `"${(lead.comment_text || '').replace(/"/g, '""')}"`,
        lead.matched_keyword,
        lead.status,
        lead.campaign?.name || '',
        lead.post?.provider || '',
        lead.post?.post_url || '',
        lead.captured_at,
        lead.dm_sent_at || '',
        lead.crm_contact_id ? 'Yes' : 'No',
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      return csv;
    },
    onSuccess: (csv) => {
      // Download the CSV
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Leads exported successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to export leads');
    },
  });
}

export function useReplyToComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accountId,
      postId,
      commentId,
      replyText,
      leadId,
    }: {
      accountId: string;
      postId: string;
      commentId: string;
      replyText: string;
      leadId: string;
    }) => {
      // Post the reply via Unipile
      const { data, error } = await supabase.functions.invoke('unipile-engage-post', {
        body: {
          accountId,
          postId,
          action: 'comment',
          commentText: replyText,
          commentId,
        },
      });

      if (error) {
        // Extract actual error message from FunctionsHttpError response body
        let msg = 'Failed to post reply';
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* ignore parse errors */ }
        throw new Error(msg);
      }
      if (!data?.success) throw new Error(data?.error || 'Failed to post reply');

      // Update the lead record with the reply info
      await supabase
        .from('unipile_leads')
        .update({
          comment_reply_text: replyText,
          comment_replied_at: new Date().toISOString(),
          status: 'comment_replied',
        } as any)
        .eq('id', leadId);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unipile-leads'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-comments'] });
      queryClient.invalidateQueries({ queryKey: ['leads-with-crm'] });
      toast.success('Reply posted successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to post reply');
    },
  });
}
