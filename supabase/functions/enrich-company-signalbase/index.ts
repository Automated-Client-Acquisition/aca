/**
 * Enrich a single crm_companies row with SignalBase data — opt-in only.
 *
 * IMPORTANT: this function is ONLY called from a user-clicked button on the
 * company detail page. It is NEVER triggered by signal-export, the company
 * list, or any cron — that would 99,937× the Apify bill in this org alone.
 *
 * Flow:
 *   1. Look up the crm_companies row + its domain.
 *   2. Call signalbase/signalbase-api with signalType='companies' filtered
 *      by domain. Costs ~$0.005-0.05 per call (per the actor's pricing).
 *   3. Store the rich payload (funding history, headcount, key people,
 *      open positions, growth stats) into crm_companies.enrichment_data.
 *   4. Stamp enrichment_updated_at + enrichment_source='signalbase'.
 *
 * The actor returns multiple shapes depending on the company's data
 * availability — we store the raw payload as JSONB so the UI can adapt
 * without a migration when the actor evolves.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APIFY_ACTOR_ID = 'fzywn8Ow4rvDK6VPc'; // signalbase/signalbase-api
const APIFY_RUNS_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs`;
const APIFY_RUN_TIMEOUT_MS = 90_000;
const APIFY_POLL_INTERVAL_MS = 4_000;

async function callSignalBaseCompanies(
  apifyToken: string,
  domain: string,
  companyName: string,
): Promise<{ items: unknown[] | null; debug: string }> {
  // SignalBase's `companies` mode accepts company_name + search fields
  // (NOT `domain` — that field is only on funding/hiring/etc. signals).
  // We pass both: company_name for an exact-ish match, search as a wider
  // backup against name+industry+description.
  const input = {
    signalType: 'companies',
    company_name: companyName,
    search: companyName,
    limit: 5,
  };

  const debugLines: string[] = [`input=${JSON.stringify(input)}`];
  const startResp = await fetch(`${APIFY_RUNS_URL}?token=${apifyToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });
  if (!startResp.ok) {
    const txt = await startResp.text().catch(() => '');
    debugLines.push(`kickoff_status=${startResp.status}: ${txt.slice(0, 200)}`);
    console.error('signalbase kickoff failed', startResp.status, txt);
    return { items: null, debug: debugLines.join(' | ') };
  }
  const startJson = await startResp.json();
  const runId = startJson?.data?.id as string | undefined;
  const datasetId = startJson?.data?.defaultDatasetId as string | undefined;
  if (!runId || !datasetId) {
    debugLines.push(`kickoff_malformed`);
    return { items: null, debug: debugLines.join(' | ') };
  }
  debugLines.push(`run=${runId}`);

  const deadline = Date.now() + APIFY_RUN_TIMEOUT_MS;
  let finalStatus = 'RUNNING';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS));
    const sr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!sr.ok) continue;
    const sj = await sr.json();
    finalStatus = (sj?.data?.status as string) ?? 'UNKNOWN';
    if (['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(finalStatus)) break;
  }
  debugLines.push(`status=${finalStatus}`);
  if (finalStatus !== 'SUCCEEDED') {
    return { items: null, debug: debugLines.join(' | ') };
  }

  const dsResp = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json&clean=true&limit=5`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!dsResp.ok) {
    debugLines.push(`dataset_fetch_${dsResp.status}`);
    return { items: null, debug: debugLines.join(' | ') };
  }
  const items = await dsResp.json();
  const arr = Array.isArray(items) ? items : null;
  debugLines.push(`items=${arr?.length ?? 0}`);
  if (arr && arr.length > 0) {
    debugLines.push(`first_keys=${Object.keys(arr[0] ?? {}).slice(0, 10).join(',')}`);
  }
  return { items: arr, debug: debugLines.join(' | ') };
}

/**
 * Best-effort normalization of the actor's payload into the shape our
 * detail page expects (funding_history, key_people, open_positions, etc.).
 * If the actor returns different keys we still store the raw record so
 * the UI degrades gracefully.
 */
interface NormalizedEnrichment {
  raw: unknown;
  funding_history?: Array<Record<string, unknown>>;
  headcount_history?: Array<Record<string, unknown>>;
  key_people?: Array<Record<string, unknown>>;
  open_positions?: Array<Record<string, unknown>>;
  job_changes?: Array<Record<string, unknown>>;
  growth_stats?: Record<string, unknown>;
  description?: string;
  industry?: string;
  employee_count?: number;
}

function normalizeCompanyPayload(items: unknown[]): NormalizedEnrichment {
  const first = (items[0] ?? {}) as Record<string, unknown>;
  const out: NormalizedEnrichment = { raw: first };

  // Try common field names. SignalBase company endpoint returns nested
  // sections; we surface the most useful ones.
  if (Array.isArray(first.funding_history)) out.funding_history = first.funding_history as Array<Record<string, unknown>>;
  if (Array.isArray(first.fundingRounds)) out.funding_history = first.fundingRounds as Array<Record<string, unknown>>;
  if (Array.isArray(first.headcount_history)) out.headcount_history = first.headcount_history as Array<Record<string, unknown>>;
  if (Array.isArray(first.headcountHistory)) out.headcount_history = first.headcountHistory as Array<Record<string, unknown>>;
  if (Array.isArray(first.key_people)) out.key_people = first.key_people as Array<Record<string, unknown>>;
  if (Array.isArray(first.keyPeople)) out.key_people = first.keyPeople as Array<Record<string, unknown>>;
  if (Array.isArray(first.open_positions)) out.open_positions = first.open_positions as Array<Record<string, unknown>>;
  if (Array.isArray(first.openPositions)) out.open_positions = first.openPositions as Array<Record<string, unknown>>;
  if (Array.isArray(first.job_changes)) out.job_changes = first.job_changes as Array<Record<string, unknown>>;
  if (Array.isArray(first.jobChanges)) out.job_changes = first.jobChanges as Array<Record<string, unknown>>;
  if (typeof first.growth_stats === 'object') out.growth_stats = first.growth_stats as Record<string, unknown>;
  if (typeof first.description === 'string') out.description = first.description;
  if (typeof first.companyDescription === 'string') out.description = first.companyDescription;
  if (typeof first.industry === 'string') out.industry = first.industry;
  if (typeof first.companyIndustry === 'string') out.industry = first.companyIndustry;
  if (typeof first.employee_count === 'number') out.employee_count = first.employee_count;
  if (typeof first.companyEmployeeCount === 'number') out.employee_count = first.companyEmployeeCount;

  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { company_id } = await req.json();
    if (!company_id || typeof company_id !== 'string') {
      throw new Error('company_id is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error('Unauthorized');

    // Load the company row + verify the caller is in the same org. RLS would
    // do this on a regular query, but service-role bypasses RLS so we check
    // explicitly.
    const { data: companyRow } = await supabase
      .from('crm_companies')
      .select('id, organization_id, name, domain, normalized_domain')
      .eq('id', company_id)
      .maybeSingle();
    if (!companyRow) throw new Error('Company not found');
    const company = companyRow as {
      id: string;
      organization_id: string;
      name: string;
      domain: string | null;
      normalized_domain: string | null;
    };

    const { data: orgMember } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', company.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!orgMember) throw new Error('Not a member of this organization');

    if (!company.domain && !company.normalized_domain) {
      throw new Error('Company has no domain to enrich');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('Encryption key not configured');

    const { data: keyRow } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', company.organization_id)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .maybeSingle();
    if (!keyRow) throw new Error('No Apify API key on file for this org');
    const apifyToken = await decryptApiKey(
      (keyRow as { key_encrypted: string }).key_encrypted,
      encryptionKey,
    );

    const result = await callSignalBaseCompanies(
      apifyToken,
      (company.normalized_domain ?? company.domain)!,
      company.name,
    );
    console.log(`[enrich-company] ${company.name}: ${result.debug}`);
    if (!result.items || result.items.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: `SignalBase had no record for ${company.name}.`,
          debug: result.debug,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const normalized = normalizeCompanyPayload(result.items);

    // Patch the row. Update some top-level fields opportunistically when the
    // enrichment provides better values than what we have.
    const patch: Record<string, unknown> = {
      enrichment_data: normalized,
      enrichment_updated_at: new Date().toISOString(),
      enrichment_source: 'signalbase',
      updated_at: new Date().toISOString(),
    };
    if (normalized.industry) patch.industry = normalized.industry;
    if (normalized.employee_count) patch.employee_count = normalized.employee_count;
    if (normalized.description) patch.description = normalized.description;

    await supabase.from('crm_companies').update(patch).eq('id', company_id);

    return new Response(
      JSON.stringify({ ok: true, enrichment: normalized }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('enrich-company-signalbase error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
