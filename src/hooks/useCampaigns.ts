import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { campaignWritePayload } from "@/lib/campaign-persistence";
import type { CampaignEntryRule } from "@/lib/campaign-entry";
import type { CampaignRateSettings } from "@/types/email";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SequenceNode, SequenceEdge } from "@/lib/sequence-utils";
import type { CampaignPowerSettings, AutopilotConfig } from "@/types/email";

// Campaign status type
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

// Campaign type (multi-channel support)
export type CampaignType = 'linkedin_only' | 'email_only' | 'multi_channel';

// Channel type
export type ChannelType = 'linkedin' | 'email' | 'whatsapp' | 'instagram' | 'telegram' | 'messenger' | 'twitter';

// Sender accounts by channel
export interface SenderAccountsByChannel {
  linkedin?: string[];
  email?: string[];
  whatsapp?: string[];
  instagram?: string[];
  telegram?: string[];
  messenger?: string[];
  twitter?: string[];
}

// Campaign interface (extended for multi-channel)
export interface LinkedInCampaign {
  entry_triggers?: CampaignEntryRule[];
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  lead_list_id: string | null; // legacy scalar, kept in sync = lead_list_ids[0]
  lead_list_ids: string[];
  exclusion_list_ids: string[];
  exclude_other_campaigns: boolean;
  exclude_same_sender: boolean;
  auto_enroll_new_members: boolean;
  enroll_filter_criteria?: SmartListFilterCriteria;
  // Legacy: LinkedIn-only sender accounts (backward compatible)
  sender_account_ids: string[];
  sequence_nodes: SequenceNode[];
  sequence_edges: SequenceEdge[];
  total_leads: number;
  needs_lead_init?: boolean;
  /** Leads that finished the entire sequence (completed/replied/failed/skipped). */
  processed_leads: number;
  /** Leads we actually reached — invitation or message sent. */
  contacted_leads: number;
  replied_count: number;
  connection_rate: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  // Behavior settings
  stop_on_reply: boolean;
  campaign_settings?: CampaignPowerSettings;
  rate_settings?: CampaignRateSettings;
  autopilot_config?: AutopilotConfig;
  agent_profile_id?: string | null;
  icp_product_id?: string | null;
  min_icp_score?: number | null;
  // Multi-channel fields
  campaign_type?: CampaignType;
  sender_accounts?: SenderAccountsByChannel;
  primary_channel?: ChannelType;
  channel_fallback_enabled?: boolean;
  fallback_order?: ChannelType[];
  // Joined data
  lead_list?: {
    id: string;
    name: string;
    lead_count: number;
  } | null;
}

// Alias for multi-channel campaigns
export type Campaign = LinkedInCampaign;

// Create campaign input
export interface CreateCampaignInput {
  entry_triggers?: CampaignEntryRule[];
  name: string;
  description?: string;
  lead_list_id?: string; // legacy single-list; prefer lead_list_ids
  lead_list_ids?: string[];
  exclusion_list_ids?: string[];
  exclude_other_campaigns?: boolean;
  exclude_same_sender?: boolean;
  auto_enroll_new_members?: boolean;
  enroll_filter_criteria?: SmartListFilterCriteria;
  sender_account_ids?: string[];
  sequence_nodes?: SequenceNode[];
  sequence_edges?: SequenceEdge[];
  stop_on_reply?: boolean;
  campaign_settings?: CampaignPowerSettings;
  rate_settings?: CampaignRateSettings;
  autopilot_config?: AutopilotConfig;
  agent_profile_id?: string | null;
  icp_product_id?: string | null;
  min_icp_score?: number | null;
  // Multi-channel options
  campaign_type?: CampaignType;
  sender_accounts?: SenderAccountsByChannel;
  primary_channel?: ChannelType;
  channel_fallback_enabled?: boolean;
  fallback_order?: ChannelType[];
}

// Update campaign input
export interface UpdateCampaignInput {
  id: string;
  updates: Partial<Omit<LinkedInCampaign, 'id' | 'organization_id' | 'created_at' | 'created_by'>>;
}

/**
 * Hook to fetch all campaigns
 */
export function useCampaigns() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["linkedin-campaigns", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .select(`
          *,
          lead_list:lead_lists(id, name, lead_count)
        `)
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []) as unknown as LinkedInCampaign[];
    },
    enabled: !!user && !!currentOrganization?.id,
  });
}

/**
 * Hook to fetch a single campaign
 */
export function useCampaign(campaignId: string | undefined) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    // Auto-refresh while the campaign is active so status and counts stay live
    // as the background processor moves leads through the sequence.
    refetchInterval: (query) =>
      (query.state.data as { status?: string } | undefined)?.status === "active" ? 15000 : false,
    queryKey: ["linkedin-campaign", currentOrganization?.id, campaignId],
    queryFn: async () => {
      if (!campaignId || !currentOrganization) throw new Error("Campaign ID and organization are required");

      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .select(`
          *,
          lead_list:lead_lists(id, name, lead_count)
        `)
        .eq("id", campaignId)
        .eq("organization_id", currentOrganization.id)
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    enabled: !!user && !!currentOrganization?.id && !!campaignId,
  });
}

/**
 * Hook to create a new campaign
 */
export function useCreateCampaign() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description || null,
          // Array is the source of truth; the DB trigger keeps lead_list_id in sync.
          lead_list_ids: input.lead_list_ids ?? (input.lead_list_id ? [input.lead_list_id] : []),
          exclusion_list_ids: input.exclusion_list_ids || [],
          exclude_other_campaigns: input.exclude_other_campaigns ?? true,
          exclude_same_sender: input.exclude_same_sender ?? true,
          auto_enroll_new_members: input.auto_enroll_new_members ?? false,
          enroll_filter_criteria: input.enroll_filter_criteria ?? {},
          entry_triggers: (input.entry_triggers ?? []) as unknown as Json,
          sender_account_ids: input.sender_account_ids || [],
          sequence_nodes: input.sequence_nodes || [],
          sequence_edges: input.sequence_edges || [],
          stop_on_reply: input.stop_on_reply ?? true,
          campaign_settings: input.campaign_settings || undefined,
          rate_settings: input.rate_settings || undefined,
          autopilot_config: input.autopilot_config || undefined,
          agent_profile_id: input.agent_profile_id || null,
          icp_product_id: input.icp_product_id || null,
          min_icp_score: input.min_icp_score ?? null,
          campaign_type: input.campaign_type || "linkedin_only",
          sender_accounts: input.sender_accounts || {},
          primary_channel: input.primary_channel || "linkedin",
          channel_fallback_enabled: input.channel_fallback_enabled ?? false,
          fallback_order: input.fallback_order || ["linkedin", "email", "whatsapp", "instagram"],
          created_by: user?.id || null,
        } as unknown as Database["public"]["Tables"]["linkedin_campaigns"]["Insert"])
        .select(`
          *,
          lead_list:lead_lists(id, name, lead_count)
        `)
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["linkedin-campaign", data.organization_id, data.id], data);
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns", data.organization_id] });
      toast.success("Campaign created successfully");
    },
    onError: (error) => {
      console.error("Failed to create campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create campaign");
    },
  });
}

/**
 * Hook to update a campaign
 */
export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, updates }: UpdateCampaignInput) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const dbUpdates = {
        ...campaignWritePayload(updates as Record<string, unknown>),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .update(dbUpdates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select(`
          *,
          lead_list:lead_lists(id, name, lead_count)
        `)
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["linkedin-campaign", data.organization_id, data.id], data);
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns", data.organization_id] });
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaign", data.organization_id, data.id] });
    },
    onError: (error) => {
      console.error("Failed to update campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update campaign");
    },
  });
}

/**
 * Hook to delete a campaign
 */
export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (campaignId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("linkedin_campaigns")
        .delete()
        .eq("id", campaignId)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      toast.success("Campaign deleted successfully");
    },
    onError: (error) => {
      console.error("Failed to delete campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete campaign");
    },
  });
}

/**
 * Hook to duplicate a campaign
 */
export function useDuplicateCampaign() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (campaignId: string) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      // Fetch original campaign
      const { data: original, error: fetchError } = await supabase
        .from("linkedin_campaigns")
        .select("*")
        .eq("id", campaignId)
        .eq("organization_id", currentOrganization.id)
        .single();

      if (fetchError) throw fetchError;

      // Create duplicate
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .insert({
          organization_id: currentOrganization.id,
          name: `${original.name} (Copy)`,
          description: original.description,
          status: 'draft',
          lead_list_ids: original.lead_list_ids ?? (original.lead_list_id ? [original.lead_list_id] : []),
          exclusion_list_ids: original.exclusion_list_ids,
          exclude_other_campaigns: original.exclude_other_campaigns,
          exclude_same_sender: original.exclude_same_sender,
          auto_enroll_new_members: original.auto_enroll_new_members,
          entry_triggers: original.entry_triggers,
          sender_account_ids: original.sender_account_ids,
          sequence_nodes: original.sequence_nodes,
          sequence_edges: original.sequence_edges,
          stop_on_reply: original.stop_on_reply,
          campaign_settings: original.campaign_settings,
          autopilot_config: original.autopilot_config,
          agent_profile_id: original.agent_profile_id,
          icp_product_id: original.icp_product_id,
          min_icp_score: original.min_icp_score,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      toast.success("Campaign duplicated successfully");
    },
    onError: (error) => {
      console.error("Failed to duplicate campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to duplicate campaign");
    },
  });
}

/**
 * Hook to start a campaign
 */
export function useStartCampaign() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (campaignId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .update({
          status: 'active',
          started_at: new Date().toISOString(),
          paused_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaign", currentOrganization?.id, data.id] });
      toast.success("Campaign started");
    },
    onError: (error) => {
      console.error("Failed to start campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to start campaign");
    },
  });
}

/**
 * Hook to pause a campaign
 */
export function usePauseCampaign() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (campaignId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .update({
          status: 'paused',
          paused_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaign", currentOrganization?.id, data.id] });
      toast.success("Campaign paused");
    },
    onError: (error) => {
      console.error("Failed to pause campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to pause campaign");
    },
  });
}

/**
 * Hook to move a campaign back to draft
 */
export function useDraftCampaign() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (campaignId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .update({
          status: 'draft',
          paused_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;

      return data as unknown as LinkedInCampaign;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["linkedin-campaign", currentOrganization?.id, data.id] });
      toast.success("Campaign moved to draft");
    },
    onError: (error) => {
      console.error("Failed to move campaign to draft:", error);
      toast.error(error instanceof Error ? error.message : "Failed to move campaign to draft");
    },
  });
}
