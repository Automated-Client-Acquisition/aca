import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { snapAspectRatio, usesOpenRouterImagesApi } from './openrouter-images-api.ts';

// What openai/gpt-5-image's endpoint accepts on the Image API.
const GPT_5_IMAGE = ['1:1', '3:2', '2:3'];

Deno.test('a 4:3 blueprint on gpt-5-image gets landscape 3:2, not square', () => {
  assertEquals(snapAspectRatio('4:3', GPT_5_IMAGE), '3:2');
});

Deno.test('wide and tall requests snap to the matching orientation', () => {
  assertEquals(snapAspectRatio('16:9', GPT_5_IMAGE), '3:2');
  assertEquals(snapAspectRatio('9:16', GPT_5_IMAGE), '2:3');
  assertEquals(snapAspectRatio('3:4', GPT_5_IMAGE), '2:3');
  assertEquals(snapAspectRatio('4:5', GPT_5_IMAGE), '2:3');
});

Deno.test('an accepted ratio passes through unchanged', () => {
  assertEquals(snapAspectRatio('1:1', GPT_5_IMAGE), '1:1');
  assertEquals(snapAspectRatio('4:3', ['1:1', '4:3', '3:2']), '4:3');
});

Deno.test('with nothing to compare to, the request is left for OpenRouter to clamp', () => {
  assertEquals(snapAspectRatio('4:3', []), '4:3');
  assertEquals(snapAspectRatio('landscape', GPT_5_IMAGE), 'landscape');
});

Deno.test('only OpenAI models take the Image API route', () => {
  assertEquals(usesOpenRouterImagesApi('openai/gpt-5-image'), true);
  assertEquals(usesOpenRouterImagesApi('openai/gpt-5.4-image-2'), true);
  assertEquals(usesOpenRouterImagesApi('google/gemini-3.1-flash-image-preview'), false);
  assertEquals(usesOpenRouterImagesApi('black-forest-labs/flux.2-pro'), false);
});
