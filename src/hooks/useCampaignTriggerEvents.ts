import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CampaignEntryType } from "@/lib/campaign-entry";

export interface CampaignTriggerEvent {
  id: string;
  campaign_id: string;
  trigger_id: string;
  event_type: CampaignEntryType;
  contact_id: string;
  status:
    | "pending"
    | "processing"
    | "review"
    | "enrolled"
    | "ignored"
    | "declined"
    | "error";
  reason: string | null;
  icp_score: number | null;
  created_at: string;
  processed_at: string | null;
  decision_state: string | null;
  context: {
    name?: string;
    text?: string;
    postId?: string;
    signalType?: string;
    eventName?: string;
    listId?: string;
    listName?: string;
  };
}

export function useCampaignTriggerEvents(campaignId?: string, enabled = true) {
  const { currentOrganization, user } = useAuth();
  const organizationId = currentOrganization?.id;
  const queryClient = useQueryClient();
  const queryKey = ["campaign-trigger-events", organizationId, campaignId];
  const permissions = useQuery({
    queryKey: ["campaign-trigger-permissions", organizationId, user?.id],
    enabled: enabled && !!organizationId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("organization_members").select("role,permissions").eq("organization_id", organizationId!).eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return !!data && (["owner", "admin"].includes(data.role) || Array.isArray(data.permissions) && data.permissions.some(permission => ["campaigns:write", "manage_campaigns", "admin:*", "*"].includes(String(permission))));
    },
  });
  const query = useQuery({
    queryKey,
    enabled: enabled && !!organizationId && !!campaignId,
    refetchInterval: enabled ? 30_000 : false,
    queryFn: async () => {
      // Parent scope is verified independently of queue row RLS.
      const { data: parent, error: parentError } = await supabase
        .from("linkedin_campaigns")
        .select("id")
        .eq("id", campaignId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (parentError) throw parentError;
      if (!parent)
        throw new Error("This campaign is unavailable in this workspace.");
      const { data, error } = await (supabase as unknown as SupabaseClient)
        .from("campaign_trigger_events")
        .select(
          "id,campaign_id,trigger_id,event_type,contact_id,status,reason,icp_score,decision_state,created_at,processed_at,context,contact:crm_contacts(display_name,first_name,last_name)",
        )
        .eq("organization_id", organizationId!)
        .eq("campaign_id", campaignId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const person = Array.isArray(row.contact) ? row.contact[0] : row.contact;
        const name = person?.display_name || [person?.first_name, person?.last_name].filter(Boolean).join(" ");
        return { ...row, context: { ...row.context, ...(name ? { name } : {}) } };
      }) as CampaignTriggerEvent[];
    },
  });
  const decision = useMutation({
    mutationFn: async ({
      eventId,
      action,
    }: {
      eventId: string;
      action: "approve" | "ignore";
    }) => {
      if (!organizationId || !campaignId)
        throw new Error("Choose a saved campaign first.");
      const { data, error } = await supabase.functions.invoke(
        "campaign-trigger-events",
        {
          body: { action, eventId, campaignId, organizationId },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({
        queryKey: ["linkedin-campaign", organizationId, campaignId],
      });
      queryClient.invalidateQueries({
        queryKey: ["campaign-progress-stats", campaignId, organizationId],
      });
    },
  });
  return { ...query, decision, canReview: permissions.data === true };
}
