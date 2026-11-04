import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { captionLength, checkPost, normPlatform } from './scheduler-api.ts';

Deno.test('normPlatform folds the platform aliases', () => {
  assertEquals(normPlatform('X'), 'twitter');
  assertEquals(normPlatform('googlebusiness'), 'google');
  assertEquals(normPlatform('Instagram'), 'instagram');
});

Deno.test('captionLength counts X links as 23 and emoji as 2', () => {
  assertEquals(captionLength('twitter', 'hi https://example.com/a/very/long/path'), 3 + 23);
  assertEquals(captionLength('twitter', '🔥'), 2);
  assertEquals(captionLength('linkedin', '🔥'), 2); // UTF-16 length, as LinkedIn counts
});

Deno.test('checkPost flags what would fail, like the composer', () => {
  const none = { images: [], video: null };
  assertEquals(checkPost(['instagram'], { instagram: 'Hello' }, none).map((i) => i.message), ['Instagram needs a picture or video']);
  assertEquals(checkPost(['linkedin'], { linkedin: '' }, none).length, 1);
  assertEquals(checkPost(['twitter'], { twitter: 'x'.repeat(281) }, none)[0].message, 'X: 1 characters over the 280 limit');
  assertEquals(checkPost(['tiktok'], { tiktok: 'a' }, { images: ['https://a/1.png', 'https://a/2.png'], video: null })[0].message, 'TikTok takes one video or one picture. Several pictures fail.');
  assertEquals(checkPost(['instagram'], { instagram: 'ok' }, { images: ['https://a/1.png'], video: null }), []);
});
