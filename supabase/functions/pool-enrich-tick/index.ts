/**
 * Drain the demand-driven MoltSets enrichment queue.
 *
 * Category comes free from each company's own website, but a deliverable email
 * does not. Measured on 1,892 real lookups: 76.8% resolve, 47.8% carry a
 * business email, and only 42.3% carry an A-grade one. Against a ~75k
 * records/week ceiling that is ~32k good addresses a week, so the budget is the
 * scarce resource and this worker exists to spend it deliberately.
 *
 * Three things it gets right, each learned the hard way:
 *
 * 1. BATCH AT 25. The API declares `linkedin_urls: maxItems 100` but returns
 *    504 above ~25 — 7 of 12 batches of 100 failed. Worse, a 504 returns an
 *    HTML error page, so a naive caller records "no matches" and silently
 *    halves its own coverage.
 *
 * 2. LOOKUP, NEVER SEARCH. reverse_linkedin_lookup draws on the replenishing
 *    enrich quota; search_* draws on a separate one that locks for DAYS once
 *    spent. Using search where a lookup would do took MoltSets to a ~97%
 *    failure rate platform-wide on 2026-08-08.
 *
 * 3. SELF-THROTTLE FROM THE RESPONSE. Every reply carries
 *    `_metadata.fair_use.records_remaining_5h`. Reading that beats modelling
 *    the budget locally, which drifts the moment anything else on the account
 *    spends a record.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { buildMoltsetsPoolWriteback } from '../_shared/pool-moltsets-writeback.ts';

const MOLTSETS_URL = 'https://api.moltsets.com/api/v1/tools/reverse_linkedin_lookup';

/** Hard ceiling per request — a MoltSets limit, not ours. See note 1 above. */
const BATCH = 25;

/** Batches per tick. At a 5-minute cron this paces ~14k records/day, just under
 *  the 75k/week ceiling with headroom for anything else using the key. */
const BATCHES_PER_TICK = 2;

/** Stop when the 5h window drops this low, so an interactive lookup elsewhere
 *  (a user enriching one contact) is never starved by the background drain. */
const RESERVE_5H = 500;

interface Fairness {
  records_remaining_5h?: number;
  records_remaining_1w?: number;
}

function normalizeLi(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
}

Deno.serve(async (req) => {
  // Cron-invoked; authenticate with the shared secret or service role.
  const auth = req.headers.get('authorization') ?? '';
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (!auth.includes(serviceKey) && (!expected || cronSecret !== expected)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('MOLTSETS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'MOLTSETS_API_KEY not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const started = Date.now();

  let claimed = 0;
  let found = 0;
  let missed = 0;
  let withEmail = 0;
  let usableEmail = 0;
  let movedEmployer = 0;
  let personsWritten = 0;
  let fair: Fairness = {};
  let stoppedBecause: string | null = null;

  for (let round = 0; round < BATCHES_PER_TICK; round++) {
    if (typeof fair.records_remaining_5h === 'number' && fair.records_remaining_5h < RESERVE_5H) {
      stoppedBecause = `quota reserve (${fair.records_remaining_5h} left in 5h window)`;
      break;
    }

    const { data: batch, error: claimErr } = await supabase
      .rpc('claim_pool_enrich_batch', { p_limit: BATCH, p_lease_seconds: 300 });
    if (claimErr) {
      return new Response(JSON.stringify({ error: claimErr.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (!batch?.length) {
      stoppedBecause = 'queue empty';
      break;
    }
    claimed += batch.length;

    const byLi = new Map<string, string>(); // normalized linkedin -> domain
    for (const row of batch) byLi.set(normalizeLi(row.linkedin_url), row.domain);

    let payload: Record<string, unknown> | null = null;
    try {
      const res = await fetch(MOLTSETS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ linkedin_urls: [...byLi.keys()] }),
        signal: AbortSignal.timeout(150_000),
      });
      // A 504 comes back as an HTML error page. Parsing must fail loudly here,
      // or the batch gets recorded as "nobody found" and the domains are
      // marked done having never actually been looked up.
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 150)}`);
      payload = JSON.parse(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Release the lease and let the attempt counter retire it after 3 tries.
      await supabase
        .from('lead_pool_enrich_queue')
        .update({ lease_until: null, last_error: message.slice(0, 300) })
        .in('domain', batch.map((r: { domain: string }) => r.domain));
      stoppedBecause = `lookup failed: ${message.slice(0, 120)}`;
      break;
    }

    const results = (Array.isArray(payload) ? payload : payload?.results ?? []) as Array<
      Record<string, any>
    >;
    // The envelope key differs by shape: a single lookup returns `_metadata`,
    // a BATCH returns `metadata`. Reading only `_metadata` left fair_use empty
    // on every batch, so the throttle below could never fire and the worker
    // would have run straight through the weekly budget. Accept both.
    fair = (payload as any)?.metadata?.fair_use ??
      (payload as any)?._metadata?.fair_use ?? fair;

    const verifiedRows: Record<string, unknown>[] = [];
    const personRows: Record<string, unknown>[] = [];
    const doneDomains: string[] = [];

    for (const item of results) {
      const domain = byLi.get(normalizeLi(String(item.input ?? '')));
      if (!domain) continue;
      doneDomains.push(domain);

      const data = item.data ?? null;
      if (item.status !== 'ok' || !data) {
        missed++;
        verifiedRows.push({
          domain,
          moltsets_status: 'not_found',
          moltsets_checked_at: new Date().toISOString(),
        });
        continue;
      }
      found++;
      const email = data.business_email ?? null;
      if (email) withEmail++;
      if (email && ['A', 'B'].includes(String(data.business_email_risk_score ?? ''))) usableEmail++;

      // Person-level truth, recorded whether or not it agrees with the pool.
      //
      // This is the half that was being thrown away. The pool filed this person
      // under `domain`, but the lookup says where they work NOW — and when
      // those disagree the lookup is right, because the dump is years old.
      // upsert_verified_person() also creates the company if we have not seen
      // it, so the shared layer grows past what the original dump contained.
      // Keyed by LinkedIn URL and domain respectively, so a re-lookup updates
      // in place and a company found via three different people is one row.
      const projected = buildMoltsetsPoolWriteback(
        data,
        String(item.input ?? ''),
        domain,
        new Date().toISOString(),
      );
      if (projected.movedEmployer) movedEmployer++;
      personRows.push(projected.person);
      verifiedRows.push(projected.sourceCompany);
    }

    if (verifiedRows.length) {
      // Global table: one lookup serves every org and every future list.
      const { error: upsertErr } = await supabase
        .from('lead_pool_verified')
        .upsert(verifiedRows, { onConflict: 'domain' });
      if (upsertErr) {
        return new Response(JSON.stringify({ error: `upsert: ${upsertErr.message}` }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Person rows go through an RPC rather than a bulk upsert because each one
    // may also have to create a company. One call per person is more round
    // trips, but the alternative is duplicating that conditional insert in TS
    // and racing two workers into the same new domain.
    for (const person of personRows) {
      const { error: personErr } = await supabase.rpc('upsert_verified_person', { p: person });
      if (personErr) {
        console.log('[enrich] person upsert failed', person.linkedin_url, personErr.message);
        continue;
      }
      personsWritten++;
    }

    if (doneDomains.length) {
      await supabase
        .from('lead_pool_enrich_queue')
        .update({ status: 'done', completed_at: new Date().toISOString(), lease_until: null })
        .in('domain', doneDomains);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      claimed,
      found,
      missed,
      with_email: withEmail,
      usable_email: usableEmail,
      persons_written: personsWritten,
      moved_employer: movedEmployer,
      fair_use: fair,
      stopped_because: stoppedBecause,
      elapsed_ms: Date.now() - started,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
