// Teardown of scraped posts → research_content.ai_analysis / analyzed_at.
// Body: { content_ids: string[] (1-10), force?: boolean }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { ensureTeardown, loadOrgFitContext, loadPosts, resolveTeardownLlm } from '../_shared/content-teardown.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: { content_ids?: string[]; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const ids = body.content_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 10) {
    return json({ error: 'content_ids must be an array of 1-10 ids' }, 400);
  }

  try {
    const posts = await loadPosts(supabase, ids);
    if (posts.length === 0) return json({ error: 'Content not found' }, 404);
    const orgIds = [...new Set(posts.map((p) => p.organization_id))];
    if (orgIds.length > 1) return json({ error: 'Posts belong to different organizations' }, 400);
    try {
      await assertOrgAccess(req, supabase, orgIds[0]);
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }

    const [llm, fitContext] = await Promise.all([resolveTeardownLlm(supabase, orgIds[0]), loadOrgFitContext(supabase, orgIds[0])]);
    const settled = await Promise.allSettled(posts.map((p) => ensureTeardown(supabase, llm, p, !!body.force, { fitContext })));

    const results = posts.map((p, i) => {
      const r = settled[i];
      return r.status === 'fulfilled'
        ? { id: p.id, analysis: r.value }
        : { id: p.id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
    });
    const failed = results.filter((r) => 'error' in r);
    if (failed.length === results.length) return json({ error: (failed[0] as { error: string }).error, results }, 502);
    return json({ results });
  } catch (err) {
    console.error('[analyze-scraped-content]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
