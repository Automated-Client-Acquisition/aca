import assert from 'node:assert/strict';
import test from 'node:test';
import { decodingParams, decodedUrlFromBatchResponse, googleNewsArticleToken } from './google-news-resolver.js';

test('extracts Google News article tokens', () => {
  assert.equal(googleNewsArticleToken('https://news.google.com/rss/articles/abc123?oc=5'), 'abc123');
  assert.equal(googleNewsArticleToken('https://example.com/articles/abc123'), null);
});

test('reads decoder attributes from a Google article page', () => {
  assert.deepEqual(decodingParams('<div data-n-a-sg="signature" data-n-a-ts="12345"></div>'), {
    signature: 'signature', timestamp: '12345',
  });
});

test('reads a canonical URL from a batch response', () => {
  const chunks = [["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", "https://publisher.test/article"])]];
  const body = `)]}'\n\n${JSON.stringify(chunks)}`;
  assert.equal(decodedUrlFromBatchResponse(body), 'https://publisher.test/article');
});
