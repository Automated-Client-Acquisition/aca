import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const CAMPAIGN_EVENTS_PATH = "/api/v1/campaign-events";

export interface TriggerTestResult {
  triggerId: string;
  name: string;
  matched: boolean;
  qualification: "match" | "mismatch" | "review" | null;
  icpScore: number | null;
  reason: string;
}

export interface TriggerTestResponse {
  success: true;
  test: true;
  receiptId: string;
  received: { campaignId: string; event: Record<string, unknown> };
  campaignStatus: string;
  contact: { id: string; name: string };
  results: TriggerTestResult[];
}

export interface TriggerTestReceipt {
  id: string;
  received: TriggerTestResponse["received"];
  campaign_status: string;
  contact: TriggerTestResponse["contact"];
  results: TriggerTestResult[];
  created_at: string;
  auth_method: "jwt" | "api_token";
}

export function useCampaignTriggerTest(campaignId?: string, listening = false) {
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;
  const queryClient = useQueryClient();
  const queryKey = ["campaign-trigger-test-receipts", organizationId, campaignId];
  const authenticatedHeaders = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Sign in again to send a test event.");
    return { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` };
  };
  const confirmTestMode = async () => {
    const response = await fetch(CAMPAIGN_EVENTS_PATH, {
      headers: await authenticatedHeaders(), signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true || result?.testMode !== true) {
      throw new Error(response.status !== 405 && result?.error || "Connection testing is unavailable until the updated event endpoint is deployed.");
    }
    return true;
  };
  const capability = useQuery({
    queryKey: ["campaign-trigger-test-capability", organizationId],
    enabled: listening && !!organizationId,
    retry: false,
    queryFn: confirmTestMode,
  });
  const receipts = useQuery({
    queryKey,
    enabled: listening && !!organizationId && !!campaignId,
    refetchInterval: listening ? 5_000 : false,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as SupabaseClient)
        .from("campaign_trigger_test_receipts")
        .select("id,received,results,campaign_status,contact,auth_method,created_at")
        .eq("organization_id", organizationId!)
        .eq("campaign_id", campaignId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as TriggerTestReceipt[];
    },
  });
  const test = useMutation({
    mutationFn: async ({ payload, triggerId }: { payload: Record<string, unknown>; triggerId: string }) => {
      if (!organizationId || !campaignId) throw new Error("Save this campaign before testing it.");
      if (payload.campaignId !== campaignId) throw new Error("The payload must use this campaign's ID.");
      // Older servers treated unknown actions as live events. Confirm support before any POST.
      await confirmTestMode();
      const response = await fetch(CAMPAIGN_EVENTS_PATH, {
        method: "POST",
        headers: await authenticatedHeaders(),
        // Always force test mode, even if the editable payload was copied from a live workflow.
        body: JSON.stringify({ ...payload, action: "test", campaignId, triggerId, organizationId }),
        signal: AbortSignal.timeout(20_000),
      });
      let result: TriggerTestResponse & { error?: string };
      try {
        result = await response.json();
      } catch {
        throw new Error("The event endpoint did not return JSON. Check the API route and try again.");
      }
      if (!response.ok || !result?.success) throw new Error(result?.error || `Test failed (HTTP ${response.status}).`);
      if (result.test !== true || !result.receiptId) throw new Error("The endpoint did not confirm test mode. Check that the updated event endpoint is deployed.");
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
  return { receipts, test, capability };
}
