// ============================================================================
// list-building-pool-search
// ----------------------------------------------------------------------------
// JWT-authenticated proxy in front of the Fly query worker
// (aca-lead-pool-query.fly.dev). Edge function is the only thing holding the
// HMAC signing secret, so the worker's public endpoint is effectively
// scoped to Supabase-authenticated callers.
//
// Body shape:
//   {
//     mode?: 'search' | 'domain-probe',
//     industry_pattern?: string,
//     industry_exact?: string,
//     p_bucket?: string,
//     state?: string,
//     employees_min?: number,
//     employees_max?: number,
//     seniority_in?: string[],
//     has_linkedin?: boolean,
//     has_phone?: boolean,
//     email_status?: string,
//     limit?: number,   offset?: number,
//     dedup_by_email?: boolean,
//     domains?: string[]           // only for mode='domain-probe'
//   }
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { poolQueryWorkerUrl } from "../_shared/site-config.ts";

const WORKER_HMAC_SECRET = Deno.env.get('POOL_QUERY_WORKER_SECRET');

async function signBody(body: Uint8Array): Promise<string> {
  if (!WORKER_HMAC_SECRET) throw new Error('POOL_QUERY_WORKER_SECRET not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WORKER_HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, body);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // --- auth --------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization' }, 401);
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid token' }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: orgRows } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id);
    const orgIds = (orgRows as Array<{ organization_id: string }> | null)
      ?.map((r) => r.organization_id) ?? [];
    if (orgIds.length === 0) {
      return json({ error: 'No organization membership' }, 403);
    }

    // --- parse & validate body --------------------------------------------
    const body = await req.json() as {
      mode?:
        | 'search'
        | 'count'
        | 'domain-probe'
        | 'cursor-start'
        | 'cursor-fetch'
        | 'cursor-end';
      keyword?: string;
      country?: string;
      city?: string;
      industry_pattern?: string;
      industry_exact?: string;
      p_bucket?: string;
      sic_code_in?: string[];
      match_combinator?: 'and' | 'or';
      skip_count?: boolean;
      state?: string;
      employees_min?: number;
      employees_max?: number;
      seniority_in?: string[];
      has_linkedin?: boolean;
      has_phone?: boolean;
      email_status?: string;
      limit?: number;
      offset?: number;
      dedup_by_email?: boolean;
      domains?: string[];
      // Cursor fields
      cursor_id?: string;
      cursor_ttl_ms?: number;
    };

    const mode = body.mode ?? 'search';
    const validModes = ['search', 'count', 'domain-probe', 'cursor-start', 'cursor-fetch', 'cursor-end'];
    if (!validModes.includes(mode)) {
      return json({ error: 'invalid mode' }, 400);
    }

    // --- hard limits to stop a rogue caller from trashing the worker -------
    if (mode === 'search' || mode === 'count' || mode === 'cursor-start') {
      if (mode === 'search') {
        // 100k safety cap. Real UIs paginate (limit=50, offset=N); the only
        // caller that goes higher is the export streamer, which loops in
        // chunks of 1000.
        body.limit = Math.min(Math.max(body.limit ?? 1000, 1), 100_000);
        body.offset = Math.max(body.offset ?? 0, 0);
      }
      // Selectivity guard: same tiers for /search, /count, and cursor-start.
      // A completely unfiltered query would scan all 123M rows. cursor-fetch
      // and cursor-end address an existing cursor by id, so they don't need it.
      const hasIndustryFilter = Boolean(
        body.industry_pattern ||
          body.industry_exact ||
          body.p_bucket ||
          (body.sic_code_in && body.sic_code_in.length > 0),
      );
      const hasKeyword = typeof body.keyword === 'string' && body.keyword.trim().length >= 2;
      // `state` only. `country` has no column in the pool, so it was dropped by
      // the worker while still counting as a geographic bound here — a filter
      // of {country, employees_min} passed this guard and then ran worldwide.
      const hasGeoEmpBound =
        Boolean(body.state) && typeof body.employees_min === 'number';
      if (body.country) {
        return json({
          error:
            'country is not a supported filter — the pool has no country column, so it would match ' +
            "every row regardless of geography. Use state (US 2-letter code, e.g. 'TX') or city.",
        }, 400);
      }
      if (!hasIndustryFilter && !hasKeyword && !hasGeoEmpBound) {
        return json({
          error:
            'require at least one of industry_pattern, industry_exact, p_bucket, sic_code_in, keyword (>=2 chars), or (state + employees_min)',
        }, 400);
      }
    } else if (mode === 'cursor-fetch' || mode === 'cursor-end') {
      // Cursor fetch/end only need a cursor_id. The worker validates the
      // format; we just check presence here so we 400 fast.
      if (!body.cursor_id || typeof body.cursor_id !== 'string') {
        return json({ error: 'cursor_id required' }, 400);
      }
      if (mode === 'cursor-fetch') {
        body.limit = Math.min(Math.max(body.limit ?? 1000, 1), 10_000);
        body.offset = Math.max(body.offset ?? 0, 0);
      }
    } else {
      // domain-probe
      if (!Array.isArray(body.domains) || body.domains.length === 0) {
        return json({ error: 'domains[] required for domain-probe' }, 400);
      }
      if (body.domains.length > 5000) {
        return json({ error: 'max 5000 domains per probe' }, 400);
      }
    }

    // --- sign + forward to worker -----------------------------------------
    const rawBody = new TextEncoder().encode(JSON.stringify(body));
    const signature = await signBody(rawBody);
    const path =
      mode === 'search'        ? '/search'
      : mode === 'count'         ? '/count'
      : mode === 'cursor-start'  ? '/search/cursor/start'
      : mode === 'cursor-fetch'  ? '/search/cursor/fetch'
      : mode === 'cursor-end'    ? '/search/cursor/end'
      :                            '/domain-probe';

    const started = Date.now();
    const resp = await fetch(`${poolQueryWorkerUrl()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signature,
      },
      body: rawBody,
    });
    const workerElapsed = Date.now() - started;

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[pool-search] worker returned', resp.status, text.slice(0, 500));
      return json({
        error: 'worker error',
        status: resp.status,
        detail: text.slice(0, 500),
      }, 502);
    }

    const data = await resp.json();

    // Fire-and-forget audit log. Lets us see search volume + latency per org.
    // Non-blocking; any write failure here is swallowed.
    supabase.from('list_building_pool_search_log').insert({
      user_id: userData.user.id,
      organization_id: orgIds[0],
      mode,
      query: body,
      result_count: Array.isArray(data.rows) ? data.rows.length : 0,
      worker_elapsed_ms: workerElapsed,
    }).then(() => {}, () => {});

    return json(data);
  } catch (err) {
    console.error('[pool-search] fatal', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
