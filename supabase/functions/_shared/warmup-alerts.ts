import { warmupCeilingFor } from './warmup-engine.ts';

/** Only provider-accepted warmup traffic counts as activity (including replies). */
export const ACCEPTED_WARMUP_STATUSES = ['sent', 'delivered', 'bounced'];
export const STALL_OPPORTUNITY_DAYS = 3;
export const ALERT_RPC_CHUNK = 500;

export interface WarmupAlertMailbox {
  id: string;
  organization_id: string;
  email_address: string;
  status: string;
  warmup_last_send_at: string | null;
  warmup_stall_alerted_at: string | null;
  metadata: Record<string, unknown> | null;
  daily_limit: number | null;
  daily_sent: number | null;
  daily_sent_reset_at: string | null;
  warmup_max_daily: number | null;
  warmup_weekdays_only?: boolean | null;
}

/** Completed UTC counter days; today's partial day never establishes an outage. */
export function recentCompletedWarmupDays(now: Date, weekdaysOnly = true): string[] {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days: string[] = [];
  while (days.length < STALL_OPPORTUNITY_DAYS) {
    day.setUTCDate(day.getUTCDate() - 1);
    if (weekdaysOnly && (day.getUTCDay() === 0 || day.getUTCDay() === 6)) continue;
    days.unshift(day.toISOString());
  }
  return days;
}

export function hasWarmupAlertHeadroom(mailbox: WarmupAlertMailbox): boolean {
  return ['ready', 'warming'].includes(mailbox.status) &&
    !isWarmupTransportBlocked(mailbox) && warmupCeilingFor(mailbox) > 0;
}

/** Independent of scheduler history: a stopped cron cannot record opportunities. */
export function isWarmupEngineDown(acceptedInCompletedDays: number, acceptedInRecentWindow: number, capableWithHeadroom: number): boolean {
  return acceptedInCompletedDays === 0 && acceptedInRecentWindow === 0 && capableWithHeadroom > 0;
}

export interface WarmupAlertState {
  mailbox_id: string;
  opportunity_days: number;
  eligible_days: number;
  latest_reason: string | null;
  last_activity_at: string | null;
}

export type WarmupAlertClassification =
  | 'stalled' | 'capacity_waiting' | 'transport_blocked' | 'observing' | 'participating';

export function isWarmupTransportBlocked(mailbox: WarmupAlertMailbox): boolean {
  const probe = mailbox.metadata?.capability_probe as Record<string, unknown> | undefined;
  return probe?.mail_send === false ||
    mailbox.metadata?.paused_reason === 'tenant_outbound_blocked' ||
    mailbox.metadata?.paused_reason === 'tenant_mail_send_missing';
}

export function classifyWarmupMailbox(
  mailbox: WarmupAlertMailbox,
  state?: WarmupAlertState,
): WarmupAlertClassification {
  if (isWarmupTransportBlocked(mailbox)) return 'transport_blocked';
  // No scheduler history means we have not measured any opportunity yet.
  if (!state?.latest_reason) return 'observing';
  if (state.opportunity_days >= STALL_OPPORTUNITY_DAYS) return 'stalled';
  if (state.latest_reason === 'transport_blocked') return 'transport_blocked';
  if (state.latest_reason === 'ineligible') return 'observing';
  if (state.latest_reason === 'off_day' || /capacity|campaign|reply|quota|domain|partner|not_due|waiting/.test(state.latest_reason)) {
    return 'capacity_waiting';
  }
  return state.last_activity_at ? 'participating' : 'observing';
}

/** Chunking is essential: set-returning RPCs also obey PostgREST's row cap. */
export async function loadWarmupAlertStates(
  client: { rpc: (name: string, params: { p_mailbox_ids: string[] }) => PromiseLike<{ data: WarmupAlertState[] | null; error: { message: string } | null }> },
  mailboxIds: string[],
): Promise<Map<string, WarmupAlertState>> {
  const states = new Map<string, WarmupAlertState>();
  for (let offset = 0; offset < mailboxIds.length; offset += ALERT_RPC_CHUNK) {
    const { data, error } = await client.rpc('warmup_scheduler_alert_state', {
      p_mailbox_ids: mailboxIds.slice(offset, offset + ALERT_RPC_CHUNK),
    });
    if (error) throw new Error(`Failed to read warmup opportunity state: ${error.message}`);
    for (const state of data ?? []) states.set(state.mailbox_id, state);
  }
  return states;
}

export async function fetchWarmupAlertPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read warmup mailboxes: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

export function escapeWarmupAlertHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}
