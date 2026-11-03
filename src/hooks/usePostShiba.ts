import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { invokeEdgeFunction, EdgeFunctionError } from "@/lib/supabase-functions";

// ============================================================================
// Shapes returned by the postshiba-connect edge function
// ============================================================================

export type PostShibaClassification = "transactional" | "bulk";

export interface PostShibaCluster {
  id: string;
  name: string;
  plan: string;
  classification: PostShibaClassification;
  status: string;
  sending_ready: boolean;
  emails_per_day: number;
  emails_per_hour: number;
}

export interface PostShibaTenant {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
  /** Another ACA organization's connection already uses it. */
  in_use_elsewhere: boolean;
  /** This organization's current tenant. */
  current: boolean;
}

export type PostShibaConnectionStatus =
  | "active"
  | "suspended"
  | "operator_hold"
  | "team_suspended"
  | "invalid";

export interface PostShibaConnection {
  team_id: string;
  api_key_hint: string;
  cluster_id: string;
  cluster_name: string;
  cluster_plan: string;
  cluster_classification: PostShibaClassification;
  emails_per_day: number;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string | null;
  status: PostShibaConnectionStatus;
  last_validated_at: string | null;
  last_error: string | null;
}

export type PostShibaErrorCode =
  | "invalid_key"
  | "wrong_team"
  | "kyc_required"
  | "payment_required"
  | "team_suspended"
  | "cluster_not_ready"
  | "rate_limited"
  | "not_connected"
  | "feature_disabled"
  | "tenant_not_found"
  | "tenant_in_use";

export type PostShibaStatusResponse =
  | { connected: false }
  | { connected: true; connection: PostShibaConnection };

export interface PostShibaValidateResult {
  clusters: PostShibaCluster[];
  tenants: PostShibaTenant[];
}

export interface PostShibaMigrationResult {
  domains_moved: number;
  domains_failed: Array<{ domain: string; error: string }>;
  senders_updated: number;
}

interface ConnectResponse {
  ok: true;
  connection: PostShibaConnection;
  /** Set when an existing connection changed tenant or cluster. */
  migration: PostShibaMigrationResult | null;
}

export interface PostShibaCredentials {
  team_id: string;
  api_key: string;
}

export interface PostShibaConnectInput extends PostShibaCredentials {
  cluster_id: string;
  /** An existing tenant of the team. */
  tenant_id?: string;
  /** Or create a new tenant with this name. */
  new_tenant_name?: string;
}

/**
 * Pull the human-readable message and error_code out of a failed
 * postshiba-connect call. The backend's `error` is already a sentence meant
 * for the user, so it wins over anything we could write here.
 */
export function getPostShibaError(err: unknown): { message: string; code?: PostShibaErrorCode } {
  if (err instanceof EdgeFunctionError) {
    const body = err.details ?? {};
    const message = typeof body.error === "string" && body.error ? body.error : err.message;
    const code = typeof body.error_code === "string" ? (body.error_code as PostShibaErrorCode) : undefined;
    return { message, code };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: "Something went wrong. Try again." };
}

export function formatPostShibaClassification(value: string): string {
  if (value === "transactional") return "Transactional";
  if (value === "bulk") return "Bulk";
  return value;
}

const FUNCTION_NAME = "postshiba-connect";

/**
 * Current PostShiba connection for the org. Only runs when the org has the
 * `postshiba` feature turned on (organizations.limits.features.postshiba).
 */
export function usePostShibaConnection() {
  const { currentOrganization } = useAuth();
  const { hasFeature } = useFeatureAccess();
  const enabled = !!currentOrganization && hasFeature("postshiba");

  return useQuery<PostShibaStatusResponse>({
    queryKey: ["postshiba_connection", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return { connected: false };
      const data = await invokeEdgeFunction<PostShibaStatusResponse>(FUNCTION_NAME, {
        action: "status",
        organization_id: currentOrganization.id,
      });
      return data ?? { connected: false };
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/**
 * Check a team id + API key against PostShiba and list the team's clusters and tenants.
 * Nothing is stored. Errors are thrown so the dialog can render them inline.
 */
export function useValidatePostShiba() {
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: PostShibaCredentials): Promise<PostShibaValidateResult> => {
      if (!currentOrganization) throw new Error("No organization selected.");
      const data = await invokeEdgeFunction<PostShibaValidateResult & { ok: true }>(FUNCTION_NAME, {
        action: "validate",
        organization_id: currentOrganization.id,
        team_id: input.team_id,
        api_key: input.api_key,
      });
      return { clusters: data?.clusters ?? [], tenants: data?.tenants ?? [] };
    },
  });
}

/**
 * Store the credentials and the chosen cluster. Errors are thrown so the
 * dialog can render them inline; success refreshes the connection card.
 */
export function useConnectPostShiba() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: PostShibaConnectInput): Promise<ConnectResponse> => {
      if (!currentOrganization) throw new Error("No organization selected.");
      const data = await invokeEdgeFunction<ConnectResponse>(FUNCTION_NAME, {
        action: "connect",
        organization_id: currentOrganization.id,
        team_id: input.team_id,
        api_key: input.api_key,
        cluster_id: input.cluster_id,
        tenant_id: input.tenant_id,
        new_tenant_name: input.new_tenant_name,
      });
      if (!data?.connection) throw new Error("PostShiba did not return a connection. Try again.");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postshiba_connection", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["postshiba-domains", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["postshiba-senders", currentOrganization?.id] });
    },
  });
}

/**
 * Remove the org's PostShiba connection.
 */
export function useDisconnectPostShiba() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization) throw new Error("No organization selected.");
      return await invokeEdgeFunction<{ ok: true }>(FUNCTION_NAME, {
        action: "disconnect",
        organization_id: currentOrganization.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postshiba_connection", currentOrganization?.id] });
      toast.success("PostShiba disconnected");
    },
    onError: (error: unknown) => {
      toast.error(`Disconnect failed: ${getPostShibaError(error).message}`);
    },
  });
}
