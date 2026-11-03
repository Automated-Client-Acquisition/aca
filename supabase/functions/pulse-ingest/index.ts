// Signals: every 30 min, pull new posts from the X accounts each opted-in org follows
// (Apify, org key), detect stories (official launch posts + names several insiders
// pick up within 3h, see _shared/pulse-stories.ts), and have the LLM write each
// story's headline, summary, post angle and fit, dropping anything not actionable.
//
// Auth: service role (cron, all enabled orgs) or a member JWT with
// { organization_id } ("Scan now" in the UI, that org only, min 5 min apart).
// Service role only: { import_datasets: [apifyDatasetId] } loads tweets from existing
// Apify datasets (e.g. a backfill) instead of fetching.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey, llmChatCompletion } from '../_shared/llm-client.ts';
import { DEFAULT_INSIDER_ACCOUNTS, DEFAULT_OFFICIAL_ACCOUNTS, normalizeHandle, REPOST_RE } from '../_shared/pulse-accounts.ts';
import { buildDetector, detectConsensus, detectLaunches, refreshStory, type Story, type StoryPost } from '../_shared/pulse-stories.ts';
import { loadOrgFitContext, parseJsonObject, resolveTeardownLlm } from '../_shared/content-teardown.ts';
import { DEFAULT_FREE_TEXT_MODEL } from '../_shared/default-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const HOUR = 3_600_000;
const HANDLES_PER_QUERY = 12; // X search drops results from long OR chains; small groups stay complete
const FETCH_CONCURRENCY = 5;
const BACKFILL_HOURS = 72; // first scan: enough history for the 72h baselines
const DETECT_BACKFILL_HOURS = 48;
const MAX_JUDGED_PER_RUN = 10;
const STARTED = { at: Date.now() };
// edge functions stop at 150s: leave the LLM loop in time to save state; the rest is judged next scan
const JUDGE_DEADLINE_MS = 110_000;

interface PulseSettings {
  organization_id: string;
  enabled: boolean;
  official_accounts: string[];
  insider_accounts: string[];
  min_accounts: number;
  last_run_at: string | null;
  last_fetch_at: string | null;
  last_detect_at: string | null;
}

interface Item {
  source: 'x';
  external_id: string;
  url: string | null;
  title: null;
  body: string;
  author: string;
  author_audience: number | null;
  published_at: string;
  bucket_at: string;
  engagement: Record<string, number>;
  score: number;
  query: 'accounts';
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

// ── Fetch ──────────────────────────────────────────────────────────────────

function toItem(t: any): Item | null {
  if (!t?.id || t.noResults || t.isReply || !t.author?.userName) return null;
  const published = new Date(t.createdAt);
  if (Number.isNaN(published.getTime())) return null;
  const author = String(t.author.userName).toLowerCase();
  // A repost is the account picking a story up (many lab and investor accounts mostly
  // repost), so it counts toward consensus; the launch lane skips it (REPOST_RE).
  // Body and engagement come from the reposted post: the RT wrapper's text is truncated.
  const rt = t.isRetweet ? t.retweet : null;
  if (t.isRetweet) {
    const origAuthor = rt?.author?.userName;
    if (!rt?.id || !origAuthor || String(origAuthor).toLowerCase() === author) return null; // self-reposts repeat the original
  }
  const post = rt || t;
  // either field can be the cut-off one (long posts: fullText; the RT wrapper: both): keep the longer
  const longer = (a?: string, b?: string) => ((a || '').length >= (b || '').length ? a || '' : b || '');
  const quote = longer(post.quote?.fullText, post.quote?.text);
  const text = longer(post.fullText, post.text);
  return {
    source: 'x',
    external_id: String(t.id),
    url: rt ? `https://x.com/${rt.author.userName}/status/${rt.id}` : t.twitterUrl || t.url || null,
    title: null,
    // a quote post is about what it quotes: keep that text so its names count
    body: [rt ? `RT @${rt.author.userName}: ${text}` : text, quote ? `> ${quote}` : ''].filter(Boolean).join('\n\n'),
    author,
    author_audience: t.author.followers ?? null,
    published_at: published.toISOString(),
    bucket_at: published.toISOString(),
    engagement: {
      viewCount: num(post.viewCount),
      likeCount: num(post.likeCount),
      commentCount: num(post.replyCount),
      shareCount: num(post.retweetCount) + num(post.quoteCount),
    },
    score: num(post.likeCount) + 3 * num(post.replyCount) + 5 * (num(post.retweetCount) + num(post.quoteCount)),
    query: 'accounts',
  };
}

// X's own search syntax; the scraper ignores since_time
const xSince = (d: Date) => d.toISOString().slice(0, 19).replace('T', '_') + '_UTC';

async function fetchGroup(token: string, handles: string[], since: Date, maxItems: number): Promise<Item[]> {
  const query = `(${handles.map((h) => `from:${h}`).join(' OR ')}) since:${xSince(since)} -filter:replies include:nativeretweets`;
  const resp = await fetch(
    'https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?timeout=90&clean=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchTerms: [query], sort: 'Latest', maxItems }),
      signal: AbortSignal.timeout(100_000),
    },
  );
  if (!resp.ok) throw new Error(`X/Apify ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return ((await resp.json()) as any[]).map(toItem).filter(Boolean) as Item[];
}

async function fetchAccounts(token: string, handles: string[], since: Date, maxItems: number) {
  const groups: string[][] = [];
  for (let i = 0; i < handles.length; i += HANDLES_PER_QUERY) groups.push(handles.slice(i, i + HANDLES_PER_QUERY));
  const items: Item[] = [];
  const errors: string[] = [];
  for (let i = 0; i < groups.length; i += FETCH_CONCURRENCY) {
    const settled = await Promise.allSettled(groups.slice(i, i + FETCH_CONCURRENCY).map((g) => fetchGroup(token, g, since, maxItems)));
    for (const r of settled) {
      if (r.status === 'fulfilled') items.push(...r.value);
      else errors.push(String(r.reason?.message || r.reason).slice(0, 200));
    }
  }
  return { items, errors, groups: groups.length };
}

async function importDatasets(ids: string[], token: string | null): Promise<Item[]> {
  const items: Item[] = [];
  for (const id of ids) {
    const resp = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(id)}/items?clean=true&format=json`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`dataset ${id}: ${resp.status}`);
    items.push(...((await resp.json()) as any[]).map(toItem).filter(Boolean) as Item[]);
  }
  return items;
}

// ── Stories: load, persist ─────────────────────────────────────────────────

const iso = (t: number) => new Date(t).toISOString();

async function loadPosts(supabase: SupabaseClient, orgId: string, since: Date): Promise<StoryPost[]> {
  const out: StoryPost[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('pulse_items')
      .select('id, author, body, published_at, score')
      .eq('organization_id', orgId)
      .eq('source', 'x')
      .eq('query', 'accounts')
      .gte('bucket_at', since.toISOString())
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`load posts: ${error.message}`);
    for (const r of data || []) {
      out.push({ id: Number(r.id), t: new Date(r.published_at).getTime(), author: String(r.author || '').toLowerCase(), text: r.body || '', score: Number(r.score) || 0 });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function loadStories(supabase: SupabaseClient, orgId: string, since: Date): Promise<Story[]> {
  const { data, error } = await supabase
    .from('pulse_stories')
    .select('id, key_term, terms, item_ids, accounts, official_accounts, first_post_at, last_post_at, detected_at, peak_accounts')
    .eq('organization_id', orgId)
    .gte('detected_at', since.toISOString());
  if (error) throw new Error(`load stories: ${error.message}`);
  return (data || []).map((s) => ({
    id: s.id,
    key_term: s.key_term,
    terms: s.terms || [],
    item_ids: (s.item_ids || []).map(Number),
    accounts: s.accounts || [],
    official_accounts: s.official_accounts || [],
    first_post_at: new Date(s.first_post_at || s.detected_at).getTime(),
    last_post_at: new Date(s.last_post_at || s.detected_at).getTime(),
    detected_at: new Date(s.detected_at).getTime(),
    peak_accounts: s.peak_accounts || 0,
  }));
}

async function saveStories(supabase: SupabaseClient, orgId: string, stories: Story[]) {
  let created = 0;
  let updated = 0;
  for (const s of stories.filter((x) => x.changed)) {
    const row = {
      key_term: s.key_term,
      terms: s.terms.slice(0, 30),
      item_ids: s.item_ids.slice(-400),
      accounts: s.accounts,
      official_accounts: s.official_accounts,
      first_post_at: iso(s.first_post_at),
      last_post_at: iso(s.last_post_at),
      peak_accounts: s.peak_accounts,
      updated_at: new Date().toISOString(),
    };
    if (s.id) {
      const { error } = await supabase.from('pulse_stories').update(row).eq('id', s.id);
      if (error) throw new Error(`update story: ${error.message}`);
      updated++;
    } else {
      const { data, error } = await supabase
        .from('pulse_stories')
        .insert({ ...row, organization_id: orgId, detected_at: iso(s.detected_at) })
        .select('id')
        .single();
      if (error) throw new Error(`insert story: ${error.message}`);
      s.id = data.id;
      created++;
    }
    s.changed = false;
  }
  return { created, updated };
}

// ── LLM: headline, summary, angle, fit; drops non-actionable and duplicates ─

async function judgeStories(supabase: SupabaseClient, orgId: string) {
  const { data: recent } = await supabase
    .from('pulse_stories')
    .select('id, key_term, headline, accounts, official_accounts, item_ids, terms, first_post_at, last_post_at, peak_accounts, judged_at, judged_accounts, actionable, detected_at')
    .eq('organization_id', orgId)
    .eq('dismissed', false)
    .gte('detected_at', new Date(Date.now() - 48 * HOUR).toISOString())
    .order('detected_at', { ascending: false });
  const todo = (recent || []).filter((s) => {
    const n = (s.accounts || []).length;
    if (!s.judged_at) return true;
    // re-judge a story that has grown a lot since: the first posts are often a teaser
    return n >= 1.5 * (s.judged_accounts || 1) && n - (s.judged_accounts || 0) >= 3 && Date.now() - new Date(s.judged_at).getTime() > HOUR;
  }).slice(0, MAX_JUDGED_PER_RUN);
  if (!todo.length) return { judged: 0, merged: 0 };

  let llm;
  try {
    llm = await resolveTeardownLlm(supabase, orgId);
  } catch {
    return { judged: 0, merged: 0, llm: 'no key' }; // cards still show, keyed by name, without headlines
  }
  const fitContext = await loadOrgFitContext(supabase, orgId);
  let model = llm.model;
  let judged = 0;
  let merged = 0;
  const gone = new Set<string>();

  for (const s of todo) {
    if (gone.has(s.id)) continue;
    if (Date.now() - STARTED.at > JUDGE_DEADLINE_MS) break;
    const { data: posts } = await supabase
      .from('pulse_items')
      .select('author, body, published_at, score, url')
      .in('id', (s.item_ids || []).slice(-200));
    if (!posts?.length) continue;
    const official = new Set(s.official_accounts || []);
    // several accounts reposting one post: show that post to the LLM once
    const seen = new Set<string>();
    const picked = [...posts]
      .sort((a, b) => Number(official.has(b.author)) - Number(official.has(a.author)) || Number(b.score) - Number(a.score))
      .filter((p) => {
        const key = String(p.body || '').replace(REPOST_RE, '').trim();
        return !seen.has(key) && !!seen.add(key);
      })
      .slice(0, 10);
    const context = picked
      .map((p) => `@${p.author} (${String(p.published_at).slice(0, 16).replace('T', ' ')} UTC): ${String(p.body || '').replace(/\s+/g, ' ').slice(0, 450)}`)
      .join('\n');
    const others = (recent || [])
      .filter((o) => o.id !== s.id && o.headline && !gone.has(o.id) && Math.abs(new Date(o.detected_at).getTime() - new Date(s.detected_at).getTime()) < 12 * HOUR)
      .slice(0, 25);

    const ask = (m: string) => llmChatCompletion({
      model: m,
      openRouterApiKey: llm.openRouterApiKey,
      messages: [
        {
          role: 'system',
          content: `You turn a cluster of X posts into a news card for a founder who posts on LinkedIn for the business below. Return ONLY JSON:
{ "headline": "max 12 words, who did what, concrete (e.g. 'Anthropic launches Claude Opus 5.5 at 40% less than Opus 5')",
  "summary": "1-2 sentences: what happened, with the key facts and numbers from the posts",
  "actionable": true or false,
  "angle": "one sentence: a specific angle for a post by the business below today (null if not actionable)",
  "fit": { "score": 0-10, "reason": "one sentence: how relevant this is to the business below" },
  "same_as": "the id of an EXISTING STORY below that reports the SAME announcement (not a follow-up, reaction or related update), else null" }

"actionable" = true when the posts share ONE concrete thing that just happened: a launch, release, feature,
price change, deal, funding, result, incident, or a viral moment someone could post about today.
false for: general commentary or opinions, event/webinar/hackathon/livestream promos, hiring, a recurring
content series, rumours with nothing to show yet, or posts that don't share one concrete news item.
${others.length ? `\nEXISTING STORIES:\n${others.map((o) => `${o.id}: ${o.headline}`).join('\n')}\n` : ''}${fitContext ? `\nTHE BUSINESS:\n${fitContext}` : ''}`,
        },
        { role: 'user', content: `NAME: ${s.key_term}\nACCOUNTS POSTING: ${(s.accounts || []).length}\n\nPOSTS:\n${context}` },
      ],
      temperature: 0.2,
      max_tokens: 600,
      timeoutMs: 45_000,
    });

    try {
      let result;
      try {
        result = await ask(model);
      } catch (err) {
        if (!/API error 402/.test(String(err)) || !llm.openRouterApiKey || model === DEFAULT_FREE_TEXT_MODEL) throw err;
        model = DEFAULT_FREE_TEXT_MODEL; // out of credits: the free model still writes usable cards
        result = await ask(model);
      }
      const p = parseJsonObject(result.content);

      const actionable = p.actionable !== false;
      const judgedFields = {
        headline: String(p.headline || s.key_term).slice(0, 200),
        summary: p.summary ? String(p.summary).slice(0, 800) : null,
        angle: actionable && p.angle ? String(p.angle).slice(0, 400) : null,
        actionable,
        fit_score: p.fit?.score ?? null,
        fit_reason: p.fit?.reason ? String(p.fit.reason).slice(0, 400) : null,
        judged_at: new Date().toISOString(),
        judged_accounts: (s.accounts || []).length,
      };

      const target = typeof p.same_as === 'string' ? others.find((o) => o.id === p.same_as.trim()) : undefined;
      if (target) {
        // the earlier story survives, so a launch keeps the moment it was first seen
        const sEarlier = new Date(s.detected_at).getTime() < new Date(target.detected_at).getTime();
        const [keep, drop] = sEarlier ? [s, target] : [target, s];
        const union = (a: unknown[] = [], b: unknown[] = []) => [...new Set([...(a || []), ...(b || [])])];
        const { error } = await supabase.from('pulse_stories').update({
          item_ids: union(keep.item_ids, drop.item_ids).slice(-400),
          accounts: union(keep.accounts, drop.accounts),
          official_accounts: union(keep.official_accounts, drop.official_accounts),
          terms: union(keep.terms, drop.terms).slice(0, 30),
          first_post_at: [keep.first_post_at, drop.first_post_at].filter(Boolean).sort()[0],
          last_post_at: [keep.last_post_at, drop.last_post_at].filter(Boolean).sort().reverse()[0],
          peak_accounts: Math.max(keep.peak_accounts || 0, drop.peak_accounts || 0),
          ...(sEarlier ? judgedFields : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', keep.id);
        if (error) throw new Error(`merge: ${error.message}`);
        await supabase.from('pulse_stories').delete().eq('id', drop.id);
        gone.add(drop.id);
        if (sEarlier) s.headline = judgedFields.headline;
        merged++;
        continue;
      }

      const { error } = await supabase.from('pulse_stories').update(judgedFields).eq('id', s.id);
      if (error) throw new Error(`update: ${error.message}`);
      s.headline = String(p.headline || s.key_term);
      judged++;
    } catch (err) {
      console.error(`[pulse-ingest] judge ${orgId}/${s.key_term}:`, err instanceof Error ? err.message : err);
      if (/API error (402|429)/.test(String(err))) break; // out of credits / rate limited: next scan
    }
  }
  return { judged, merged };
}

// ── Pipeline ───────────────────────────────────────────────────────────────

async function runOrg(supabase: SupabaseClient, settings: PulseSettings, importIds?: string[]) {
  const orgId = settings.organization_id;
  const summary: Record<string, unknown> = {};

  // First run: start from the default lists (editable in Settings)
  let official = settings.official_accounts.map(normalizeHandle).filter(Boolean);
  let insiders = settings.insider_accounts.map(normalizeHandle).filter(Boolean);
  if (!official.length && !insiders.length) {
    official = DEFAULT_OFFICIAL_ACCOUNTS.map(normalizeHandle);
    insiders = DEFAULT_INSIDER_ACCOUNTS.map(normalizeHandle);
    await supabase.from('pulse_settings').update({ official_accounts: DEFAULT_OFFICIAL_ACCOUNTS, insider_accounts: DEFAULT_INSIDER_ACCOUNTS }).eq('organization_id', orgId);
  }
  const handles = [...new Set([...official, ...insiders])];
  summary.accounts = handles.length;

  const key = await resolveApiKey(supabase, orgId, 'apify');
  const token = key ? await decryptApiKey(key.key_encrypted) : null;

  const firstFetch = !settings.last_fetch_at;
  const since = firstFetch ? new Date(Date.now() - BACKFILL_HOURS * HOUR) : new Date(new Date(settings.last_fetch_at!).getTime() - 10 * 60_000);
  let items: Item[] = [];
  let fetchOk = false;
  if (importIds?.length) {
    items = await importDatasets(importIds, token);
    summary.imported = items.length;
  } else if (!token) {
    summary.x = 'error: no Apify key. Add one in Settings, API keys.';
  } else {
    const r = await fetchAccounts(token, handles, since, firstFetch ? 600 : 200);
    items = r.items;
    summary.fetched = items.length;
    if (r.errors.length) {
      // same message from every group (e.g. Apify monthly limit): report it once
      summary.x = `error: ${[...new Set(r.errors)][0]}${r.errors.length > 1 ? ` (${r.errors.length}/${r.groups} queries)` : ''}`;
    }
    fetchOk = r.errors.length < r.groups;
  }

  let newIds = new Set<number>();
  if (items.length) {
    // names are extracted at detection time (with casing); terms stays empty for account posts
    const rows = items.map((it) => ({ ...it, organization_id: orgId }));
    const { data, error } = await supabase
      .from('pulse_items')
      .upsert(rows, { onConflict: 'organization_id,source,external_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`insert items: ${error.message}`);
    newIds = new Set((data || []).map((r) => Number(r.id)));
  }
  summary.new_items = newIds.size;

  // Detection: replay 30-min scans since the last one (48h on the first run), as the
  // backtest did, so a gap in scans doesn't skip a story.
  const now = Date.now();
  const lastDetect = settings.last_detect_at ? new Date(settings.last_detect_at).getTime() : now - DETECT_BACKFILL_HOURS * HOUR;
  const start = Math.max(lastDetect, now - DETECT_BACKFILL_HOURS * HOUR);
  const scans: number[] = [];
  for (let t = start + 30 * 60_000; t < now; t += 30 * 60_000) scans.push(t);
  scans.push(now);

  const posts = await loadPosts(supabase, orgId, new Date(start - 75 * HOUR));
  const stories = await loadStories(supabase, orgId, new Date(start - 24 * HOUR));
  const officialSet = new Set(official);
  const minAccounts = settings.min_accounts || 4;
  // one index for all scans (names extracted once; each scan only looks at posts up to its time)
  const d = buildDetector(posts);
  let prev = start;
  for (const t of scans) {
    detectLaunches(d, stories, d.posts.filter((p) => p.t > prev && p.t <= t), officialSet);
    detectConsensus(d, stories, t, minAccounts);
    for (const s of stories) if (s.detected_at > t - 24 * HOUR) refreshStory(d, s, t);
    prev = t;
  }
  Object.assign(summary, await saveStories(supabase, orgId, stories));
  Object.assign(summary, await judgeStories(supabase, orgId));

  // Retention
  await supabase.from('pulse_items').delete().eq('organization_id', orgId).lt('bucket_at', new Date(now - 14 * 24 * HOUR).toISOString());
  await supabase.from('pulse_stories').delete().eq('organization_id', orgId).is('idea_id', null).lt('detected_at', new Date(now - 30 * 24 * HOUR).toISOString());

  const newest = items.reduce((max, it) => (it.published_at > max ? it.published_at : max), '');
  await supabase
    .from('pulse_settings')
    .update({
      last_run_at: new Date().toISOString(),
      last_run_summary: summary,
      last_detect_at: new Date(now).toISOString(),
      // advance only when X answered, so a failed scan is retried from the same point
      ...(fetchOk || importIds?.length ? { last_fetch_at: newest && newest > (settings.last_fetch_at || '') ? newest : new Date(now).toISOString() } : {}),
    })
    .eq('organization_id', orgId);
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  STARTED.at = Date.now();
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: { organization_id?: string; import_datasets?: string[] } = {};
  try {
    body = await req.json();
  } catch { /* cron sends {} */ }

  const serviceRole = isServiceRoleRequest(req);
  if (!serviceRole) {
    if (!body.organization_id) return json({ error: 'organization_id required' }, 400);
    try {
      await assertOrgAccess(req, supabase, body.organization_id);
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }
  }
  const importIds = serviceRole && Array.isArray(body.import_datasets) ? body.import_datasets.map(String) : undefined;

  let query = supabase.from('pulse_settings').select('*').eq('enabled', true);
  if (body.organization_id) query = query.eq('organization_id', body.organization_id);
  const { data: settingsRows, error } = await query;
  if (error) return json({ error: error.message }, 500);
  if (!settingsRows?.length) return json({ error: 'Signals are not enabled for this organization' }, body.organization_id ? 400 : 200);

  if (!serviceRole) {
    const last = settingsRows[0].last_run_at ? new Date(settingsRows[0].last_run_at).getTime() : 0;
    if (Date.now() - last < 5 * 60_000) return json({ error: 'Ran less than 5 minutes ago. Try again shortly.' }, 429);
  }

  const results: Record<string, unknown> = {};
  await Promise.all(
    (settingsRows as PulseSettings[]).map(async (s) => {
      // one scan per org at a time (a stale claim from a crashed run expires after 4 min)
      const { data: claimed } = await supabase
        .from('pulse_settings')
        .update({ run_started_at: new Date().toISOString() })
        .eq('organization_id', s.organization_id)
        .or(`run_started_at.is.null,run_started_at.lt.${new Date(Date.now() - 4 * 60_000).toISOString()}`)
        .select('organization_id');
      if (!claimed?.length) {
        results[s.organization_id] = 'skipped: a scan is already running';
        return;
      }
      try {
        results[s.organization_id] = await runOrg(supabase, s, importIds);
      } catch (err) {
        console.error(`[pulse-ingest] ${s.organization_id}:`, err);
        results[s.organization_id] = { error: err instanceof Error ? err.message : String(err) };
      } finally {
        await supabase.from('pulse_settings').update({ run_started_at: null }).eq('organization_id', s.organization_id);
      }
    }),
  );
  console.log('[pulse-ingest]', JSON.stringify(results));
  return json({ results });
});
