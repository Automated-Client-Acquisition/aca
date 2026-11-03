import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYcAlgoliaOptions, parseYcDirectoryHtml, ycContinuationRequests } from './yc-directory.js';

test('extracts company records from the directory JSON without executing scripts', () => {
  const fixture = `<html><script type="application/json">${JSON.stringify({
    props: {
      companies: [
        { name: 'Acme AI', slug: 'acme-ai', website: 'https://acme.ai', batch: 'S2026' },
        { name: 'Beta', slug: 'beta', website_url: 'beta.com', one_liner: 'Useful software' },
      ],
    },
  })}</script></html>`;
  assert.deepEqual(parseYcDirectoryHtml(fixture), [
    { name: 'Acme AI', slug: 'acme-ai', website: 'https://acme.ai', batch: 'S2026', status: undefined, location: undefined, description: undefined },
    { name: 'Beta', slug: 'beta', website: 'beta.com', batch: undefined, status: undefined, location: undefined, description: 'Useful software' },
  ]);
});

test('ignores malformed JSON and objects without stable slugs', () => {
  const fixture = '<script type="application/json">bad json</script>' +
    '<script type="application/json">{"companies":[{"name":"No slug"}]}</script>';
  assert.deepEqual(parseYcDirectoryHtml(fixture), []);
});

test('reads the public search credentials from the live page contract', () => {
  const fixture = '<script>window.AlgoliaOpts = {"app":"public-app","key":"search-only-key"};</script>';
  assert.deepEqual(parseYcAlgoliaOptions(fixture), {
    app: 'public-app',
    key: 'search-only-key',
  });
  assert.equal(parseYcAlgoliaOptions('<html></html>'), null);
});

test('plans every remaining YC page and rejects inaccessible result caps', () => {
  const requests = ycContinuationRequests(['S2026'], [{
    nbHits: 620,
    nbPages: 3,
    hitsPerPage: 250,
  }]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].params, /page=1/);
  assert.match(requests[1].params, /page=2/);

  assert.throws(
    () => ycContinuationRequests(['oversized'], [{ nbHits: 1200, nbPages: 4, hitsPerPage: 250 }]),
    /accessible pagination window/,
  );
});
