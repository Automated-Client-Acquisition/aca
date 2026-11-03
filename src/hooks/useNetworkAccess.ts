import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type NetworkStatus = "none" | "pending" | "approved" | "rejected" | "suspended";

export interface NetworkApplication {
  company: string;
  website: string;
  use_case: string;
  self_hosted: boolean;
}

export interface NetworkAccess {
  network_status: NetworkStatus;
  network_only: boolean;
  network_application: NetworkApplication | null;
  network_requested_at: string | null;
  network_reviewed_at: string | null;
  network_review_note: string | null;
  network_billing_ready_at: string | null;
}

export interface NetworkRequestRow extends NetworkAccess {
  id: string;
  name: string;
}

const NETWORK_COLUMNS =
  "network_status, network_only, network_application, network_requested_at, network_reviewed_at, network_review_note, network_billing_ready_at";

// The generated Supabase types predate these columns and RPCs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useNetworkAccess() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["network-access", currentOrganization?.id],
    queryFn: async (): Promise<NetworkAccess> => {
      const { data, error } = await db
        .from("organizations")
        .select(NETWORK_COLUMNS)
        .eq("id", currentOrganization!.id)
        .single();
      if (error) throw error;
      return data as NetworkAccess;
    },
    enabled: !!currentOrganization,
  });
}

export function useRequestNetworkAccess() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      company: string;
      website: string;
      useCase: string;
      selfHosted: boolean;
    }) => {
      const { error } = await db.rpc("request_network_access", {
        p_company: input.company,
        p_website: input.website,
        p_use_case: input.useCase,
        p_self_hosted: input.selfHosted,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["network-access", currentOrganization?.id] });
      toast.success("Application sent. We review every request by hand.");
    },
    onError: (err: Error) => {
      toast.error(`Could not send the application: ${err.message}`);
    },
  });
}

export function useStartNetworkBillingSetup() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("network-billing-setup", {
        body: {},
      });
      if (error) throw error;
      const payload = data as { url?: string; error?: string };
      if (payload?.error || !payload?.url) throw new Error(payload?.error ?? "No checkout URL");
      return payload.url;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: Error) => {
      toast.error(`Could not open card setup: ${err.message}`);
    },
  });
}

/** ACA staff: organizations waiting for a network decision. */
export function useNetworkRequests() {
  const { isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ["admin-network-requests"],
    queryFn: async (): Promise<NetworkRequestRow[]> => {
      const { data, error } = await db
        .from("organizations")
        .select(`id, name, ${NETWORK_COLUMNS}`)
        .eq("network_status", "pending")
        .order("network_requested_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as NetworkRequestRow[];
    },
    enabled: isSuperAdmin,
  });
}

export function useAdminNetworkAccess(orgId: string | undefined) {
  return useQuery({
    queryKey: ["admin-network-access", orgId],
    queryFn: async (): Promise<NetworkAccess> => {
      const { data, error } = await db
        .from("organizations")
        .select(NETWORK_COLUMNS)
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as NetworkAccess;
    },
    enabled: !!orgId,
  });
}

export type NetworkDecision = "approve" | "reject" | "suspend" | "reinstate";

export function useReviewNetworkAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orgId: string; decision: NetworkDecision; note?: string }) => {
      const { error } = await db.rpc("review_network_access", {
        p_org_id: input.orgId,
        p_decision: input.decision,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["admin-network-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-network-access", input.orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin-action-logs"] });
      toast.success(`Network access: ${input.decision} saved`);
    },
    onError: (err: Error) => {
      toast.error(`Could not save the decision: ${err.message}`);
    },
  });
}
