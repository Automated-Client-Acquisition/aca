import assert from 'node:assert/strict';
import test from 'node:test';
import { atsDeltaId, paginateOffset } from './ats.js';

test('offset pagination exhausts every page in order', async () => {
  const source = Array.from({ length: 205 }, (_, id) => id);
  const calls: number[] = [];
  const rows = await paginateOffset(async (offset, limit) => {
    calls.push(offset);
    return { items: source.slice(offset, offset + limit), total: source.length };
  }, 100);
  assert.deepEqual(rows, source);
  assert.deepEqual(calls, [0, 100, 200]);
});

test('offset pagination rejects a source that never terminates', async () => {
  await assert.rejects(
    () => paginateOffset(async (_offset, limit) => ({ items: Array(limit).fill('row') }), 2, 3),
    /refusing a partial board snapshot/,
  );
});

test('a missing first page preserves the board-not-found signal', async () => {
  assert.equal(await paginateOffset(async () => null), null);
});

test('ATS delta identity ignores job ordering but distinguishes fresh jobs', () => {
  const first = atsDeltaId('board', ['job-2', 'job-1'], '2026-09-07');
  assert.equal(first, atsDeltaId('board', ['job-1', 'job-2'], '2026-09-07'));
  assert.notEqual(first, atsDeltaId('board', ['job-1', 'job-3'], '2026-09-07'));
  assert.notEqual(first, atsDeltaId('board', ['job-1', 'job-2'], '2026-09-08'));
});
