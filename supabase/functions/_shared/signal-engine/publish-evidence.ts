/** Evidence selection must let every publisher observation make progress. */

export const CANONICAL_NEWS_RETRY_MS = 6 * 60 * 60 * 1000;
export const CANONICAL_PUBLISHER_VERIFIER_VERSION = 'publisher_v3_domain_bound';

/** Cached article verification is valid only for the exact resolved company. */
export function isBoundNewsEvidence(evidence: EvidenceRow, companyDomain: string): boolean {
  return evidence.collectorKey === 'google_news_rss'
    && (evidence.evidenceStatus === 'canonical_article_verified'
      || evidence.evidenceStatus === 'publisher_blocked_headline_verified')
    && evidence.structured.canonical_verification_decoder_version === CANONICAL_PUBLISHER_VERIFIER_VERSION
    && evidence.structured.canonical_verified_company_domain === companyDomain;
}

export interface PublishEvidenceObservation {
  id: string;
  source_url: string | null;
  title: string | null;
  collector_key: string;
  structured: Record<string, unknown> | null;
  signal_sources?: { label?: string } | Array<{ label?: string }> | null;
}

export interface EvidenceRow {
  observationId: string;
  source_url: string;
  title: string;
  sourceLabel: string;
  collectorKey: string;
  evidenceStatus?: string;
  structured: Record<string, unknown>;
}

export interface EvidenceSelectionOptions {
  now?: number;
  verifierVersion?: string;
  retryMs?: number;
}

const SOURCE_AUTHORITY: Record<string, number> = {
  edgar_form_d: 5,
  edgar_8k: 5,
  ats_boards: 4,
  yc_directory: 2,
  google_news_rss: 1,
};

const VERIFIED_NEWS_STATUSES = new Set([
  'canonical_article_verified',
  'publisher_blocked_headline_verified',
]);

export function inVerificationCooldown(
  evidence: EvidenceRow,
  options: EvidenceSelectionOptions = {},
): boolean {
  const attemptedAt = verificationAttemptTime(evidence);
  return attemptedAt !== null
    && stringValue(evidence.structured.canonical_verification_decoder_version)
      === (options.verifierVersion ?? CANONICAL_PUBLISHER_VERIFIER_VERSION)
    && (options.now ?? Date.now()) - attemptedAt < (options.retryMs ?? CANONICAL_NEWS_RETRY_MS);
}

/**
 * Prefer usable evidence, then an article that can actually be checked now.
 * Picking the first news row by source authority pins an event to one failed
 * publisher forever, even when its other observations were never attempted.
 */
export function selectPublishEvidence(
  observations: PublishEvidenceObservation[],
  options: EvidenceSelectionOptions = {},
): EvidenceRow | null {
  const now = options.now ?? Date.now();
  const selectionOptions = { ...options, now };
  const evidence = observations.flatMap((row): EvidenceRow[] => {
    const sourceUrl = stringValue(row.source_url);
    if (!sourceUrl) return [];
    const source = Array.isArray(row.signal_sources) ? row.signal_sources[0] : row.signal_sources;
    return [{
      observationId: row.id,
      source_url: sourceUrl,
      title: row.title ?? '',
      sourceLabel: stringValue(row.structured?.publisher) ?? source?.label ?? row.collector_key,
      collectorKey: row.collector_key,
      evidenceStatus: stringValue(row.structured?.evidence_status),
      structured: row.structured ?? {},
    }];
  });

  evidence.sort((a, b) => {
    const priority = evidencePriority(a, selectionOptions) - evidencePriority(b, selectionOptions);
    if (priority) return priority;
    const authority = (SOURCE_AUTHORITY[b.collectorKey] ?? 0) - (SOURCE_AUTHORITY[a.collectorKey] ?? 0);
    if (authority) return authority;
    const attemptOrder = (verificationAttemptTime(a) ?? 0) - (verificationAttemptTime(b) ?? 0);
    return attemptOrder || a.observationId.localeCompare(b.observationId);
  });
  return evidence[0] ?? null;
}

function evidencePriority(evidence: EvidenceRow, options: EvidenceSelectionOptions): number {
  if (isGoogleNewsUrl(evidence.source_url)) return 5;
  if (evidence.collectorKey !== 'google_news_rss' && evidence.evidenceStatus !== 'rss_headline_only') return 0;
  if (VERIFIED_NEWS_STATUSES.has(evidence.evidenceStatus ?? '')) return 1;
  if (inVerificationCooldown(evidence, options)) return 4;
  const attemptedAt = verificationAttemptTime(evidence);
  const currentVerifier = stringValue(evidence.structured.canonical_verification_decoder_version)
    === (options.verifierVersion ?? CANONICAL_PUBLISHER_VERIFIER_VERSION);
  return attemptedAt === null || !currentVerifier ? 2 : 3;
}

function verificationAttemptTime(evidence: EvidenceRow): number | null {
  const value = stringValue(evidence.structured.canonical_verification_attempted_at);
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isGoogleNewsUrl(value: string): boolean {
  try {
    return new URL(value).hostname === 'news.google.com';
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
