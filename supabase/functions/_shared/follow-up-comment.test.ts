import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { splitFollowUpComment } from './follow-up-comment.ts';

Deno.test('no marker leaves the text alone', () => {
  assertEquals(splitFollowUpComment('Hello\n\nWorld'), { caption: 'Hello\n\nWorld' });
});

Deno.test('splits post and follow-up comment', () => {
  const r = splitFollowUpComment('Post body\n\nFREE ACCESS BELOW. ↓\n\n---FOLLOW-UP---\nThe pack: https://x.io/a');
  assertEquals(r.caption, 'Post body\n\nFREE ACCESS BELOW. ↓');
  assertEquals(r.followUpComment, 'The pack: https://x.io/a');
});

Deno.test('marker variants and an empty comment', () => {
  assertEquals(splitFollowUpComment('A\n--- follow up ---\nB').followUpComment, 'B');
  assertEquals(splitFollowUpComment('A\n---FOLLOW-UP---\n  \n'), { caption: 'A' });
});

Deno.test('handles null', () => {
  assertEquals(splitFollowUpComment(null), { caption: '' });
});
