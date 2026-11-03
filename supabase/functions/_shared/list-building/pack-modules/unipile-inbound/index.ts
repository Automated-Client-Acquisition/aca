/**
 * Unipile Inbound Discovery pack module — pack_key `unipile_inbound`.
 *
 * Surfaces NEW prospects from your already-authenticated LinkedIn account:
 *   - followers       : people who follow you but you've never DM'd
 *   - relations       : new connections in the lookback window
 *   - post_reactors   : people who reacted to / commented on YOUR posts
 *   - pending_invites : invitation requests sent to you that you haven't responded to
 *
 * Cost: $0. The Unipile account is already paid for; per-call pulls are
 * included.
 *
 * Async safety: this module uses the synchronous run() iterator (not
 * kickoff()) because Unipile pulls are 200-500ms per page. Bounded to 5
 * pages × 100 records = 500 records per refresh tick. If more remain,
 * cursors persist in pack_subscriptions.config.unipile_cursors so the
 * next refresh resumes — no edge function blocked for minutes.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../../../apify-leads-utils.ts';
import { normalizeDsnUrl } from '../../../unipile-client.ts';
import type { PackModule, DiscoveryRecord, PackRunConfig } from '../types.ts';

type UnipileSource = 'followers' | 'relations' | 'post_reactors' | 'pending_invites';

interface UnipileInboundConfig {
  /** unipile_accounts.id (our PK, NOT Unipile's external id). */
  account_id?: string;
  sources?: UnipileSource[];
  /** Posts to check engagement on. Used only when sources includes 'post_reactors'. */
  post_ids?: string[];
  /** Pagination cursors from previous tick — persisted by pack-refresh. */
  unipile_cursors?: Record<UnipileSource, string | null>;
  /**
   * If set, drop any record whose linkedin_url matches a contact we've sent
   * an outbound message to within the last N days. Use case: stop a follower
   * who we DM'd 3 weeks ago (and never heard back from) re-surfacing as a
   * "new prospect" on every refresh.
   */
  exclude_if_outbound_within_days?: number;
}

interface UnipileAccountRow {
  id: string;
  unipile_account_id: string | null;
  access_token_encrypted: string;
  dsn_url: string | null;
  provider: string;
  status: string;
}

interface UnipilePerson {
  // Various Unipile API responses use slightly different field names depending
  // on the endpoint. Accept the union.
  member_id?: string;
  member_urn?: string;
  public_identifier?: string;
  profile_url?: string;
  picture_url?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  name?: string;
  headline?: string;
  occupation?: string;
  location?: string;
  industry?: string;
  // Pending invite shape:
  invitation_id?: string;
  inviter?: UnipilePerson;
}

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_TICK = 5;

/**
 * Normalize a LinkedIn URL to a canonical key so two visually-different URLs
 * for the same person collapse together. Strips protocol, www/locale subdomain,
 * trailing slash, query string, fragment.
 *
 *   https://www.linkedin.com/in/john-doe/    →  linkedin.com/in/john-doe
 *   https://fr.linkedin.com/in/john-doe?ref=x →  linkedin.com/in/john-doe
 *   linkedin.com/in/john-doe                  →  linkedin.com/in/john-doe
 */
function normalizeLinkedinUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\./, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '');
}

/**
 * Pull the set of LinkedIn URLs we've sent an outbound message to within the
 * last `days`. Used by the unipile_inbound pack to avoid re-surfacing a
 * follower / new connection we already DM'd recently and never heard back
 * from. Returns an empty set if days <= 0 or on query failure (fail-open —
 * better to over-surface than to crash the refresh tick).
 */
async function loadRecentOutboundLinkedinUrls(
  orgId: string,
  days: number,
): Promise<Set<string>> {
  if (days <= 0) return new Set();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('crm_messages')
    .select('crm_contacts!inner(primary_linkedin_url, organization_id)')
    .eq('direction', 'outbound')
    .gte('created_at', cutoff)
    .eq('crm_contacts.organization_id', orgId)
    .not('crm_contacts.primary_linkedin_url', 'is', null);

  if (error) {
    console.warn('[unipile-inbound] failed to load recent outbound urls', error.message);
    return new Set();
  }

  const urls = new Set<string>();
  type Row = { crm_contacts?: { primary_linkedin_url?: string | null } | null };
  for (const row of (data ?? []) as Row[]) {
    const u = row.crm_contacts?.primary_linkedin_url;
    if (u) {
      const norm = normalizeLinkedinUrl(u);
      if (norm) urls.add(norm);
    }
  }
  return urls;
}

async function loadAccount(orgId: string, accountId: string): Promise<UnipileAccountRow | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data } = await supabase
    .from('unipile_accounts')
    .select('id, unipile_account_id, access_token_encrypted, dsn_url, provider, status')
    .eq('organization_id', orgId)
    .eq('id', accountId)
    .maybeSingle();
  return (data as UnipileAccountRow | null) ?? null;
}

async function unipileGet(
  url: string,
  apiKey: string,
): Promise<{ items: unknown[]; cursor: string | null }> {
  const resp = await fetch(url, {
    headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    console.warn(`[unipile-inbound] ${resp.status} on ${url}`);
    return { items: [], cursor: null };
  }
  const json = await resp.json() as {
    items?: unknown[];
    results?: unknown[];
    cursor?: string | null;
    next_cursor?: string | null;
  };
  return {
    items: (json.items ?? json.results ?? []) as unknown[],
    cursor: json.cursor ?? json.next_cursor ?? null,
  };
}

/**
 * Pull one source for one tick — up to MAX_PAGES_PER_TICK pages, returns
 * the records collected + the cursor we landed on (so next refresh resumes).
 */
async function pullSource(
  source: UnipileSource,
  account: UnipileAccountRow,
  apiKey: string,
  startCursor: string | null,
  postIds: string[],
): Promise<{ items: UnipilePerson[]; nextCursor: string | null }> {
  const dsnUrl = normalizeDsnUrl(account.dsn_url);
  const accountQuery = account.unipile_account_id
    ? `&account_id=${encodeURIComponent(account.unipile_account_id)}`
    : '';

  const collected: UnipilePerson[] = [];
  let cursor = startCursor;

  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    let url: string;
    switch (source) {
      case 'followers':
        url = `${dsnUrl}/api/v1/users/followers?limit=${PAGE_LIMIT}${accountQuery}` + (cursor ? `&cursor=${cursor}` : '');
        break;
      case 'relations':
        url = `${dsnUrl}/api/v1/users/relations?limit=${PAGE_LIMIT}${accountQuery}` + (cursor ? `&cursor=${cursor}` : '');
        break;
      case 'pending_invites':
        url = `${dsnUrl}/api/v1/users/invite/received?limit=${PAGE_LIMIT}${accountQuery}` + (cursor ? `&cursor=${cursor}` : '');
        break;
      case 'post_reactors': {
        // For post_reactors, we iterate posts ourselves. Each post is a
        // separate cursor-less call (Unipile returns all in one shot for
        // typical post sizes; for huge posts, the page limit caps us).
        // We don't try to resume mid-post — the cursor isn't a thing here.
        if (postIds.length === 0) return { items: [], nextCursor: null };
        const postIdx = page < postIds.length ? page : postIds.length - 1;
        const postId = postIds[postIdx];
        url = `${dsnUrl}/api/v1/posts/${encodeURIComponent(postId)}/reactions?limit=${PAGE_LIMIT}${accountQuery}`;
        break;
      }
    }

    const { items, cursor: nextCursor } = await unipileGet(url, apiKey);
    for (const it of items) collected.push(it as UnipilePerson);

    cursor = nextCursor;
    if (!cursor) break;
    if (source === 'post_reactors' && page + 1 >= postIds.length) break;
  }

  return { items: collected, nextCursor: cursor };
}

function personToRecord(
  person: UnipilePerson,
  source: UnipileSource,
  moduleKey: string,
): DiscoveryRecord | null {
  // Pending invites nest the inviter
  const p = person.inviter ?? person;

  const fullName = (p.full_name ?? p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim();
  if (!fullName) return null;

  const linkedinUrl = p.profile_url
    ?? (p.public_identifier ? `https://www.linkedin.com/in/${p.public_identifier}` : null);
  if (!linkedinUrl) return null;

  const [first, ...rest] = fullName.split(/\s+/);
  const last = rest.join(' ');

  const sourceLabels: Record<UnipileSource, string> = {
    followers: 'Follows you on LinkedIn',
    relations: 'Recently connected with you on LinkedIn',
    post_reactors: 'Reacted to your LinkedIn post',
    pending_invites: 'Sent you a LinkedIn connection request',
  };

  return {
    company: {
      // No company info from these endpoints — use the person's name as
      // a placeholder; downstream dm-scrape / enrichment fills the company.
      company_name: fullName,
      domain: null,
      website_url: null,
      linkedin_url: null,
      country: null,
      source: 'linkedin' as const,
      raw_html_snippet: null,
    },
    person: {
      first: p.first_name ?? first ?? '',
      last: p.last_name ?? last,
      title: p.headline ?? p.occupation ?? '',
      linkedin_url: linkedinUrl,
    },
    signal_metadata: {
      type: 'unipile_inbound',
      date: new Date().toISOString().slice(0, 10),
      detail: sourceLabels[source],
      evidence_url: linkedinUrl,
    },
    source: moduleKey,
    source_url: linkedinUrl,
    raw_signal: { ...person, _unipile_source: source } as Record<string, unknown>,
  };
}

export const unipileInboundModule: PackModule = {
  key: 'unipile_inbound',
  pack: 'unipile_inbound',
  tier: 'signal',
  label: 'LinkedIn Inbound',

  async *run(config: PackRunConfig): AsyncIterable<DiscoveryRecord> {
    const cfg = (config.filters ?? {}) as UnipileInboundConfig;
    if (!cfg.account_id) {
      console.warn('[unipile-inbound] no account_id in config — skipping');
      return;
    }
    const sources = (cfg.sources ?? ['followers', 'relations', 'pending_invites']) as UnipileSource[];
    if (sources.length === 0) return;

    const account = await loadAccount(config.organizationId, cfg.account_id);
    if (!account) {
      console.warn('[unipile-inbound] account not found', cfg.account_id);
      return;
    }
    // 'active' is the canonical status set by the connect flow.
    // 'OK' and 'connected' are kept as aliases for older accounts.
    const goodStatuses = new Set(['active', 'OK', 'connected']);
    if (!goodStatuses.has(account.status)) {
      console.warn(`[unipile-inbound] account ${cfg.account_id} status=${account.status} — skipping`);
      return;
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      console.error('[unipile-inbound] ENCRYPTION_KEY not set');
      return;
    }
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);

    // We pull each source up to MAX_PAGES_PER_TICK. Cursors carried over
    // ticks via cfg.unipile_cursors.
    const cursors = (cfg.unipile_cursors ?? {}) as Record<UnipileSource, string | null>;
    const postIds = cfg.post_ids ?? [];
    const newCursors: Record<UnipileSource, string | null> = { ...cursors };

    // Recency filter — drop any record we've already sent an outbound message
    // to within the lookback window. Stops a follower we DM'd 3 weeks ago
    // from re-surfacing as "new" on every refresh.
    const excludeDays = Math.max(0, cfg.exclude_if_outbound_within_days ?? 0);
    const excludedUrls = excludeDays > 0
      ? await loadRecentOutboundLinkedinUrls(config.organizationId, excludeDays)
      : new Set<string>();
    if (excludedUrls.size > 0) {
      console.log(
        `[unipile-inbound] excluding ${excludedUrls.size} recently-DM'd contacts (within ${excludeDays}d)`,
      );
    }

    for (const source of sources) {
      const { items, nextCursor } = await pullSource(
        source,
        account,
        apiKey,
        cursors[source] ?? null,
        postIds,
      );
      newCursors[source] = nextCursor;

      let skipped = 0;
      for (const person of items) {
        const rec = personToRecord(person, source, 'unipile_inbound');
        // person is optional on DiscoveryRecord; without this guard a record
        // lacking one throws instead of being skipped.
        if (!rec?.person) continue;
        if (excludedUrls.size > 0) {
          const norm = normalizeLinkedinUrl(rec.person.linkedin_url);
          if (norm && excludedUrls.has(norm)) {
            skipped++;
            continue;
          }
        }
        yield rec;
      }
      if (skipped > 0) {
        console.log(`[unipile-inbound] ${source}: skipped ${skipped} recently-DM'd contacts`);
      }
      if (config.signal?.aborted) return;
    }

    // Persist cursors for next tick — best-effort, swallow errors. If the
    // sub doesn't have a config row for some reason, we just re-pull from
    // cursor=null next time which is fine (dedup by linkedin_url handles it).
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      // Read current config (we may not be the only writer in flight).
      const { data: subRow } = await supabase
        .from('pack_subscriptions')
        .select('config')
        .eq('organization_id', config.organizationId)
        .filter('config->>account_id', 'eq', cfg.account_id)
        .maybeSingle();
      const currentConfig = (subRow as { config?: Record<string, unknown> } | null)?.config ?? {};
      const updated = { ...currentConfig, unipile_cursors: newCursors };
      await supabase
        .from('pack_subscriptions')
        .update({ config: updated })
        .eq('organization_id', config.organizationId)
        .filter('config->>account_id', 'eq', cfg.account_id);
    } catch (err) {
      console.warn('[unipile-inbound] cursor persist failed', err);
    }
  },
};
