import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { assessCanonicalNewsEvidence } from './news-evidence.ts';

Deno.test('canonical publisher evidence verifies a matching funding article', () => {
  assertEquals(assessCanonicalNewsEvidence({
    finalUrl: 'https://example.com/news/acme-series-a',
    contentType: 'text/html; charset=utf-8',
    body: '<article>Acme raised a $12 million Series A funding round.</article>',
    companyName: 'Acme',
    eventType: 'funding',
  }), { verified: true, reason: 'canonical_article_verified' });
});

Deno.test('Google redirect pages are never canonical evidence', () => {
  assertEquals(assessCanonicalNewsEvidence({
    finalUrl: 'https://news.google.com/articles/abc',
    contentType: 'text/html',
    body: 'Acme raised a Series A funding round',
    companyName: 'Acme',
    eventType: 'funding',
  }).reason, 'not_a_publisher_url');
});

Deno.test('publisher evidence must contain the company and event language', () => {
  assertEquals(assessCanonicalNewsEvidence({
    finalUrl: 'https://publisher.example/story',
    contentType: 'text/html',
    body: 'Another company raised a Series A funding round.',
    companyName: 'Acme',
    eventType: 'funding',
  }).reason, 'company_not_present_on_publisher_page');
  assertEquals(assessCanonicalNewsEvidence({
    finalUrl: 'https://publisher.example/story',
    contentType: 'text/html',
    body: 'Acme released a new logo.',
    companyName: 'Acme',
    eventType: 'funding',
  }).reason, 'event_terms_not_present_on_publisher_page');
});

import { assessBlockedPublisherEvidence } from './news-evidence.ts';

const blocked = {
  finalUrl: 'https://www.businesswire.com/news/x',
  httpStatus: 403,
  headline: 'Acme Raises $20M Series A - Business Wire',
  companyName: 'Acme',
  eventType: 'funding',
};

Deno.test('blocked publisher falls back to a headline naming the company and event', () => {
  assertEquals(assessBlockedPublisherEvidence(blocked), {
    verified: true,
    reason: 'publisher_blocked_headline_verified',
  });
});

Deno.test('headline fallback only applies to publisher blocks, not missing pages', () => {
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, httpStatus: 404 }).verified, false);
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, httpStatus: 500 }).verified, false);
});

Deno.test('headline fallback needs the whole company name, not a token', () => {
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, companyName: 'Acme Robotics' }).reason, 'company_not_in_headline');
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, headline: 'Acmecorp raises Series A' }).reason, 'company_not_in_headline');
});

Deno.test('headline fallback excludes leadership and hiring and Google URLs', () => {
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, eventType: 'leadership_change', headline: 'Acme appoints new Head of Sales' }).verified, false);
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, eventType: 'hiring', headline: 'Acme hiring reps' }).verified, false);
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, finalUrl: 'https://news.google.com/rss/articles/x' }).reason, 'not_a_publisher_url');
});

Deno.test('headline fallback needs event language', () => {
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, headline: 'Acme unveils new logo' }).reason, 'event_terms_not_in_headline');
});

const domainEvidence = {
  finalUrl: 'https://publisher.example/funding',
  contentType: 'text/html',
  companyName: 'Latitude',
  companyDomain: 'latitude.io',
  eventType: 'funding',
};

Deno.test('namesakes must identify the resolved company domain', () => {
  for (const [companyName, companyDomain, body] of [
    ['Latitude', 'latitude.io', '<article>Latitude raised $35M for crypto.</article>'],
    ['Safebox LLC', 'safeboxllc.com', '<article>Safebox raised $1M for Indian wealth protection. <a href="https://safebox.life">Website</a></article>'],
    ['EDT Corp', 'edtcorp.com', '<article>EDT raised $2M for beauty products.</article><footer>Publisher Corporation</footer>'],
  ]) {
    assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence, companyName, companyDomain, body }).verified, false);
  }
});

Deno.test('generic company tokens and partial brand substrings never match', () => {
  for (const body of ['<article>Another firm raised funding.</article><footer>Corporation</footer>', '<article>Acmecorp raised funding.</article>']) {
    assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence, companyName: 'Acme Corp', companyDomain: undefined, body }).reason,
      'company_not_present_on_publisher_page');
  }
});

Deno.test('exact article company links and visible domain mentions bind the identity', () => {
  for (const body of [
    '<article>Latitude raised funding. <a href="https://www.latitude.io/about">Company</a></article>',
    '<article>Latitude raised funding. Website: latitude.io</article>',
    '<article>Latitude raised funding. <a href="https://news.latitude.io/round">Company</a></article>',
  ]) {
    assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence, body }).verified, true);
  }
});

Deno.test('deceptive hostnames cannot establish company domain evidence', () => {
  for (const host of ['latitude.io.evil.example', 'fakelatitude.io']) {
    assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence,
      body: `<article>Latitude raised funding. <a href="https://${host}/">Website</a></article>` }).verified, false);
    assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence,
      body: `<article>Latitude raised funding. Website: ${host}</article>` }).verified, false);
  }
});

Deno.test('unrelated footer, script and navigation links do not bind an article', () => {
  for (const extra of ['<footer><a href="https://latitude.io">Sponsor</a></footer>',
    '<script>const x="latitude.io";</script>', '<nav><a href="https://latitude.io">Partner</a></nav>']) {
    assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence,
      body: `<article>Latitude raised funding.</article>${extra}` }).verified, false);
  }
});

Deno.test('first-party publisher pages bind the domain with whole distinctive company names', () => {
  assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence, finalUrl: 'https://news.latitude.io/round',
    companyName: 'Latitude LLC', body: '<article>Latitude raised funding.</article>' }).verified, true);
});

Deno.test('blocked third-party headline evidence lacks company domain binding', () => {
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, companyDomain: 'acme.com' }).reason,
    'company_domain_not_verified_for_blocked_publisher');
  assertEquals(assessBlockedPublisherEvidence({ ...blocked, companyDomain: 'acme.com',
    finalUrl: 'https://news.acme.com/round' }).verified, true);
});

Deno.test('event terms elsewhere on the page cannot verify an unrelated article', () => {
  assertEquals(assessCanonicalNewsEvidence({ ...domainEvidence,
    body: '<article>Latitude released a logo. <a href="https://latitude.io">Company</a></article><footer>Funding news</footer>' }).reason,
    'event_terms_not_present_on_publisher_page');
});
