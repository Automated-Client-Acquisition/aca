/**
 * Phase 8.2.1 — Cron-triggered Postmaster Tools data poll.
 *
 * For every org with `postmaster_oauth_tokens.status = 'connected'`, fetches
 * the latest traffic stats for each registered BYO sending domain and
 * appends to email_domain_reputation_log.
 *
 * Gmail Postmaster covers eligible Gmail recipient traffic only. Reputation
 * and spam observations never change mailbox status, limits or domain sending
 * controls; operators decide whether to pause a domain.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getValidAccessToken,
  getLatestTrafficStats,
  type PostmasterTrafficStats,
} from '../_shared/postmaster-oauth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SPAM_RATE_CRITICAL_THRESHOLD = 0.003;       // Gmail flags > 0.3% as problematic
const BAD_REPUTATIONS = new Set(['BAD']);
const WARN_REPUTATIONS = new Set(['LOW']);

interface ConnectedOrg {
  organization_id: string;
}

function parseRecordedDate(name?: string): string {
  // trafficStats name format: "domains/<domain>/trafficStats/YYYYMMDD"
  const match = (name ?? '').match(/trafficStats\/(\d{8})$/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const yyyymmdd = match[1];
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: orgs, error: orgErr } = await supabase
    .from('postmaster_oauth_tokens')
    .select('organization_id')
    .eq('status', 'connected');
  if (orgErr) return jsonResponse({ success: false, error: orgErr.message }, 500);

  const totals = { domainsChecked: 0, snapshotsWritten: 0, criticalObservations: 0, errors: 0 };

  for (const o of (orgs ?? []) as ConnectedOrg[]) {
    const accessToken = await getValidAccessToken(supabase, o.organization_id);
    if (!accessToken) {
      totals.errors++;
      continue;
    }

    const { data: domains } = await supabase
      .from('email_sending_domains')
      .select('id, domain, domain_health, replaced_by_id')
      .eq('organization_id', o.organization_id)
      .eq('infra_type', 'byo');

    for (const d of (domains ?? []) as Array<{ id: string; domain: string; domain_health: string | null; replaced_by_id: string | null }>) {
      // Skip domains already replaced by another sending domain.
      if (d.replaced_by_id) continue;

      let stats: PostmasterTrafficStats | null = null;
      try {
        stats = await getLatestTrafficStats(accessToken, d.domain);
      } catch (e) {
        totals.errors++;
        console.warn(`[postmaster-poll] ${d.domain}: ${e instanceof Error ? e.message : 'fetch failed'}`);
        continue;
      }
      totals.domainsChecked++;
      if (!stats) continue;

      const recordedFor = parseRecordedDate(stats.name);

      // Compute the highest-cardinality IP reputation (BAD wins, then LOW, etc.)
      let topIpReputation: string | undefined;
      const repPriority = ['BAD', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'];
      for (const rep of repPriority) {
        if (stats.ipReputations?.some((r) => r.reputation === rep)) {
          topIpReputation = rep;
          break;
        }
      }

      const { error: insertErr } = await supabase
        .from('email_domain_reputation_log')
        .upsert({
          domain_id: d.id,
          organization_id: o.organization_id,
          recorded_for: recordedFor,
          recorded_at: new Date().toISOString(),
          ip_reputation: topIpReputation ?? null,
          domain_reputation: stats.domainReputation ?? null,
          spam_rate: stats.userReportedSpamRatio ?? null,
          dkim_success_ratio: stats.dkimSuccessRatio ?? null,
          spf_success_ratio: stats.spfSuccessRatio ?? null,
          dmarc_success_ratio: stats.dmarcSuccessRatio ?? null,
          delivery_errors: stats.deliveryErrors ?? [],
          raw_payload: stats,
        }, { onConflict: 'domain_id,recorded_for' });
      if (insertErr) {
        totals.errors++;
        console.warn(`[postmaster-poll] insert failed for ${d.domain}: ${insertErr.message}`);
        continue;
      }
      totals.snapshotsWritten++;

      // Diagnostic Gmail scope only; it does not represent every mailbox or
      // recipient provider and must never stop or throttle outbound sending.
      const critical =
        BAD_REPUTATIONS.has(stats.domainReputation ?? '') ||
        (typeof stats.userReportedSpamRatio === 'number' && stats.userReportedSpamRatio > SPAM_RATE_CRITICAL_THRESHOLD);
      const warning =
        WARN_REPUTATIONS.has(stats.domainReputation ?? '') ||
        (typeof stats.userReportedSpamRatio === 'number' && stats.userReportedSpamRatio > SPAM_RATE_CRITICAL_THRESHOLD / 3);

      if (critical || warning) {
        const notes = `POSTMASTER MONITOR [google]: Gmail recipient traffic only (${recordedFor}); domain reputation ${stats.domainReputation ?? 'unknown'}, spam ratio ${stats.userReportedSpamRatio ?? 'unknown'}. Does not represent all recipients/mailboxes. Monitoring continues; sending unchanged. Operator may pause/resume the domain.`;
        const { count, error: dedupeError } = await supabase
          .from('email_domain_health_log')
          .select('id', { count: 'exact', head: true })
          .eq('domain_id', d.id)
          .like('notes', `POSTMASTER MONITOR [google]: Gmail recipient traffic only (${recordedFor})%`);
        if (dedupeError) {
          totals.errors++;
          console.warn(`[postmaster-poll] warning lookup failed for ${d.domain}: ${dedupeError.message}`);
        } else if (!count) {
          const { error: logError } = await supabase.from('email_domain_health_log').insert({
            domain_id: d.id,
            domain_health: d.domain_health,
            notes,
          });
          if (logError) totals.errors++;
        }
        if (critical) totals.criticalObservations++;
        console.warn(`[postmaster-poll] ${d.domain}: Gmail ${critical ? 'critical' : 'warning'} observation; sending unchanged`);
      }

    }

    await supabase
      .from('postmaster_oauth_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('organization_id', o.organization_id);
  }

  return jsonResponse({ success: true, ...totals });
});
