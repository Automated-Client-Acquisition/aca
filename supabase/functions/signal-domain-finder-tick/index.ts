/**
 * Edge Function: signal-domain-finder-tick
 * ---------------------------------------------------------------------------
 * Rung 3.5 of the resolution ladder, run as its own batched pass.
 *
 * Takes company_identities that are still unresolved, sends the whole batch to
 * the bulk domain actor in ONE call, verifies every candidate against its live
 * homepage, and promotes only the ones that prove out.
 *
 * WHY A SEPARATE TICK RATHER THAN A RUNG INSIDE resolveCompany()
 * ---------------------------------------------------------------------------
 * The actor is bulk-shaped: 42 names in 7 seconds for ~3 cents, versus one
 * HTTP round trip per name if called inline. Batching it here also means it
 * runs BEFORE the MoltSets rung on the next resolve pass, so the cheap source
 * gets first refusal and the quota that locks for days is only reached for
 * names nothing else could place.
 *
 * Ordering in the ladder is therefore:
 *   cache -> board URL -> CRM/pool seed -> [this tick] -> MoltSets
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { findDomainsBulk, verifyCandidates } from '../_shared/signal-engine/domain-finder.ts';
import { normalizeCompanyName } from '../_shared/signal-engine/normalize.ts';
import { MAX_RESOLUTION_ATTEMPTS } from '../_shared/signal-engine/resolve.ts';
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ENGINE_ORG_ID = Deno.env.get('SIGNAL_ENGINE_ORG_ID')
  ?? HOUSE_ORG_ID;

const DEFAULT_BATCH = 100;

/**
 * Names that are legal vehicles rather than businesses. They have no website by
 * construction, so sending them to a domain finder guarantees a guess, and a
 * guess is exactly what we do not want. Cheaper and safer to skip them here
 * than to verify our way back out afterwards.
 */
const VEHICLE_NAME_PATTERN =
  /\b(fund|fund\s+[ivx\d]+|spv|series\s+[a-z0-9]+\s+llc|holdings?|partners|partnership|capital|ventures?|management|receivables|trust|reit|acquisition\s+corp)\b/i;

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
    const batchSize = Number(body.batch_size ?? DEFAULT_BATCH);
    const includeVehicles = body.include_vehicles === true;

    const { data: rows, error } = await supabase.rpc('claim_signal_identities', {
      p_limit: batchSize * 2,
      p_max_attempts: MAX_RESOLUTION_ATTEMPTS,
      p_worker: 'signal-domain-finder-tick',
      p_lease_seconds: 600,
    });
    if (error) throw new Error(`claim failed: ${error.message}`);

    const all = (rows ?? []) as Array<{ id: string; name: string; resolution_attempts: number }>;
    const vehicleRows = includeVehicles
      ? []
      : all.filter((r) => VEHICLE_NAME_PATTERN.test(r.name));
    const eligible = all.filter((r) => includeVehicles || !VEHICLE_NAME_PATTERN.test(r.name));
    const candidates = eligible.slice(0, batchSize);
    const overflow = eligible.slice(batchSize);
    const skippedVehicles = vehicleRows.length;

    for (const row of vehicleRows) {
      await supabase.from('company_identities').update({
        resolution_attempts: MAX_RESOLUTION_ATTEMPTS,
        last_resolution_error: 'domain-finder: skipped legal/investment vehicle',
        resolution_lease_until: null,
        resolution_claimed_by: null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }

    // We claim extra rows so the legal-vehicle filter can still fill a batch.
    // Any valid overflow must be released untouched for the next tick; parking
    // it as a vehicle would permanently lose legitimate companies.
    if (overflow.length > 0) {
      await supabase.from('company_identities').update({
        resolution_lease_until: null,
        resolution_claimed_by: null,
        updated_at: new Date().toISOString(),
      }).in('id', overflow.map((row) => row.id));
    }

    if (candidates.length === 0) {
      return json({ ok: true, considered: all.length, skipped_vehicles: skippedVehicles, verified: 0 });
    }

    const apifyToken = await loadApifyToken(supabase);
    if (!apifyToken) {
      return json({ ok: false, error: 'no valid Apify API key for the engine org' }, 400);
    }

    const found = await findDomainsBulk(apifyToken, candidates.map((c) => c.name));
    const { verified, rejected } = await verifyCandidates(found);

    // Map verified domains back onto identity rows by normalized name.
    const byName = new Map(candidates.map((c) => [normalizeCompanyName(c.name), c]));
    let promoted = 0;
    const collisions: string[] = [];

    for (const v of verified) {
      const identity = byName.get(normalizeCompanyName(v.companyName));
      if (!identity) continue;

      // Another identity may already own this domain — that is a genuine
      // duplicate, not a new resolution. Leave it for the merge path rather
      // than creating a second row on the same domain.
      const { data: existing } = await supabase
        .from('company_identities')
        .select('id')
        .eq('domain', v.domain)
        .maybeSingle();
      if (existing && existing.id !== identity.id) {
        collisions.push(`${v.companyName} -> ${v.domain} (already held)`);
        await supabase.from('company_identities').update({
          resolution_attempts: MAX_RESOLUTION_ATTEMPTS,
          last_resolution_error: `domain-finder: domain already belongs to identity ${existing.id}`,
          resolution_lease_until: null,
          resolution_claimed_by: null,
          updated_at: new Date().toISOString(),
        }).eq('id', identity.id);
        continue;
      }

      const { error: upErr } = await supabase
        .from('company_identities')
        .update({
          domain: v.domain,
          website_url: `https://${v.domain}`,
          resolved_via: v.via,
          resolved_at: new Date().toISOString(),
          last_resolution_error: null,
          resolution_lease_until: null,
          resolution_claimed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', identity.id);
      if (!upErr) promoted++;
    }

    // Anything the actor could not place, or that failed verification, gets an
    // attempt recorded so the negative cache stops us paying for it again.
    for (const r of rejected) {
      const identity = byName.get(normalizeCompanyName(r.name));
      if (!identity) continue;
      await supabase
        .from('company_identities')
        .update({
          resolution_attempts: (identity.resolution_attempts ?? 0) + 1,
          last_resolution_error: `domain-finder: ${r.reason}`.slice(0, 500),
          resolution_lease_until: null,
          resolution_claimed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', identity.id);
    }

    // Names the actor could not place at all never appear in `rejected`, so
    // they would otherwise sit at attempt 0 and be re-sent forever.
    const answered = new Set(
      [...verified.map((v) => v.companyName), ...rejected.map((r) => r.name)]
        .map(normalizeCompanyName),
    );
    for (const c of candidates) {
      if (answered.has(normalizeCompanyName(c.name))) continue;
      await supabase
        .from('company_identities')
        .update({
          resolution_attempts: (c.resolution_attempts ?? 0) + 1,
          last_resolution_error: 'domain-finder: no candidate domain returned',
          resolution_lease_until: null,
          resolution_claimed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', c.id);
    }

    // Observations pointing at newly-resolved identities can move on.
    if (promoted > 0) {
      await supabase
        .from('signal_observations')
        .update({ status: 'extracted', attempts: 0, error: null })
        .eq('status', 'skipped')
        .in('company_identity_id', candidates.map((c) => c.id));
    }

    return json({
      ok: true,
      considered: all.length,
      skipped_vehicles: skippedVehicles,
      sent_to_actor: candidates.length,
      actor_returned_domain: found.filter((f) => f.domain).length,
      verified: verified.length,
      promoted,
      collisions,
      // Returned so the verification gate's behaviour is inspectable rather
      // than a black box — this is the part that has to stay trustworthy.
      sample_verified: verified.slice(0, 10).map((v) => `${v.companyName} -> ${v.domain} (${v.via}: ${v.evidence})`),
      sample_rejected: rejected.slice(0, 15).map((r) => `${r.name} -> ${r.domain} REJECTED: ${r.reason}`),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[signal-domain-finder-tick]', msg);
    return json({ ok: false, error: msg }, 500);
  }
});

async function loadApifyToken(supabase: SupabaseClient): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', ENGINE_ORG_ID)
    .eq('provider', 'apify')
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
