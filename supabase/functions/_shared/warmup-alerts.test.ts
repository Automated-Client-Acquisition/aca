import {
  ACCEPTED_WARMUP_STATUSES, classifyWarmupMailbox, escapeWarmupAlertHtml,
  fetchWarmupAlertPages, loadWarmupAlertStates,
  hasWarmupAlertHeadroom, isWarmupEngineDown, recentCompletedWarmupDays,
  type WarmupAlertMailbox, type WarmupAlertState,
} from './warmup-alerts.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
const mailbox: WarmupAlertMailbox = {
  id: 'mailbox', organization_id: 'org', email_address: 'hello@example.com',
  status: 'ready', warmup_last_send_at: null, warmup_stall_alerted_at: null, metadata: null,
  daily_limit: 3, daily_sent: 0, daily_sent_reset_at: null, warmup_max_daily: 3,
};
const state: WarmupAlertState = {
  mailbox_id: 'mailbox', opportunity_days: 0, eligible_days: 0,
  latest_reason: null, last_activity_at: null,
};

Deno.test('calendar gaps do not imply stalls without measured opportunities', () => {
  equal(classifyWarmupMailbox(mailbox), 'observing');
  equal(classifyWarmupMailbox(mailbox, state), 'observing');
  for (const reason of ['off_day', 'campaign_capacity', 'domain_capacity', 'reply_priority', 'waiting_for_domain_slot', 'mailbox_capacity']) {
    equal(classifyWarmupMailbox(mailbox, { ...state, latest_reason: reason, eligible_days: 12 }), 'capacity_waiting');
  }
});
Deno.test('three completed opportunities without accepted activity constitute a stall', () => {
  equal(classifyWarmupMailbox(mailbox, { ...state, latest_reason: 'failed', opportunity_days: 2 }), 'observing');
  for (const reason of ['failed', 'no_partner', 'domain_capacity']) {
    equal(classifyWarmupMailbox(mailbox, { ...state, latest_reason: reason, opportunity_days: 3 }), 'stalled');
  }
});
Deno.test('accepted reply activity prevents a stall even when an original was never sent', () => {
  equal(classifyWarmupMailbox(mailbox, { ...state, latest_reason: 'sent', last_activity_at: '2026-10-06T09:00:00Z' }), 'participating');
  equal(ACCEPTED_WARMUP_STATUSES, ['sent', 'delivered', 'bounced']);
});
Deno.test('known transport failures remain separate from stalls', () => {
  for (const metadata of [{ capability_probe: { mail_send: false } }, { paused_reason: 'tenant_outbound_blocked' }, { paused_reason: 'tenant_mail_send_missing' }]) {
    equal(classifyWarmupMailbox({ ...mailbox, metadata }, { ...state, latest_reason: 'failed', opportunity_days: 9 }), 'transport_blocked');
  }
});
Deno.test('mailbox pagination reads beyond the 1000 row cap and propagates later page failures', async () => {
  const ranges: number[][] = [];
  const rows = await fetchWarmupAlertPages<number>(async (from, to) => {
    ranges.push([from, to]);
    return { data: from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : [1000, 1001], error: null };
  });
  equal(rows.length, 1002);
  equal(ranges, [[0, 999], [1000, 1999]]);
  let threw = false;
  try {
    await fetchWarmupAlertPages<number>(async (from) => ({ data: from === 0 ? Array(1000).fill(0) : null, error: from === 0 ? null : { message: 'page failed' } }));
  } catch (error) { threw = (error as Error).message.includes('page failed'); }
  equal(threw, true);
});
Deno.test('scheduler RPC batches at most 500 IDs and propagates failures', async () => {
  const sizes: number[] = [];
  const ids = Array.from({ length: 1049 }, (_, i) => String(i));
  const states = await loadWarmupAlertStates({ rpc: async (name, params) => {
    equal(name, 'warmup_scheduler_alert_state');
    sizes.push(params.p_mailbox_ids.length);
    return { data: params.p_mailbox_ids.map((mailbox_id) => ({ ...state, mailbox_id })), error: null };
  } }, ids);
  equal(sizes, [500, 500, 49]);
  equal(states.size, 1049);
  let threw = false;
  try {
    await loadWarmupAlertStates({ rpc: async () => ({ data: null, error: { message: 'rpc failed' } }) }, ['mailbox']);
  } catch (error) { threw = (error as Error).message.includes('rpc failed'); }
  equal(threw, true);
});
Deno.test('digest mailbox samples escape HTML', () => {
  equal(escapeWarmupAlertHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
});

Deno.test('global engine window skips weekends and excludes today', () => {
  equal(recentCompletedWarmupDays(new Date('2026-10-12T10:00:00Z')).map((day) => day.slice(0, 10)), ['2026-10-07', '2026-10-08', '2026-10-09']);
  equal(recentCompletedWarmupDays(new Date('2026-10-09T23:59:59Z')).map((day) => day.slice(0, 10)), ['2026-10-06', '2026-10-07', '2026-10-08']);
  equal(recentCompletedWarmupDays(new Date('2026-10-12T10:00:00Z'), false).map((day) => day.slice(0, 10)), ['2026-10-09', '2026-10-10', '2026-10-11']);
});

Deno.test('global outage remains detectable without any scheduler history', () => {
  equal(classifyWarmupMailbox(mailbox, state), 'observing');
  equal(hasWarmupAlertHeadroom(mailbox), true);
  equal(isWarmupEngineDown(0, 0, 1), true);
  equal(isWarmupEngineDown(1, 0, 1), false);
  equal(isWarmupEngineDown(0, 1, 1), false);
  equal(isWarmupEngineDown(0, 0, 0), false);
});

Deno.test('global outage cohort excludes blocked, paused and exhausted mailboxes', () => {
  const today = new Date().toISOString().slice(0, 10);
  equal(hasWarmupAlertHeadroom({ ...mailbox, status: 'paused' }), false);
  equal(hasWarmupAlertHeadroom({ ...mailbox, metadata: { capability_probe: { mail_send: false } } }), false);
  equal(hasWarmupAlertHeadroom({ ...mailbox, warmup_max_daily: 0 }), false);
  equal(hasWarmupAlertHeadroom({ ...mailbox, daily_limit: 3, daily_sent: 3, daily_sent_reset_at: today }), false);
  equal(hasWarmupAlertHeadroom({ ...mailbox, daily_limit: 3, daily_sent: 3, daily_sent_reset_at: '2020-01-01' }), true);
});
