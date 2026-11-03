/**
 * IP rotation helpers — pick a sticky outbound IP for a new mailbox, and
 * compute the daily warmup ramp.
 *
 * Selection rules (in order):
 *   1. Only IPs in 'active' status (not cooling/blacklisted/disabled/pending)
 *   2. Prefer PTR-verified IPs (ptr_verified = true). When none are
 *      available we fall back to non-verified candidates with a warning
 *      logged so Phase 7.5 docs panel can prompt the user to set rDNS.
 *   3. Prefer IPs assigned to the mailbox's domain (domain_id match);
 *      fall back to unassigned IPs (domain_id IS NULL) if none match.
 *   4. Among those, pick the IP with the lowest current load
 *      (mailbox_count_for_ip / daily_send_limit) — keeps load balanced.
 *   5. Tiebreaker: lowest current daily_sent.
 *
 * Returns null if no eligible IP — the mailbox falls back to default routing
 * (server's primary IP). Phase 5 makes this acceptable; Phase 6 hardens it.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export type SupabaseServiceClient = SupabaseClient<any>;

export interface PickStickyIpInput {
  organization_id: string;
  server_id: string;
  domain_id: string;
}

export interface PickedStickyIp {
  ip_id: string;
  ip_address: string;
  ptr_verified: boolean;
}

interface ServerIpRow {
  id: string;
  ip_address: string;
  status: string;
  domain_id: string | null;
  daily_send_limit: number;
  daily_sent: number;
  health_score: number;
  ptr_verified: boolean;
}

interface MailboxRow { metadata: Record<string, unknown> | null }

/**
 * Pick the best outbound IP for a new mailbox. Returns null when no IP is
 * registered on the server yet — caller should fall back to the server's
 * primary IP via Postfix default routing.
 *
 * PTR gating: prefers ptr_verified=true candidates. If none are PTR-verified
 * we fall back to unverified candidates and log a warning so the operator
 * gets prompted to set rDNS.
 */
export async function pickStickyIp(
  supabase: SupabaseServiceClient,
  input: PickStickyIpInput,
): Promise<PickedStickyIp | null> {
  const { data: ips, error } = await supabase
    .from('byo_server_ips')
    .select('id, ip_address, status, domain_id, daily_send_limit, daily_sent, health_score, ptr_verified')
    .eq('organization_id', input.organization_id)
    .eq('server_id', input.server_id)
    .eq('status', 'active');
  if (error) throw new Error(`pickStickyIp: ${error.message}`);

  const all = (ips ?? []) as ServerIpRow[];
  if (all.length === 0) return null;

  // Prefer IPs pinned to this domain; fall back to unassigned IPs.
  const pinned = all.filter((ip) => ip.domain_id === input.domain_id);
  const unassigned = all.filter((ip) => ip.domain_id === null);
  const scopeCandidates = pinned.length > 0 ? pinned : unassigned;
  if (scopeCandidates.length === 0) return null;

  // PTR gate: prefer verified candidates. Fall through to unverified only when
  // every IP in scope is unverified — at that point we log a warning so the
  // operator notices.
  const ptrVerified = scopeCandidates.filter((ip) => ip.ptr_verified === true);
  let candidates = ptrVerified.length > 0 ? ptrVerified : scopeCandidates;
  if (ptrVerified.length === 0 && scopeCandidates.length > 0) {
    console.warn(`[pickStickyIp] No PTR-verified IPs for domain ${input.domain_id} on server ${input.server_id}; falling back to unverified IP. Set reverse DNS at the hosting provider to improve deliverability.`);
  }

  // Compute load per candidate from email_mailboxes that already pin to it.
  const candidateIds = candidates.map((c) => c.id);
  const { data: pinnedMailboxes } = await supabase
    .from('email_mailboxes')
    .select('metadata')
    .eq('organization_id', input.organization_id);

  const loadByIp = new Map<string, number>();
  for (const id of candidateIds) loadByIp.set(id, 0);
  for (const row of (pinnedMailboxes ?? []) as MailboxRow[]) {
    const stickyId = (row.metadata as Record<string, unknown> | null)?.sticky_ip_id as string | undefined;
    if (stickyId && loadByIp.has(stickyId)) {
      loadByIp.set(stickyId, (loadByIp.get(stickyId) ?? 0) + 1);
    }
  }

  // Score: load_ratio (mailboxes per send-limit-unit) ascending, then daily_sent ascending.
  candidates.sort((a, b) => {
    const ar = (loadByIp.get(a.id) ?? 0) / Math.max(a.daily_send_limit, 1);
    const br = (loadByIp.get(b.id) ?? 0) / Math.max(b.daily_send_limit, 1);
    if (ar !== br) return ar - br;
    if (a.daily_sent !== b.daily_sent) return a.daily_sent - b.daily_sent;
    return b.health_score - a.health_score;
  });

  const chosen = candidates[0];
  return { ip_id: chosen.id, ip_address: chosen.ip_address, ptr_verified: chosen.ptr_verified };
}

// ── Warmup curves ────────────────────────────────────────────────────────────
// Three strategies for IP warmup:
//   - aggressive: original 11-day ramp; useful for IPs already aged on similar traffic
//   - standard:   4-week ramp suitable for fresh leased IPs in a /29 or /28
//   - cautious:   8-week ramp; default for any operation targeting 10K+/day, or
//                 any IP coming from a netblock with previous abuse history
//
// Match these at most loosely — domain reputation is the real lever.
export type WarmupStrategy = 'aggressive' | 'standard' | 'cautious';

export const IP_WARMUP_CURVES: Record<WarmupStrategy, number[]> = {
  aggressive: [10, 15, 22, 30, 38, 46, 54, 62, 70, 76, 80],
  standard:   [5, 10, 18, 26, 34, 42, 50, 58, 65, 72, 78, 84, 90, 96, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230],
  cautious:   [5, 8, 12, 17, 22, 28, 34, 40, 48, 56, 64, 72, 80, 86, 92, 96, 100],
};

// Backwards-compat alias used by existing infra-byo-* edge functions written
// before warmup strategies were introduced. Defaults to the aggressive curve
// to preserve historical behaviour for any IPs already mid-warmup.
export const IP_WARMUP_CURVE: number[] = IP_WARMUP_CURVES.aggressive;

export const DEFAULT_WARMUP_STRATEGY: WarmupStrategy = 'cautious';

export function dailyLimitForWarmupDay(
  day: number,
  strategy: WarmupStrategy = DEFAULT_WARMUP_STRATEGY,
): number {
  const curve = IP_WARMUP_CURVES[strategy] ?? IP_WARMUP_CURVES[DEFAULT_WARMUP_STRATEGY];
  if (day < 0) return curve[0];
  if (day >= curve.length) return curve[curve.length - 1];
  return curve[day];
}

/**
 * Resolve the warmup strategy for an organization. Reads
 * `organizations.settings.warmup_strategy`; falls back to the cautious default.
 */
export async function resolveWarmupStrategy(
  supabase: SupabaseServiceClient,
  organizationId: string,
): Promise<WarmupStrategy> {
  try {
    const { data } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', organizationId)
      .maybeSingle();
    const raw = ((data?.settings as Record<string, unknown> | null | undefined)?.warmup_strategy ?? null) as string | null;
    if (raw === 'aggressive' || raw === 'standard' || raw === 'cautious') return raw;
    return DEFAULT_WARMUP_STRATEGY;
  } catch {
    return DEFAULT_WARMUP_STRATEGY;
  }
}
