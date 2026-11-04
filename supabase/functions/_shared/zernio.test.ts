import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildZernioPost,
  createZernioDestination,
  ensureZernioProfile,
  fetchZernioPostAnalytics,
  findZernioPostId,
  getZernioConnectUrl,
  listZernioAccounts,
  parseZernioDestination,
  publishToZernio,
  readZernioAnalytics,
  readZernioOutcome,
  ZernioError,
} from './zernio.ts';
import { nextMetricsFetch } from './post-metrics.ts';

type Call = { url: string; method: string; headers: Record<string, string>; body?: any };

function fakeFetch(responses: Array<{ status: number; body: unknown }>, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method || 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift() ?? { status: 500, body: { error: 'no more responses' } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

Deno.test('destinations round-trip and reject junk', () => {
  assertEquals(parseZernioDestination(createZernioDestination('65f1a2b3c4d5e6f7a8b9c0d1')), '65f1a2b3c4d5e6f7a8b9c0d1');
  assertEquals(parseZernioDestination('unipile:abc:profile'), null);
  assertEquals(parseZernioDestination('zernio:../x'), null);
  assertThrows(() => createZernioDestination('a b'));
});

Deno.test('lists healthy posting accounts in ACA platform names, and says why the rest are left out', async () => {
  const calls: Call[] = [];
  const listed = await listZernioAccounts('sk_test', fakeFetch([{ status: 200, body: { accounts: [
    { _id: 'acc_ig_000001', platform: 'instagram', username: 'brand', displayName: 'Brand', profilePicture: 'https://x/p.jpg', isActive: true },
    { _id: 'acc_gbp_00001', platform: 'googlebusiness', displayName: 'Shop', isActive: true },
    { _id: 'acc_ads_00001', platform: 'metaads', displayName: 'Ads', isActive: true },
    { _id: 'acc_tt_000001', platform: 'tiktok', username: 'dead', isActive: true, needsReconnection: true },
    { _id: 'acc_fb_000001', platform: 'facebook', displayName: 'Auto page', isActive: true, enabled: false },
  ] } }], calls));
  assertEquals(calls[0].url, 'https://zernio.com/api/v1/accounts?includeOverLimit=true');
  assertEquals(calls[0].headers.Authorization, 'Bearer sk_test');
  assertEquals(listed.total, 5);
  assertEquals(listed.accounts, [
    { id: 'acc_ig_000001', platform: 'instagram', name: 'Brand', username: 'brand', avatar_url: 'https://x/p.jpg' },
    { id: 'acc_gbp_00001', platform: 'google', name: 'Shop' },
  ]);
  assertEquals(listed.skipped, [
    { platform: 'metaads', name: 'Ads', reason: 'unsupported_platform' },
    { platform: 'tiktok', name: 'dead', reason: 'needs_reconnection' },
    { platform: 'facebook', name: 'Auto page', reason: 'not_enabled' },
  ]);
});

Deno.test('a bad key is a non-retryable error that points to Settings', async () => {
  const err = await assertRejects(() => listZernioAccounts('sk_bad', fakeFetch([{ status: 401, body: { code: 'invalid_credentials' } }], [])), ZernioError);
  assertEquals((err as ZernioError).retryable, false);
});

Deno.test('builds platform payloads: story, reel, carousel, first comment, TikTok consent, Google name', () => {
  const story = buildZernioPost('instagram', 'acc1234', { caption: 'Hi', images: ['https://cdn/a.jpg'], postType: 'story', followUpComment: 'link' });
  assertEquals((story.platforms as any[])[0], { platform: 'instagram', accountId: 'acc1234', platformSpecificData: { contentType: 'story' } });

  const carousel = buildZernioPost('instagram', 'acc1234', { caption: 'Hi', images: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'http://insecure/c.jpg'], followUpComment: ' link ' });
  assertEquals(carousel.mediaItems, [{ type: 'image', url: 'https://cdn/a.jpg' }, { type: 'image', url: 'https://cdn/b.jpg' }]);
  assertEquals((carousel.platforms as any[])[0].platformSpecificData, { firstComment: 'link' });
  assertEquals(carousel.publishNow, true);

  const reel = buildZernioPost('facebook', 'acc1234', { caption: 'Watch', videoUrl: 'https://cdn/v.mp4', postType: 'reel' });
  assertEquals(reel.mediaItems, [{ type: 'video', url: 'https://cdn/v.mp4' }]);
  assertEquals((reel.platforms as any[])[0].platformSpecificData, { contentType: 'reel' });

  const tiktok = buildZernioPost('tiktok', 'acc1234', { caption: 'Clip', videoUrl: 'https://cdn/v.mp4' });
  assertEquals((tiktok.platforms as any[])[0].platformSpecificData, {
    privacyLevel: 'PUBLIC_TO_EVERYONE', allowComment: true, allowDuet: true, allowStitch: true, contentPreviewConfirmed: true, expressConsentGiven: true,
  });

  const gbp = buildZernioPost('google', 'acc1234', { caption: 'Open late tonight' }, { aca_queue_id: 'q1' });
  assertEquals(gbp.platforms, [{ platform: 'googlebusiness', accountId: 'acc1234' }]);
  assertEquals(gbp.metadata, { source: 'aca', aca_queue_id: 'q1' });

  assertThrows(() => buildZernioPost('wordpress', 'acc1234', { caption: 'x' }), ZernioError);
  assertThrows(() => buildZernioPost('instagram', 'acc1234', { caption: '  ' }), ZernioError);
});

Deno.test('reads published, failed-in-a-207 and pending outcomes', () => {
  assertEquals(readZernioOutcome({ post: { _id: 'p1', platforms: [{ accountId: 'a1', status: 'published', platformPostId: '99', platformPostUrl: 'https://ig/p/99' }] } }, 'a1'),
    { state: 'published', postId: 'p1', platformPostId: '99', url: 'https://ig/p/99' });
  assertEquals(readZernioOutcome({ post: { _id: 'p1', platforms: [{ accountId: { _id: 'a1' }, status: 'failed', errorMessage: 'Aspect ratio not supported', errorCategory: 'user_content' }] } }, 'a1'),
    { state: 'failed', postId: 'p1', error: 'Aspect ratio not supported', retryable: false });
  assertEquals(readZernioOutcome({ post: { _id: 'p1', platforms: [{ accountId: 'a1', status: 'failed', errorCategory: 'platform_error', errorMessage: 'Meta 500' }] } }, 'a1').state, 'failed');
  assertEquals(readZernioOutcome({ post: { _id: 'p1', status: 'publishing', platforms: [{ accountId: 'a1', status: 'processing' }] } }, 'a1'), { state: 'pending', postId: 'p1' });
});

Deno.test('publishes with an idempotency key and polls a processing video until it lands', async () => {
  const calls: Call[] = [];
  const outcome = await publishToZernio('sk_test', { content: 'x' }, 'a1', 'queue-row-1', {
    fetchImpl: fakeFetch([
      { status: 201, body: { post: { _id: 'p1', platforms: [{ accountId: 'a1', status: 'processing' }] } } },
      { status: 200, body: { post: { _id: 'p1', platforms: [{ accountId: 'a1', status: 'published', platformPostUrl: 'https://tt/1' }] } } },
    ], calls),
    sleep: async () => {},
  });
  assertEquals(outcome, { state: 'published', postId: 'p1', platformPostId: undefined, url: 'https://tt/1' });
  assertEquals(calls[0].method, 'POST');
  assertEquals(calls[0].headers['Idempotency-Key'], 'queue-row-1');
  assertEquals(calls[1].url, 'https://zernio.com/api/v1/posts/p1');
});

Deno.test('rate limits retry, duplicates do not', async () => {
  const limited = await assertRejects(() => publishToZernio('sk', {}, 'a1', 'k', { fetchImpl: fakeFetch([{ status: 429, body: { error: 'slow down' } }], []) }), ZernioError);
  assertEquals((limited as ZernioError).retryable, true);
  const dup = await assertRejects(() => publishToZernio('sk', {}, 'a1', 'k', { fetchImpl: fakeFetch([{ status: 409, body: {} }], []) }), ZernioError);
  assertEquals((dup as ZernioError).retryable, false);
});

Deno.test('reuses the organization profile found by externalId', async () => {
  const calls: Call[] = [];
  const id = await ensureZernioProfile('sk', 'org-1111-2222', 'Acme', fakeFetch([
    { status: 200, body: { profiles: [{ _id: 'prof_other', externalId: 'someone-else' }, { _id: 'prof_acme', externalId: 'org-1111-2222' }] } },
  ], calls));
  assertEquals(id, 'prof_acme');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://zernio.com/api/v1/profiles?externalId=org-1111-2222&includeOverLimit=true');
});

Deno.test('creates the profile once, idempotently, and survives a create race', async () => {
  const calls: Call[] = [];
  assertEquals(await ensureZernioProfile('sk', 'org-1111-2222', 'Acme', fakeFetch([
    { status: 200, body: { profiles: [] } },
    { status: 201, body: { profile: { _id: 'prof_new', externalId: 'org-1111-2222' } } },
  ], calls)), 'prof_new');
  assertEquals(calls[1].method, 'POST');
  assertEquals(calls[1].headers['Idempotency-Key'], 'aca-profile-org-1111-2222');
  assertEquals(calls[1].body, { name: 'Acme (org-1111)', externalId: 'org-1111-2222' });

  assertEquals(await ensureZernioProfile('sk', 'org-1111-2222', 'Acme', fakeFetch([
    { status: 200, body: { profiles: [] } },
    { status: 409, body: { code: 'profile_external_id_conflict' } },
    { status: 200, body: { profiles: [{ _id: 'prof_raced', externalId: 'org-1111-2222' }] } },
  ], [])), 'prof_raced');
});

Deno.test('asks Zernio for a sign-in link in its own platform names', async () => {
  const calls: Call[] = [];
  const url = await getZernioConnectUrl('sk', 'prof_acme', 'google', 'http://localhost:3002/connect/zernio', fakeFetch([
    { status: 200, body: { authUrl: 'https://accounts.google.com/o/oauth2/auth?x=1' } },
  ], calls));
  assertEquals(url, 'https://accounts.google.com/o/oauth2/auth?x=1');
  assertEquals(calls[0].url, 'https://zernio.com/api/v1/connect/googlebusiness?profileId=prof_acme&redirect_url=http%3A%2F%2Flocalhost%3A3002%2Fconnect%2Fzernio');
  await assertRejects(() => getZernioConnectUrl('sk', 'p', 'wordpress', 'https://x', fakeFetch([], [])), ZernioError);
  await assertRejects(() => getZernioConnectUrl('sk', 'p', 'bluesky', 'https://x', fakeFetch([], [])), ZernioError);
});

Deno.test('readZernioAnalytics picks the account entry of a cross-post', () => {
  const body = {
    syncStatus: 'synced',
    analytics: { likes: 99, impressions: 999 },
    platformAnalytics: [
      { accountId: 'other', platformPostId: '1', syncStatus: 'synced', analytics: { likes: 50 } },
      {
        accountId: 'acc_ig', platformPostId: '1788', syncStatus: 'synced', platformPostUrl: 'https://instagram.com/p/x',
        analytics: { impressions: 1200, reach: 900, likes: 41, comments: 6, shares: 2, saves: 9, views: 0, clicks: 0, engagementRate: 6.4321, profileViews: 3, reposts: 0 },
      },
    ],
  };
  const r = readZernioAnalytics(body, 'acc_ig', '1788');
  assertEquals(r.synced, true);
  assertEquals(r.postUrl, 'https://instagram.com/p/x');
  assertEquals(r.stats?.likes, 41);
  assertEquals(r.stats?.reach, 900);
  assertEquals(r.stats?.engagementRate, 6.43);
  assertEquals(r.stats?.extra, { profileViews: 3 });
});

Deno.test('fetchZernioPostAnalytics: 202 is pending, 402 is no_access, 429 throws to retry later', async () => {
  const calls: Call[] = [];
  const pending = await fetchZernioPostAnalytics('sk_test', '1788', 'acc_ig', fakeFetch([
    { status: 202, body: { syncStatus: 'pending', message: 'Syncing', platformAnalytics: [{ accountId: 'acc_ig', syncStatus: 'pending' }] } },
  ], calls));
  assertEquals(pending.state, 'pending');
  assertEquals(calls[0].url, 'https://zernio.com/api/v1/analytics?postId=1788&accountId=acc_ig');

  const noAccess = await fetchZernioPostAnalytics('sk_test', '1788', 'acc_ig', fakeFetch([
    { status: 402, body: { error: 'Analytics add-on required', code: 'analytics_addon_required' } },
  ], []));
  assertEquals(noAccess.state, 'no_access');

  const gone = await fetchZernioPostAnalytics('sk_test', '1788', 'acc_ig', fakeFetch([{ status: 424, body: { error: 'All platforms failed' } }], []));
  assertEquals(gone.state, 'unavailable');

  await assertRejects(
    () => fetchZernioPostAnalytics('sk_test', '1788', 'acc_ig', fakeFetch([{ status: 429, body: { error: 'Slow down' } }], [])),
    ZernioError,
  );
});

Deno.test('nextMetricsFetch: hourly on day one, daily for a week, weekly to 30 days, then stop', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
  const inHours = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 3600_000 : null);
  assertEquals(inHours(nextMetricsFetch(ago(2), 'synced', now)), 1);
  assertEquals(inHours(nextMetricsFetch(ago(48), 'synced', now)), 24);
  assertEquals(inHours(nextMetricsFetch(ago(10 * 24), 'synced', now)), 168);
  assertEquals(nextMetricsFetch(ago(31 * 24), 'synced', now), null);
  assertEquals(inHours(nextMetricsFetch(ago(2), 'pending', now)), 1);
  assertEquals(inHours(nextMetricsFetch(ago(2), 'no_access', now)), 24);
});

Deno.test('findZernioPostId matches ACA\'s queue id, then the platform post id', async () => {
  const calls: Call[] = [];
  const posts = { posts: [
    { _id: 'z_other', metadata: { aca_queue_id: 'q-2' }, platforms: [{ platformPostId: '999' }] },
    { _id: 'z_mine', metadata: { source: 'aca', aca_queue_id: 'q-1' }, platforms: [{ platformPostId: '1788' }] },
  ] };
  const at = new Date('2026-11-04T12:48:54Z');
  assertEquals(await findZernioPostId('sk_test', { accountId: 'acc_ig', queueId: 'q-1', publishedAt: at }, fakeFetch([{ status: 200, body: posts }], calls)), 'z_mine');
  const url = new URL(calls[0].url);
  assertEquals(url.pathname, '/api/v1/posts');
  assertEquals(url.searchParams.get('accountId'), 'acc_ig');
  assertEquals(url.searchParams.get('fields'), 'platforms,metadata');
  assertEquals(await findZernioPostId('sk_test', { accountId: 'acc_ig', queueId: 'q-x', platformPostId: '999', publishedAt: at }, fakeFetch([{ status: 200, body: posts }], [])), 'z_other');
  assertEquals(await findZernioPostId('sk_test', { accountId: 'acc_ig', queueId: 'q-x', publishedAt: at }, fakeFetch([{ status: 200, body: posts }], [])), null);
});
