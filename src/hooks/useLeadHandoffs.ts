import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ToolType = 'smartlead' | 'instantly' | 'successai';
export type HandoffStatus = 'pending' | 'sent' | 'failed';
export type DeletionStatus = 'pending' | 'deleted' | 'failed' | 'skipped' | null;

export interface LeadHandoff {
  id: string;
  campaign_id: string | null;
  progress_id: string | null;
  contact_id: string;
  organization_id: string | null;
  tool_type: ToolType;
  connection_id: string | null;
  external_campaign_id: string | null;
  external_lead_id: string | null;
  email_subject: string | null;
  email_body: string | null;
  push_mode: 'leads_only' | 'with_sequences' | null;
  status: HandoffStatus;
  pushed_at: string | null;
  error_message: string | null;
  deleted_at: string | null;
  deletion_status: DeletionStatus;
  deletion_error: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  contact?: {
    id: string;
    display_name: string | null;
    primary_email: string | null;
    company: string | null;
  };
  connection?: {
    id: string;
    name: string;
  };
}

export interface LeadHandoffsFilters {
  toolType?: ToolType;
  connectionId?: string;
  externalCampaignId?: string;
  status?: HandoffStatus;
  deletionStatus?: DeletionStatus | 'not_deleted';
  contactIds?: string[];
}

export interface DeleteFromEmailToolResult {
  success: boolean;
  deleted: number;
  failed: number;
  errors: Array<{ handoffId: string; error: string }>;
}

/**
 * Hook to fetch lead handoffs with optional filters
 */
export function useLeadHandoffs(filters: LeadHandoffsFilters = {}) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['lead-handoffs', currentOrganization?.id, filters],
    queryFn: async (): Promise<LeadHandoff[]> => {
      if (!currentOrganization?.id) {
        return [];
      }

      // Fetch all org handoffs with server-side filters (except contactIds).
      // contactIds is filtered client-side to avoid URL length limits —
      // handoffs per org are bounded (only pushed contacts).
      let query = supabase
        .from('lead_handoffs')
        .select(`
          *,
          contact:crm_contacts!contact_id(id, display_name, primary_email, company),
          connection:email_tool_connections!connection_id(id, name)
        `)
        .eq('organization_id', currentOrganization.id)
        .order('pushed_at', { ascending: false });

      if (filters.toolType) {
        query = query.eq('tool_type', filters.toolType);
      }
      if (filters.connectionId) {
        query = query.eq('connection_id', filters.connectionId);
      }
      if (filters.externalCampaignId) {
        query = query.eq('external_campaign_id', filters.externalCampaignId);
      }
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.deletionStatus === 'not_deleted') {
        query = query.is('deletion_status', null);
      } else if (filters.deletionStatus) {
        query = query.eq('deletion_status', filters.deletionStatus);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch lead handoffs: ${error.message}`);
      }

      let results = (data || []) as LeadHandoff[];

      // Client-side filter by contactIds to avoid encoding 100K+ UUIDs in the URL
      if (filters.contactIds && filters.contactIds.length > 0) {
        const contactIdSet = new Set(filters.contactIds);
        results = results.filter(h => contactIdSet.has(h.contact_id));
      }

      return results;
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to get handoff statistics
 */
export function useLeadHandoffsStats() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['lead-handoffs-stats', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) {
        return { total: 0, byTool: {}, byStatus: {}, deletable: 0 };
      }

      const { data, error } = await supabase
        .from('lead_handoffs')
        .select('id, tool_type, status, deletion_status')
        .eq('organization_id', currentOrganization.id);

      if (error) {
        throw new Error(`Failed to fetch stats: ${error.message}`);
      }

      const handoffs = data || [];
      const byTool: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      let deletable = 0;

      for (const h of handoffs) {
        byTool[h.tool_type] = (byTool[h.tool_type] || 0) + 1;
        byStatus[h.status] = (byStatus[h.status] || 0) + 1;
        if (h.status === 'sent' && !h.deletion_status) {
          deletable++;
        }
      }

      return {
        total: handoffs.length,
        byTool,
        byStatus,
        deletable,
      };
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to delete contacts from email tools
 */
export function useDeleteFromEmailTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      toolType,
      connectionId,
      handoffIds,
    }: {
      toolType: ToolType;
      connectionId: string;
      handoffIds: string[];
    }): Promise<DeleteFromEmailToolResult> => {
      // Determine which function to call based on tool type
      const functionName = `delete-from-${toolType}`;

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          connectionId,
          handoffIds,
        },
      });

      if (error) {
        throw new Error(`Failed to delete from ${toolType}: ${error.message}`);
      }

      return data as DeleteFromEmailToolResult;
    },
    onSuccess: (result, { toolType }) => {
      // Invalidate handoffs queries
      queryClient.invalidateQueries({ queryKey: ['lead-handoffs'] });
      queryClient.invalidateQueries({ queryKey: ['lead-handoffs-stats'] });

      if (result.deleted > 0) {
        toast.success(`Deleted ${result.deleted} contact(s) from ${toolType}`);
      }
      if (result.failed > 0) {
        toast.warning(`Failed to delete ${result.failed} contact(s)`);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete contacts');
    },
  });
}

/**
 * Hook to get unique campaigns from handoffs for a specific connection
 */
export function useHandoffCampaigns(connectionId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['handoff-campaigns', currentOrganization?.id, connectionId],
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      if (!currentOrganization?.id || !connectionId) {
        return [];
      }

      const { data, error } = await supabase
        .from('lead_handoffs')
        .select('external_campaign_id')
        .eq('organization_id', currentOrganization.id)
        .eq('connection_id', connectionId)
        .not('external_campaign_id', 'is', null);

      if (error) {
        throw new Error(`Failed to fetch campaigns: ${error.message}`);
      }

      // Get unique campaign IDs
      const uniqueCampaigns = [...new Set(data?.map(h => h.external_campaign_id).filter(Boolean))];

      // Return as simple list (we don't have campaign names stored)
      return uniqueCampaigns.map(id => ({
        id: id!,
        name: id!, // Using ID as name since we don't store campaign names
      }));
    },
    enabled: !!currentOrganization?.id && !!connectionId,
  });
}
