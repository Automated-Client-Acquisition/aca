/**
 * Edge Function: signal-resolve-tick
 * ---------------------------------------------------------------------------
 * Drains signal_observations in status 'extracted' and attaches each one to a
 * company_identity. This is the stage that decides whether the whole engine is
 * worth anything: an observation without a domain cannot be scored, enriched,
 * or emailed, so an unresolved signal is a signal we did not collect.
 *
 * Cost control is the other job here. The resolver walks a cost ladder (see
 * _shared/signal-engine/resolve.ts) and only reaches the paid company lookup rung
 * when nothing free can answer. Two guards sit on top of that:
 *
 *   - a per-run budget of QuickEnrich company credits / legacy paid lookups, so one bad batch cannot run up a bill
 *   - a provider-specific company cache and lease, so overlapping observations
 *     share the paid lookup and misses are not re-bought immediately
 *
 * Runs are idempotent: rows are claimed by flipping status, and anything that
 * throws is left in 'extracted' with attempts incremented so it retries with a
 * bounded number of chances rather than forever.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { QuickenrichCompanyFinderError } from '../_shared/enrichment/quickenrich.ts';
import { reserveEnrichmentProviderRequest } from '../_shared/enrichment/rate-limit.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import {
  MAX_RESOLUTION_ATTEMPTS,
  MoltsetsSearchLockedError,
  MoltsetsSearchUnavailableError,
  resolveCompany,
  type EntityHints,
} from '../_shared/signal-engine/resolve.ts';
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The org whose provider key funds shared resolution. The identity cache is
// global, so a lookup bought once here serves every tenant afterwards.
const ENGINE_ORG_ID = Deno.env.get('SIGNAL_ENGINE_ORG_ID')
  ?? HOUSE_ORG_ID;

// Supabase edge functions abort at a 150s idle timeout, and each unresolved
// row can cost a MoltSets round trip plus a homepage fetch. A batch of 200 can
// never finish — measured: 130 rows timed out. Keep batches small and let the
// cron run more often; a tick that always dies mid-way is worse than a small one.
const DEFAULT_BATCH = 25;
const DEFAULT_PAID_BUDGET = 50;
const MAX_ATTEMPTS = 3;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const requestedBatch = Number(body.batch_size ?? DEFAULT_BATCH);
    const requestedBudget = Number(body.paid_budget ?? DEFAULT_PAID_BUDGET);
    if (!Number.isInteger(requestedBatch) || requestedBatch < 1 || requestedBatch > 25 ||
        !Number.isInteger(requestedBudget) || requestedBudget < 0 || requestedBudget > 50) {
      return json({ ok: false, error: 'batch_size must be 1..25 and paid_budget 0..50' }, 400);
    }
    const batchSize = requestedBatch;
    let paidBudget = requestedBudget;
    const freeOnly = paidBudget <= 0;

    const { data: claimed, error: claimErr } = await supabase.rpc(
      'claim_signal_observations',
      {
        p_status: 'extracted',
        p_limit: batchSize,
        p_max_attempts: MAX_ATTEMPTS,
        p_worker: 'signal-resolve-tick',
        p_lease_seconds: 300,
      },
    );
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);

    const rows = (claimed ?? []) as Array<{
      id: string;
      collector_key: string;
      entity_hints: Record<string, unknown> | null;
      attempts: number;
    }>;
    if (rows.length === 0) {
      return json({ ok: true, claimed: 0, resolved: 0, unresolved: 0, billed: 0 });
    }

    const quickenrichToken = freeOnly ? null : await loadProviderToken(supabase, 'quickenrich');
    const moltsetsToken = freeOnly || quickenrichToken ? null : await loadProviderToken(supabase, 'moltsets');
    const startedAt = Date.now();

    // ATS observations carry a token, not a domain. The board row often knows
    // the employer's own careers URL, which resolves for free — so fetch the
    // boards this batch needs in one query rather than per row.
    const atsTokens = rows
      .map((r) => (r.entity_hints as EntityHints)?.ats_token)
      .filter((t): t is string => !!t);
    const boardUrls = new Map<string, string | null>();
    if (atsTokens.length > 0) {
      const { data: boards } = await supabase
        .from('ats_boards')
        .select('token, board_url')
        .in('token', [...new Set(atsTokens)]);
      for (const b of boards ?? []) boardUrls.set(b.token as string, b.board_url as string | null);
    }

    let resolved = 0;
    let unresolved = 0;
    let billed = 0;
    let quickenrichCreditsUsed = 0;
    let processed = 0;
    let providerUnavailable: MoltsetsSearchLockedError | MoltsetsSearchUnavailableError | QuickenrichCompanyFinderError | null = null;
    const viaCounts: Record<string, number> = {};

    for (const row of rows) {
      if (Date.now() - startedAt > 100_000) break;
      const hints = (row.entity_hints ?? {}) as EntityHints;
      try {
        const outcome = await resolveCompany(
          {
            supabase,
            // Keep the configured provider present when budget is spent so its
            // cache policy remains independent from the legacy attempts cap.
            quickenrichToken,
            reserveQuickenrich: async () => {
              if (paidBudget <= 0) return 0;
              const reservation = await reserveEnrichmentProviderRequest(supabase, ENGINE_ORG_ID,
                'quickenrich_company_finder', { requestsPerMinute: 120 }, 5_000);
              if (reservation.status !== 'granted') {
                throw new QuickenrichCompanyFinderError('RATE_LIMITED', 429, 'company finder capacity unavailable', 60);
              }
              const reserved = Math.min(5, paidBudget);
              paidBudget -= reserved;
              return reserved;
            },
            reserveQuickenrichDiscovery: async () => {
              const reservation = await reserveEnrichmentProviderRequest(supabase, ENGINE_ORG_ID,
                'quickenrich_contact_finder', { requestsPerMinute: 120 }, 5_000);
              if (reservation.status !== 'granted') {
                throw new QuickenrichCompanyFinderError('RATE_LIMITED', 429, 'contact finder capacity unavailable', 60);
              }
            },
            settleQuickenrich: (reserved, used) => { paidBudget += reserved - used; },
            moltsetsToken: paidBudget > 0 ? moltsetsToken : null,
            reserveMoltsets: async () => {
              if (paidBudget <= 0) return false;
              paidBudget--;
              return true;
            },
          },
          hints,
          hints.ats_token ? boardUrls.get(hints.ats_token) ?? null : null,
        );

        viaCounts[outcome.via] = (viaCounts[outcome.via] ?? 0) + 1;
        if (outcome.billed) billed++;
        quickenrichCreditsUsed += outcome.creditsUsed ?? 0;

        if (outcome.identity?.domain) {
          await supabase
            .from('signal_observations')
            .update({
              company_identity_id: outcome.identity.id,
              status: 'resolved',
              error: null,
              lease_until: null,
              claimed_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          resolved++;
        } else {
          // Keep the link to the placeholder identity so a later run can pick
          // it up once the company is resolved by some other observation.
          const giveUp =
            !freeOnly && !quickenrichToken && outcome.identity
              ? await attemptsExceeded(supabase, outcome.identity.id)
              : false;
          await supabase
            .from('signal_observations')
            .update({
              company_identity_id: outcome.identity?.id ?? null,
              status: giveUp ? 'skipped' : 'extracted',
              // Fast free-only passes are an opportunistic cache/seed sweep.
              // They must not consume the observation attempt budget or the
              // paid resolver can no longer claim the row afterward.
              attempts: freeOnly || (quickenrichToken && !outcome.paidAttempted)
                ? (row.attempts ?? 0) : (row.attempts ?? 0) + 1,
              error: freeOnly
                ? `awaiting paid/domain resolution (${outcome.via})`
                : `unresolved (${outcome.via})`,
              lease_until: null,
              claimed_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          unresolved++;
        }
        processed++;
      } catch (err) {
        // The search quota locking is not a row-level failure — it is a
        // run-level stop. Every remaining row would hit the same locked
        // endpoint, and burning their attempts on it would mark them 'failed'
        // for a reason that has nothing to do with the rows themselves. Leave
        // them untouched and exit; the next tick picks them up once the window
        // reopens.
        if (err instanceof MoltsetsSearchLockedError || err instanceof MoltsetsSearchUnavailableError || err instanceof QuickenrichCompanyFinderError) {
          providerUnavailable = err;
          break;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await supabase
          .from('signal_observations')
          .update({
            attempts: (row.attempts ?? 0) + 1,
            error: msg.slice(0, 500),
            status: (row.attempts ?? 0) + 1 >= MAX_ATTEMPTS ? 'failed' : 'extracted',
            lease_until: null,
            claimed_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        unresolved++;
        processed++;
      }
    }

    // Release untouched rows after a provider stop/deadline without consuming
    // attempts. Their leases belong to this invocation; another tick can drain.
    if (processed < rows.length) {
      await supabase.from('signal_observations').update({ lease_until: null, claimed_by: null })
        .in('id', rows.slice(processed).map((row) => row.id));
    }

    // Surface the lock in the response body AND as a non-200, so a cron that
    // only checks status still notices. A silent 200 is how the last search
    // outage went unnoticed for two days.
    if (providerUnavailable) {
      return json({
        ok: false,
        error: providerUnavailable instanceof QuickenrichCompanyFinderError
          ? 'quickenrich_company_finder_unavailable'
          : providerUnavailable instanceof MoltsetsSearchLockedError
          ? 'moltsets_search_quota_locked'
          : 'moltsets_search_unavailable',
        retry_after_seconds: providerUnavailable instanceof MoltsetsSearchLockedError
          ? providerUnavailable.retryAfterSeconds
          : null,
        detail: providerUnavailable.message,
        claimed: rows.length,
        resolved,
        unresolved,
        billed,
        quickenrich_credits_used: quickenrichCreditsUsed,
        via: viaCounts,
      }, 503);
    }

    return json({
      ok: true,
      claimed: rows.length,
      resolved,
      unresolved,
      billed,
      quickenrich_credits_used: quickenrichCreditsUsed,
      paid_budget_left: Math.max(0, paidBudget),
      via: viaCounts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[signal-resolve-tick]', msg);
    return json({ ok: false, error: msg }, 500);
  }
});

async function attemptsExceeded(supabase: SupabaseClient, identityId: string): Promise<boolean> {
  const { data } = await supabase
    .from('company_identities')
    .select('resolution_attempts')
    .eq('id', identityId)
    .maybeSingle();
  return Number(data?.resolution_attempts ?? 0) >= MAX_RESOLUTION_ATTEMPTS;
}

async function loadProviderToken(supabase: SupabaseClient, provider: string): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', ENGINE_ORG_ID)
    .eq('provider', provider)
    .eq('is_valid', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.key_encrypted) return null;
  try {
    return await decryptApiKey(data.key_encrypted, encryptionKey);
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
