/**
 * Drain the bulk classification queue.
 *
 * Reading a company's own website costs nothing per domain and has no external
 * quota, so unlike the MoltSets drain this one is meant to run to exhaustion:
 * 8.1M domains at the measured ~18.6k/hour is days, not months, and the model
 * spend for the whole pool is $55-185.
 *
 * This is the layer that makes lists buildable. The pool's own columns cannot
 * be filtered on — `employees` is wrong ~71% of the time, sic_code and
 * p_industry are empty or corrupted, and a keyword match against company text
 * is ~97% noise for a targeted ICP. A page-verified category is the only
 * selective, trustworthy predicate the pool has, so coverage here is the
 * ceiling on how good any list can be.
 *
 * Delegates the actual fetching and classifying to classify-company, which
 * already handles the 4-URL retry ladder, the CSS/error-page guards, the
 * closed-enum prompt and the per-domain cache. This worker only feeds it and
 * records outcomes — including failures, so a dead domain is not retried
 * forever.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

/** classify-company's own per-request ceiling. */
const BATCH = 10;

/** Batches per tick — ONE, deliberately.
 *
 * Two constraints, and the second is the one that bites. A batch takes ~60-70s
 * against live websites, so three overran the edge function's wall clock. But
 * more importantly these ticks are invoked by pg_cron via pg_net, and pg_net
 * has a SINGLE SHARED request worker: a call that holds it for 200s delays
 * every other cron on the platform behind it. Observed here as a 34-request
 * backlog while nothing appeared to run.
 *
 * So each tick stays short and throughput comes from FREQUENCY instead. One
 * batch of 50 every 2 minutes is ~36k domains/day — the full 8.1M in about
 * nine months of idle background time, or far less when run in parallel from
 * outside pg_net. */
const BATCHES_PER_TICK = 1;

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const expected = Deno.env.get('CRON_SECRET') ?? '';

  // Three ways in, because the cron is the SLOW lane. At one batch every two
  // minutes the queue drains at ~36k domains/day — fine as background fill,
  // useless when you want the pool classified this week. An operator with a
  // valid aca_ token can therefore drive this endpoint directly and in
  // parallel, which measured ~18.6k domains/hour at 8 concurrent callers.
  //
  // Crucially that path runs OUTSIDE pg_net, whose single shared request
  // worker is what made long cron calls stall every other job on the platform.
  let authorized = auth.includes(serviceKey) || (Boolean(expected) && cronSecret === expected);
  if (!authorized) {
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    if (bearer.startsWith('aca_')) {
      // validate_api_token takes the SHA-256 HEX of the token, never the token
      // itself — the database only ever stores the hash.
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(bearer),
      );
      const tokenHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const { data: tokenRow } = await createClient(
        Deno.env.get('SUPABASE_URL')!,
        serviceKey,
      ).rpc('validate_api_token', { p_token_hash: tokenHash });
      authorized = Array.isArray(tokenRow) ? tokenRow.length > 0 : Boolean(tokenRow);
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  // The work itself stays platform-scoped whoever triggered it: results go to
  // the global lead_pool_verified, never into the caller's CRM.
  const batchesThisCall = Math.max(1, Math.min(Number(new URL(req.url).searchParams.get('batches') ?? BATCHES_PER_TICK) || BATCHES_PER_TICK, 4));

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const started = Date.now();

  let claimed = 0;
  let classified = 0;
  let unreachable = 0;
  let usable = 0;
  let stoppedBecause: string | null = null;

  for (let round = 0; round < batchesThisCall; round++) {
    const { data: batch, error: claimErr } = await supabase
      .rpc('claim_pool_classify_batch', { p_limit: BATCH, p_lease_seconds: 600 });
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
    const domains = batch.map((r: { domain: string }) => r.domain);

    let payload: Record<string, any> | null = null;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/classify-company`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ domains }),
        signal: AbortSignal.timeout(240_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 150)}`);
      payload = JSON.parse(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A provider, quota or transport failure is not evidence that any domain
      // is bad. claim_pool_classify_batch increments attempts before the call,
      // so release atomically restores that attempt. Otherwise three platform
      // failures permanently exhaust every claimed domain.
      const { error: releaseErr } = await supabase
        .rpc('release_pool_classify_batch', { p_domains: domains });
      const releaseSuffix = releaseErr ? `; queue release failed: ${releaseErr.message}` : '';
      stoppedBecause = `classify failed: ${message.slice(0, 120)}${releaseSuffix}`;
      break;
    }

    const rows: Record<string, unknown>[] = [];
    const now = new Date().toISOString();

    for (const r of (payload?.data ?? []) as Array<Record<string, any>>) {
      classified++;
      if (r.category && !['unclear', 'other'].includes(String(r.category))) usable++;
      rows.push({
        domain: String(r.domain).toLowerCase(),
        category: r.category ?? null,
        category_confidence: r.confidence ?? null,
        category_evidence: r.evidence ? String(r.evidence).slice(0, 200) : null,
        website_location: r.location ?? null,
        website_status: 'ok',
        website_checked_at: now,
      });
    }
    // Record failures too. A domain with no DNS will never resolve, and
    // re-fetching it every sweep is the difference between finishing the pool
    // and grinding on its dead 30% forever.
    for (const u of (payload?.unreachable_domains ?? []) as Array<Record<string, any>>) {
      unreachable++;
      rows.push({
        domain: String(u.domain).toLowerCase(),
        website_status: u.reason ?? 'conn_failed',
        website_checked_at: now,
      });
    }

    if (rows.length) {
      const { error: upsertErr } = await supabase
        .from('lead_pool_verified')
        .upsert(rows, { onConflict: 'domain' });
      if (upsertErr) {
        return new Response(JSON.stringify({ error: `upsert: ${upsertErr.message}` }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    await supabase
      .from('lead_pool_classify_queue')
      .update({ status: 'done', completed_at: now, lease_until: null })
      .in('domain', domains);
  }

  return new Response(
    JSON.stringify({
      success: true,
      claimed,
      classified,
      unreachable,
      usable_category: usable,
      stopped_because: stoppedBecause,
      elapsed_ms: Date.now() - started,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
