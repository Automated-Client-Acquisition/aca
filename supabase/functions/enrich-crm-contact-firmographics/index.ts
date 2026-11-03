/**
 * Backfill provider-verified firmographics onto crm_contacts flat columns.
 * Claims are atomically stamped by claim_crm_contacts_for_firmographics, so a
 * provider miss is not purchased again until the recheck window expires.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import {
  refundRateLimitedMoltsetsRequest,
  reserveMoltsetsRequest,
  type MoltsetsPlanTier,
} from '../_shared/enrichment/moltsets.ts';
import { resolveMoltsetsPacing } from '../_shared/enrichment/moltsets-budget.ts';
import { reportEnrichmentProviderRecord } from '../_shared/enrichment/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-enrich-secret, x-cron-secret',
};
const MOLTSETS_URL = 'https://api.moltsets.com/api/v1/tools/reverse_linkedin_lookup';
const MAX_RUN_MS = 120_000;

type Contact = {
  id: string;
  organization_id: string;
  company_id: string | null;
  company: string | null;
  company_website: string | null;
  primary_linkedin_url: string | null;
  company_employee_count: number | null;
  company_employee_range: string | null;
  company_revenue_range: string | null;
  company_industry: string | null;
};
type Facts = {
  companyName: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  revenueRange: string | null;
  industry: string | null;
  website: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function clean(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && !['unknown', 'n/a', 'none'].includes(text.toLowerCase()) ? text : null;
}
function count(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function domain(value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '') || null; }
  catch { return null; }
}
function normalizedName(value: string | null): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|bv|plc|sa|sas|srl|pty|group|holdings?)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function namesMatch(expected: string | null, actual: string | null): boolean {
  const a = normalizedName(expected), b = normalizedName(actual);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}
function patch(f: Facts, source: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    firmographics_checked_at: new Date().toISOString(),
    firmographics_source: source,
  };
  if (f.employeeCount) out.company_employee_count = f.employeeCount;
  if (f.revenueRange) out.company_revenue_range = f.revenueRange;
  if (f.industry) out.company_industry = f.industry;
  return out;
}
async function reverseLookup(token: string, linkedinUrl: string): Promise<{ facts: Facts | null; rateLimited: boolean }> {
  const response = await fetch(MOLTSETS_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedin_url: linkedinUrl }), signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429) return { facts: null, rateLimited: true };
  if (response.status === 404 || response.status === 422) return { facts: null, rateLimited: false };
  if (!response.ok) throw new Error(`MoltSets reverse lookup ${response.status}`);
  const body = await response.json().catch(() => null) as { results?: { company?: Record<string, unknown> } } | null;
  const company = body?.results?.company;
  if (!company || Object.keys(company).length === 0) return { facts: null, rateLimited: false };
  return { facts: {
    companyName: clean(company.name), employeeCount: count(company.employee_count),
    employeeRange: clean(company.employee_range), revenueRange: clean(company.revenue_range),
    industry: clean(company.industry), website: clean(company.website_url),
  }, rateLimited: false };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const requiredSecret = Deno.env.get('SIGNAL_ENRICH_SECRET');
    if (requiredSecret && req.headers.get('x-enrich-secret') !== requiredSecret) return json({ error: 'Forbidden' }, 403);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!supabaseUrl || !serviceKey || !encryptionKey) return json({ error: 'Missing required environment variables' }, 500);
    const supabase = createClient(supabaseUrl, serviceKey) as unknown as SupabaseClient;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const batchSize = Math.min(500, Math.max(1, Number(body.limit) || 100));
    const recheckDays = Math.max(1, Number(body.recheckDays) || 90);
    const orgId = typeof body.organizationId === 'string' ? body.organizationId : null;
    const dryRun = body.dryRun === true;
    // Claiming intentionally stamps attempts atomically. Pretending this can be
    // dry-run would mutate checked_at while skipping the useful writeback.
    if (dryRun) return json({ error: 'dryRun is not supported by the atomic claim worker' }, 400);
    const started = Date.now();
    const { data, error } = await supabase.rpc('claim_crm_contacts_for_firmographics', {
      p_org_id: orgId, p_batch_size: batchSize, p_recheck_days: recheckDays,
    });
    if (error) throw new Error(`Could not claim contacts: ${error.message}`);
    const contacts = (data ?? []) as Contact[];

    // One purchased answer per canonical company (or stable domain/name fallback),
    // then fan it out to every claimed contact in that company.
    const groups = new Map<string, Contact[]>();
    for (const c of contacts) {
      const key = c.company_id || domain(c.company_website) || normalizedName(c.company) || c.id;
      const bucket = groups.get(`${c.organization_id}:${key}`);
      if (bucket) bucket.push(c); else groups.set(`${c.organization_id}:${key}`, [c]);
    }
    const summary = { claimed: contacts.length, companies: groups.size, fromPool: 0, fromMoltsets: 0, misses: 0, mismatches: 0, errors: [] as string[], timedOut: false };

    for (const companyContacts of groups.values()) {
      if (Date.now() - started > MAX_RUN_MS) { summary.timedOut = true; break; }
      const representative = companyContacts[0];
      let facts: Facts | null = null;
      let source: string | null = null;
      let definitiveMiss = false;
      let poolLookupFailed = false;
      const companyDomain = domain(representative.company_website);
      const anchor = companyContacts.find((c) => c.primary_linkedin_url?.includes('/in/'))?.primary_linkedin_url;
      if (companyDomain) {
        const { data: pool, error: poolError } = await supabase.from('lead_pool_verified')
          .select('employee_count, employee_range, revenue_range, linkedin_industry')
          .eq('domain', companyDomain).not('employee_count', 'is', null).limit(1).maybeSingle();
        if (poolError) {
          poolLookupFailed = true;
          summary.errors.push(`${representative.id}: lead pool lookup failed: ${poolError.message}`);
        }
        if (pool) {
          facts = { companyName: representative.company, employeeCount: count(pool.employee_count), employeeRange: clean(pool.employee_range), revenueRange: clean(pool.revenue_range), industry: clean(pool.linkedin_industry), website: representative.company_website };
          source = 'lead_pool'; summary.fromPool++;
        }
      }
      if (!facts) {
        if (anchor) {
          const keyRow = await resolveApiKey(supabase, representative.organization_id, 'moltsets');
          if (keyRow?.key_encrypted) {
            const token = await decryptApiKey(keyRow.key_encrypted, encryptionKey);
            const limits = await resolveMoltsetsPacing(supabase, representative.organization_id, token, (keyRow.metadata?.plan as MoltsetsPlanTier | undefined) ?? null);
            if (limits && !limits.exhausted) {
              const reservation = await reserveMoltsetsRequest(supabase, representative.organization_id, limits, 30_000);
              if (reservation.status === 'granted') {
                try {
                  const result = await reverseLookup(token, anchor);
                  await reportEnrichmentProviderRecord(supabase, representative.organization_id, 'moltsets', !!result.facts);
                  if (result.rateLimited) {
                    await refundRateLimitedMoltsetsRequest(supabase, reservation.reservationId);
                    summary.errors.push(`${representative.id}: MoltSets rate limited; claim released for retry`);
                  }
                  else if (result.facts && namesMatch(representative.company, result.facts.companyName)) { facts = result.facts; source = 'moltsets_reverse_linkedin'; summary.fromMoltsets++; }
                  else if (result.facts) { summary.mismatches++; definitiveMiss = true; }
                  else definitiveMiss = true;
                } catch (e) { summary.errors.push(`${representative.id}: ${e instanceof Error ? e.message : String(e)}`); }
              }
            }
          }
        } else if (companyDomain && !poolLookupFailed) {
          // The free domain cache had no record and this claimed group has no
          // person anchor for the paid reverse lookup. That is an honest,
          // durable miss; another contact in the same company can still fan a
          // later hit back onto this row.
          definitiveMiss = true;
        }
      }
      if (!facts || !source) {
        if (definitiveMiss) {
          summary.misses++;
          await supabase.from('crm_contacts').update({ firmographics_source: null })
            .in('id', companyContacts.map((c) => c.id));
        } else {
          // The claim RPC uses checked_at as a lightweight lease. Provider
          // outages, missing credentials/quota and timeouts are not data
          // misses, so release that lease instead of suppressing a retry for
          // the full recheck window.
          await supabase.from('crm_contacts').update({ firmographics_checked_at: null })
            .in('id', companyContacts.map((c) => c.id));
        }
        continue;
      }
      const ids = companyContacts.map((c) => c.id);
      // A canonical company id lets one purchased answer cover contacts that a
      // later claim batch has not reached yet. Otherwise restrict the fan-out
      // to this atomically claimed group; company-name-only global updates can
      // collide with unrelated businesses.
      let updateQuery = supabase.from('crm_contacts').update(patch(facts, source));
      updateQuery = representative.company_id
        ? updateQuery.eq('organization_id', representative.organization_id).eq('company_id', representative.company_id)
        : updateQuery.in('id', ids);
      const { error: updateError } = await updateQuery;
      if (updateError) { summary.errors.push(`${representative.id}: ${updateError.message}`); continue; }
      if (representative.company_id) {
        const { data: crmCompany } = await supabase.from('crm_companies').select('employee_count, industry').eq('id', representative.company_id).maybeSingle();
        if (crmCompany) {
          const companyPatch: Record<string, unknown> = {};
          if (!crmCompany.employee_count && facts.employeeCount) companyPatch.employee_count = facts.employeeCount;
          if (!crmCompany.industry && facts.industry) companyPatch.industry = facts.industry;
          if (Object.keys(companyPatch).length) await supabase.from('crm_companies').update(companyPatch).eq('id', representative.company_id);
        }
      }
    }
    return json({ ok: true, dryRun, ...summary, elapsedMs: Date.now() - started });
  } catch (error) {
    console.error('[crm-contact-firmographics] failed:', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
