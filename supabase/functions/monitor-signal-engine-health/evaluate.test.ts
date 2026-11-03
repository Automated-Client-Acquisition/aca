import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evaluateSnapshot } from './index.ts';

const healthy = {
  news_obs_age_h: 1, ats_run_age_h: 1, edgar_run_age_h: 0.5,
  edgar_form_d_obs_age_h: 20, edgar_8k_obs_age_h: 20, last_publish_age_h: 0.1,
  resolve_backlog: 5, resolve_last_attempt_age_h: 1,
  identity_resolution_backlog: 5, identity_resolution_oldest_pending_age_h: 1,
  identity_resolution_last_progress_age_h: 0.1,
  verify_backlog: 5, verify_last_attempt_age_h: 0.1,
  pending_non_hiring: 10, failed_events: 0,
};
const codes = (s: Record<string, number | null>) => evaluateSnapshot(s).map((i) => i.code);

Deno.test('a healthy snapshot raises nothing', () => {
  assertEquals(codes(healthy), []);
});

Deno.test('EDGAR cron succeeding while writing nothing is caught (the Sept 8-19 outage)', () => {
  assertEquals(codes({ ...healthy, edgar_form_d_obs_age_h: 264, edgar_8k_obs_age_h: 264 }), ['edgar_silent']);
});

Deno.test('a normal weekend gap in EDGAR is not an alert', () => {
  assertEquals(codes({ ...healthy, edgar_form_d_obs_age_h: 70, edgar_8k_obs_age_h: 70 }), []);
});

Deno.test('verification with a real backlog but no recent attempts is critical', () => {
  assertEquals(codes({ ...healthy, verify_backlog: 120, verify_last_attempt_age_h: 5 }), ['verify_stalled']);
});

Deno.test('an empty backlog with no recent attempts is not a stall', () => {
  assertEquals(codes({ ...healthy, verify_backlog: 0, verify_last_attempt_age_h: 40 }), []);
});

Deno.test('publish and collector stalls are each reported', () => {
  assertEquals(codes({ ...healthy, last_publish_age_h: 20, news_obs_age_h: 9 }), ['news_stalled', 'publish_stalled']);
});

Deno.test('a never-run source counts as stalled', () => {
  assertEquals(codes({ ...healthy, ats_run_age_h: null }), ['ats_stalled']);
});

Deno.test('identity starvation is caught while collectors and evidence ticks stay healthy', () => {
  const issues = evaluateSnapshot({
    ...healthy,
    identity_resolution_backlog: 764,
    identity_resolution_oldest_pending_age_h: 33,
    identity_resolution_last_progress_age_h: 33,
    resolve_backlog: 0,
    resolve_last_attempt_age_h: 45,
    verify_backlog: 30,
    verify_last_attempt_age_h: 0.2,
  });
  assertEquals(issues.map((issue) => issue.code), ['identity_resolution_stalled']);
  assertEquals(issues[0].severity, 'critical');
});

Deno.test('identity backlog with no successful resolution ever alerts after six hours', () => {
  assertEquals(codes({
    ...healthy,
    identity_resolution_backlog: 20,
    identity_resolution_oldest_pending_age_h: 6.1,
    identity_resolution_last_progress_age_h: null,
  }), ['identity_resolution_stalled']);
});

Deno.test('fresh identity progress prevents a stall even with an old untouched backlog', () => {
  assertEquals(codes({
    ...healthy,
    identity_resolution_backlog: 764,
    identity_resolution_oldest_pending_age_h: 33,
    identity_resolution_last_progress_age_h: 0.1,
  }), []);
});

Deno.test('a fresh batch after a quiet period has time to resolve', () => {
  assertEquals(codes({
    ...healthy,
    identity_resolution_backlog: 100,
    identity_resolution_oldest_pending_age_h: 0.1,
    identity_resolution_last_progress_age_h: 33,
  }), []);
});

Deno.test('identity backlog and age thresholds are conservative', () => {
  for (const snapshot of [
    { identity_resolution_backlog: 19, identity_resolution_oldest_pending_age_h: 33, identity_resolution_last_progress_age_h: 33 },
    { identity_resolution_backlog: 20, identity_resolution_oldest_pending_age_h: 6, identity_resolution_last_progress_age_h: 33 },
    { identity_resolution_backlog: 20, identity_resolution_oldest_pending_age_h: 33, identity_resolution_last_progress_age_h: 6 },
  ]) {
    assertEquals(codes({ ...healthy, ...snapshot }), []);
  }
});

Deno.test('no untouched identity backlog means no stall despite stale successful progress', () => {
  assertEquals(codes({
    ...healthy,
    identity_resolution_backlog: 0,
    identity_resolution_oldest_pending_age_h: null,
    identity_resolution_last_progress_age_h: 33,
  }), []);
});

Deno.test('a legacy snapshot without identity metrics remains compatible', () => {
  const legacy: Record<string, number | null> = { ...healthy };
  delete legacy.identity_resolution_backlog;
  delete legacy.identity_resolution_oldest_pending_age_h;
  delete legacy.identity_resolution_last_progress_age_h;
  assertEquals(codes(legacy), []);
});
