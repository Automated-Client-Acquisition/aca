// ============================================================================
// expand-vertical
// ----------------------------------------------------------------------------
// Translates a niche string ("HVAC", "law firms in Texas", etc.) into a
// structured query body the lead-pool-search worker can run. SIC codes are
// always validated against the SEC's official 444-code catalog — no
// hallucinations leak through, even from the LLM fallback.
//
// Endpoints:
//   GET  /              — list curated verticals (UI dropdown source)
//   POST /              — expand a vertical to a SearchBody-compatible JSON
//                         body. Pass ?dispatch=1 to ALSO forward to the
//                         lead-pool-search worker and return rows directly.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import {
  resolveVertical,
  resolvedToSearchBody,
} from '../_shared/vertical-resolver.ts';
import { VERTICAL_DEFINITIONS } from '../_shared/vertical-definitions.ts';

// LLM fallback is BYOK — users pass their own openrouter_api_key in the
// request body. We never spend operator money on third-party LLM calls.
const POOL_SEARCH_URL = (() => {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  return `${base}/functions/v1/list-building-pool-search`;
})();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- auth ---------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization' }, 401);
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid token' }, 401);
    }

    // --- GET: list curated verticals ---------------------------------------
    if (req.method === 'GET') {
      return json({
        verticals: VERTICAL_DEFINITIONS.map((v) => ({
          slug: v.slug,
          label: v.label,
          description: v.description,
        })),
      });
    }

    if (req.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }

    // --- POST: expand a niche ----------------------------------------------
    const body = await req.json() as {
      vertical?: string;       // niche name or slug, e.g. "hvac" or "find me solar installers"
      dispatch?: boolean;      // if true, run the pool-search and return rows directly
      // BYOK — caller passes their own OpenRouter key for LLM fallback when
      // the niche isn't in the curated 33-vertical library. Empty/missing
      // means LLM fallback is disabled and unknown niches return 404.
      openrouter_api_key?: string;
      // Anything else is forwarded to the worker as additional filter (employees,
      // seniority, geo, limit, etc.). The vertical fields are merged in.
      [key: string]: unknown;
    };

    const niche = String(body.vertical ?? '').trim();
    if (!niche) {
      return json({ error: 'vertical is required' }, 400);
    }

    const resolved = await resolveVertical({
      query: niche,
      llmApiKey: body.openrouter_api_key,
    });
    if (!resolved) {
      return json({
        error:
          'no static match for this niche. ' +
          'Pass `openrouter_api_key` in the request body to enable LLM fallback (BYOK), ' +
          'or pick from the curated list at GET /expand-vertical.',
      }, 404);
    }

    const queryFields = resolvedToSearchBody(resolved);

    // Merge: explicit body fields override the vertical's defaults.
    // The user's filter (employees_min, seniority_in, etc.) sits next to the
    // SIC + keyword that came from the vertical.
    const mergedQuery: Record<string, unknown> = {
      ...queryFields,
      ...Object.fromEntries(
        Object.entries(body).filter(([k]) =>
          k !== 'vertical' && k !== 'dispatch' && k !== 'openrouter_api_key'
        ),
      ),
    };

    // --- direct pass-through mode ------------------------------------------
    if (body.dispatch === true) {
      const resp = await fetch(POOL_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mergedQuery),
      });
      const poolData = await resp.json();
      return json({
        resolved,
        query: mergedQuery,
        results: poolData,
      });
    }

    // --- preview mode: just return the resolved query so caller can run it -
    return json({
      resolved,
      query: mergedQuery,
    });
  } catch (err) {
    console.error('[expand-vertical] error', err);
    return json({
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
