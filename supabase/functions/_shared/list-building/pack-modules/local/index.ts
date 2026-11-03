/**
 * Proprietary pack provider — reads the ACA Signal Engine's own signal_events.
 *
 * The counterpart to signalbase/index.ts. Where that module calls out to an
 * Apify actor and bills $0.04 per result, this one runs a single indexed SELECT
 * against events our own collectors already gathered, resolved and deduped.
 *
 * WHY THIS IS A PLAIN SYNC READ
 * ---------------------------------------------------------------------------
 * The SignalBase module needs kickoff() + AsyncRunHandle + the apify-poller
 * because the work happens *during* the refresh and can take half an hour.
 * Here the collectors run on their own schedule, so by the time a subscription
 * refreshes the events are already sitting in Postgres. No async handshake, no
 * dataset polling, no partial-run recovery — the whole machinery simply isn't
 * needed on this path. (It stays in place untouched for the BYO-Apify provider.)
 *
 * WHAT IT ADDS OVER THE BOUGHT FEED
 * ---------------------------------------------------------------------------
 *   confidence  — corroboration across independent sources, filterable per
 *                 subscription via config.min_confidence. A vendor cannot sell
 *                 this; they are one of the sources being corroborated.
 *   people      — EDGAR Form D names executives and directors in the filing, so
 *                 decision-maker hints arrive with the signal and before any
 *                 enrichment spend.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { DiscoveryRecord, PackModule } from '../types.ts';

/**
 * Engine event_type -> the signal_metadata.type the rest of ACA already speaks.
 *
 * These strings are load-bearing: the activity feed, the public /signals page
 * and the {{ai_signal_*}} outreach variables all key off them. Keeping the
 * existing vocabulary is what lets the provider swap underneath a live
 * subscription without anything downstream noticing.
 */
const DETAIL_TYPE: Record<string, string> = {
  funding: 'just_funded',
  hiring: 'aggressive_hiring',
  leadership_change: 'new_leadership',
  acquisition: 'recent_acquisition',
  intent: 'topic_intent',
};

interface EventRow {
  id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  confidence: number;
  corroboration_count: number;
  first_seen_at: string;
  company_identities: {
    id: string;
    name: string;
    domain: string | null;
    website_url: string | null;
    linkedin_url: string | null;
    industry: string | null;
    employee_count: number | null;
    country: string | null;
  } | null;
}

function money(amount: unknown, currency = 'USD'): string | null {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return currency === 'USD' ? `$${Math.round(n).toLocaleString()}` : `${Math.round(n).toLocaleString()} ${currency}`;
}

/** Human-readable one-liner, mirroring the shape SignalBase records produce. */
function buildDetail(row: EventRow): string {
  const p = row.payload ?? {};
  switch (row.event_type) {
    case 'funding': {
      const parts: string[] = [];
      const amt = money(p.total_offering_amount ?? p.amount, String(p.currency ?? 'USD'));
      if (p.round_type) parts.push(String(p.round_type));
      if (amt) parts.push(amt);
      const investors = Array.isArray(p.investors) ? (p.investors as unknown[]).slice(0, 2) : [];
      if (investors.length) parts.push(`${investors.join(', ')}-led`);
      if (!parts.length && p.form_type) parts.push(`SEC Form ${p.form_type} filed`);
      return parts.join(', ') || 'Funding round disclosed';
    }
    case 'hiring': {
      const n = Number(p.new_role_count ?? 0);
      const depts = Array.isArray(p.departments) ? (p.departments as string[]).slice(0, 3) : [];
      return `Opened ${n} new role${n === 1 ? '' : 's'}${depts.length ? ` in ${depts.join(', ')}` : ''}`;
    }
    case 'acquisition': {
      const items = Array.isArray(p.items) ? (p.items as string[]) : [];
      return items.length ? `M&A activity: ${items[0]}` : 'Acquisition activity disclosed';
    }
    case 'leadership_change':
      return p.person_name ? `${p.person_name} now ${p.new_role ?? 'in a new role'}` : 'Leadership change';
    default:
      return String(p.summary ?? 'Buying signal detected');
  }
}

/**
 * Decision-maker hint. EDGAR Form D lists related persons with their
 * relationship, so a funding signal arrives already naming an executive —
 * something the bought feed never provided.
 */
function personFrom(payload: Record<string, unknown>): DiscoveryRecord['person'] | undefined {
  const dms = payload.decision_makers ?? payload.related_persons;
  if (!Array.isArray(dms) || dms.length === 0) return undefined;
  const first = dms[0] as { name?: string; relationships?: string[] };
  const name = String(first?.name ?? '').trim();
  if (!name) return undefined;
  const bits = name.split(/\s+/);
  return {
    first: bits[0] ?? '',
    last: bits.slice(1).join(' '),
    title: Array.isArray(first.relationships) ? first.relationships.join(', ') : '',
  };
}

export interface LocalModuleOptions {
  packKey: string;
  /** signal_events.event_type values this pack surfaces. */
  eventTypes: string[];
  label: string;
  tier: 'signal' | 'trade' | 'pro_services';
  /** Floor when the subscription doesn't set config.min_confidence. */
  defaultMinConfidence?: number;
  /**
   * How old the underlying EVENT may be, regardless of when we discovered it.
   *
   * Discovery date and event date are not the same thing, and conflating them
   * produces confidently wrong outreach. SEC filings make this vivid: on a
   * single day in Aug 2026, Mbq Pharma filed catch-up Form Ds for rounds that
   * closed in 2018, 2021 and 2023. All four are real, all four were discovered
   * today — and congratulating a founder on a raise that closed eight years ago
   * is worse than saying nothing.
   *
   * Same class of bug as the public /signals feed re-stamping every card as
   * freshly found. Filter on both: recently discovered AND actually recent.
   */
  defaultMaxEventAgeDays?: number;
}

export function buildLocalSignalModule(opts: LocalModuleOptions): PackModule {
  const moduleKey = `aca_engine_${opts.packKey}`;

  return {
    key: moduleKey,
    pack: opts.packKey,
    tier: opts.tier,
    label: opts.label,

    async *run({ filters, sinceIso, limit, signal }) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const cfg = (filters ?? {}) as Record<string, unknown>;
      const minConfidence = Number(cfg.min_confidence ?? opts.defaultMinConfidence ?? 1);
      const maxEventAgeDays = Number(
        cfg.max_event_age_days ?? opts.defaultMaxEventAgeDays ?? 90,
      );
      const fetchLimit = Math.min(limit ?? 200, 1000);
      const occurredFloor = new Date(Date.now() - maxEventAgeDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      // Filter on first_seen_at, not occurred_at: a funding round is often
      // filed weeks after it closed, and keying on the event date would hide
      // every signal we discovered late behind the subscription's watermark.
      const since = sinceIso ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('signal_events')
        .select(
          'id, event_type, occurred_at, payload, confidence, corroboration_count, first_seen_at, ' +
            'company_identities!inner(id, name, domain, website_url, linkedin_url, industry, employee_count, country)',
        )
        .in('event_type', opts.eventTypes)
        .gte('confidence', minConfidence)
        .gte('first_seen_at', since)
        // Recently DISCOVERED is not the same as recently HAPPENED — see
        // defaultMaxEventAgeDays. Both gates are required.
        .gte('occurred_at', occurredFloor)
        // A company with no domain cannot be scored, enriched or emailed, so it
        // is not a lead yet. Leaving it out here (rather than letting the
        // pipeline discard it later) keeps the activity log honest.
        .not('company_identities.domain', 'is', null)
        .order('first_seen_at', { ascending: false })
        .limit(fetchLimit);

      if (error) {
        console.error(`[${moduleKey}] query failed: ${error.message}`);
        return;
      }

      for (const raw of (data ?? []) as unknown as EventRow[]) {
        if (signal?.aborted) return;
        const company = raw.company_identities;
        if (!company?.domain) continue;

        const detail = buildDetail(raw);
        const evidenceUrl = String(raw.payload?.evidence_url ?? '') || '';

        const rec: DiscoveryRecord = {
          company: {
            company_name: company.name,
            domain: company.domain,
            website_url: company.website_url ?? `https://${company.domain}`,
            linkedin_url: company.linkedin_url,
            employee_signal:
              company.employee_count != null ? `${company.employee_count} employees (aca engine)` : null,
            employee_count_estimate: company.employee_count,
            country: company.country,
            source: 'directory',
            raw_html_snippet: null,
          },
          signal_metadata: {
            type: DETAIL_TYPE[raw.event_type] ?? raw.event_type,
            date: raw.occurred_at,
            detail,
            evidence_url: evidenceUrl,
            context: {
              ...raw.payload,
              signal_event_id: raw.id,
              signal_detail: detail,
              // Surfaced deliberately: this is the number that distinguishes a
              // legally-filed, multiply-confirmed event from a single rumour,
              // and outreach copy can lean on it.
              confidence: raw.confidence,
              corroboration_count: raw.corroboration_count,
              provider: 'aca_engine',
            },
          },
          person: personFrom(raw.payload ?? {}),
          source: moduleKey,
          source_url: evidenceUrl,
          raw_signal: raw.payload as Record<string, unknown>,
        };

        yield rec;
      }
    },
    // No kickoff(): collection already happened out of band. See header.
  };
}

export const localFundingModule = buildLocalSignalModule({
  packKey: 'just_funded_saas',
  eventTypes: ['funding'],
  label: 'ACA Engine — Funding (SEC + press)',
  tier: 'signal',
  defaultMinConfidence: 2,
  defaultMaxEventAgeDays: 90,
});

export const localHiringModule = buildLocalSignalModule({
  packKey: 'aggressive_hiring',
  eventTypes: ['hiring'],
  label: 'ACA Engine — Hiring (ATS boards)',
  tier: 'signal',
  defaultMinConfidence: 2,
  defaultMaxEventAgeDays: 30,
});

export const localLeadershipModule = buildLocalSignalModule({
  packKey: 'new_leadership',
  eventTypes: ['leadership_change'],
  label: 'ACA Engine — Leadership changes',
  tier: 'signal',
  // A headline-only RSS match is useful discovery evidence, but not enough to
  // create a lead or personalize outreach without independent corroboration.
  defaultMinConfidence: 2,
  defaultMaxEventAgeDays: 60,
});

export const localAcquisitionModule = buildLocalSignalModule({
  packKey: 'recent_acquisitions',
  eventTypes: ['acquisition'],
  label: 'ACA Engine — M&A (SEC 8-K + press)',
  tier: 'signal',
  defaultMinConfidence: 2,
  defaultMaxEventAgeDays: 90,
});
