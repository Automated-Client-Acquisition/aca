import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeEdgeFunction, EdgeFunctionError } from "@/lib/supabase-functions";
import { getPostShibaError } from "@/hooks/usePostShiba";

// ============================================================================
// Shapes: PostShiba sending domains (email_sending_domains rows with
// infra_type='postshiba') and their senders (email_mailboxes rows with
// connection_type='postshiba'). Writes go through the postshiba-provision
// edge function.
// ============================================================================

export interface PostShibaDnsRecord {
  type: "CNAME" | "TXT" | "MX";
  name: string;
  value: string;
  ttl: number;
  priority?: number;
  description: string;
}

export interface PostShibaDomain {
  id: string;
  domain: string;
  dns_records: PostShibaDnsRecord[];
  dns_status: string;
  dns_managed: boolean;
  dkim_verified: boolean;
  dmarc_verified: boolean;
  return_path_verified: boolean;
  sending_allowed: boolean;
  inbox_created: boolean;
  inbox_host: string | null;
  inbox_mx_status: string | null;
  mx_verified: boolean;
  mailbox_count: number;
  last_dns_check_at: string | null;
  last_error: string | null;
  /** Emails a day for the whole domain, split across its senders; null until set. */
  daily_volume: number | null;
  /**
   * auto: the cluster's daily limit shared across its auto domains, at most
   * senders x sender_cap. manual: daily_volume as typed.
   */
  volume_mode: "auto" | "manual";
  /** Most emails one sender sends a day on an auto domain. */
  sender_cap: number;
  created_at: string;
}

export interface PostShibaSender {
  id: string;
  email_address: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  daily_limit: number;
  status: string;
  imap_connected: boolean;
  sending_domain_id: string | null;
  created_at: string;
}

export interface PostShibaSenderInput {
  first_name: string;
  last_name: string;
  local_part: string;
}

export interface AddPostShibaSendersInput {
  domain_id: string;
  /** A manual domain's emails a day; ACA splits it across all of the domain's senders. Ignored on auto domains. */
  daily_volume?: number;
  senders: PostShibaSenderInput[];
}

export interface AddPostShibaSendersResult {
  ok: true;
  senders: Array<{ id: string; email_address: string; display_name: string | null; daily_limit: number; status: string }>;
  skipped: string[];
  capped: boolean;
}

export interface VerifyPostShibaDomainResult {
  ok: true;
  dns_changed: boolean;
  domain: PostShibaDomain;
}

export type PostShibaProvisionErrorCode =
  | "invalid_domain"
  | "domain_in_use"
  | "domain_has_mx"
  | "not_connected"
  | "connection_inactive"
  | "connection_mismatch"
  | "rate_limited"
  | "rejected"
  | "invalid_daily_limit"
  | "invalid_daily_volume"
  | "invalid_sender_cap"
  | "invalid_senders"
  | "senders_in_use"
  | "not_found"
  | "feature_disabled";

/** Local part rule the backend enforces (plus no "..") for sender addresses. */
export const POSTSHIBA_LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;
export const POSTSHIBA_MAX_SENDERS_PER_CALL = 100;
export const POSTSHIBA_MAX_DAILY_LIMIT = 500;

/**
 * Message, error_code and (for senders_in_use) the addresses already used by
 * other mailboxes, from a failed postshiba-provision call. The backend's
 * `error` is a sentence meant for the user.
 */
export function getPostShibaProvisionError(err: unknown): {
  message: string;
  code?: PostShibaProvisionErrorCode;
  skipped?: string[];
} {
  const { message, code } = getPostShibaError(err);
  const skippedRaw = err instanceof EdgeFunctionError ? err.details?.skipped : undefined;
  const skipped = Array.isArray(skippedRaw)
    ? skippedRaw.filter((s): s is string => typeof s === "string")
    : undefined;
  return { message, code: code as PostShibaProvisionErrorCode | undefined, skipped };
}

const FUNCTION_NAME = "postshiba-provision";

// Never select * here: the row also holds the inbox webhook secret.
const DOMAIN_COLUMNS =
  "id, domain, dns_records, dns_status, dns_managed, dkim_verified, dmarc_verified, mx_verified, " +
  "mailbox_count, last_dns_check_at, created_at, postshiba_sending_allowed, postshiba_return_path_verified, " +
  "postshiba_inbox_id, postshiba_inbox_host, postshiba_inbox_mx_status, postshiba_last_error, postshiba_daily_volume, " +
  "postshiba_volume_mode, postshiba_sender_cap";

const SENDER_COLUMNS =
  "id, email_address, display_name, first_name, last_name, daily_limit, status, imap_connected, sending_domain_id, created_at";

interface PostShibaDomainRow {
  id: string;
  domain: string;
  dns_records: PostShibaDnsRecord[] | null;
  dns_status: string | null;
  dns_managed: boolean | null;
  dkim_verified: boolean | null;
  dmarc_verified: boolean | null;
  mx_verified: boolean | null;
  mailbox_count: number | null;
  last_dns_check_at: string | null;
  created_at: string;
  postshiba_sending_allowed: boolean | null;
  postshiba_return_path_verified: boolean | null;
  postshiba_inbox_id: string | null;
  postshiba_inbox_host: string | null;
  postshiba_inbox_mx_status: string | null;
  postshiba_last_error: string | null;
  postshiba_daily_volume: number | null;
  postshiba_volume_mode: string | null;
  postshiba_sender_cap: number | null;
}

function toPostShibaDomain(row: PostShibaDomainRow): PostShibaDomain {
  return {
    id: row.id,
    domain: row.domain,
    dns_records: row.dns_records ?? [],
    dns_status: row.dns_status ?? "pending",
    dns_managed: !!row.dns_managed,
    dkim_verified: !!row.dkim_verified,
    dmarc_verified: !!row.dmarc_verified,
    return_path_verified: !!row.postshiba_return_path_verified,
    sending_allowed: !!row.postshiba_sending_allowed,
    inbox_created: !!row.postshiba_inbox_id,
    inbox_host: row.postshiba_inbox_host,
    inbox_mx_status: row.postshiba_inbox_mx_status,
    mx_verified: !!row.mx_verified,
    mailbox_count: row.mailbox_count ?? 0,
    last_dns_check_at: row.last_dns_check_at,
    last_error: row.postshiba_last_error,
    daily_volume: row.postshiba_daily_volume,
    volume_mode: row.postshiba_volume_mode === "manual" ? "manual" : "auto",
    sender_cap: row.postshiba_sender_cap ?? 500,
    created_at: row.created_at,
  };
}

/**
 * Refresh everything a PostShiba write can change: the PostShiba domain and
 * sender lists, plus the app-wide domain and mailbox lists (PostShiba rows
 * show up there as mailboxes and as domain names).
 */
function invalidatePostShibaProvisioning(queryClient: QueryClient, orgId: string | undefined) {
  queryClient.invalidateQueries({ queryKey: ["postshiba-domains", orgId] });
  queryClient.invalidateQueries({ queryKey: ["postshiba-senders", orgId] });
  queryClient.invalidateQueries({ queryKey: ["email-sending-domains", orgId] });
  queryClient.invalidateQueries({ queryKey: ["email-mailboxes", orgId] });
  queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", orgId] });
  queryClient.invalidateQueries({ queryKey: ["postshiba-domain-candidates", orgId] });
}

// ============================================================================
// Queries
// ============================================================================

/** The org's PostShiba sending domains, newest first. */
export function usePostShibaDomains() {
  const { currentOrganization } = useAuth();

  return useQuery<PostShibaDomain[]>({
    queryKey: ["postshiba-domains", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("email_sending_domains")
        .select(DOMAIN_COLUMNS)
        .eq("organization_id", currentOrganization.id)
        .eq("infra_type", "postshiba")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as PostShibaDomainRow[]).map(toPostShibaDomain);
    },
    enabled: !!currentOrganization,
  });
}

/** The org's PostShiba senders, oldest first (the order they were added). */
export function usePostShibaSenders() {
  const { currentOrganization } = useAuth();

  return useQuery<PostShibaSender[]>({
    queryKey: ["postshiba-senders", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("email_mailboxes")
        .select(SENDER_COLUMNS)
        .eq("organization_id", currentOrganization.id)
        .eq("connection_type", "postshiba")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PostShibaSender[];
    },
    enabled: !!currentOrganization,
  });
}

export type PostShibaCandidateExclusion = "zone_not_active" | "in_aca" | "has_mailboxes" | "receives_mail";

export interface PostShibaDomainCandidates {
  cloudflare_connected: boolean;
  /** Cloudflare zones add_domain would accept. */
  candidates: string[];
  excluded: Array<{ domain: string; reason: PostShibaCandidateExclusion }>;
}

/**
 * The org's Cloudflare domains that can become PostShiba sending domains (no
 * mailboxes, no MX elsewhere, not already in ACA). Takes a few seconds, since
 * it looks up each domain's MX, so it only runs while the add dialog is open.
 */
export function usePostShibaDomainCandidates(enabled: boolean) {
  const { currentOrganization } = useAuth();

  return useQuery<PostShibaDomainCandidates>({
    queryKey: ["postshiba-domain-candidates", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return { cloudflare_connected: false, candidates: [], excluded: [] };
      const data = await invokeEdgeFunction<PostShibaDomainCandidates>(FUNCTION_NAME, {
        action: "domain_candidates",
        organization_id: currentOrganization.id,
      });
      return {
        cloudflare_connected: !!data?.cloudflare_connected,
        candidates: data?.candidates ?? [],
        excluded: data?.excluded ?? [],
      };
    },
    enabled: enabled && !!currentOrganization,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// Mutations (postshiba-provision)
// ============================================================================

/**
 * Create a sending domain under the org's PostShiba tenant. Errors are thrown
 * so the dialog can render them inline.
 */
export function useAddPostShibaDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domain: string): Promise<PostShibaDomain> => {
      if (!currentOrganization) throw new Error("No organization selected.");
      const data = await invokeEdgeFunction<{ ok: true; domain: PostShibaDomain }>(FUNCTION_NAME, {
        action: "add_domain",
        organization_id: currentOrganization.id,
        domain,
      });
      if (!data?.domain) throw new Error("PostShiba did not return the domain. Try again.");
      return data.domain;
    },
    onSuccess: () => invalidatePostShibaProvisioning(queryClient, currentOrganization?.id),
  });
}

/**
 * Re-check a domain with PostShiba. Once PostShiba has verified it this also
 * creates the catch-all reply inbox (dns_changed = true: its MX record was just
 * added to dns_records). `force: false` only reads PostShiba's latest result
 * instead of forcing a new check (each forced check is one of its 60 setup
 * calls an hour). Errors are thrown; the caller decides whether to toast.
 */
export function useVerifyPostShibaDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, force = true }: { id: string; force?: boolean }): Promise<VerifyPostShibaDomainResult> => {
      if (!currentOrganization) throw new Error("No organization selected.");
      const data = await invokeEdgeFunction<VerifyPostShibaDomainResult>(FUNCTION_NAME, {
        action: "verify",
        organization_id: currentOrganization.id,
        domain_id: id,
        force,
      });
      if (!data?.domain) throw new Error("PostShiba did not return the domain. Try again.");
      return data;
    },
    onSuccess: () => invalidatePostShibaProvisioning(queryClient, currentOrganization?.id),
  });
}

/**
 * Disable the reply inbox, delete the domain in PostShiba and park its senders.
 */
export function useRemovePostShibaDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domain: Pick<PostShibaDomain, "id" | "domain">) => {
      if (!currentOrganization) throw new Error("No organization selected.");
      return await invokeEdgeFunction<{ ok: true }>(FUNCTION_NAME, {
        action: "remove_domain",
        organization_id: currentOrganization.id,
        domain_id: domain.id,
      });
    },
    onSuccess: (_data, domain) => {
      invalidatePostShibaProvisioning(queryClient, currentOrganization?.id);
      toast.success(`${domain.domain} removed`);
    },
    onError: (error: unknown) => {
      toast.error(`Remove failed: ${getPostShibaError(error).message}`);
    },
  });
}

/**
 * Add 1 to 100 senders on a domain. Errors are thrown so the dialog can render
 * them inline (senders_in_use carries the addresses in `skipped`).
 */
export function useAddPostShibaSenders() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: AddPostShibaSendersInput): Promise<AddPostShibaSendersResult> => {
      if (!currentOrganization) throw new Error("No organization selected.");
      const data = await invokeEdgeFunction<AddPostShibaSendersResult>(FUNCTION_NAME, {
        action: "add_senders",
        organization_id: currentOrganization.id,
        domain_id: input.domain_id,
        daily_volume: input.daily_volume,
        senders: input.senders,
      });
      return {
        ok: true,
        senders: data?.senders ?? [],
        skipped: data?.skipped ?? [],
        capped: !!data?.capped,
      };
    },
    onSuccess: () => invalidatePostShibaProvisioning(queryClient, currentOrganization?.id),
  });
}

export type SetPostShibaDailyVolumeInput =
  | { domainId: string; mode: "auto"; senderCap?: number }
  | { domainId: string; mode: "manual"; dailyVolume: number };

/**
 * Set how a domain's emails a day are decided: auto (a share of the cluster's
 * daily limit, at most senderCap a sender) or a manual number. The database
 * splits the result evenly across the domain's senders, so their shares update too.
 */
export function useSetPostShibaDailyVolume() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: SetPostShibaDailyVolumeInput) => {
      if (!currentOrganization) throw new Error("No organization selected.");
      const data = await invokeEdgeFunction<{ ok: true; domain: PostShibaDomain }>(FUNCTION_NAME, {
        action: "set_daily_volume",
        organization_id: currentOrganization.id,
        domain_id: input.domainId,
        mode: input.mode,
        ...(input.mode === "auto" ? { sender_cap: input.senderCap } : { daily_volume: input.dailyVolume }),
      });
      if (!data?.domain) throw new Error("PostShiba did not return the domain. Try again.");
      return data.domain;
    },
    onSuccess: () => invalidatePostShibaProvisioning(queryClient, currentOrganization?.id),
  });
}
