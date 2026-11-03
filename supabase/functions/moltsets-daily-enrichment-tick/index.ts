/**
 * MoltSets Daily Enrichment Tick
 *
 * Cron-invoked every minute. For each org
 * with an enrolled lead list (moltsets_worker_lists) and a valid MoltSets
 * BYOK key, claims a small batch of contacts missing an email, resolves them
 * via MoltsetsAdapter, and writes results back through the shared
 * applyEnrichmentResult module — the same write-back path enrich-contact and
 * process-enrichment-queue use, so history/identities stay consistent.
 *
 * Every request is scheduled through the same org/provider clock used by list
 * processing. Calls are smoothly staggered across 97% of the plan allowance,
 * leaving a small safety margin without the old nine-minute idle gap.
 *
 * A per-run wall-clock budget bails out before the edge function's ~150s
 * hard timeout (we hit this exact IDLE_TIMEOUT failure mode doing an earlier
 * ad-hoc LinkedIn scrape in this session) — the next cron tick just resumes.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import {
  MoltsetsAdapter,
  refundRateLimitedMoltsetsRequest,
  reserveMoltsetsRequest,
  type MoltsetsPlanTier,
} from '../_shared/enrichment/moltsets.ts';
import { resolveMoltsetsPacing } from '../_shared/enrichment/moltsets-budget.ts';
import { reportEnrichmentProviderRecord } from '../_shared/enrichment/rate-limit.ts';
import { applyEnrichmentResult, logEmailProviderLookup } from '../_shared/enrichment/write-back.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const MAX_BATCH_SIZE = 500;
const MAX_RUN_MS = 120_000;

interface WorkerListRow {
  id: string;
  organization_id: string;
  lead_list_id: string;
}

interface ApiKeyRow {
  key_encrypted: string;
  metadata: { plan?: MoltsetsPlanTier } | null;
}

interface ProcessingPolicyRow {
  organization_id: string;
  email_provider: string | null;
  email_provider_chain: string[] | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const adapter = new MoltsetsAdapter();

  let orgsProcessed = 0;
  let contactsAttempted = 0;
  let emailsFound = 0;
  let capExhaustedOrgs = 0;
  let reservedForWorkflowOrgs = 0;
  const errors: string[] = [];

  try {
    const { data: workerLists, error: listsError } = await supabase
      .from('moltsets_worker_lists')
      .select('id, organization_id, lead_list_id')
      .eq('enabled', true);

    if (listsError) throw listsError;

    if (!workerLists || workerLists.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No enrolled lists' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // A list-processing policy is the user-configured workflow and must own
    // its provider capacity. The older background worker only uses MoltSets
    // for organizations without an enabled MoltSets workflow, so it cannot
    // exhaust the day before upstream ICP stages release their contacts.
    const { data: processingPolicies, error: policiesError } = await supabase
      .from('lead_list_processing_policies')
      .select('organization_id, email_provider, email_provider_chain')
      .eq('enabled', true);
    if (policiesError) throw policiesError;
    const workflowPriorityOrganizations = new Set(
      ((processingPolicies || []) as ProcessingPolicyRow[])
        .filter((policy) => policy.email_provider === 'moltsets' || policy.email_provider_chain?.includes('moltsets'))
        .map((policy) => policy.organization_id),
    );

    for (const list of workerLists as WorkerListRow[]) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        console.log('[moltsets-tick] Run budget exhausted, stopping — next tick resumes');
        break;
      }

      if (workflowPriorityOrganizations.has(list.organization_id)) {
        reservedForWorkflowOrgs++;
        console.log(`[moltsets-tick] Org ${list.organization_id}: capacity reserved for enabled list workflow`);
        continue;
      }

      try {
        const { data: keyRow } = await supabase
          .from('api_keys')
          .select('key_encrypted, metadata')
          .eq('organization_id', list.organization_id)
          .eq('provider', 'moltsets')
          .eq('is_valid', true)
          .maybeSingle();

        if (!keyRow) {
          continue; // Key removed/invalidated since enrollment — skip silently
        }

        const apiKey = await decryptApiKey((keyRow as ApiKeyRow).key_encrypted, encryptionKey);

        // Pace against MoltSets' own fair-use accounting rather than a static
        // per-plan budget, which only ever modelled the 5h window and left the
        // rolling 1w one unenforced.
        const limits = await resolveMoltsetsPacing(
          supabase as unknown as SupabaseClient,
          list.organization_id,
          apiKey,
          (keyRow as ApiKeyRow).metadata?.plan ?? null,
        );
        if (!limits) {
          errors.push(`Org ${list.organization_id}: MoltSets key has no plan tier configured`);
          continue;
        }
        if (limits.exhausted) {
          errors.push(`Org ${list.organization_id}: MoltSets fair-use record budget spent until ${limits.exhaustedResetAt ?? 'the next window'}`);
          continue;
        }
        const { data: usageRow, error: usageError } = await supabase
          .from('enrichment_provider_daily_usage')
          .select('request_count')
          .eq('organization_id', list.organization_id)
          .eq('provider', 'moltsets')
          .eq('usage_date', new Date().toISOString().slice(0, 10))
          .maybeSingle();
        if (usageError) {
          errors.push(`Org ${list.organization_id} quota check error: ${usageError.message}`);
          continue;
        }
        // Null dailyCap = plan has no daily cap; only reqPerMin paces the batch.
        const remainingDailyRequests = limits.dailyCap === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, limits.dailyCap - Number(usageRow?.request_count ?? 0));
        if (remainingDailyRequests === 0) {
          capExhaustedOrgs++;
          continue;
        }
        const batchSize = Math.min(
          MAX_BATCH_SIZE,
          Math.max(1, Math.floor(limits.requestsPerMinute * 0.97)),
          remainingDailyRequests,
        );

        const { data: claimed, error: claimError } = await supabase.rpc('claim_contacts_for_moltsets', {
          p_lead_list_id: list.lead_list_id,
          p_batch_size: batchSize,
        });

        if (claimError) {
          errors.push(`Org ${list.organization_id} claim error: ${claimError.message}`);
          continue;
        }

        const contacts = (claimed || []) as Array<Record<string, unknown>>;
        orgsProcessed++;

        let orgHitDailyCap = false;
        await Promise.all(contacts.map(async (contact) => {
          const contactId = contact.id as string;
          // The claim RPC stamped moltsets_attempted_at as its claim marker.
          // Only null it back if it still holds OUR claim value — a concurrent
          // enrich-contact run may have written a genuine attempt stamp in the
          // meantime, and unconditionally nulling it erased real attempts
          // (making them eligible for duplicate paid lookups).
          const claimedAt = contact.moltsets_attempted_at as string | null;
          const releaseClaim = async () => {
            let query = supabase.from('crm_contacts')
              .update({ moltsets_attempted_at: null })
              .eq('id', contactId)
              .eq('organization_id', list.organization_id);
            if (claimedAt) query = query.eq('moltsets_attempted_at', claimedAt);
            await query;
          };

          if (Date.now() - startTime > MAX_RUN_MS) {
            await releaseClaim();
            return;
          }

          try {
            const reservation = await reserveMoltsetsRequest(
              supabase as unknown as SupabaseClient,
              list.organization_id,
              limits,
              105_000,
            );
            if (reservation.status === 'daily_exhausted') {
              orgHitDailyCap = true;
              await releaseClaim();
              return;
            }
            if (reservation.status === 'rate_wait') {
              await releaseClaim();
              return;
            }

            contactsAttempted++;
            const linkedinUrl = contact.primary_linkedin_url as string;
            const result = await adapter.enrich(apiKey, { linkedinUrl }, ['email']);

            // reserve() already counted this as a request in the find-rate
            // denominator, and that state is shared per (org, provider) — so
            // staying silent here would drag the rate enrich-contact derives
            // from toward the 0.05 floor and push the shared request rate to
            // the maxReqPerMin ceiling, overspending the record budget. A miss
            // costs no record and no round trip.
            await reportEnrichmentProviderRecord(
              supabase as unknown as SupabaseClient,
              list.organization_id,
              'moltsets',
              !!result.data?.email,
            );

            if (result.error?.code === 'RATE_LIMITED') {
              await refundRateLimitedMoltsetsRequest(
                supabase as unknown as SupabaseClient,
                reservation.reservationId,
              );
              await releaseClaim();
              errors.push(`Contact ${contactId}: ${result.error.message}`);
              return;
            }

            if (result.success && result.data.email) {
              await logEmailProviderLookup(supabase as unknown as SupabaseClient, {
                organizationId: list.organization_id,
                contactId,
                provider: 'moltsets',
                outcome: 'found',
                source: 'moltsets_tick',
                leadListId: list.lead_list_id,
              });
              emailsFound++;
              await applyEnrichmentResult(supabase as unknown as SupabaseClient, {
                contactId,
                organizationId: list.organization_id,
                existingContact: contact,
                provider: 'moltsets',
                enrichmentType: 'email',
                data: result.data,
                creditsUsed: result.creditsUsed,
              });
            } else if (result.error?.code === 'NOT_FOUND' || result.success) {
              await logEmailProviderLookup(supabase as unknown as SupabaseClient, {
                organizationId: list.organization_id,
                contactId,
                provider: 'moltsets',
                outcome: 'not_found',
                source: 'moltsets_tick',
                leadListId: list.lead_list_id,
              });
            } else {
              errors.push(`Contact ${contactId}: ${result.error?.message}`);
            }
          } catch (error) {
            await releaseClaim();
            errors.push(`Contact ${contactId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }));

        if (orgHitDailyCap) {
          capExhaustedOrgs++;
          console.log(`[moltsets-tick] Org ${list.organization_id} hit daily cap (${limits.dailyCap})`);
        }

        await supabase
          .from('moltsets_worker_lists')
          .update({ last_run_at: new Date().toISOString() })
          .eq('id', list.id);
      } catch (orgError) {
        errors.push(`Org ${list.organization_id}: ${orgError instanceof Error ? orgError.message : 'Unknown error'}`);
      }
    }

    console.log(`[moltsets-tick] orgs=${orgsProcessed} attempted=${contactsAttempted} found=${emailsFound} capExhausted=${capExhaustedOrgs} reservedForWorkflow=${reservedForWorkflowOrgs}`);

    return new Response(JSON.stringify({
      success: true,
      orgsProcessed,
      contactsAttempted,
      emailsFound,
      capExhaustedOrgs,
      reservedForWorkflowOrgs,
      errors: errors.length > 0 ? errors : undefined,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[moltsets-tick] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
