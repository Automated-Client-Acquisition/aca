import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  CANONICAL_NEWS_RETRY_MS,
  CANONICAL_PUBLISHER_VERIFIER_VERSION,
  inVerificationCooldown,
  selectPublishEvidence,
  type PublishEvidenceObservation,
} from './publish-evidence.ts';

const NOW = Date.parse('2026-10-07T12:00:00Z');

function observation(
  id: string,
  overrides: Partial<PublishEvidenceObservation> = {},
): PublishEvidenceObservation {
  return {
    id,
    source_url: `https://publisher.example/${id}`,
    title: 'Acme raises a Series A',
    collector_key: 'google_news_rss',
    structured: { evidence_status: 'rss_headline_only' },
    signal_sources: { label: 'Google News' },
    ...overrides,
  };
}

function attempted(id: string, hoursAgo: number, verifierVersion = CANONICAL_PUBLISHER_VERIFIER_VERSION) {
  return observation(id, {
    structured: {
      evidence_status: 'rss_headline_only',
      canonical_verification_attempted_at: new Date(NOW - hoursAgo * 60 * 60 * 1000).toISOString(),
      canonical_verification_decoder_version: verifierVersion,
    },
  });
}

Deno.test('unattempted publisher observation escapes a first observation in cooldown', () => {
  assertEquals(selectPublishEvidence([
    attempted('first-failed', 1),
    observation('never-attempted'),
  ], { now: NOW })?.observationId, 'never-attempted');
});

Deno.test('verified news is selected even after an unverified observation', () => {
  for (const evidenceStatus of ['canonical_article_verified', 'publisher_blocked_headline_verified']) {
    assertEquals(selectPublishEvidence([
      observation('unverified'),
      observation('verified', { structured: { evidence_status: evidenceStatus } }),
    ], { now: NOW })?.observationId, 'verified');
  }
});

Deno.test('authoritative filing evidence outranks verified publisher news', () => {
  assertEquals(selectPublishEvidence([
    observation('verified', { structured: { evidence_status: 'canonical_article_verified' } }),
    observation('ats', { collector_key: 'ats_boards', structured: null }),
    observation('filing', { collector_key: 'edgar_form_d', structured: null }),
  ], { now: NOW })?.observationId, 'filing');
});

Deno.test('never-attempted evidence outranks due retries, which run oldest first', () => {
  const retries = [attempted('recent-due', 7), attempted('oldest-due', 24)];
  assertEquals(selectPublishEvidence(retries, { now: NOW })?.observationId, 'oldest-due');
  assertEquals(selectPublishEvidence([...retries, observation('fresh')], { now: NOW })?.observationId, 'fresh');
});

Deno.test('changed verifier versions can run without waiting for the old cooldown', () => {
  const oldVerifier = attempted('old-verifier', 1, 'publisher_v1');
  const selected = selectPublishEvidence([attempted('current-verifier', 1), oldVerifier], { now: NOW })!;
  assertEquals(selected.observationId, 'old-verifier');
  assertEquals(inVerificationCooldown(selected, { now: NOW }), false);
});

Deno.test('cooldown expires exactly at the retry boundary', () => {
  const evidence = selectPublishEvidence([attempted('retry', 6)], { now: NOW })!;
  assertEquals(inVerificationCooldown(evidence, { now: NOW - 1 }), true);
  assertEquals(inVerificationCooldown(evidence, { now: NOW }), false);
  assertEquals(CANONICAL_NEWS_RETRY_MS, 6 * 60 * 60 * 1000);
});

Deno.test('resolved publisher evidence outranks Google wrappers even during cooldown', () => {
  assertEquals(selectPublishEvidence([
    observation('wrapper', { source_url: 'https://news.google.com/rss/articles/abc' }),
    attempted('publisher', 1),
  ], { now: NOW })?.observationId, 'publisher');
});

Deno.test('evidence selection preserves metadata and does not mutate query results', () => {
  const rows = [observation('b'), observation('a', {
    structured: { evidence_status: 'rss_headline_only', publisher: 'Publisher' },
    signal_sources: [{ label: 'Feed' }],
  })];
  const before = JSON.stringify(rows);
  const selected = selectPublishEvidence(rows, { now: NOW });
  assertEquals(selected?.observationId, 'a');
  assertEquals(selected?.sourceLabel, 'Publisher');
  assertEquals(JSON.stringify(rows), before);
});

Deno.test('invalid attempt dates are retryable and missing evidence URLs are ignored', () => {
  const invalidDate = observation('invalid-date', {
    structured: {
      evidence_status: 'rss_headline_only',
      canonical_verification_attempted_at: 'invalid',
      canonical_verification_decoder_version: CANONICAL_PUBLISHER_VERIFIER_VERSION,
    },
  });
  const evidence = selectPublishEvidence([invalidDate], { now: NOW })!;
  assertEquals(inVerificationCooldown(evidence, { now: NOW }), false);
  assertEquals(selectPublishEvidence([observation('missing', { source_url: null })]), null);
  assertEquals(selectPublishEvidence([]), null);
});

Deno.test('cached verification cannot bypass a changed verifier or company domain', async () => {
  const { isBoundNewsEvidence } = await import('./publish-evidence.ts');
  const evidence = selectPublishEvidence([observation('bound', {
    structured: { evidence_status: 'canonical_article_verified',
      canonical_verification_decoder_version: CANONICAL_PUBLISHER_VERIFIER_VERSION,
      canonical_verified_company_domain: 'acme.com' },
  })])!;
  assertEquals(isBoundNewsEvidence(evidence, 'acme.com'), true);
  assertEquals(isBoundNewsEvidence(evidence, 'namesake.example'), false);
  assertEquals(isBoundNewsEvidence({ ...evidence, structured: { ...evidence.structured,
    canonical_verification_decoder_version: 'publisher_v2' } }, 'acme.com'), false);
  assertEquals(isBoundNewsEvidence({ ...evidence, structured: { ...evidence.structured,
    canonical_verified_company_domain: null } }, 'acme.com'), false);
});
