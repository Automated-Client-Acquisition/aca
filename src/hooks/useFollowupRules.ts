import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { FollowupRule, FollowupTriggerType } from "@/types/classification";

export function useFollowupRules(sequenceId?: string, campaignId?: string, leadMagnetCampaignId?: string) {
  const { currentOrganization } = useAuth();
  const sourceColumn = sequenceId
    ? 'sequence_id'
    : leadMagnetCampaignId
      ? 'lead_magnet_campaign_id'
      : 'campaign_id';
  const sourceId = sequenceId || leadMagnetCampaignId || campaignId;

  return useQuery({
    queryKey: ["followup-rules", currentOrganization?.id, sourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequence_followup_rules")
        .select(
          `*, target_sequence:target_sequence_id(id, name)`
        )
        .eq("organization_id", currentOrganization!.id)
        .eq(sourceColumn, sourceId!)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return (data || []).map((r: any) => ({
        ...r,
        target_sequence_name: r.target_sequence?.name || "Unknown",
      })) as FollowupRule[];
    },
    enabled: !!currentOrganization && !!sourceId,
    retry: false,
  });
}

export function useCreateFollowupRule() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sequence_id?: string;
      campaign_id?: string;
      lead_magnet_campaign_id?: string;
      name: string;
      trigger_type: FollowupTriggerType;
      trigger_config: Record<string, unknown>;
      target_sequence_id: string;
      delay_hours?: number;
    }) => {
      const { data, error } = await supabase
        .from("email_sequence_followup_rules")
        .insert({
          organization_id: currentOrganization!.id,
          sequence_id: input.sequence_id || null,
          campaign_id: input.campaign_id || null,
          lead_magnet_campaign_id: input.lead_magnet_campaign_id || null,
          name: input.name,
          trigger_type: input.trigger_type,
          trigger_config: input.trigger_config,
          target_sequence_id: input.target_sequence_id,
          delay_hours: input.delay_hours ?? 0,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      const sourceId = variables.sequence_id || variables.lead_magnet_campaign_id || variables.campaign_id;
      queryClient.invalidateQueries({
        queryKey: ["followup-rules", currentOrganization?.id, sourceId],
      });
      queryClient.invalidateQueries({ queryKey: ["lead-magnet-recovery-context"] });
      toast.success("Follow-up rule created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create rule");
    },
  });
}

export function useUpdateFollowupRule() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      sequence_id?: string;
      campaign_id?: string;
      lead_magnet_campaign_id?: string;
      name?: string;
      trigger_type?: FollowupTriggerType;
      trigger_config?: Record<string, unknown>;
      target_sequence_id?: string;
      delay_hours?: number;
      is_active?: boolean;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { id, sequence_id, campaign_id, lead_magnet_campaign_id, ...updates } = input;
      const { error } = await supabase
        .from("email_sequence_followup_rules")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      const sourceId = variables.sequence_id || variables.lead_magnet_campaign_id || variables.campaign_id;
      queryClient.invalidateQueries({
        queryKey: ["followup-rules", currentOrganization?.id, sourceId],
      });
      queryClient.invalidateQueries({ queryKey: ["lead-magnet-recovery-context"] });
      toast.success("Follow-up rule updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update rule");
    },
  });
}

export function useDeleteFollowupRule() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; sequence_id?: string; campaign_id?: string; lead_magnet_campaign_id?: string }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("email_sequence_followup_rules")
        .delete()
        .eq("id", input.id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      const sourceId = variables.sequence_id || variables.lead_magnet_campaign_id || variables.campaign_id;
      queryClient.invalidateQueries({
        queryKey: ["followup-rules", currentOrganization?.id, sourceId],
      });
      queryClient.invalidateQueries({ queryKey: ["lead-magnet-recovery-context"] });
      toast.success("Follow-up rule deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete rule");
    },
  });
}

export function useToggleFollowupRule() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      sequence_id?: string;
      campaign_id?: string;
      lead_magnet_campaign_id?: string;
      is_active: boolean;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("email_sequence_followup_rules")
        .update({ is_active: input.is_active })
        .eq("id", input.id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      const sourceId = variables.sequence_id || variables.lead_magnet_campaign_id || variables.campaign_id;
      queryClient.invalidateQueries({
        queryKey: ["followup-rules", currentOrganization?.id, sourceId],
      });
      queryClient.invalidateQueries({ queryKey: ["lead-magnet-recovery-context"] });
      toast.success(variables.is_active ? "Rule enabled" : "Rule disabled");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to toggle rule");
    },
  });
}
