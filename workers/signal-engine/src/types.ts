/**
 * ACA Signal Engine — collector contracts.
 *
 * Every collector produces the same thing: a RawObservation. Collectors do NOT
 * resolve companies, classify events, or dedupe — that all happens later in the
 * refinery ticks. Keeping collection dumb is deliberate: the v1 scrapers
 * (ripped out in 1a812ac8) interleaved fetching with domain-resolution
 * heuristics, so a resolution bug meant re-scraping the source to fix it. Here
 * the raw row is durable and reprocessing is free.
 */

/** One raw thing we observed at a source. Never interpreted at write time. */
export interface RawObservation {
  /** Stable id at the source — accession number, job id, RSS guid, post id.
   *  Combined with source_id this is the idempotency key, so re-polling a feed
   *  after a crash is safe and cheap. */
  external_id: string;
  source_url?: string;
  title?: string;
  /** Prose needing LLM extraction. Leave undefined for structured sources —
   *  its presence is what routes a row through (paid) extraction. */
  body_text?: string;
  /** Already-structured payload. When set, the extract tick passes the row
   *  straight through without spending a token on it. */
  structured?: Record<string, unknown>;
  /** Whatever identity we got for free. The more of this a collector fills in,
   *  the less the resolver has to buy from MoltSets. */
  entity_hints: EntityHints;
  /** Event type when the source makes it unambiguous (EDGAR Form D is always
   *  funding). Undefined means the extract tick has to classify it. */
  event_type?: string;
  published_at?: string;
}

export interface EntityHints {
  company_name?: string;
  domain?: string;
  website_url?: string;
  linkedin_url?: string;
  /** SEC Central Index Key — a permanent unique company id, the single most
   *  valuable hint available because it never collides. */
  cik?: string;
  ats_provider?: string;
  ats_token?: string;
  country?: string;
  state?: string;
  industry?: string;
}

/** A row of signal_sources: one feed / board / form type we poll. */
export interface SignalSource {
  id: string;
  kind: string;
  collector_key: string;
  external_key: string;
  label: string;
  config: Record<string, unknown>;
  cursor: Record<string, unknown>;
  enabled: boolean;
  consecutive_empty_runs: number;
  consecutive_failures: number;
  last_run_at: string | null;
  last_success_at: string | null;
}

export interface CollectResult {
  observations: RawObservation[];
  /** Opaque resume state merged into signal_sources.cursor on success. */
  cursor?: Record<string, unknown>;
  /** Free-form run detail recorded on signal_engine_runs.meta. */
  meta?: Record<string, unknown>;
}

export interface CollectContext {
  source: SignalSource;
  /** Only look at things newer than this. */
  since: Date;
  /** Hard ceiling on observations for one run — a runaway backfill must not be
   *  able to write a million rows before anyone notices. */
  limit: number;
  signal?: AbortSignal;
}

export interface Collector {
  key: string;
  kind: string;
  collect(ctx: CollectContext): Promise<CollectResult>;
}
