import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { DnsProvider, CloudflareZone } from "@/types/email";

// ============================================================================
// Shared types: shapes returned by the dns-cloudflare-* edge functions
// ============================================================================

export interface UnmigratedMatch {
  id: string;
  domain: string;
  dns_managed: boolean;
}

export interface DnsPushPlan {
  adds: Array<{ type: string; name: string; value: string; ttl?: number; priority?: number }>;
  updates: Array<{
    current: { id: string; type: string; name: string; content: string };
    target: { type: string; name: string; value: string; ttl?: number; priority?: number };
    reason: string;
  }>;
  keeps: Array<{ type: string; name: string; value: string }>;
  conflicts: Array<{ id: string; type: string; name: string; value: string; reason: string }>;
}

export interface DnsPushResponse {
  success?: boolean;
  requires_confirmation?: boolean;
  dry_run?: boolean;
  zone_id?: string;
  nameservers_assigned?: string[];
  diff?: DnsPushPlan;
  counts?: { created: number; updated: number; deleted: number; skipped: number; failed: number };
  summary?: string;
  results?: Array<{ action: string; record: unknown; success: boolean; error?: string }>;
  error?: string;
  error_title?: string;
  next_steps?: string[];
  help_url?: string;
}

// ============================================================================
// Commit 1: connect / disconnect / status only.
//
// Subsequent commits add useCloudflareZones, usePushDnsToCloudflare,
// useDomainPushPreview, useMigrateDomainToCloudflare, useCheckCloudflareNameservers.
// ============================================================================

interface CloudflareProviderStatus {
  connected: boolean;
  provider?: DnsProvider;
}

/**
 * Read the org's current DNS provider connection state. Returns `connected: false`
 * when no row exists in dns_providers. Refresh-on-stale runs server-side
 * (re-verifies token against Cloudflare if older than 24h).
 */
export function useDnsProvider() {
  const { currentOrganization } = useAuth();

  return useQuery<CloudflareProviderStatus>({
    queryKey: ["dns-provider", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return { connected: false };
      const data = await invokeEdgeFunction<CloudflareProviderStatus>("dns-cloudflare-connect", {
        action: "status",
        organization_id: currentOrganization.id,
      });
      return data ?? { connected: false };
    },
    enabled: !!currentOrganization,
    // Keep the connection state fresh-ish but don't hammer Cloudflare on every
    // mount — the server-side stale check covers slow drift.
    staleTime: 60 * 1000,
  });
}

interface ConnectInput {
  api_token: string;
}

interface ConnectResponse {
  success?: boolean;
  provider?: {
    id: string;
    account_id: string;
    account_name: string;
    validated_at: string;
    zone_count: number;
  };
  // Structured-error shape (mirrors M365 wizard's pattern). When present, the
  // dialog renders title + body + next_steps inline instead of toasting.
  error?: string;
  error_title?: string;
  next_steps?: string[];
}

/**
 * Validate a Cloudflare API token, then persist it encrypted server-side.
 * On structured failure (invalid token, missing perms) returns the error
 * envelope so the dialog can render inline instructions instead of toasting.
 */
export function useConnectCloudflare() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: ConnectInput): Promise<ConnectResponse> => {
      if (!currentOrganization) throw new Error("No organization context");
      const data = await invokeEdgeFunction<ConnectResponse>("dns-cloudflare-connect", {
        action: "validate_and_store",
        organization_id: currentOrganization.id,
        ...input,
      });
      return data ?? { error: "No response from Cloudflare connect endpoint" };
    },
    onSuccess: (data) => {
      // Refetch status after a successful connect. Errors stay in the mutation
      // result so the dialog can render them inline (no toast for structured errors).
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["dns-provider", currentOrganization?.id] });
        // A fresh token can see a different zone set than whatever was cached
        // (or errored out) under the old one — reconnect must refetch this too.
        queryClient.invalidateQueries({ queryKey: ["cloudflare-zones", currentOrganization?.id] });
        toast.success(`Cloudflare connected (${data.provider?.zone_count ?? 0} ${(data.provider?.zone_count ?? 0) === 1 ? "domain" : "domains"})`);
      }
    },
    onError: (error: Error) => {
      // Only generic / network errors land here. Structured errors come back as
      // data.error and are rendered by the dialog.
      toast.error(`Connection failed: ${error.message}`);
    },
  });
}

/**
 * Remove the org's Cloudflare credential. Records already written to Cloudflare
 * zones stay in place — disconnecting just stops future auto-push.
 */
export function useDisconnectCloudflare() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization) throw new Error("No organization context");
      return await invokeEdgeFunction("dns-cloudflare-connect", {
        action: "disconnect",
        organization_id: currentOrganization.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dns-provider", currentOrganization?.id] });
      toast.success("Cloudflare disconnected");
    },
    onError: (error: Error) => {
      toast.error(`Disconnect failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Zone listing + migration matching
// ============================================================================

interface ListZonesResponse {
  zones?: CloudflareZone[];
  unmigrated_matches?: UnmigratedMatch[];
  error?: string;
}

/**
 * List Cloudflare zones for the org. `nameContains` does a server-side filter
 * (Cloudflare's name= is exact-match, so for substring matches we pull all
 * zones — fine up to a few hundred). `includeUnmigratedMatches` returns the
 * cross-reference between zones and existing ACA domains that aren't yet on
 * managed DNS — powers the connect-success "migrate N domains" CTA.
 */
export function useCloudflareZones(opts?: {
  nameContains?: string;
  includeUnmigratedMatches?: boolean;
  enabled?: boolean;
}) {
  const { currentOrganization } = useAuth();

  return useQuery<ListZonesResponse>({
    queryKey: ["cloudflare-zones", currentOrganization?.id, opts?.nameContains, opts?.includeUnmigratedMatches],
    queryFn: async () => {
      if (!currentOrganization) return {};
      const data = await invokeEdgeFunction<ListZonesResponse>("dns-cloudflare-list-zones", {
        organization_id: currentOrganization.id,
        name_contains: opts?.nameContains,
        include_unmigrated_matches: opts?.includeUnmigratedMatches ?? false,
      });
      return data ?? {};
    },
    enabled: !!currentOrganization && (opts?.enabled ?? true),
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// Push records (preview + execute)
// ============================================================================

interface PushInput {
  domain_id: string;
  confirm_destructive?: boolean;
  dry_run?: boolean;
  only_dkim?: boolean;
}

/**
 * Push a domain's dns_records to its Cloudflare zone. Two-call pattern:
 *   1. First call with `dry_run: true` (or no confirm_destructive) → returns
 *      the diff. UI renders the diff and asks for user confirmation.
 *   2. Second call with `confirm_destructive: true` → executes the plan.
 *
 * Structured errors (no Cloudflare zone, missing connection) come back in
 * data.error/error_title/next_steps — the caller renders them inline.
 */
export function usePushDnsToCloudflare() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: PushInput): Promise<DnsPushResponse> => {
      if (!currentOrganization) throw new Error("No organization context");
      const data = await invokeEdgeFunction<DnsPushResponse>("dns-cloudflare-push-records", {
        organization_id: currentOrganization.id,
        ...input,
      });
      return data ?? { error: "No response" };
    },
    onSuccess: (data) => {
      // Only the final push (success && !requires_confirmation && !dry_run) invalidates
      // the domain list. Diff previews are read-only.
      if (data.success && !data.requires_confirmation && !data.dry_run) {
        queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
        if (data.summary) toast.success(data.summary);
      }
    },
    onError: (error: Error) => {
      toast.error(`Push failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Nameserver check (migrate-existing-domain flow)
// ============================================================================

interface NameserverCheckResponse {
  status?: "pending" | "pending_cf_activation" | "active";
  nameservers_assigned?: string[];
  nameservers_active?: string[];
  zone_status?: string | null;
  next_check_recommended_in_seconds?: number;
  error?: string;
}

export function useCheckCloudflareNameservers() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (domainId: string): Promise<NameserverCheckResponse> => {
      if (!currentOrganization) throw new Error("No organization context");
      const data = await invokeEdgeFunction<NameserverCheckResponse>("dns-cloudflare-check-nameservers", {
        organization_id: currentOrganization.id,
        domain_id: domainId,
      });
      return data ?? {};
    },
    onError: (error: Error) => {
      toast.error(`Nameserver check failed: ${error.message}`);
    },
  });
}
