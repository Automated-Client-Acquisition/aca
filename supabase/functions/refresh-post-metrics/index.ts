/**
 * Engagement stats for posts the Scheduler published through the org's own Zernio key.
 *
 * Each run:
 *  1. adds a social_post_metrics row for every Zernio post published in the last 30 days
 *     that has none yet (the platform post id comes from the row publish-to-zernio wrote);
 *  2. reads the stats that are due from Zernio (GET /v1/analytics) and writes them, plus a
 *     snapshot when anything changed. See nextMetricsFetch for the schedule.
 *
 * POST { organization_id?, queue_ids?: string[] }
 *  - service role (pg_cron every 15 min): every org.
 *  - a member of the org: that org only; with queue_ids, reads those posts now (the
 *    Scheduler's "Refresh" button), whatever their schedule says.
 * → { success, discovered, refreshed, results: [{ queue_id, status }] }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { fetchZernioPostAnalytics, findZernioPostId, parseZernioDestination, ZernioError, type ZernioAnalyticsResult } from '../_shared/zernio.ts';
import { nextMetricsFetch, type MetricsState } from '../_shared/post-metrics.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_DAYS = 30;
/** Rows read per run; at ~1 s per Zernio call this stays well inside the function's time limit. */
const BATCH = 60;
const METRICS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'views', 'clicks'] as const;

type MetricRow = {
  id: string;
  organization_id: string;
  queue_id: string;
  account_id: string;
  platform_post_id: string | null;
  provider_post_id: string | null;
  published_at: string | null;
  [key: string]: unknown;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
  } catch { /* empty body is fine for the cron */ }

  const orgId = typeof body.organization_id === 'string' && UUID.test(body.organization_id) ? body.organization_id : null;
  const queueIds = (Array.isArray(body.queue_ids) ? body.queue_ids : [])
    .filter((id): id is string => typeof id === 'string' && UUID.test(id))
    .slice(0, 25);
  const service = isServiceRoleRequest(req);
  if (!service) {
    if (!orgId) return json({ success: false, error: 'organization_id is required' }, 400);
    try {
      await assertOrgAccess(req, supabase, orgId);
    } catch (authError) {
      return unauthorized(authError, corsHeaders);
    }
  }

  try {
    const discovered = await discover(supabase, orgId);

    let query = supabase.from('social_post_metrics').select('*');
    if (orgId) query = query.eq('organization_id', orgId);
    query = queueIds.length
      ? query.in('queue_id', queueIds)
      : query.lte('next_fetch_at', new Date().toISOString()).order('next_fetch_at', { ascending: true }).limit(BATCH);
    const { data: due, error: dueError } = await query;
    if (dueError) throw dueError;

    const byOrg = new Map<string, MetricRow[]>();
    for (const row of (due ?? []) as MetricRow[]) byOrg.set(row.organization_id, [...(byOrg.get(row.organization_id) ?? []), row]);

    const results: Array<{ queue_id: string; status: MetricsState | 'skipped' }> = [];
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    for (const [org, rows] of byOrg) {
      const stored = await resolveApiKey(supabase, org, 'zernio');
      if (!stored || !encryptionKey) {
        for (const row of rows) {
          await save(supabase, row, { state: 'error', message: 'No Zernio API key. Add it in Settings › API keys.' });
          results.push({ queue_id: row.queue_id, status: 'error' });
        }
        continue;
      }
      const apiKey = await decryptApiKey(stored.key_encrypted, encryptionKey);
      for (const row of rows) {
        const accountId = parseZernioDestination(row.account_id);
        const publishedAt = row.published_at ? new Date(row.published_at) : new Date();
        let result: ZernioAnalyticsResult;
        try {
          // Zernio's own id first (found once, then kept): look-ups by the platform's id can
          // 404 until Zernio has synced the account.
          let postId = row.provider_post_id as string | null;
          if (!postId && accountId) {
            postId = await findZernioPostId(apiKey, { accountId, queueId: row.queue_id, platformPostId: row.platform_post_id, publishedAt });
            if (postId) {
              await supabase.from('social_post_metrics').update({ provider_post_id: postId }).eq('id', row.id);
              row.provider_post_id = postId;
            }
          }
          postId = postId || row.platform_post_id;
          if (!accountId || !postId) {
            await save(supabase, row, { state: 'unavailable', message: 'ACA has no post id for this post, so its stats cannot be read.' }, true);
            results.push({ queue_id: row.queue_id, status: 'unavailable' });
            continue;
          }
          result = await fetchZernioPostAnalytics(apiKey, postId, accountId);
          // A fresh post Zernio hasn't synced yet reads as "not found": keep checking for two days.
          if (result.state === 'unavailable' && Date.now() - publishedAt.getTime() < 48 * 3600_000) {
            result = { state: 'pending', stats: null, postUrl: null, message: 'Zernio has not synced this post yet.' };
          }
        } catch (error) {
          // Rate limit or Zernio down: leave this org's rows due and try again next run.
          console.warn(`[refresh-post-metrics] org ${org}: ${error instanceof ZernioError ? `${error.status} ${error.message}` : 'Zernio unreachable'}`);
          for (const r of rows.slice(rows.indexOf(row))) results.push({ queue_id: r.queue_id, status: 'skipped' });
          break;
        }
        await save(supabase, row, result);
        results.push({ queue_id: row.queue_id, status: result.state });
      }
    }

    return json({ success: true, discovered, refreshed: results.filter((r) => r.status !== 'skipped').length, results });
  } catch (error) {
    // Never log the request: it carries the caller's token.
    console.error('[refresh-post-metrics]', error instanceof Error ? error.message : error);
    return json({ success: false, error: error instanceof Error ? error.message : 'Could not refresh post stats' }, 500);
  }
});

/** A metrics row for each recent Zernio post that has none yet. */
async function discover(supabase: any, orgId: string | null): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  let query = supabase.from('publish_queue')
    .select('id, organization_id, output_id, account_id, platform, published_at')
    .eq('status', 'published')
    .like('account_id', 'zernio:%')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(500);
  if (orgId) query = query.eq('organization_id', orgId);
  const { data: published, error } = await query;
  if (error) throw error;
  if (!published?.length) return 0;

  const { data: known } = await supabase.from('social_post_metrics').select('queue_id').in('queue_id', published.map((r: any) => r.id));
  const have = new Set((known ?? []).map((r: any) => r.queue_id));
  const missing = published.filter((r: any) => !have.has(r.id) && r.organization_id);
  if (!missing.length) return 0;

  // publish-to-zernio records the platform's post id (or Zernio's, while media was processing).
  const { data: tracked } = await supabase.from('ghl_published_posts')
    .select('content_output_id, platform_account_id, ghl_post_id, published_at')
    .in('content_output_id', [...new Set(missing.map((r: any) => r.output_id))])
    .like('platform_account_id', 'zernio:%')
    .not('ghl_post_id', 'is', null);
  const postIdFor = (row: any): string | null => {
    const at = new Date(row.published_at).getTime();
    const candidates = (tracked ?? [])
      .filter((t: any) => t.content_output_id === row.output_id && t.platform_account_id === row.account_id)
      .sort((a: any, b: any) => Math.abs(new Date(a.published_at).getTime() - at) - Math.abs(new Date(b.published_at).getTime() - at));
    return candidates[0]?.ghl_post_id ?? null;
  };

  const { error: insertError } = await supabase.from('social_post_metrics').upsert(
    missing.map((r: any) => ({
      organization_id: r.organization_id,
      queue_id: r.id,
      output_id: r.output_id,
      account_id: r.account_id,
      platform: r.platform,
      provider: 'zernio',
      platform_post_id: postIdFor(r),
      published_at: r.published_at,
      status: 'pending',
      next_fetch_at: new Date().toISOString(),
    })),
    { onConflict: 'queue_id', ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
  return missing.length;
}

/** Writes one read: the numbers when there are any, the state, and when to look again. */
async function save(supabase: any, row: MetricRow, result: ZernioAnalyticsResult, final = false): Promise<void> {
  const now = new Date();
  const publishedAt = row.published_at ? new Date(row.published_at) : null;
  const next = final ? null : nextMetricsFetch(publishedAt, result.state, now);
  const stats = 'stats' in result ? result.stats : null;
  const patch: Record<string, unknown> = {
    status: result.state,
    last_error: result.state === 'synced' ? null : result.message,
    fetched_at: now.toISOString(),
    next_fetch_at: next?.toISOString() ?? null,
    updated_at: now.toISOString(),
  };
  if ('postUrl' in result && result.postUrl) patch.post_url = result.postUrl;
  // While Zernio syncs it answers with zeros: keep a pending read only when it has real
  // numbers, so a re-sync never wipes counts already stored.
  const usable = stats && (result.state === 'synced' || METRICS.some((k) => stats[k] > 0)) ? stats : null;
  if (usable) {
    for (const k of METRICS) patch[k] = usable[k];
    patch.engagement_rate = usable.engagementRate;
    patch.extra = usable.extra;
  }
  const { error } = await supabase.from('social_post_metrics').update(patch).eq('id', row.id);
  if (error) throw error;

  // Keep a reading whenever a number moved, for the growth line.
  if (usable && METRICS.some((k) => row[k] !== usable[k])) {
    await supabase.from('social_post_metric_snapshots').insert({
      metric_id: row.id,
      organization_id: row.organization_id,
      captured_at: now.toISOString(),
      ...Object.fromEntries(METRICS.map((k) => [k, usable[k]])),
      engagement_rate: usable.engagementRate,
    });
  }
}
