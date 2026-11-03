import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { sha256Hex, timingSafeEqualHex, validateVideoRequest, type VideoModel } from './openrouter-video.ts';

// Shapes as GET /api/v1/videos/models reported them on 2026-10-28.
const VEO_FAST: VideoModel = {
  id: 'google/veo-3.1-fast',
  supported_resolutions: ['720p', '1080p', '4K'],
  supported_aspect_ratios: ['16:9', '9:16'],
  supported_durations: [4, 6, 8],
  supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true,
  pricing_skus: null,
};
const HAILUO_23: VideoModel = {
  id: 'minimax/hailuo-2.3',
  supported_resolutions: ['1080p'],
  supported_aspect_ratios: ['16:9'],
  supported_durations: [6, 10],
  supported_frame_images: ['first_frame'],
  generate_audio: false,
  pricing_skus: null,
};
const ALEPH_2: VideoModel = {
  id: 'runway/aleph-2',
  supported_resolutions: null,
  supported_aspect_ratios: null,
  supported_durations: null,
  supported_frame_images: null,
  generate_audio: false,
  pricing_skus: null,
};

const frame = (frame_type: 'first_frame' | 'last_frame') =>
  ({ type: 'image_url' as const, image_url: { url: 'https://x/f.png' }, frame_type });

Deno.test('a 15s block on Veo is rejected: it only takes 4, 6 or 8 seconds', () => {
  const errors = validateVideoRequest({ model: VEO_FAST.id, duration: 15, aspect_ratio: '9:16' }, VEO_FAST);
  assertEquals(errors.length, 1);
});

Deno.test('an 8s 9:16 Veo clip with first and last frame passes', () => {
  const req = { model: VEO_FAST.id, duration: 8, aspect_ratio: '9:16', resolution: '720p', frame_images: [frame('first_frame'), frame('last_frame')] };
  assertEquals(validateVideoRequest(req, VEO_FAST), []);
});

Deno.test('a last frame on a first-frame-only model is flagged, and so is 9:16', () => {
  const req = { model: HAILUO_23.id, duration: 6, aspect_ratio: '9:16', frame_images: [frame('first_frame'), frame('last_frame')] };
  assertEquals(validateVideoRequest(req, HAILUO_23).length, 2);
});

Deno.test('models that declare nothing (edit models) are not blocked', () => {
  assertEquals(validateVideoRequest({ model: ALEPH_2.id, duration: 12, aspect_ratio: '9:16' }, ALEPH_2), []);
});

Deno.test('callback token check: right token matches its stored hash, wrong one does not', async () => {
  const stored = await sha256Hex('a1b2c3');
  assertEquals(timingSafeEqualHex(await sha256Hex('a1b2c3'), stored), true);
  assertEquals(timingSafeEqualHex(await sha256Hex('a1b2c4'), stored), false);
  assertEquals(timingSafeEqualHex('abc', stored), false);
});
