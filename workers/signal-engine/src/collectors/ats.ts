/**
 * ATS job-board collector — hiring signals, computed rather than scraped.
 *
 * WHY THIS BEATS BUYING HIRING DATA
 * ---------------------------------------------------------------------------
 * Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee and Workable each expose
 * a public JSON board per company. Three properties make this the single best
 * source in the engine:
 *
 *   1. Identity is free. The board token IS the company — no name matching, no
 *      domain guessing. This is precisely the problem that killed the v1
 *      scrapers, and here it simply does not arise.
 *   2. It is free and unmetered. No per-result billing, no proxies, no blocking.
 *   3. We own the history. "Aggressive hiring" is a *delta*, and a delta needs a
 *      time series. We snapshot every board every run and diff, so
 *      "opened 7 roles in 30d" is derived from data we hold rather than a number
 *      a vendor asserts and we cannot check.
 *
 * ONE OBSERVATION PER BOARD, NOT PER JOB
 * ---------------------------------------------------------------------------
 * The SignalBase hiring feed returns one record per job posting, so a company
 * opening 30 roles arrives as 30 near-identical signals that all resolve to the
 * same account. Buying intent is an account-level fact, so we emit one
 * observation per board per run — "this company opened N roles, here they are"
 * — which is both what outreach wants to say and far cheaper downstream.
 */

import { createHash } from 'node:crypto';
import { fetchJson } from '../http.js';
import type { EntityHints, RawObservation } from '../types.js';
import {
  latestSnapshotJobIds,
  loadDueBoards,
  markBoardChecked,
  writeSnapshot,
  type AtsBoard,
} from '../store.js';

/** Provider-neutral job shape. */
export interface AtsJob {
  id: string;
  title: string;
  department?: string;
  location?: string;
  url?: string;
  posted_at?: string;
}

type Adapter = (token: string, signal?: AbortSignal) => Promise<AtsJob[] | null>;

const ATS_PAGE_SIZE = 100;
const MAX_ATS_PAGES = 100;

/** Exhaust an offset/limit API and fail loudly instead of returning a partial board. */
export async function paginateOffset<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total?: number } | null>,
  pageSize = ATS_PAGE_SIZE,
  maxPages = MAX_ATS_PAGES,
): Promise<T[] | null> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(page * pageSize, pageSize);
    if (result === null) return page === 0 ? null : rows;
    rows.push(...result.items);
    if (result.items.length < pageSize || (result.total != null && rows.length >= result.total)) {
      return rows;
    }
  }
  throw new Error(`ATS pagination exceeded ${maxPages} pages; refusing a partial board snapshot`);
}

function uniqueJobs(jobs: AtsJob[]): AtsJob[] {
  return [...new Map(jobs.map((job) => [job.id, job])).values()];
}

export function atsDeltaId(boardId: string, newJobIds: string[], day: string): string {
  const digest = createHash('sha256')
    .update([...newJobIds].sort().join('|'))
    .digest('hex')
    .slice(0, 16);
  return `${boardId}:${day}:${digest}`;
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
};

type ApiRow = Record<string, unknown>;
const record = (value: unknown): ApiRow =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRow : {};

/**
 * Each adapter returns [] for a live-but-empty board and null when the board
 * does not exist. The distinction matters: an empty board is a normal state
 * (ashby/deel and lever/plaid both return 200 with zero jobs today), while a
 * missing one should eventually be deactivated.
 *
 * Verification status as of 2026-08-17, checked against live boards:
 *   greenhouse       VERIFIED (stripe: 573 jobs)
 *   lever            VERIFIED (leverdemo: 388 postings)
 *   ashby            VERIFIED (ramp: 136, notion: 132)
 *   smartrecruiters  VERIFIED (Visa: 2 postings)
 *   workable         VERIFIED reachable (hotjar/wetransfer/bolt all 200, 0 open roles)
 *   recruitee        UNVERIFIED — implemented from the documented
 *                    {token}.recruitee.com/api/offers/ shape, but every token
 *                    tried returned 404. Confirm against a known-good board
 *                    before enabling it in production.
 */
const ADAPTERS: Record<string, Adapter> = {
  async greenhouse(token, signal) {
    const data = await fetchJson<{ jobs?: ApiRow[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
      { signal, allow404: true },
    );
    if (!data) return null;
    return (data.jobs ?? []).map((j) => ({
      id: String(j.id),
      title: str(j.title) ?? '',
      location: str(record(j.location).name),
      url: str(j.absolute_url),
      posted_at: str(j.updated_at),
    }));
  },

  async lever(token, signal) {
    const data = await paginateOffset<ApiRow>(async (skip, limit) => {
      const page = await fetchJson<ApiRow[]>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json&skip=${skip}&limit=${limit}`,
        { signal, allow404: true },
      );
      return page === null ? null : { items: page };
    });
    if (!Array.isArray(data)) return null;
    return uniqueJobs(data.map((j) => ({
      id: String(j.id),
      title: str(j.text) ?? '',
      department: str(record(j.categories).department) ?? str(record(j.categories).team),
      location: str(record(j.categories).location),
      url: str(j.hostedUrl),
      // Lever sends epoch milliseconds.
      posted_at:
        typeof j.createdAt === 'number' ? new Date(j.createdAt).toISOString() : undefined,
    })));
  },

  async ashby(token, signal) {
    const data = await fetchJson<{ jobs?: ApiRow[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
      { signal, allow404: true },
    );
    if (!data) return null;
    return (data.jobs ?? [])
      .filter((j) => j.isListed !== false)
      .map((j) => ({
        id: String(j.id),
        title: str(j.title) ?? '',
        department: str(j.department) ?? str(j.team),
        location: str(j.location),
        url: str(j.jobUrl),
        posted_at: str(j.publishedAt),
      }));
  },

  async smartrecruiters(token, signal) {
    const data = await paginateOffset<ApiRow>(async (offset, limit) => {
      const page = await fetchJson<{ content?: ApiRow[]; totalFound?: number }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=${limit}&offset=${offset}`,
        { signal, allow404: true },
      );
      return page === null ? null : { items: page.content ?? [], total: page.totalFound };
    });
    if (!data) return null;
    return uniqueJobs(data.map((j) => ({
      id: String(j.id ?? j.uuid),
      title: str(j.name) ?? '',
      department: str(record(j.department).label),
      location: [str(record(j.location).city), str(record(j.location).country)].filter(Boolean).join(', '),
      url: str(j.ref) ?? str(j.applyUrl),
      posted_at: str(j.releasedDate),
    })));
  },

  async recruitee(token, signal) {
    const data = await fetchJson<{ offers?: ApiRow[] }>(
      `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`,
      { signal, allow404: true },
    );
    if (!data) return null;
    return (data.offers ?? []).map((j) => ({
      id: String(j.id),
      title: str(j.title) ?? '',
      department: str(j.department),
      location: str(j.location),
      url: str(j.careers_url) ?? str(j.careers_apply_url),
      posted_at: str(j.published_at) ?? str(j.created_at),
    }));
  },

  async workable(token, signal) {
    const data = await fetchJson<{ jobs?: ApiRow[] }>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`,
      { signal, allow404: true },
    );
    if (!data) return null;
    return (data.jobs ?? []).map((j) => ({
      id: String(j.shortcode ?? j.id),
      title: str(j.title) ?? '',
      department: str(j.department),
      location: [str(j.city), str(j.country)].filter(Boolean).join(', '),
      url: str(j.url) ?? str(j.application_url),
      posted_at: str(j.published_on),
    }));
  },
};

export function supportedProviders(): string[] {
  return Object.keys(ADAPTERS);
}

/** Exposed for focused live verification without touching snapshots or Supabase. */
export async function fetchAtsBoardJobs(
  provider: string,
  token: string,
  signal?: AbortSignal,
): Promise<AtsJob[] | null> {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`unknown ATS provider: ${provider}`);
  return adapter(token, signal);
}

/**
 * Coarse seniority band from a job title.
 *
 * Not trying to be clever — the point is to let a subscription say "only tell me
 * when they're hiring leadership", which is a much stronger buying signal than
 * headcount growth alone. Anything unrecognised stays 'ic' rather than being
 * guessed upward.
 */
function seniorityOf(title: string): string {
  const t = title.toLowerCase();
  if (/\b(chief|c[teofim]o|founder|president)\b/.test(t)) return 'c_level';
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 'vp';
  if (/\bhead of\b|\bdirector\b/.test(t)) return 'director';
  if (/\b(manager|lead|principal|staff)\b/.test(t)) return 'manager';
  return 'ic';
}

export interface AtsSweepResult {
  boardsChecked: number;
  boardsWithNewJobs: number;
  observations: Array<{ board: AtsBoard; observation: RawObservation }>;
  errors: string[];
}

/**
 * Poll every due board once, snapshot it, and emit an observation for boards
 * that opened new roles since we last looked.
 */
export async function sweepAtsBoards(opts: {
  limit: number;
  signal?: AbortSignal;
}): Promise<AtsSweepResult> {
  const boards = await loadDueBoards(opts.limit);
  const out: AtsSweepResult = {
    boardsChecked: 0,
    boardsWithNewJobs: 0,
    observations: [],
    errors: [],
  };

  for (const board of boards) {
    if (opts.signal?.aborted) break;

    const adapter = ADAPTERS[board.provider];
    if (!adapter) {
      out.errors.push(`unknown provider ${board.provider} (board ${board.id})`);
      continue;
    }

    let jobs: AtsJob[] | null;
    try {
      jobs = await fetchAtsBoardJobs(board.provider, board.token, opts.signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.errors.push(`${board.provider}/${board.token}: ${msg}`);
      await markBoardChecked(board.id, { error: msg });
      continue;
    }

    out.boardsChecked++;

    if (jobs === null) {
      // Board is gone (404). Counted as a failure so it deactivates after
      // repeated misses rather than being polled forever.
      await markBoardChecked(board.id, { error: 'board not found (404)' });
      continue;
    }

    const jobIds = jobs.map((j) => j.id);
    const previous = await latestSnapshotJobIds(board.id);

    // First sighting: record the baseline and emit nothing. Without a prior
    // snapshot every existing role looks "new", which would report a company
    // with 500 standing openings as having just opened 500 roles.
    const isBaseline = previous === null;
    const previousSet = new Set(previous ?? []);
    const newJobIds = isBaseline ? [] : jobIds.filter((id) => !previousSet.has(id));

    await writeSnapshot({
      board_id: board.id,
      job_count: jobIds.length,
      job_ids: jobIds,
      new_job_ids: newJobIds,
      meta: { baseline: isBaseline, provider: board.provider, token: board.token },
    });
    await markBoardChecked(board.id, { jobCount: jobIds.length });

    if (newJobIds.length === 0) continue;
    out.boardsWithNewJobs++;

    const newJobs = jobs.filter((j) => newJobIds.includes(j.id));
    const departments = [...new Set(newJobs.map((j) => j.department).filter(Boolean))];
    const seniorities = [...new Set(newJobs.map((j) => seniorityOf(j.title)))];

    const hints: EntityHints = {
      ats_provider: board.provider,
      ats_token: board.token,
    };

    out.observations.push({
      board,
      observation: {
        // Stable for the exact daily delta: a replay cannot duplicate it, while
        // genuinely new jobs found in a later same-day sweep still get stored.
        external_id: atsDeltaId(board.id, newJobIds, new Date().toISOString().slice(0, 10)),
        source_url: board.board_url ?? newJobs[0]?.url,
        title: `${board.token} opened ${newJobs.length} role${newJobs.length === 1 ? '' : 's'}`,
        structured: {
          event_type: 'hiring',
          ats_provider: board.provider,
          ats_token: board.token,
          new_role_count: newJobs.length,
          total_open_roles: jobIds.length,
          departments,
          seniorities,
          roles: newJobs.slice(0, 50).map((j) => ({
            id: j.id,
            title: j.title,
            department: j.department ?? null,
            location: j.location ?? null,
            url: j.url ?? null,
            seniority: seniorityOf(j.title),
            posted_at: j.posted_at ?? null,
          })),
          evidence_url: board.board_url ?? newJobs[0]?.url ?? null,
        },
        entity_hints: hints,
        event_type: 'hiring',
        published_at: new Date().toISOString(),
      },
    });
  }

  return out;
}
