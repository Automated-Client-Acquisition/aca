/**
 * ACA Discovery Layer — Engagement Revalidator (§9.8).
 *
 * Catch-all domains accept every RCPT regardless of whether the mailbox
 * exists, so the SMTP signal alone cannot tell a real address from a phantom.
 * Strategy: send the candidate as a low-volume first email and watch a 7-day
 * window for opens, replies, or hard bounces:
 *   - opened/replied → flip status to `verified` (retroactively)
 *   - hard bounce  → flip to `not_found` + invalidate the domain pattern
 *   - silent       → leave at `catch_all`
 *
 * Invoked by pg_cron daily at 03:17 UTC. Scans `lb_email_verifications` rows
 * whose `engagement_window_ends_at <= now()` and `engagement_status='pending'`.
 *
 * Phase 1 reads engagement signals from `email_send_logs` (opens/replies) and
 * `crm_contacts.status='bounced'`. Bounce detection that updates that field
 * lives in list-building-bounce-handler.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { PatternCache } from '../_shared/list-building/pattern-cache.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

interface VerificationRow {
  id: string;
  organization_id: string;
  email: string;
  pattern: string | null;
  status: string;
  catch_all: boolean;
}

const BATCH_SIZE = 200;

async function fetchDueRows(supabase: SupabaseClient): Promise<VerificationRow[]> {
  const { data, error } = await supabase
    .from('lb_email_verifications')
    .select('id, organization_id, email, pattern, status, catch_all')
    .eq('engagement_status', 'pending')
    .lte('engagement_window_ends_at', new Date().toISOString())
    .limit(BATCH_SIZE);
  if (error) {
    console.error('[engagement-revalidate] fetch failed', error);
    return [];
  }
  return (data as VerificationRow[]) ?? [];
}

async function classifyEngagement(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
): Promise<'opened' | 'replied' | 'bounced' | 'silent'> {
  // Check email_send_logs for any positive engagement on this address
  const { data: logs } = await supabase
    .from('email_send_log')
    .select('opened_at, replied_at, bounced_at')
    .eq('organization_id', orgId)
    .eq('recipient_email', email.toLowerCase())
    .order('sent_at', { ascending: false })
    .limit(20);

  if (logs && logs.length > 0) {
    if (logs.some((l) => l.replied_at)) return 'replied';
    if (logs.some((l) => l.bounced_at)) return 'bounced';
    if (logs.some((l) => l.opened_at)) return 'opened';
  }

  // Cross-check the contact-level bounced status
  const { data: contacts } = await supabase
    .from('crm_contacts')
    .select('status')
    .eq('organization_id', orgId)
    .eq('primary_email', email.toLowerCase())
    .limit(1);
  if (contacts && contacts[0]?.status === 'bounced') return 'bounced';

  return 'silent';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const rows = await fetchDueRows(supabase);
    let opened = 0;
    let replied = 0;
    let bounced = 0;
    let silent = 0;

    for (const row of rows) {
      const verdict = await classifyEngagement(supabase, row.organization_id, row.email);
      const updates: Record<string, unknown> = { engagement_status: verdict };

      if (verdict === 'opened' || verdict === 'replied') {
        updates.status = 'verified';
        if (verdict === 'replied') replied += 1;
        else opened += 1;
      } else if (verdict === 'bounced') {
        updates.status = 'not_found';
        bounced += 1;
        // Invalidate the domain pattern via the bounce helper
        const at = row.email.indexOf('@');
        if (at > 0) {
          const domain = row.email.slice(at + 1);
          const cache = new PatternCache(supabase, row.organization_id);
          await cache.recordHardBounce(domain);
        }
      } else {
        silent += 1;
      }

      await supabase.from('lb_email_verifications').update(updates).eq('id', row.id);
    }

    return new Response(
      JSON.stringify({ ok: true, processed: rows.length, opened, replied, bounced, silent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[engagement-revalidate] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
