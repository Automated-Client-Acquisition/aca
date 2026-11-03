// Morning email: Signals stories from the last 24h (pulse_stories),
// for orgs with Signals + digest enabled. Sent to the org's first user, same
// recipient rule as lifecycle-digest-tick. Service role only (pg_cron daily).
//
// Body: { dry_run?: boolean } logs instead of sending.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { APP_URL, fromAddress } from "../_shared/site-config.ts";

const FROM = Deno.env.get('ONBOARDING_DRIP_FROM') || fromAddress("cedric");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn('[pulse-digest] RESEND_API_KEY missing, skipping send to', to);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) console.error('[pulse-digest] resend failed', res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (!isServiceRoleRequest(req)) return json({ error: 'Forbidden' }, 403);
  let dryRun = false;
  try {
    dryRun = !!(await req.json())?.dry_run;
  } catch { /* cron sends {} */ }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: orgs } = await supabase
    .from('pulse_settings')
    .select('organization_id')
    .eq('enabled', true)
    .eq('digest_enabled', true);

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const results: Record<string, string> = {};

  for (const { organization_id: orgId } of orgs || []) {
    const { data: stories } = await supabase
      .from('pulse_stories')
      .select('headline, key_term, summary, angle, fit_score, accounts, official_accounts, first_post_at')
      .eq('organization_id', orgId)
      .eq('dismissed', false)
      .neq('actionable', false)
      .not('judged_at', 'is', null)
      .gte('detected_at', since)
      .limit(40);
    if (!stories?.length) {
      results[orgId] = 'nothing new';
      continue;
    }
    // launches and wide pickup first, nudged by fit
    const rank = (x: (typeof stories)[number]) =>
      ((x.accounts || []).length + ((x.official_accounts || []).length ? 5 : 0)) * (0.5 + Number(x.fit_score ?? 5) / 10);
    stories.sort((a, b) => rank(b) - rank(a));
    const top = stories.slice(0, 10);

    const { data: member } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!member?.email) {
      results[orgId] = 'no recipient';
      continue;
    }

    const rows = top
      .map((t) => {
        const who = (t.official_accounts || []).length
          ? `Posted by @${esc(t.official_accounts[0])}${(t.accounts || []).length > 1 ? ` · ${esc((t.accounts || []).length)} accounts talking` : ''}`
          : `${esc((t.accounts || []).length)} accounts you follow`;
        return `<tr><td style="padding:12px 0;border-bottom:1px solid #EEE;">
          <div style="font-size:16px;font-weight:600;color:#1A1814;">${esc(t.headline || t.key_term)}</div>
          <div style="font-size:12px;color:#8A8577;margin:4px 0;">${who}${t.fit_score !== null ? ` · Fit ${esc(t.fit_score)}/10` : ''}</div>
          ${t.summary ? `<div style="font-size:14px;color:#3F3B33;">${esc(t.summary)}</div>` : ''}
          ${t.angle ? `<div style="font-size:13px;color:#047857;margin-top:4px;">Post angle: ${esc(t.angle)}</div>` : ''}
        </td></tr>`;
      })
      .join('');

    const firstName = String(member.full_name || '').split(' ')[0];
    const lead = top[0].headline || top[0].key_term;
    const subject = top.length === 1 ? `Signals: ${lead}` : `Signals: ${lead}, and ${top.length - 1} more`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <p style="font-size:15px;color:#1A1814;">${firstName ? `Morning ${esc(firstName)},` : 'Morning,'}</p>
      <p style="font-size:15px;color:#3F3B33;">What launched or took off in the last 24 hours among the accounts Signals follows.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
      <p style="margin-top:20px;"><a href="${APP_URL}/research?tab=signals" style="background:#E8A33D;color:#1A1814;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;font-size:14px;">Open Signals</a></p>
      <p style="font-size:12px;color:#8A8577;margin-top:24px;">Turn this email off in Ideas, Signals, Settings.</p>
    </div>`;

    if (dryRun) {
      console.log(`[pulse-digest][dry] ${member.email}: ${subject}`);
      results[orgId] = `dry: ${top.length} stories → ${member.email}`;
      continue;
    }
    results[orgId] = (await sendEmail(member.email as string, subject, html)) ? `sent ${top.length}` : 'send failed';
  }

  return json({ results });
});
