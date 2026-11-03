/**
 * ACA Discovery Layer — Pack Source Module contracts.
 *
 * Pack modules are pluggable Step-1 producers: each one yields companies
 * (plus optional decision-maker hints and signal metadata) that flow into
 * the existing list-building pipeline (DM → pattern → SMTP → ICP).
 *
 * Spec: ACA Discovery Layer Implementation Brief v1.2, §8.
 */

import type { DiscoveredCompany } from '../types.ts';

export type PackTier = 'signal' | 'trade' | 'pro_services';

export interface SignalMetadata {
  type: string;            // e.g. 'just_funded', 'aggressive_hiring', 'tech_stack_change'
  date: string;            // ISO YYYY-MM-DD
  detail: string;          // human-readable detail e.g. 'Series B, $30M, Sequoia-led'
  evidence_url: string;    // canonical source for the signal
  context?: Record<string, unknown>; // structured payload for outreach personalization
}

export interface DiscoveryRecord {
  /** Company-level fields — fed into lb_discovered_companies. */
  company: DiscoveredCompany;
  /** Optional pre-resolved decision-maker hint. */
  person?: {
    first: string;
    last: string;
    title: string;
    linkedin_url?: string;
  };
  /** Pack-specific signal payload, surfaced to {{ai_signal_*}} variables. */
  signal_metadata?: SignalMetadata;
  /** Free-text source identifier, e.g. 'crunchbase'. Mapped to lb_discovered_companies.source. */
  source: string;
  /** Canonical URL for this record (where it was scraped from). */
  source_url: string;
  /**
   * Full raw provider record (e.g. one SignalBase dataset item). Carried
   * end-to-end so the UI can show every datapoint per signal — letting
   * the user decide which fields to surface in outreach without a
   * schema migration each time. Stored as JSONB on signal_activity_log.data.
   */
  raw_signal?: Record<string, unknown>;
}

export interface PackRunConfig {
  organizationId: string;
  /** Pack-specific filters: geo selectors, industries, headcount ranges, etc. */
  filters: Record<string, unknown>;
  /** ISO timestamp; modules that emit deltas should ignore items older than this. */
  sinceIso?: string;
  /** Hard cap on records the module yields per run. */
  limit?: number;
  /** AbortSignal honored for graceful cancellation. */
  signal?: AbortSignal;
}

/**
 * Result of kicking off an async (Apify) run. The pack-refresh launcher
 * persists these into pack_refresh_jobs.apify_runs; the apify-poller
 * cron resumes processing once the run completes.
 */
export interface AsyncRunHandle {
  /** Apify run ID (`acts/{actorId}/runs/{runId}`). */
  run_id: string;
  /** Apify dataset ID where the actor writes its results. */
  dataset_id: string;
  /** Originating pack module key (e.g. 'signalbase_funding'). */
  module_key: string;
  /** Signal type (e.g. 'just_funded', 'aggressive_hiring') for downstream metadata. */
  signal_type: string;
  /** Free-text source identifier carried into lb_discovered_companies.source. */
  source: string;
}

export interface PackModule {
  /** Stable module identifier; persisted in lb_discovered_companies.metadata. */
  key: string;
  /** Pack subscription this module belongs to. */
  pack: string;
  /** Tier classification (drives default UI grouping and cadence). */
  tier: PackTier;
  /** Human-readable label for logs / UI. */
  label: string;
  /** Sync async iterator over discovered records — used when kickoff() isn't
   *  defined or as an emergency fallback. */
  run(config: PackRunConfig): AsyncIterable<DiscoveryRecord>;
  /**
   * Async path: kicks off long-running scrape on the underlying provider
   * (e.g. Apify) and returns immediately with a handle. The apify-poller
   * polls run completion and processes the dataset out-of-band. Modules
   * without this method fall through to the sync `run()` iterator.
   */
  kickoff?(config: PackRunConfig): Promise<AsyncRunHandle[]>;
  /**
   * Map a single raw provider record (e.g. one row from an Apify dataset)
   * into a DiscoveryRecord. Required when `kickoff()` is defined — the
   * poller calls this to translate dataset items back into the pipeline's
   * canonical record shape.
   */
  mapRecord?(raw: Record<string, unknown>, ctx: { signalType: string; moduleKey: string; sourceLabel: string }): DiscoveryRecord | null;
}
