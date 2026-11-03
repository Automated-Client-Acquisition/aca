import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CampaignLeadProgress, CampaignActionLog } from "@/hooks/useCampaignProgress";

interface TestContactResult {
  success: boolean;
  result?: {
    leadId: string;
    contactId: string;
    action: string;
    success: boolean;
    error?: string;
  };
  progress?: CampaignLeadProgress;
  actionLogs?: CampaignActionLog[];
  error?: string;
}

/**
 * Mutation: start a test run with a single contact
 */
export function useStartTestContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      campaignId,
      contactId,
      senderAccountId,
    }: {
      campaignId: string;
      contactId: string;
      senderAccountId: string;
    }): Promise<TestContactResult> => {
      const { data, error } = await supabase.functions.invoke("campaign-test-contact", {
        body: { action: "start", campaignId, contactId, senderAccountId },
      });
      if (error) throw error;
      return data as TestContactResult;
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ["campaign-test-progress", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-test-action-logs"] });
    },
    onError: (error) => {
      toast.error(`Test failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });
}

/**
 * Mutation: advance the test contact to the next step (optionally with condition override)
 */
export function useAdvanceTestContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      campaignId,
      progressId,
      conditionOverride,
    }: {
      campaignId: string;
      progressId: string;
      conditionOverride?: { type: string; branch: string };
    }): Promise<TestContactResult> => {
      const { data, error } = await supabase.functions.invoke("campaign-test-contact", {
        body: { action: "advance", campaignId, progressId, conditionOverride },
      });
      if (error) throw error;
      return data as TestContactResult;
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ["campaign-test-progress", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-test-action-logs"] });
    },
    onError: (error) => {
      toast.error(`Advance failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });
}

/**
 * Mutation: remove all test data for a campaign
 */
export function useCleanupTestContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campaignId }: { campaignId: string }) => {
      const { data, error } = await supabase.functions.invoke("campaign-test-contact", {
        body: { action: "cleanup", campaignId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ["campaign-test-progress", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-test-action-logs"] });
      toast.success("Test data removed");
    },
    onError: () => {
      toast.error("Failed to clean up test data");
    },
  });
}

/**
 * Query: poll the test contact's progress row
 */
export function useCampaignTestProgress(campaignId: string | undefined) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["campaign-test-progress", campaignId, currentOrganization?.id],
    queryFn: async () => {
      if (!campaignId) return null;

      const { data, error } = await (supabase
        .from("campaign_lead_progress")
        .select(`
          *,
          contact:crm_contacts(id, first_name, last_name, display_name, linkedin_url, company, job_title, avatar_url),
          sender_account:unipile_accounts(id, display_name)
        `)
        .eq("campaign_id", campaignId) as any)
        .eq("is_test_contact", true)
        .maybeSingle();

      if (error) throw error;
      return data as CampaignLeadProgress | null;
    },
    enabled: !!user && !!currentOrganization && !!campaignId,
  });
}

/**
 * Query: fetch action logs for a test contact's progress row
 */
export function useTestContactActionLogs(progressId: string | undefined) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["campaign-test-action-logs", progressId, currentOrganization?.id],
    queryFn: async () => {
      if (!progressId) return [];

      const { data, error } = await supabase
        .from("campaign_action_log")
        .select("*")
        .eq("progress_id", progressId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as CampaignActionLog[];
    },
    enabled: !!user && !!currentOrganization && !!progressId,
  });
}
