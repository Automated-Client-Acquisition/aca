/**
 * BYO Domain Provision — creates an email_sending_domains row with infra_type='byo'
 * pointing at a deployed BYO server, then enqueues provision_domain.
 *
 * After the deployer runs, the row will have dns_records populated and
 * dns_status='records_generated'. The user adds the records to their registrar,
 * then calls infra-byo-domain-verify to flip dns_status to 'verified'.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { enqueueByoJob, pingByoDeployer } from '../_shared/byo/job-enqueue.ts';

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

interface ProvisionBody {
  organization_id: string;
  server_id: string;
  domain: string;
  dkim_selector?: string;
  dmarc_email?: string;
  /**
   * If true, skip the apex-domain guardrail. Use when the domain is
   * dedicated to cold outreach (no transactional/marketing mail to protect).
   */
  allow_apex?: boolean;
  /**
   * If true, skip the <30-day domain-age guardrail. Use only if you
   * understand that fresh domains are heavily penalized by Gmail/Outlook.
   */
  allow_young?: boolean;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SELECTOR_RE = /^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: ProvisionBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, server_id, domain, dkim_selector = 'aca1', dmarc_email, allow_apex, allow_young } = body;

  if (!organization_id || !server_id || !domain) {
    return jsonResponse({ success: false, error: 'organization_id, server_id, and domain are required' }, 400);
  }
  const normalizedDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!DOMAIN_RE.test(normalizedDomain)) {
    return jsonResponse({ success: false, error: 'Invalid domain format. Use a bare FQDN like sales.example.com' }, 400);
  }
  if (!SELECTOR_RE.test(dkim_selector)) {
    return jsonResponse({ success: false, error: 'Invalid DKIM selector. Use lowercase alphanumeric with . _ -' }, 400);
  }

  // Phase 8.1.5: Apex-domain protection. Refuse to use a bare apex (yourapp.com)
  // for cold-email sending — it would bleed reputation onto the user's
  // transactional + marketing email. Insist on a subdomain (outreach.yourapp.com).
  // Heuristic: a "subdomain" has at least 3 labels (foo.bar.tld) — except for
  // ccTLDs like co.uk where 4 labels would be needed. We require >=3 labels
  // and surface a precise error message so the user understands the why.
  const dotCount = normalizedDomain.split('.').length - 1;
  if (dotCount < 2 && !allow_apex) {
    return jsonResponse({
      success: false,
      error:
        `Refusing to provision "${normalizedDomain}" as a sending domain — looks like an apex domain. ` +
        `Cold-email sending will bleed reputation onto your transactional/marketing mail. ` +
        `Use a dedicated subdomain (e.g. "outreach.${normalizedDomain}"), or pass allow_apex=true if this domain is dedicated to cold outreach.`,
    }, 400);
  }

  // Phase 8.1.5: Domain-age check. Gmail explicitly trusts domains >90 days
  // older significantly more than fresh registrations. Reject domains
  // <30 days old; warn (but allow) for 30-90 days; allow without warning >90 days.
  // We use RDAP (the modern WHOIS replacement) with HTTPS and JSON.
  // Fallback: if RDAP returns 404 or times out, allow with warning.
  let domainAgeDays: number | null = null;
  let domainAgeWarning: string | null = null;
  try {
    const rdapRes = await fetch(`https://rdap.org/domain/${encodeURIComponent(normalizedDomain)}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(4000),
    });
    if (rdapRes.ok) {
      const rdap = await rdapRes.json() as { events?: Array<{ eventAction?: string; eventDate?: string }> };
      const reg = rdap.events?.find((e) => e.eventAction === 'registration');
      if (reg?.eventDate) {
        const ageMs = Date.now() - Date.parse(reg.eventDate);
        domainAgeDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        if (domainAgeDays < 30 && !allow_young) {
          return jsonResponse({
            success: false,
            error:
              `"${normalizedDomain}" is ${domainAgeDays} days old. Gmail and Outlook treat domains <30 days old as suspicious. ` +
              `Wait until 30+ days old, or pass allow_young=true to override.`,
          }, 400);
        }
        if (domainAgeDays < 90) {
          domainAgeWarning = `Domain is ${domainAgeDays} days old (under 90). Reputation will warm up slowly — ramp send volume cautiously.`;
        }
      }
    }
  } catch {
    // RDAP failed (timeout, DNS, etc.) — allow but note in metadata for the UI.
    domainAgeWarning = 'Could not verify domain age via RDAP — proceed with extra caution if domain is fresh.';
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

  // The server must have made it through deploy_base.
  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, status, hostname')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (serverErr) return jsonResponse({ success: false, error: serverErr.message }, 500);
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);
  if (server.status !== 'ready') {
    return jsonResponse({ success: false, error: `Server status is "${server.status}". Deploy the mail stack first.` }, 400);
  }

  // Insert (or reuse) the email_sending_domains row.
  // subscription_id is required by the existing schema (FK to azure_subscriptions),
  // but for BYO we don't have one. We use a sentinel UUID that points at no row;
  // existing M365 path also reuses this column even when no Azure subscription
  // exists. If the FK is strict, the migration above made byo_server_id the
  // primary linkage and subscription_id is left null-able by historical
  // additive ALTERs — fall back to an existing dummy row if needed.
  let domainRow: { id: string } | null = null;
  const { data: existing } = await supabase
    .from('email_sending_domains')
    .select('id, infra_type, byo_server_id')
    .eq('organization_id', organization_id)
    .eq('domain', normalizedDomain)
    .maybeSingle();

  if (existing) {
    if (existing.infra_type !== 'byo') {
      return jsonResponse({ success: false, error: `Domain already exists with infra_type "${existing.infra_type}"` }, 409);
    }
    if (existing.byo_server_id && existing.byo_server_id !== server_id) {
      return jsonResponse({ success: false, error: 'Domain is already attached to a different BYO server' }, 409);
    }
    domainRow = { id: existing.id as string };
    await supabase
      .from('email_sending_domains')
      .update({ byo_server_id: server_id, dkim_selector, dmarc_email: dmarc_email ?? null, dns_status: 'pending' })
      .eq('id', existing.id);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('email_sending_domains')
      .insert({
        organization_id,
        domain: normalizedDomain,
        infra_type: 'byo',
        byo_server_id: server_id,
        byo_helo_hostname: server.hostname,
        dkim_selector,
        dmarc_email: dmarc_email ?? null,
        dns_status: 'pending',
        vm_status: 'running',
        sender_addresses: [],
        max_mailboxes: 150,
        metadata: {
          ...(domainAgeDays !== null ? { domain_age_days: domainAgeDays } : {}),
          ...(domainAgeWarning ? { domain_age_warning: domainAgeWarning } : {}),
        },
      })
      .select('id')
      .single();
    if (insertErr) {
      return jsonResponse({ success: false, error: `Failed to create domain row: ${insertErr.message}` }, 500);
    }
    domainRow = { id: inserted.id as string };
  }

  // Idempotency on the job side too.
  const { data: existingJob } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'provision_domain')
    .eq('target_kind', 'domain')
    .eq('target_id', domainRow.id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingJob) {
    return jsonResponse({ success: true, domain_id: domainRow.id, job_id: existingJob.id, status: existingJob.status, reused: true });
  }

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'provision_domain',
      target_kind: 'domain',
      target_id: domainRow.id,
      input: { server_id, domain: normalizedDomain, dkim_selector },
      created_by: userRes.user.id,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
  }

  pingByoDeployer(job_id).catch(() => {});
  return jsonResponse({
    success: true,
    domain_id: domainRow.id,
    job_id,
    status: 'pending',
    reused: false,
    domain_age_days: domainAgeDays,
    warning: domainAgeWarning,
  });
});
