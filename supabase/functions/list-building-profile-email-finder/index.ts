/**
 * Profile Email Finder — for person-first signals (post engagers, inbound).
 *
 * Why this exists: post-engagement and inbound (followers / new connections)
 * signals already give us the engager's name + LinkedIn profile URL — we
 * don't need to scrape "employees of company X" because there is no company,
 * the person IS the lead. This worker takes a single LinkedIn profile URL
 * and finds that person's email via harvestapi/linkedin-profile-scraper
 * Full+email mode.
 *
 * Flow per cron tick (every minute):
 *   1. Claim up to BATCH_SIZE pending stage='profile_email' work items
 *      (same SELECT FOR UPDATE SKIP LOCKED pattern as dm-scraper).
 *   2. Batch all linkedin_urls into ONE harvestapi run — the actor accepts
 *      arrays and Apify's startup fee is per-run, not per-input. So 20 items
 *      = 1 run × ~$0.012/result × 20 = ~$0.24 instead of 20 × startup fees.
 *   3. Match results back to dm_id by profile URL (or provider id).
 *   4. For results with email: insert into lb_email_verifications with
 *      status='verified' (harvestapi already validates) + source pattern.
 *   5. Mark items completed; mark items with no email returned as 'dead'
 *      so they don't re-fire.
 *
 * Cost: ~$0.012 per result on Full+email mode. 20 items/min × 60 min × 24h =
 * 28,800 max/day. With per-org caps + the recovery-cron retry-cap (2/7d),
 * realistic load is 100-1000/day per active org → $1-12/day.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { triggerSignalExport } from '../_shared/list-building/signal-export-trigger.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const APIFY_PROFILE_ACTOR = 'harvestapi~linkedin-profile-scraper';
const APIFY_RUNS_URL = `https://api.apify.com/v2/acts/${APIFY_PROFILE_ACTOR}/runs`;
const APIFY_RUN_TIMEOUT_MS = 180_000;
const APIFY_POLL_INTERVAL_MS = 4_000;
const BATCH_SIZE = 20;

interface ProfileEmailWorkItem {
  id: number;
  job_id: string;
  organization_id: string;
  payload: {
    dm_id: string;
    linkedin_url: string;
  };
}

/**
 * Resolve Unipile-internal ACoAA URLs to their public-slug counterparts.
 * harvestapi/linkedin-profile-scraper expects URLs like
 *   https://www.linkedin.com/in/john-doe
 * NOT
 *   https://www.linkedin.com/in/ACoAACbaR5sBFLvTrWic_LjokVhiheRjBlbQ7zE
 *
 * The ACoAA form is Unipile's stable provider_id wrapped in a URL — useful
 * within Unipile's own API but unrecognized by external scrapers. So before
 * we hand a URL to harvestapi, we look up its public_identifier via Unipile's
 * /api/v1/users/{provider_id} endpoint and rebuild the URL.
 *
 * Cost: 1 Unipile call per item that gets to email-finding (i.e. per ICP-
 * passed engager). Free per call (Unipile included), bounded by
 * BATCH_SIZE=20/min × ICP throughput.
 */
async function getOrgUnipileAccount(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ apiKey: string; dsnUrl: string; unipileAccountId: string } | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const { data } = await supabase
    .from('unipile_accounts')
    .select('unipile_account_id, access_token_encrypted, dsn_url, status, provider')
    .eq('organization_id', orgId)
    .eq('provider', 'LINKEDIN')
    .in('status', ['active', 'OK', 'connected'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    unipile_account_id: string;
    access_token_encrypted: string;
    dsn_url: string | null;
  };
  const apiKey = await decryptApiKey(row.access_token_encrypted, encryptionKey);
  return {
    apiKey,
    dsnUrl: normalizeDsnUrl(row.dsn_url),
    unipileAccountId: row.unipile_account_id,
  };
}

function extractAcoaaId(url: string): string | null {
  const match = url.match(/\/in\/(ACoAA[A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function resolvePublicSlug(
  acoaaId: string,
  unipileCtx: { apiKey: string; dsnUrl: string; unipileAccountId: string },
): Promise<string | null> {
  const url = `${unipileCtx.dsnUrl}/api/v1/users/${encodeURIComponent(acoaaId)}` +
    `?notify=false&account_id=${encodeURIComponent(unipileCtx.unipileAccountId)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'X-API-KEY': unipileCtx.apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.warn(`[profile-email-finder] resolve ${acoaaId} → ${resp.status}`);
      return null;
    }
    const json = await resp.json() as { public_identifier?: string };
    return json.public_identifier ?? null;
  } catch (err) {
    console.warn(`[profile-email-finder] resolve ${acoaaId} threw`, err);
    return null;
  }
}

async function getApifyToken(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', orgId)
    .eq('provider', 'apify')
    .eq('is_valid', true)
    .maybeSingle();
  if (!data) return null;
  return decryptApiKey((data as { key_encrypted: string }).key_encrypted, encryptionKey);
}

interface HarvestapiProfileRow {
  /** ACoAA-format LinkedIn provider id — matches Unipile's `author.id`. */
  id?: string;
  linkedinUrl?: string;
  publicIdentifier?: string;
  emails?: Array<{
    email?: string;
    address?: string;
    status?: string;
    tier?: string | number;
    deliverable?: boolean;
    qualityScore?: number;
    free?: boolean;
  }>;
  email?: string;
  about?: string;
  headline?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Pick the highest-tier email out of the harvestapi `emails` array.
 * Mirrors logic in list-building-dm-scraper.ts:pickBestEmail.
 */
/**
 * Pick the best email from harvestapi's response. Real shape (verified
 * against a debug capture):
 *   emails: [{ email, deliverable, free, qualityScore, status, ... }]
 *
 * Sort priority:
 *   1. status === 'valid' first (clearly the best)
 *   2. deliverable === true second
 *   3. higher qualityScore (0-100) wins ties
 *   4. non-free domain preferred (free domains like gmail are riskier)
 */
function pickBestEmail(row: HarvestapiProfileRow): string | null {
  const candidates: Array<{
    email: string;
    valid: boolean;
    deliverable: boolean;
    quality: number;
    nonFree: boolean;
  }> = [];
  for (const e of row.emails ?? []) {
    const addr = (e.email ?? e.address ?? '').trim();
    if (!addr || !addr.includes('@')) continue;
    candidates.push({
      email: addr,
      valid: e.status === 'valid',
      deliverable: e.deliverable === true,
      quality: typeof e.qualityScore === 'number' ? e.qualityScore : 0,
      nonFree: e.free !== true,
    });
  }
  if (row.email && row.email.includes('@')) {
    candidates.push({ email: row.email.trim(), valid: false, deliverable: false, quality: 0, nonFree: true });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (a.deliverable !== b.deliverable) return a.deliverable ? -1 : 1;
    if (a.quality !== b.quality) return b.quality - a.quality;
    if (a.nonFree !== b.nonFree) return a.nonFree ? -1 : 1;
    return 0;
  });
  return candidates[0]!.email;
}

function normalizeLinkedinUrl(u: string | null | undefined): string {
  if (!u) return '';
  return u.toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\./, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '');
}

/**
 * Claim batch of pending profile_email items via SELECT FOR UPDATE SKIP LOCKED.
 * Same pattern as dm-scraper to allow concurrent runs without conflict.
 */
async function claimItems(supabase: SupabaseClient): Promise<ProfileEmailWorkItem[]> {
  const { data, error } = await supabase.rpc('claim_profile_email_items', {
    p_batch_size: BATCH_SIZE,
  });
  if (error) {
    console.error('[profile-email-finder] claim failed', error.message);
    return [];
  }
  return (data as ProfileEmailWorkItem[] | null) ?? [];
}

async function kickoffActor(token: string, urls: string[]): Promise<{ run_id: string; dataset_id: string } | null> {
  // Unipile gives us URLs like linkedin.com/in/ACoAACbaR5s... — the obfuscated
  // provider_id form. The actor's `urls` field expects either a public-slug
  // URL or the ACoAA id form, but in practice the public-slug form is what
  // gets resolved cleanly. Pass BOTH `urls` (in case it accepts ACoAA URLs)
  // AND `profileIds` (the bare ACoAA id) to maximize match rate.
  // Actor schema: profileIds = "LinkedIn Profile IDs", accepts ACoAA-prefixed.
  const profileIds = urls
    .map((u) => u.match(/\/in\/([A-Za-z0-9_-]+)/)?.[1])
    .filter((id): id is string => !!id);

  const input: Record<string, unknown> = {
    urls,
    profileIds,
    profileScraperMode: 'Profile details + email search ($10 per 1k)',
    maxItems: Math.max(urls.length, profileIds.length),
  };
  console.log(`[profile-email-finder] kickoff input: ${urls.length} urls, ${profileIds.length} profileIds`);
  const resp = await fetch(`${APIFY_RUNS_URL}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[profile-email-finder] kickoff failed', resp.status, body.slice(0, 500));
    return null;
  }
  const payload = await resp.json() as { data?: { id?: string; defaultDatasetId?: string } };
  if (!payload.data?.id || !payload.data.defaultDatasetId) {
    console.error('[profile-email-finder] kickoff returned no run_id/dataset_id', JSON.stringify(payload).slice(0, 500));
    return null;
  }
  return { run_id: payload.data.id, dataset_id: payload.data.defaultDatasetId };
}

async function waitForRun(token: string, runId: string): Promise<boolean> {
  const deadline = Date.now() + APIFY_RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS));
    const resp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    if (!resp.ok) continue;
    const status = (await resp.json() as { data?: { status?: string } }).data?.status;
    if (status === 'SUCCEEDED') return true;
    if (status === 'FAILED' || status === 'TIMED-OUT' || status === 'ABORTED') return false;
  }
  return false;
}

async function fetchDataset(token: string, datasetId: string): Promise<HarvestapiProfileRow[]> {
  const resp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`);
  if (!resp.ok) return [];
  return (await resp.json()) as HarvestapiProfileRow[];
}

async function processBatch(
  supabase: SupabaseClient,
  items: ProfileEmailWorkItem[],
): Promise<{ verified: number; noEmail: number; failed: number }> {
  if (items.length === 0) return { verified: 0, noEmail: 0, failed: 0 };

  // Group by organization_id — each org has its own Apify token.
  const byOrg = new Map<string, ProfileEmailWorkItem[]>();
  for (const it of items) {
    const list = byOrg.get(it.organization_id) ?? [];
    list.push(it);
    byOrg.set(it.organization_id, list);
  }

  let verified = 0;
  let noEmail = 0;
  let failed = 0;

  for (const [orgId, orgItems] of byOrg) {
    const token = await getApifyToken(supabase, orgId);
    if (!token) {
      console.warn(`[profile-email-finder] org ${orgId} has no Apify token; marking ${orgItems.length} items dead`);
      await supabase.from('lb_work_items')
        .update({ status: 'dead', error: 'no_apify_token', completed_at: new Date().toISOString() })
        .in('id', orgItems.map((i) => i.id));
      failed += orgItems.length;
      continue;
    }

    // Resolve any ACoAA-format URLs to public-slug form via Unipile before
    // calling harvestapi. The actor doesn't recognize Unipile-internal IDs.
    const unipileCtx = await getOrgUnipileAccount(supabase, orgId);
    const resolvedByItem = new Map<number, string>();  // workItemId → public URL
    let resolvedCount = 0;
    let unresolvedCount = 0;
    for (const it of orgItems) {
      const acoaa = extractAcoaaId(it.payload.linkedin_url);
      if (!acoaa) {
        // Already a public-slug URL (or unrecognized format) — pass through.
        resolvedByItem.set(it.id, it.payload.linkedin_url);
        continue;
      }
      if (!unipileCtx) {
        unresolvedCount++;
        continue;
      }
      const slug = await resolvePublicSlug(acoaa, unipileCtx);
      if (slug) {
        resolvedByItem.set(it.id, `https://www.linkedin.com/in/${slug}`);
        resolvedCount++;
      } else {
        unresolvedCount++;
      }
    }
    if (resolvedCount + unresolvedCount > 0) {
      console.log(
        `[profile-email-finder] org ${orgId}: resolved ${resolvedCount} ACoAA URLs to public slugs, ${unresolvedCount} could not be resolved`,
      );
    }

    const urls: string[] = [];
    const itemsForUrls: ProfileEmailWorkItem[] = [];
    for (const it of orgItems) {
      const u = resolvedByItem.get(it.id);
      if (u) {
        urls.push(u);
        itemsForUrls.push(it);
      }
    }
    if (urls.length === 0) {
      // Nothing usable — mark as failed but don't burn attempts (transient).
      await supabase.from('lb_work_items')
        .update({
          status: 'pending',
          claimed_by: null,
          claimed_at: null,
          error: 'unipile_resolve_failed',
          attempts: 0,
        })
        .in('id', orgItems.map((i) => i.id));
      failed += orgItems.length;
      continue;
    }

    const handle = await kickoffActor(token, urls);
    if (!handle) {
      // Apify rejected our kickoff (bad token, malformed input, rate limit).
      // Reset to pending AND decrement attempts so we don't burn the retry
      // budget on transient infra problems — only real per-profile failures
      // (returned with no email) should consume attempts.
      await supabase.from('lb_work_items')
        .update({
          status: 'pending',
          claimed_by: null,
          claimed_at: null,
          error: 'apify_kickoff_failed',
          attempts: 0,
        })
        .in('id', orgItems.map((i) => i.id));
      failed += orgItems.length;
      continue;
    }

    const ok = await waitForRun(token, handle.run_id);
    if (!ok) {
      await supabase.from('lb_work_items')
        .update({
          status: 'pending',
          claimed_by: null,
          claimed_at: null,
          error: 'apify_run_failed',
          attempts: 0,
        })
        .in('id', orgItems.map((i) => i.id));
      failed += orgItems.length;
      continue;
    }

    const rows = await fetchDataset(token, handle.dataset_id);
    console.log(`[profile-email-finder] org ${orgId}: ${urls.length} profiles in, ${rows.length} rows out`);

    // Debug: persist a single raw row sample so we can SELECT from it later
    // and verify the actor's actual output shape (field names for emails,
    // URL formats, etc.). Capped at 1 row per run to avoid junk accumulation.
    if (rows.length > 0) {
      try {
        await supabase.from('lb_job_logs').insert({
          job_id: orgItems[0].job_id,
          stage: 'profile_email',
          level: 'debug',
          message: `harvestapi dataset sample (run ${handle.run_id}): ${JSON.stringify(rows[0]).slice(0, 4000)}`,
        });
      } catch (e) {
        console.warn('[profile-email-finder] could not log sample row', e);
      }
    }
    if (rows.length === 0) {
      console.warn(`[profile-email-finder] EMPTY DATASET — run_id=${handle.run_id} dataset_id=${handle.dataset_id}. ` +
        `First profile we asked about: ${urls[0]?.slice(0, 80)}`);
    } else {
      // Log a redacted snapshot of the first row's KEYS so we can spot
      // shape drift from the actor (different field names, missing emails, etc.)
      console.log(`[profile-email-finder] first row keys: ${Object.keys(rows[0] ?? {}).join(', ')}`);
      const r0 = rows[0];
      console.log(
        `[profile-email-finder] first row sample: ` +
        `linkedinUrl=${(r0?.linkedinUrl ?? '').slice(0, 60)} ` +
        `publicIdentifier=${r0?.publicIdentifier ?? '-'} ` +
        `email=${r0?.email ? '<set>' : '-'} ` +
        `emails.len=${r0?.emails?.length ?? 0}`,
      );
    }

    // Index actor output by every identifier that might match a work item.
    // Real harvestapi response shape:
    //   row.id              — ACoAA value (matches Unipile's author.id)
    //   row.linkedinUrl     — public-slug URL
    //   row.publicIdentifier — bare public slug
    //
    // Work item payload.linkedin_url is typically the ACoAA-form URL we got
    // from Unipile. So the most reliable match is on the ACoAA id directly.
    const byUrl = new Map<string, HarvestapiProfileRow>();
    const byProfileId = new Map<string, HarvestapiProfileRow>();
    for (const r of rows) {
      const u = r.linkedinUrl ?? (r.publicIdentifier ? `https://linkedin.com/in/${r.publicIdentifier}` : '');
      if (u) byUrl.set(normalizeLinkedinUrl(u), r);
      if (r.id) byProfileId.set(r.id, r);
      const ext = (r.linkedinUrl ?? '').match(/\/in\/([A-Za-z0-9_-]+)/)?.[1];
      if (ext) byProfileId.set(ext, r);
      if (r.publicIdentifier) byProfileId.set(r.publicIdentifier, r);
    }

    const verifyRows: Array<Record<string, unknown>> = [];
    const completedIds: number[] = [];
    const deadIds: number[] = [];

    for (const item of orgItems) {
      const norm = normalizeLinkedinUrl(item.payload.linkedin_url);
      // Try ACoAA id first (most reliable — actor returns it as row.id),
      // then public slug, then full URL match.
      const ext = item.payload.linkedin_url.match(/\/in\/([A-Za-z0-9_-]+)/)?.[1];
      const row = (ext ? byProfileId.get(ext) : undefined) ?? byUrl.get(norm);
      const email = row ? pickBestEmail(row) : null;
      if (!email) {
        // No email returned — mark dead so we don't keep retrying.
        deadIds.push(item.id);
        noEmail++;
        continue;
      }
      verifyRows.push({
        dm_id: item.payload.dm_id,
        job_id: item.job_id,
        organization_id: item.organization_id,
        email,
        pattern: 'apify:harvestapi-profile',
        tier: 1,
        status: 'verified',
        catch_all: false,
        attempts: 1,
        verified_at: new Date().toISOString(),
      });
      completedIds.push(item.id);
      verified++;
    }

    if (verifyRows.length > 0) {
      const { error: vErr } = await supabase.from('lb_email_verifications').insert(verifyRows);
      if (vErr) {
        console.error('[profile-email-finder] email_verifications insert failed', vErr.message);
      } else {
        // Resolve the affected companies so concurrent organizations do not
        // contend on a global export batch. Person-first DMs still have a
        // canonical company_id created during discovery.
        const dmIds = verifyRows
          .map((row) => row.dm_id)
          .filter((id): id is string => typeof id === 'string');
        const { data: dmRows } = await supabase
          .from('lb_decision_makers')
          .select('company_id')
          .in('id', dmIds);
        const companyIds = new Set(
          (dmRows as Array<{ company_id: string | null }> | null ?? [])
            .map((row) => row.company_id)
            .filter((id): id is string => !!id),
        );
        for (const companyId of companyIds) triggerSignalExport(supabase, companyId);
      }
    }
    if (completedIds.length > 0) {
      await supabase.from('lb_work_items')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .in('id', completedIds);
    }
    if (deadIds.length > 0) {
      await supabase.from('lb_work_items')
        .update({ status: 'dead', error: 'no_email_returned', completed_at: new Date().toISOString() })
        .in('id', deadIds);
    }
  }

  return { verified, noEmail, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const items = await claimItems(supabase);
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, claimed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const result = await processBatch(supabase, items);
    return new Response(JSON.stringify({ ok: true, claimed: items.length, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[profile-email-finder] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
