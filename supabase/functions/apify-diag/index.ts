/**
 * Throwaway diagnostic function.
 * POST { organization_id, actor_id, input } -> calls the Apify actor synchronously
 * and returns the raw response + status, so we can see what shape it accepts.
 *
 * Used once to figure out the SignalBase actor's input contract. Delete after.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Diagnostic that decrypts any org's Apify key: internal (service-role) calls only.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
  try {
    const { organization_id, actor_id, input } = await req.json();
    if (!organization_id || !actor_id) {
      return new Response(JSON.stringify({ error: 'organization_id and actor_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: keyRow } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organization_id)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .maybeSingle();

    if (!keyRow) {
      return new Response(JSON.stringify({ error: 'no apify key' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = await decryptApiKey(
      keyRow.key_encrypted as string,
      Deno.env.get('ENCRYPTION_KEY')!,
    );

    // 1. Get actor metadata so we can see its input schema
    const metaResp = await fetch(`https://api.apify.com/v2/acts/${actor_id}?token=${token}`);
    const meta = await metaResp.json();

    // 2. List recent runs to see what input shapes have actually worked
    const runsResp = await fetch(
      `https://api.apify.com/v2/acts/${actor_id}/runs?token=${token}&limit=5&desc=true`,
    );
    const runs = await runsResp.json();
    const recentInputs: unknown[] = [];
    for (const run of (runs?.data?.items ?? []).slice(0, 3)) {
      // Each run's input lives in its key-value store under INPUT
      try {
        const inputResp = await fetch(
          `https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT?token=${token}`,
        );
        const text = await inputResp.text();
        recentInputs.push({
          run_id: run.id,
          status: run.status,
          started_at: run.startedAt,
          stats: run.stats,
          input_raw: text.slice(0, 2000),
        });
      } catch (err) {
        recentInputs.push({ run_id: run.id, error: String(err) });
      }
    }

    // 3. If caller passed an input, attempt a sync call and surface the result
    let attempted = null;
    if (input) {
      const url = `https://api.apify.com/v2/acts/${actor_id}/run-sync-get-dataset-items?token=${token}&format=json`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const text = await resp.text();
      attempted = {
        sent_input: input,
        http_status: resp.status,
        response_preview: text.slice(0, 4000),
      };
    }

    return new Response(
      JSON.stringify(
        {
          actor_meta: {
            id: meta?.data?.id,
            name: meta?.data?.name,
            username: meta?.data?.username,
            title: meta?.data?.title,
            description: meta?.data?.description?.slice(0, 200),
            input_schema_present: !!meta?.data?.exampleRunInput,
            example_run_input: meta?.data?.exampleRunInput,
          },
          recent_runs: recentInputs,
          attempted,
        },
        null,
        2,
      ),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
