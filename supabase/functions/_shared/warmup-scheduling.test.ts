import { allocateWarmupOpportunities, createWarmupClaimQueue, warmupBudgetKey, warmupUsageFromLedger } from './warmup-scheduling.ts';
import { meshSendsDueBy, type WarmupMailbox } from './warmup-engine.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function mailbox(id: string, last: string | null, domain = 'domain-a'): WarmupMailbox {
  return { id, sending_domain_id: domain, warmup_last_send_at: last } as WarmupMailbox;
}

Deno.test('domain pacing includes replies from mailboxes outside the original sender pool', () => {
  const { budgetUsed, mailboxUsed } = warmupUsageFromLedger([
    { from_mailbox_id: 'disabled-originals-but-can-reply', from_mailbox: { sending_domain_id: 'domain-a' } },
    { from_mailbox_id: 'waiting', from_mailbox: { sending_domain_id: 'domain-a' } },
  ]);
  assert(budgetUsed.get('domain:domain-a') === 2, 'all domain traffic must consume pacing');
  assert(mailboxUsed.get('waiting') === 1, 'mailbox accounting remains scoped to its own sends');
});

Deno.test('claims preserve domain order while other domains proceed, including after rejection', async () => {
  const claim = createWarmupClaimQueue();
  const order: string[] = [];
  let release!: () => void;
  const first = claim('a', async () => {
    order.push('oldest');
    await new Promise<void>((resolve) => { release = resolve; });
    throw new Error('fixture rejection');
  }).catch(() => {});
  const second = claim('a', async () => { order.push('next'); });
  const other = claim('b', async () => { order.push('other-domain'); });
  await other;
  assert(order.join(',') === 'oldest,other-domain', 'next claim must wait for the oldest claim; other domains must not block');
  release();
  await Promise.all([first, second]);
  assert(order.join(',') === 'oldest,other-domain,next', 'failed claims must release the queue');
});

Deno.test('domain opportunities go to never-sent and oldest mailboxes regardless of mailbox hash slots', () => {
  const boxes = [mailbox('newer', '2026-10-05T08:00:00Z'), mailbox('never', null), mailbox('old', '2026-09-28T08:00:00Z')];
  const result = allocateWarmupOpportunities(boxes, new Map(boxes.map((b) => [b.id, 1])), new Map(), new Map([['domain:domain-a', 2]]), new Map(), new Date('2026-10-06T22:00:00Z'));
  assert(result.remaining.get('never') === 1 && result.remaining.get('old') === 1, 'longest-waiting boxes must get the two slots');
  assert(result.remaining.get('newer') === 0, 'recently active box must wait');
});

Deno.test('replies consume paced capacity before originals', () => {
  const box = mailbox('never', null);
  const now = new Date('2026-10-06T12:00:00Z');
  const cap = 50;
  const released = meshSendsDueBy(warmupBudgetKey(box), cap, now);
  const result = allocateWarmupOpportunities([box], new Map([[box.id, 1]]), new Map(), new Map([[warmupBudgetKey(box), cap]]), new Map([[warmupBudgetKey(box), released]]), now);
  assert(result.remaining.get(box.id) === 0, 'already-used reply capacity must not be spent again');
});

Deno.test('fair rotation advances after the previous oldest mailbox sends', () => {
  const first = mailbox('first', '2026-10-06T08:00:00Z');
  const waiting = mailbox('waiting', null);
  const result = allocateWarmupOpportunities([first, waiting], new Map([['first', 1], ['waiting', 1]]), new Map(), new Map([['domain:domain-a', 1]]), new Map(), new Date('2026-10-07T22:00:00Z'));
  assert(result.remaining.get('waiting') === 1 && result.remaining.get('first') === 0, 'next opportunity must rotate to the waiting mailbox');
});

Deno.test('full campaign allocation and consumed mailbox quota cannot receive an original slot', () => {
  const boxes = [mailbox('campaign-full', null), mailbox('replied-today', null), mailbox('waiting', null)];
  const result = allocateWarmupOpportunities(boxes, new Map([['campaign-full', 0], ['replied-today', 1], ['waiting', 1]]), new Map([['replied-today', 1]]), new Map([['domain:domain-a', 50]]), new Map(), new Date('2026-10-06T22:00:00Z'));
  assert(result.remaining.get('campaign-full') === 0 && result.remaining.get('replied-today') === 0, 'capacity guards must hold');
  assert(result.remaining.get('waiting') === 1, 'eligible waiting mailbox must receive capacity');
});

Deno.test('pacing stays closed before the existing send window and distributes first turns', () => {
  const boxes = [mailbox('a', null), mailbox('b', null)];
  const quotas = new Map([['a', 3], ['b', 3]]);
  const caps = new Map([['domain:domain-a', 3]]);
  const before = allocateWarmupOpportunities(boxes, quotas, new Map(), caps, new Map(), new Date('2026-10-06T05:59:59Z'));
  assert([...before.remaining.values()].every((n) => n === 0), 'no midnight burst');
  const after = allocateWarmupOpportunities(boxes, quotas, new Map(), caps, new Map(), new Date('2026-10-06T22:00:00Z'));
  assert(after.remaining.get('a') === 2 && after.remaining.get('b') === 1, 'second turn may only follow all first turns');
});
