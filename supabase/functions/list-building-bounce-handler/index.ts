/**
 * ACA Discovery Layer — Bounce Handler (§9.10).
 *
 * Increments bounce counters on `domain_pattern_cache` and triggers
 * threshold-based pattern invalidation (5+ hard bounces in 30 days).
 *
 * Two invocation modes:
 *   1. **Webhook**: POST { organization_id, email, type: 'hard'|'soft' }
 *      Direct push from email-send infra (e.g. SES, Postmark callback).
 *   2. **Polling**: POST {} or GET — scans recent
 *      `email_send_logs.bounced_at IS NOT NULL` rows that have not yet been
 *      reflected in `domain_pattern_cache.bounce_count` and increments them.
 *
 * Calls the SQL helper `dpc_record_hard_bounce(org_id, domain)` which both
 * bumps counters and atomically invalidates the pattern when the 30-day
 * threshold is crossed.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

interface WebhookBody {
  organization_id?: string;
  email?: string;
  type?: 'hard' | 'soft';
}

const POLL_BATCH = 500;
const POLL_LOOKBACK_HOURS = 24;

async function recordBounce(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
): Promise<void> {
  const at = email.indexOf('@');
  if (at <= 0) return;
  const domain = email.slice(at + 1).toLowerCase();
  await supabase.rpc('dpc_record_hard_bounce', {
    p_org_id: orgId,
    p_domain: domain,
  });
}

async function processWebhook(supabase: SupabaseClient, body: WebhookBody): Promise<{ ok: boolean; reason?: string }> {
  if (!body.organization_id || !body.email) {
    return { ok: false, reason: 'organization_id and email required' };
  }
  if (body.type && body.type !== 'hard') {
    return { ok: true, reason: 'soft bounce ignored' };
  }
  await recordBounce(supabase, body.organization_id, body.email);
  return { ok: true };
}

async function processPoll(supabase: SupabaseClient): Promise<{ processed: number; domainsInvalidated: number }> {
  const since = new Date(Date.now() - POLL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('email_send_log')
    .select('organization_id, recipient_email, bounced_at, bounce_handled_at')
    .gte('bounced_at', since)
    .is('bounce_handled_at', null)
    .limit(POLL_BATCH);

  if (error) {
    console.error('[bounce-handler] poll fetch failed', error);
    return { processed: 0, domainsInvalidated: 0 };
  }

  const rows = (data as Array<{ organization_id: string; recipient_email: string }>) ?? [];
  let processed = 0;
  for (const row of rows) {
    if (!row.organization_id || !row.recipient_email) continue;
    await recordBounce(supabase, row.organization_id, row.recipient_email);
    processed += 1;
  }

  // Mark logs as handled
  if (rows.length > 0) {
    await supabase
      .from('email_send_log')
      .update({ bounce_handled_at: new Date().toISOString() })
      .in(
        'recipient_email',
        rows.map((r) => r.recipient_email),
      )
      .gte('bounced_at', since)
      .is('bounce_handled_at', null);
  }

  // Count domains whose pattern was just invalidated (confidence dropped to 0)
  const { count } = await supabase
    .from('domain_pattern_cache')
    .select('domain', { count: 'exact', head: true })
    .eq('confidence', 0)
    .eq('negative_result', true)
    .gte('updated_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

  return { processed, domainsInvalidated: count ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: WebhookBody = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    if (body.email && body.organization_id) {
      // The service-role client acts on whatever org the body names, so the caller
      // must be able to access it (a valid anon-key JWT alone is not enough).
      try {
        await assertOrgAccess(req, supabase, body.organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
      const result = await processWebhook(supabase, body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Poll mode scans every org, so it is internal (cron / service key) only.
    if (!isServiceRoleRequest(req)) {
      return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
    }
    const summary = await processPoll(supabase);
    return new Response(JSON.stringify({ ok: true, mode: 'poll', ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[bounce-handler] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
