import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { stageText } from './stage-text.ts';

Deno.test('stageText: edited content beats the stale text copy', () => {
  assertEquals(stageText({ text: 'original', content: 'edited' }), 'edited');
});

Deno.test('stageText: falls back to text when content is missing or empty', () => {
  assertEquals(stageText({ text: 'only text' }), 'only text');
  assertEquals(stageText({ text: 'only text', content: '' }), 'only text');
});

Deno.test('stageText: ignores a non-string content', () => {
  assertEquals(stageText({ text: 'script', content: { scenes: [] } }), 'script');
  assertEquals(stageText({ content: { scenes: [] } }), '');
});

Deno.test('stageText: empty for missing stages', () => {
  assertEquals(stageText(undefined), '');
  assertEquals(stageText(null), '');
  assertEquals(stageText('not a stage'), '');
});
