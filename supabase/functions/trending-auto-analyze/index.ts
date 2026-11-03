// Analyze each org's top new outliers (get_trending_content) so the Trending
// tab has formulas, fit scores and themes without anyone clicking Analyze.
//
// Quota: DAILY_QUOTA teardowns per org per UTC day (counted from
// ai_analysis._meta.auto), each one a quality-model call on the org's own LLM
// key. Runs hourly via pg_cron with the service-role key; every run tops orgs
// up toward the quota and stops starting new work before the edge time limit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { ensureTeardown, loadOrgFitContext, loadPosts, resolveTeardownLlm } from '../_shared/content-teardown.ts';

const DAILY_QUOTA = 10;
const LOOKBACK_DAYS = 14;
const CONCURRENCY = 3;
const TIME_BUDGET_MS = 100_000;

// Billing / rate-limit / provider outages: stop this org's run and retry next hour.
// Anything else (e.g. unparseable model output) is recorded so it isn't retried forever.
const RETRYABLE = /API error (402|408|429|5\d\d)|timeout|aborted|fetch failed|network/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (!isServiceRoleRequest(req)) return json({ error: 'Forbidden' }, 403);

  const started = Date.now();
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: recent, error } = await supabase
    .from('research_content')
    .select('organization_id')
    .eq('source', 'scrape')
    .gte('created_at', since)
    .limit(5000);
  if (error) return json({ error: error.message }, 500);
  const orgIds = [...new Set((recent || []).map((r) => r.organization_id as string))];

  const todayUtc = new Date().toISOString().slice(0, 10);
  const summary: Record<string, unknown> = {};

  for (const orgId of orgIds) {
    if (outOfTime()) break;

    const { count: doneToday } = await supabase
      .from('research_content')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('analyzed_at', `${todayUtc}T00:00:00Z`)
      .eq('ai_analysis->_meta->>auto', 'true');
    const remaining = DAILY_QUOTA - (doneToday || 0);
    if (remaining <= 0) {
      summary[orgId] = 'quota reached';
      continue;
    }

    let llm;
    try {
      llm = await resolveTeardownLlm(supabase, orgId);
    } catch {
      summary[orgId] = 'no LLM key';
      continue;
    }

    const { data: trending, error: rpcError } = await supabase.rpc('get_trending_content', {
      p_org: orgId,
      p_days: LOOKBACK_DAYS,
      p_min_ratio: 2,
      p_limit: remaining,
      p_only_unanalyzed: true,
    });
    if (rpcError) {
      summary[orgId] = `rpc error: ${rpcError.message}`;
      continue;
    }
    const ids = (trending || []).map((t: { id: string }) => t.id);
    if (ids.length === 0) {
      summary[orgId] = 'nothing new';
      continue;
    }

    const [posts, fitContext] = await Promise.all([loadPosts(supabase, ids), loadOrgFitContext(supabase, orgId)]);
    let analyzed = 0;
    let failed = 0;
    let stopReason: string | null = null;
    const queue = [...posts];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let post = queue.shift(); post && !outOfTime() && !stopReason; post = queue.shift()) {
          try {
            await ensureTeardown(supabase, llm, post, false, { fitContext, auto: true });
            analyzed++;
          } catch (err) {
            failed++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[trending-auto-analyze] ${orgId}/${post.id}:`, message);
            if (RETRYABLE.test(message)) {
              stopReason = message.slice(0, 200); // e.g. out of OpenRouter credits
              continue;
            }
            // Mark as attempted so the hourly run doesn't retry it forever. No _meta,
            // so the UI still treats it as unanalyzed and Analyze can retry manually.
            await supabase
              .from('research_content')
              .update({ analyzed_at: new Date().toISOString(), ai_analysis: { _auto_error: message.slice(0, 300) } })
              .eq('id', post.id)
              .is('analyzed_at', null);
          }
        }
      }),
    );
    summary[orgId] = stopReason ? { analyzed, failed, stopped: stopReason } : { analyzed, failed };
  }

  console.log('[trending-auto-analyze]', JSON.stringify(summary));
  return json({ orgs: orgIds.length, summary, ms: Date.now() - started });
});
