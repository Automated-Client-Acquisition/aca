import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCompany,
  filterFreshObservations,
  googleArticleId,
  GOOGLE_NEWS_QUERIES,
  parseGoogleNewsRss,
} from './google-news.js';

test('the recovered Google News registry remains complete and categorized', () => {
  assert.equal(GOOGLE_NEWS_QUERIES.length, 83);
  const counts = GOOGLE_NEWS_QUERIES.reduce<Record<string, number>>((all, item) => {
    all[item.type] = (all[item.type] ?? 0) + 1;
    return all;
  }, {});
  assert.deepEqual(counts, {
    funding: 30,
    acquisition: 16,
    hiring: 12,
    leadership_change: 15,
    growth: 10,
  });
});

test('extracts conservative company identities from supported event headlines', () => {
  assert.equal(extractCompany('Comet raises $100M Series B - TechCrunch', 'funding'), 'Comet');
  assert.equal(extractCompany('OpenAI acquires startup Windsurf - Example', 'acquisition'), 'Windsurf');
  assert.equal(extractCompany('Acme appoints VP of Sales - Business Wire', 'leadership_change'), 'Acme');
  assert.equal(extractCompany('Why startup funding slowed in Europe - News', 'funding'), null);
});

test('strips descriptive startup prefixes and rejects nameless descriptions', () => {
  assert.equal(extractCompany('Voice AI Startup Navana.ai Raises Rs 40 Cr in Series A - News', 'funding'), 'Navana.ai');
  assert.equal(extractCompany('AI content creator platform Creedom raises seed round - News', 'funding'), 'Creedom');
  assert.equal(extractCompany('Women’s wellness brand Nua raises Series C - News', 'funding'), 'Nua');
  assert.equal(extractCompany('Google-backed Indian space startup raises $100 million - News', 'funding'), null);
});

test('parses RSS items, rejects unrelated headlines, and preserves raw evidence status', () => {
  const fixture = `<?xml version="1.0"?><rss><channel>
    <item><guid>one</guid><title>Comet raises $100M Series B - TechCrunch</title>
      <link>https://news.google.com/rss/articles/one</link>
      <pubDate>Sun, 07 Sep 2026 08:00:00 GMT</pubDate>
      <source url="https://techcrunch.com">TechCrunch</source></item>
    <item><guid>two</guid><title>Ten ways to raise productivity - Blog</title>
      <link>https://news.google.com/rss/articles/two</link></item>
  </channel></rss>`;
  const rows = parseGoogleNewsRss(fixture, 'funding', 'raises Series B');
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].external_id,
    googleArticleId('TechCrunch', 'Comet raises $100M Series B - TechCrunch'),
  );
  assert.equal(rows[0].entity_hints.company_name, 'Comet');
  assert.equal(rows[0].structured?.evidence_status, 'rss_headline_only');
  assert.equal(rows[0].structured?.source_guid, 'one');
  assert.equal(rows[0].published_at, '2026-09-07T08:00:00.000Z');
});

test('article identity is stable across overlapping queries and redirect tokens', () => {
  assert.equal(
    googleArticleId('Example News', 'Acme raises Series A - Example News'),
    googleArticleId('example news', 'Acme raises Series A | Example News'),
  );
});

test('freshness cursor drops both prior-run and same-run duplicate articles', () => {
  const old = { external_id: 'old', entity_hints: {} };
  const fresh = { external_id: 'fresh', entity_hints: {} };
  const result = filterFreshObservations([old, fresh, fresh], new Set(['old']));
  assert.deepEqual(result.fresh, [fresh]);
  assert.equal(result.duplicates, 2);
});
