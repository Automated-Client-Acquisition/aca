/**
 * Contact phone backfill: normalises an org's contact phones to E.164 into
 * crm_contact_phones (never writes crm_contacts, see migration 20261025160000).
 *
 * Actions:
 *  - { action: "start", organization_id, default_country? } → queue (or return) the org's job
 *  - { action: "status", organization_id }                   → latest job; restarts a stalled one
 *  - { action: "run", job_id }                                → service role only: process for
 *    ~50s, then re-invoke itself until the org's contacts are done
 *
 * Walks crm_contacts by (organization_id, id) (idx_crm_contacts_org_id), 1,000 at a time.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { normalizePhone, toCountryCode } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 1000;
const RUN_BUDGET_MS = 50_000;
// A running job whose heartbeat is older than this lost its self-invoke chain.
const STALL_MS = 3 * 60_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function kick(jobId: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/contact-phone-backfill`;
  const run = fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'run', job_id: jobId }),
  }).catch((err) => console.error(`[phone-backfill] re-invoke failed for ${jobId}:`, err));
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(run);
}

async function latestJob(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from('contact_phone_backfill_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function isStalled(job: { status: string; heartbeat_at: string | null; created_at: string }) {
  if (job.status !== 'running' && job.status !== 'queued') return false;
  const last = new Date(job.heartbeat_at ?? job.created_at).getTime();
  return Date.now() - last > STALL_MS;
}

async function processJob(supabase: SupabaseClient, jobId: string) {
  const started = Date.now();
  const { data: job } = await supabase.from('contact_phone_backfill_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return { done: true, job };

  await supabase
    .from('contact_phone_backfill_jobs')
    .update({ status: 'running', started_at: job.started_at ?? new Date().toISOString(), heartbeat_at: new Date().toISOString() })
    .eq('id', jobId);

  let cursor: string | null = job.cursor_contact_id;
  const totals = { processed: job.processed, valid: job.valid, invalid: job.invalid, no_country: job.no_country };
  const companyCountry = new Map<string, string | null>();

  while (Date.now() - started < RUN_BUDGET_MS) {
    let query = supabase
      .from('crm_contacts')
      .select('id, primary_phone, phone, country, company_id')
      .eq('organization_id', job.organization_id)
      .or('primary_phone.not.is.null,phone.not.is.null')
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor) query = query.gt('id', cursor);
    const { data: contacts, error } = await query;
    if (error) throw new Error(`contacts read failed: ${error.message}`);

    if (!contacts || contacts.length === 0) {
      await supabase
        .from('contact_phone_backfill_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), ...totals })
        .eq('id', jobId);
      return { done: true };
    }

    const missingCompanies = [
      ...new Set(contacts.map((c) => c.company_id).filter((id): id is string => !!id && !companyCountry.has(id))),
    ];
    if (missingCompanies.length > 0) {
      const { data: companies } = await supabase.from('crm_companies').select('id, country').in('id', missingCompanies);
      for (const id of missingCompanies) companyCountry.set(id, null);
      for (const c of companies ?? []) companyCountry.set(c.id, c.country);
    }

    const rows = [];
    for (const c of contacts) {
      const result = normalizePhone(c.primary_phone || c.phone, {
        contact: c.country,
        company: c.company_id ? companyCountry.get(c.company_id) : null,
        orgDefault: job.default_country,
      });
      if (!result) continue;
      totals[result.status === 'valid' ? 'valid' : result.status === 'invalid' ? 'invalid' : 'no_country']++;
      rows.push({
        contact_id: c.id,
        organization_id: job.organization_id,
        ...result,
        normalized_at: new Date().toISOString(),
      });
    }

    if (rows.length > 0) {
      const { error: upsertError } = await supabase.from('crm_contact_phones').upsert(rows, { onConflict: 'contact_id' });
      if (upsertError) throw new Error(`phones upsert failed: ${upsertError.message}`);
    }

    totals.processed += contacts.length;
    cursor = contacts[contacts.length - 1].id;
    await supabase
      .from('contact_phone_backfill_jobs')
      .update({ cursor_contact_id: cursor, heartbeat_at: new Date().toISOString(), ...totals })
      .eq('id', jobId);

    if (contacts.length < BATCH_SIZE) {
      await supabase
        .from('contact_phone_backfill_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString() })
        .eq('id', jobId);
      return { done: true };
    }
  }

  return { done: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'run') {
    if (!isServiceRoleRequest(req)) return json({ error: 'Forbidden' }, 403);
    const jobId = body.job_id;
    try {
      const result = await processJob(supabase, jobId);
      if (!result.done) kick(jobId);
      return json({ success: true, done: result.done });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[phone-backfill] job ${jobId} failed:`, message);
      await supabase
        .from('contact_phone_backfill_jobs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', jobId);
      return json({ error: message }, 500);
    }
  }

  const organizationId = body.organization_id || body.organizationId;
  try {
    await assertOrgAccess(req, supabase, organizationId);
  } catch (err) {
    return unauthorized(err, corsHeaders);
  }

  if (body.action === 'status') {
    const job = await latestJob(supabase, organizationId);
    if (job && isStalled(job)) kick(job.id);
    return json({ success: true, job });
  }

  if (body.action === 'start') {
    const existing = await latestJob(supabase, organizationId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      if (isStalled(existing)) kick(existing.id);
      return json({ success: true, job: existing });
    }

    const defaultCountry = toCountryCode(body.default_country) ?? null;
    const { data: job, error } = await supabase
      .from('contact_phone_backfill_jobs')
      .insert({ organization_id: organizationId, default_country: defaultCountry })
      .select('*')
      .single();
    if (error) {
      // Lost a race with another start: the unique active-job index fired.
      const current = await latestJob(supabase, organizationId);
      if (current) return json({ success: true, job: current });
      return json({ error: error.message }, 500);
    }
    kick(job.id);
    return json({ success: true, job });
  }

  return json({ error: `Unknown action: ${body.action}` }, 400);
});
