// Keep engagement numbers on scraped posts fresh.
//
// The creator/search scrapers only look forward, so a post's likes/views freeze
// the day it is first scraped. This re-reads only the posts still worth
// watching (see research_refresh_candidates: recent or outlier, on a decaying
// schedule), by URL, on each org's own Apify key.
//
// Runs hourly via pg_cron with the service-role key. Apify runs are async: each
// tick first ingests the runs the previous tick started, then starts new ones,
// so no public webhook is needed. Only `engagement` (plus metrics_checked_at) is
// written; the research_content_capture_metrics trigger snapshots every change,
// which is what feeds the "rising" / growth_7d signal.
//
// Body (all optional): { organizationId, dryRun }. dryRun lists what would be
// refreshed without starting any run.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { transformContentItem } from '../_shared/research-content-transform.ts';

// Same actors trigger-scrape uses for these platforms, so the output shape
// matches transformContentItem. TikTok/Instagram are not refreshed (no live
// creators, and their post-URL inputs differ). Verified against the live actors:
//  - youtube: any number of video URLs per run.
//  - linkedin: needs `feed/update/urn:li:<activity|ugcPost>:<id>` URLs (the stored
//    share links return nothing) and deepScrape on (else no counts).
//  - twitter: apidojo returns NOTHING when startUrls holds more than one tweet, so
//    it runs one tweet per run (small memory keeps the parallel runs cheap).
const ACTORS: Record<string, {
  id: string;
  batchSize: number;
  maxPerTick: number;
  memoryMb?: number;
  toInputUrl: (stored: string) => string | null;
  input: (urls: string[]) => Record<string, unknown>;
}> = {
  youtube: {
    id: 'streamers~youtube-scraper',
    batchSize: 40,
    maxPerTick: 120,
    toInputUrl: (u) => u,
    input: (urls) => ({
      startUrls: urls.map((url) => ({ url })),
      maxResults: urls.length,
      maxResultsShorts: urls.length,
      downloadSubtitles: false,
      saveSubsToKVS: false,
    }),
  },
  twitter: {
    id: 'apidojo~tweet-scraper',
    batchSize: 1,
    // Each tweet is its own Apify run and the account allows 32 concurrent runs in total,
    // so keep well under it (steady-state demand is ~6 tweets/hour; a backlog drains over a few ticks).
    maxPerTick: 20,
    memoryMb: 128,
    toInputUrl: (u) => u,
    input: (urls) => ({ startUrls: urls, maxItems: urls.length }),
  },
  linkedin: {
    id: 'supreme_coder~linkedin-post',
    batchSize: 30,
    maxPerTick: 120,
    toInputUrl: (u) => {
      const activity = u.match(/activity[-:](\d{10,})/)?.[1];
      if (activity) return `https://www.linkedin.com/feed/update/urn:li:activity:${activity}`;
      const ugc = u.match(/ugcPost[-:](\d{10,})/)?.[1];
      return ugc ? `https://www.linkedin.com/feed/update/urn:li:ugcPost:${ugc}` : null;
    },
    input: (urls) => ({ urls, limitPerSource: 1, deepScrape: true, numComments: 0, numLikes: 0 }),
  },
};

const START_CONCURRENCY = 10; // Apify runs started at once
const CANDIDATES_PER_ORG = 200; // fetched per tick; each platform is further capped by maxPerTick
const STUCK_AFTER_MS = 2 * 3600_000;
const COUNT_KEYS = ['viewCount', 'likeCount', 'commentCount', 'shareCount'] as const;

type Engagement = Record<string, number | undefined>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** One comparable key per post, so scraped URL variants (x.com vs twitter.com, share params) still match. */
function urlKey(platform: string, raw: string | null | undefined): string {
  if (!raw) return '';
  const url = String(raw).trim();
  if (platform === 'twitter') {
    const id = url.match(/status(?:es)?\/(\d+)/)?.[1];
    if (id) return `tw:${id}`;
  } else if (platform === 'youtube') {
    const id = url.match(/[?&]v=([\w-]{6,})/)?.[1] || url.match(/(?:youtu\.be|shorts|embed)\/([\w-]{6,})/)?.[1];
    if (id) return `yt:${id}`;
  } else if (platform === 'linkedin') {
    const id = url.match(/activity[-:](\d{10,})/)?.[1] || url.match(/ugcPost[-:](\d{10,})/)?.[1];
    if (id) return `li:${id}`;
  }
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Take the fresh number per counter, but never let a missing/zero value from a
 * partial scrape wipe a real one already stored.
 */
function mergeEngagement(old: Engagement | null, fresh: Engagement | null): Engagement {
  const merged: Engagement = { ...(old || {}) };
  for (const key of COUNT_KEYS) {
    const next = num(fresh?.[key]);
    const prev = num(old?.[key]);
    if (next !== null && (next > 0 || !prev)) merged[key] = next;
  }
  return merged;
}

const engagementChanged = (a: Engagement | null, b: Engagement) =>
  COUNT_KEYS.some((k) => (num(a?.[k]) ?? 0) !== (num(b[k]) ?? 0));

async function apify(token: string, path: string, init?: RequestInit) {
  return fetch(`https://api.apify.com/v2${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });
}

async function orgApifyToken(supabase: any, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', orgId)
    .eq('provider', 'apify')
    .eq('is_valid', true)
    .maybeSingle();
  if (!data?.key_encrypted) return null;
  try {
    return await decryptApiKey(data.key_encrypted, Deno.env.get('ENCRYPTION_KEY')!);
  } catch {
    return null;
  }
}

async function failRun(supabase: any, runId: string, message: string, contentIds: string[]) {
  // Stamp the posts anyway so a bad URL / dead actor doesn't get retried every hour.
  await supabase.from('research_metrics_refresh_runs').update({
    status: 'FAILED', error_message: message.slice(0, 500), completed_at: new Date().toISOString(),
  }).eq('id', runId);
  await markChecked(supabase, contentIds);
}

async function markChecked(supabase: any, ids: string[]) {
  if (ids.length === 0) return;
  await supabase.from('research_content').update({ metrics_checked_at: new Date().toISOString() }).in('id', ids);
}

/** Pull the results of runs started by earlier ticks into research_content. */
async function ingestFinishedRuns(supabase: any, orgFilter: string | null, tokens: Map<string, string | null>) {
  let q = supabase.from('research_metrics_refresh_runs').select('*').eq('status', 'RUNNING');
  if (orgFilter) q = q.eq('organization_id', orgFilter);
  const { data: runs } = await q;
  const out = { checked: 0, ingested: 0, updated: 0, failed: 0, stillRunning: 0 };
  const stillRunningIds = new Set<string>();

  for (const run of runs || []) {
    out.checked++;
    if (!tokens.has(run.organization_id)) tokens.set(run.organization_id, await orgApifyToken(supabase, run.organization_id));
    const token = tokens.get(run.organization_id);
    if (!token) { await failRun(supabase, run.id, 'Apify key missing or invalid', run.content_ids); out.failed++; continue; }

    const statusRes = await apify(token, `/actor-runs/${run.apify_run_id}`);
    if (!statusRes.ok) {
      if (Date.now() - new Date(run.created_at).getTime() > STUCK_AFTER_MS) { await failRun(supabase, run.id, `run lookup ${statusRes.status}`, run.content_ids); out.failed++; }
      else { out.stillRunning++; (run.content_ids as string[]).forEach((id) => stillRunningIds.add(id)); }
      continue;
    }
    const info = (await statusRes.json()).data;

    if (info.status === 'RUNNING' || info.status === 'READY') {
      if (Date.now() - new Date(run.created_at).getTime() > STUCK_AFTER_MS) {
        await failRun(supabase, run.id, 'stuck: no result after 2h', run.content_ids); out.failed++;
      } else { out.stillRunning++; (run.content_ids as string[]).forEach((id) => stillRunningIds.add(id)); }
      continue;
    }
    if (info.status !== 'SUCCEEDED') { await failRun(supabase, run.id, `apify run ${info.status}`, run.content_ids); out.failed++; continue; }

    const itemsRes = await apify(token, `/datasets/${info.defaultDatasetId}/items?clean=true&limit=1000`);
    if (!itemsRes.ok) { await failRun(supabase, run.id, `dataset ${itemsRes.status}`, run.content_ids); out.failed++; continue; }
    const items: any[] = await itemsRes.json();

    const { data: rows } = await supabase
      .from('research_content').select('id, url, engagement').in('id', run.content_ids);
    const byKey = new Map<string, { id: string; engagement: Engagement | null }>();
    for (const r of rows || []) byKey.set(urlKey(run.platform, r.url), r);

    const now = new Date().toISOString();
    const seen = new Set<string>();
    const writes: Array<{ id: string; engagement?: Engagement }> = [];
    for (const item of items) {
      if (!item || item.error) continue;
      const t = transformContentItem(item, run.platform, run.apify_run_id, run.organization_id, null, null) as any;
      // inputUrl = the URL we asked for. LinkedIn's returned `url` can be the activity twin of
      // a ugcPost we requested, so trust inputUrl first.
      const hit = byKey.get(urlKey(run.platform, item.inputUrl)) || byKey.get(urlKey(run.platform, t.url));
      if (!hit || seen.has(hit.id)) continue;
      seen.add(hit.id);
      const merged = mergeEngagement(hit.engagement, t.engagement);
      writes.push(engagementChanged(hit.engagement, merged) ? { id: hit.id, engagement: merged } : { id: hit.id });
    }

    // Changed engagement gets its own update (fires the snapshot trigger); the rest just get stamped.
    let updated = 0;
    const changed = writes.filter((w) => w.engagement);
    for (let i = 0; i < changed.length; i += 10) {
      await Promise.all(changed.slice(i, i + 10).map(async (w) => {
        const { error } = await supabase.from('research_content')
          .update({ engagement: w.engagement, metrics_checked_at: now }).eq('id', w.id);
        if (!error) updated++;
      }));
    }
    // Everything requested but unchanged / not returned (deleted posts) is stamped too.
    const changedIds = new Set(changed.map((w) => w.id));
    await markChecked(supabase, (run.content_ids as string[]).filter((id) => !changedIds.has(id)));

    await supabase.from('research_metrics_refresh_runs').update({
      status: 'SUCCEEDED', items_returned: items.length, items_updated: updated, completed_at: now,
    }).eq('id', run.id);
    out.ingested++;
    out.updated += updated;
  }
  return { ...out, stillRunningIds };
}

Deno.serve(async (req) => {
  if (!isServiceRoleRequest(req)) return json({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const orgFilter: string | null = body.organizationId ?? null;
  const dryRun = body.dryRun === true;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const tokens = new Map<string, string | null>();

  const ingest = dryRun ? null : await ingestFinishedRuns(supabase, orgFilter, tokens);
  const inFlight = ingest?.stillRunningIds ?? new Set<string>();

  let orgIds: string[];
  if (orgFilter) {
    orgIds = [orgFilter];
  } else {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('research_content').select('organization_id').gte('published_at', since).limit(5000);
    if (error) return json({ error: error.message }, 500);
    orgIds = [...new Set((data || []).map((r: { organization_id: string }) => r.organization_id))];
  }

  const started: Record<string, unknown> = {};
  for (const orgId of orgIds) {
    if (!tokens.has(orgId)) tokens.set(orgId, await orgApifyToken(supabase, orgId));
    const token = tokens.get(orgId);
    if (!token) continue;

    const { data: candidates, error } = await supabase.rpc('research_refresh_candidates', {
      p_org: orgId, p_limit: CANDIDATES_PER_ORG,
    });
    if (error) { started[orgId] = `rpc error: ${error.message}`; continue; }

    const due = (candidates || []).filter((c: { id: string }) => !inFlight.has(c.id));
    const byPlatform = new Map<string, Array<{ id: string; url: string }>>();
    for (const c of due) {
      if (!ACTORS[c.platform]) continue;
      if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, []);
      byPlatform.get(c.platform)!.push(c);
    }
    if (byPlatform.size === 0) continue;

    if (dryRun) {
      started[orgId] = Object.fromEntries([...byPlatform].map(([p, list]) => [p, list.length]));
      continue;
    }

    const runsStarted: Record<string, number | string> = {};
    const jobs: Array<{ platform: string; batch: Array<{ id: string; url: string; inputUrl: string }> }> = [];
    for (const [platform, list] of byPlatform) {
      const actor = ACTORS[platform];
      const usable: Array<{ id: string; url: string; inputUrl: string }> = [];
      const unusable: string[] = [];
      for (const c of list.slice(0, actor.maxPerTick)) {
        const inputUrl = actor.toInputUrl(c.url);
        if (inputUrl) usable.push({ ...c, inputUrl }); else unusable.push(c.id);
      }
      await markChecked(supabase, unusable); // no scrapeable URL (e.g. pasted text): don't retry hourly
      for (let i = 0; i < usable.length; i += actor.batchSize) {
        jobs.push({ platform, batch: usable.slice(i, i + actor.batchSize) });
      }
    }

    // One-run-per-item Twitter jobs go last so they can't crowd out the batched platforms.
    jobs.sort((a, b) => ACTORS[b.platform].batchSize - ACTORS[a.platform].batchSize);

    let authFailed = false;
    for (let i = 0; i < jobs.length && !authFailed; i += START_CONCURRENCY) {
      await Promise.all(jobs.slice(i, i + START_CONCURRENCY).map(async ({ platform, batch }) => {
        const actor = ACTORS[platform];
        const query = actor.memoryMb ? `?memory=${actor.memoryMb}` : '';
        const res = await apify(token, `/acts/${actor.id}/runs${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(actor.input(batch.map((b) => b.inputUrl))),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          console.error(`[refresh-content-metrics] ${platform} start failed`, res.status, detail);
          runsStarted[`${platform}_error`] = `${res.status} ${detail}`;
          // Bad/expired key, spent monthly cap (403) or concurrent-run cap (402): stop this org.
          // Posts stay unstamped and retry next hour.
          if (res.status === 401 || res.status === 402 || res.status === 403) authFailed = true;
          return;
        }
        const run = (await res.json()).data;
        await supabase.from('research_metrics_refresh_runs').insert({
          organization_id: orgId, platform, apify_run_id: run.id, dataset_id: run.defaultDatasetId,
          content_ids: batch.map((b) => b.id),
        });
        runsStarted[platform] = ((runsStarted[platform] as number) || 0) + batch.length;
      }));
    }
    started[orgId] = runsStarted;
  }

  const { stillRunningIds: _omit, ...ingestSummary } = ingest ?? ({} as any);
  return json({ dryRun, ingest: ingest ? ingestSummary : null, started });
});
