/**
 * ESP-specific rate limiter (Phase 8.1.2).
 *
 * Cold-email best practice: each receiving ESP has its own throughput
 * tolerance. Sending the same total volume but bursting Gmail at 100/min from
 * one IP gets you tarpitted; spreading the same volume at 30/min lands inbox.
 *
 * Two limits per ESP:
 *   - Per-IP per-minute: protects sender reputation by IP
 *   - Per-recipient-domain per-hour: protects against being seen as a spammer
 *     hammering one company (Gmail's "unusual traffic" detector)
 *
 * Limits are conservative defaults; production tuning happens via the
 * org_settings.esp_overrides JSONB later if needed.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export type SupabaseServiceClient = SupabaseClient<any>;

export type EspBucket = 'gmail' | 'outlook' | 'yahoo' | 'apple' | 'aol' | 'proton' | 'other';

interface EspLimits {
  per_ip_per_minute: number;
  per_recipient_domain_per_hour: number;
}

const ESP_LIMITS: Record<EspBucket, EspLimits> = {
  // Gmail tolerates the most, but punishes bursts hardest. 30/min ≈ 1800/hr per IP.
  gmail:   { per_ip_per_minute: 30, per_recipient_domain_per_hour: 200 },
  // Outlook/Hotmail/Live: stricter on fresh IPs, esp during the first 14 warmup days.
  outlook: { per_ip_per_minute: 10, per_recipient_domain_per_hour: 100 },
  // Yahoo: very strict on new sender domains, less so on volume.
  yahoo:   { per_ip_per_minute: 15, per_recipient_domain_per_hour: 80 },
  // Apple/iCloud: no public guidance; conservative defaults.
  apple:   { per_ip_per_minute: 12, per_recipient_domain_per_hour: 60 },
  // AOL (Verizon): treated similarly to Yahoo since they merged.
  aol:     { per_ip_per_minute: 15, per_recipient_domain_per_hour: 80 },
  // Proton: small but strict; treated like Apple.
  proton:  { per_ip_per_minute: 10, per_recipient_domain_per_hour: 50 },
  // Other (custom corporate domains): assume capable, but cap company-domain.
  other:   { per_ip_per_minute: 20, per_recipient_domain_per_hour: 50 },
};

const ESP_DOMAIN_PATTERNS: Array<{ bucket: EspBucket; suffixes: string[] }> = [
  { bucket: 'gmail',   suffixes: ['gmail.com', 'googlemail.com'] },
  { bucket: 'outlook', suffixes: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.', 'hotmail.'] },
  { bucket: 'yahoo',   suffixes: ['yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.'] },
  { bucket: 'apple',   suffixes: ['icloud.com', 'me.com', 'mac.com'] },
  { bucket: 'aol',     suffixes: ['aol.com', 'aim.com', 'verizon.net'] },
  { bucket: 'proton',  suffixes: ['proton.me', 'protonmail.com', 'pm.me'] },
];

/**
 * Classify a recipient email by its receiving ESP based on the domain suffix.
 * Phase 8.4 will refine this with MX-based detection (e.g. corporate Gmail
 * Workspace domains routing to mx.google.com), but suffix-matching is fast and
 * catches >95% of consumer mail.
 */
export function classifyEsp(recipientEmail: string): { bucket: EspBucket; recipient_domain: string } {
  const domain = recipientEmail.toLowerCase().split('@')[1] ?? '';
  if (!domain) return { bucket: 'other', recipient_domain: '' };

  for (const entry of ESP_DOMAIN_PATTERNS) {
    for (const suffix of entry.suffixes) {
      if (suffix.endsWith('.')) {
        // International TLD pattern, e.g. "outlook." matches "outlook.fr".
        if (domain.startsWith(suffix)) return { bucket: entry.bucket, recipient_domain: domain };
      } else if (domain === suffix) {
        return { bucket: entry.bucket, recipient_domain: domain };
      }
    }
  }
  return { bucket: 'other', recipient_domain: domain };
}

export interface ThrottleDecision {
  allowed: boolean;
  /** When allowed=false, retry not before this many seconds. */
  retry_after_seconds?: number;
  /** Human-readable reason for the throttle, useful for the run log. */
  reason?: string;
  /** ESP bucket the recipient was classified into. */
  bucket: EspBucket;
}

export interface ShouldThrottleParams {
  organization_id: string;
  mailbox_id: string;
  recipient_email: string;
  /** byo_server_ips.id when the mailbox is sticky-pinned. Used for per-IP counters. */
  sticky_ip_id?: string | null;
  /** Override defaults (e.g. allow higher Gmail rate for warmed mailboxes). */
  overrides?: Partial<Record<EspBucket, Partial<EspLimits>>>;
}

/**
 * Should we send this email right now, or defer it?
 *
 * Rolling counts come from email_send_log filtered by recipient_email LIKE
 * '%@<domain>' for the per-recipient-domain check, and by mailbox metadata
 * sticky_ip_id for the per-IP check. We DON'T tag every send with an ESP
 * column to avoid a migration; the LIKE query is fast enough at expected
 * volume because email_send_log is indexed on (organization_id, created_at).
 */
export async function shouldThrottleSend(
  supabase: SupabaseServiceClient,
  params: ShouldThrottleParams,
): Promise<ThrottleDecision> {
  const { bucket, recipient_domain } = classifyEsp(params.recipient_email);
  const baseLimits = ESP_LIMITS[bucket];
  const limits: EspLimits = {
    per_ip_per_minute: params.overrides?.[bucket]?.per_ip_per_minute ?? baseLimits.per_ip_per_minute,
    per_recipient_domain_per_hour: params.overrides?.[bucket]?.per_recipient_domain_per_hour ?? baseLimits.per_recipient_domain_per_hour,
  };

  const now = Date.now();
  const oneMinuteAgo = new Date(now - 60_000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60_000).toISOString();

  // 1) Per-IP per-minute. Group by sticky IP if pinned; otherwise per-mailbox.
  // Use HEAD count so Postgres returns the count without fetching rows.
  let perIpQuery = supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', params.organization_id)
    .gte('created_at', oneMinuteAgo)
    .in('status', ['queued', 'sending', 'sent', 'delivered']);

  if (params.sticky_ip_id) {
    // Sticky IP: count sends from any mailbox pinned to this IP.
    // We can't filter on metadata directly via REST; fall back to mailbox_id
    // for the "this minute" window. The per-IP semantic is approximate but
    // matches the practical concern (one IP firing too fast).
    perIpQuery = perIpQuery.eq('mailbox_id', params.mailbox_id);
  } else {
    perIpQuery = perIpQuery.eq('mailbox_id', params.mailbox_id);
  }
  const { count: perIpCount = 0 } = await perIpQuery;

  if ((perIpCount ?? 0) >= limits.per_ip_per_minute) {
    return {
      allowed: false,
      retry_after_seconds: 60,
      reason: `${bucket} per-IP/minute cap (${limits.per_ip_per_minute}) reached`,
      bucket,
    };
  }

  // 2) Per-recipient-domain per-hour across the entire org.
  if (recipient_domain) {
    const { count: perDomainCount = 0 } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', params.organization_id)
      .gte('created_at', oneHourAgo)
      .ilike('recipient_email', `%@${recipient_domain}`)
      .in('status', ['queued', 'sending', 'sent', 'delivered']);

    if ((perDomainCount ?? 0) >= limits.per_recipient_domain_per_hour) {
      return {
        allowed: false,
        // Spread the next attempt across the next hour so we don't all retry at once.
        retry_after_seconds: 1800 + Math.floor(Math.random() * 1800),
        reason: `${bucket} per-recipient-domain/hour cap (${limits.per_recipient_domain_per_hour}) reached for ${recipient_domain}`,
        bucket,
      };
    }
  }

  return { allowed: true, bucket };
}

/**
 * Compute a randomised send delay (in seconds) within the configured min/max.
 * Used by the sequence processor to schedule the NEXT send so we don't burst
 * a queue all at once.
 */
export function computeSendJitter(
  minSeconds: number,
  maxSeconds: number,
): number {
  const min = Math.max(1, minSeconds);
  const max = Math.max(min, maxSeconds);
  return Math.floor(min + Math.random() * (max - min));
}
