/**
 * Check SEG Status
 *
 * Given a list of CRM contact IDs, checks if any contacts' email domains
 * route through a known Secure Email Gateway (Barracuda, Mimecast, etc.).
 * Uses DNS-over-HTTPS MX lookups with domain-level caching.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { detectSEGBatch } from '../_shared/seg-detector.ts';
import type { SEGDetectionResult } from '../_shared/seg-detector.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL_DAYS = 30;
/** PostgREST .in() safe chunk size — avoids URL length / param limits */
const IN_CHUNK_SIZE = 300;

interface SEGCheckRequest {
  contactIds: string[];
  organizationId: string;
}

interface SEGContactResult {
  contactId: string;
  email: string;
  domain: string;
  segProvider: string;
}

/** Run a Supabase .in() select in chunks, concat results */
async function selectInChunks<T>(
  supabase: any,
  table: string,
  selectCols: string,
  inColumn: string,
  ids: string[],
  extraFilters?: (q: any) => any,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    let q = supabase.from(table).select(selectCols).in(inColumn, chunk);
    if (extraFilters) q = extraFilters(q);
    const { data } = await q;
    if (data) results.push(...data);
  }
  return results;
}

/** Run a Supabase .in() update in chunks */
async function updateInChunks(
  supabase: any,
  table: string,
  updateData: Record<string, any>,
  inColumn: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    await supabase.from(table).update(updateData).in(inColumn, chunk);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { contactIds, organizationId }: SEGCheckRequest = await req.json();

    if (!contactIds?.length || !organizationId) {
      return new Response(
        JSON.stringify({ segContacts: [], checkedDomains: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch contacts with emails (chunked to handle large arrays)
    const contacts = await selectInChunks<{ id: string; primary_email: string }>(
      supabase,
      'crm_contacts',
      'id, primary_email',
      'id',
      contactIds,
      (q: any) => q.eq('organization_id', organizationId).not('primary_email', 'is', null),
    );

    if (contacts.length === 0) {
      return new Response(
        JSON.stringify({ segContacts: [], checkedDomains: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Extract unique domains and map contacts to domains
    const contactDomainMap = new Map<string, { contactId: string; email: string }[]>();
    for (const contact of contacts) {
      const email = contact.primary_email?.toLowerCase();
      if (!email || !email.includes('@')) continue;
      const domain = email.split('@')[1];
      if (!domain) continue;

      if (!contactDomainMap.has(domain)) {
        contactDomainMap.set(domain, []);
      }
      contactDomainMap.get(domain)!.push({ contactId: contact.id, email });
    }

    const uniqueDomains = [...contactDomainMap.keys()];

    // 3. Check cache for recently checked domains (chunked)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_TTL_DAYS);

    const cached = await selectInChunks<{ domain: string; has_seg: boolean; seg_provider: string | null }>(
      supabase,
      'domain_seg_cache',
      'domain, has_seg, seg_provider',
      'domain',
      uniqueDomains,
      (q: any) => q.gte('checked_at', cutoffDate.toISOString()),
    );

    const cachedDomains = new Map(
      cached.map((c) => [c.domain, { hasSEG: c.has_seg, segProvider: c.seg_provider }])
    );

    // 4. Identify uncached domains
    const uncachedDomains = uniqueDomains
      .filter(d => !cachedDomains.has(d));

    // 5. Perform DoH lookups for uncached domains
    let freshResults: SEGDetectionResult[] = [];
    if (uncachedDomains.length > 0) {
      console.log(`[SEG] Performing ${uncachedDomains.length} fresh MX lookups`);
      freshResults = await detectSEGBatch(uncachedDomains, 5);

      // 6. Upsert results into cache
      const upsertRows = freshResults.map(r => ({
        domain: r.domain,
        has_seg: r.hasSEG,
        seg_provider: r.segProvider,
        mx_records: r.mxRecords,
        checked_at: new Date().toISOString(),
      }));

      if (upsertRows.length > 0) {
        await supabase
          .from('domain_seg_cache')
          .upsert(upsertRows, { onConflict: 'domain' });
      }
    }

    // 7. Build combined SEG results (cached + fresh)
    const segDomains = new Map<string, string>();

    for (const [domain, info] of cachedDomains) {
      if (info.hasSEG && info.segProvider) {
        segDomains.set(domain, info.segProvider);
      }
    }

    for (const result of freshResults) {
      if (result.hasSEG && result.segProvider) {
        segDomains.set(result.domain, result.segProvider);
      }
    }

    // 8. Map back to contacts
    const segContacts: SEGContactResult[] = [];
    for (const [domain, provider] of segDomains) {
      const domainContacts = contactDomainMap.get(domain) || [];
      for (const { contactId, email } of domainContacts) {
        segContacts.push({ contactId, email, domain, segProvider: provider });
      }
    }

    // 9. Persist seg_provider + seg_checked_at on crm_contacts (chunked updates)
    const now = new Date().toISOString();

    // Collect all SEG contact IDs grouped by provider for batch updates
    const providerContactIds = new Map<string, string[]>();
    for (const [domain, provider] of segDomains) {
      const domainContacts = contactDomainMap.get(domain) || [];
      const ids = domainContacts.map(c => c.contactId);
      if (ids.length > 0) {
        const existing = providerContactIds.get(provider) || [];
        existing.push(...ids);
        providerContactIds.set(provider, existing);
      }
    }

    for (const [provider, ids] of providerContactIds) {
      await updateInChunks(supabase, 'crm_contacts', { seg_provider: provider, seg_checked_at: now }, 'id', ids);
    }

    // Only clear seg_provider for contacts whose domains were actually checked
    // (cached or freshly looked up).
    const checkedDomains = new Set([
      ...cachedDomains.keys(),
      ...uncachedDomains,
    ]);

    const nonSegContactIds = contacts
      .filter((c: any) => {
        const domain = c.primary_email?.toLowerCase()?.split('@')[1];
        return domain && checkedDomains.has(domain) && !segDomains.has(domain);
      })
      .map((c: any) => c.id);

    if (nonSegContactIds.length > 0) {
      await updateInChunks(supabase, 'crm_contacts', { seg_provider: null, seg_checked_at: now }, 'id', nonSegContactIds);
    }

    console.log(`[SEG] ${uniqueDomains.length} domains checked, ${uncachedDomains.length} fresh lookups, ${segContacts.length} contacts behind SEGs`);

    return new Response(
      JSON.stringify({
        segContacts,
        checkedDomains: uniqueDomains.length,
        freshLookups: uncachedDomains.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Check SEG status error:', error);
    return new Response(
      JSON.stringify({
        segContacts: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
