import { meshSendsDueBy, type WarmupMailbox } from './warmup-engine.ts';

export function warmupBudgetKey(mailbox: Pick<WarmupMailbox, 'id' | 'sending_domain_id'>): string {
  return mailbox.sending_domain_id ? `domain:${mailbox.sending_domain_id}` : `mailbox:${mailbox.id}`;
}

export function oldestWarmupFirst(a: WarmupMailbox, b: WarmupMailbox): number {
  const ta = a.warmup_last_send_at ? Date.parse(a.warmup_last_send_at) : 0;
  const tb = b.warmup_last_send_at ? Date.parse(b.warmup_last_send_at) : 0;
  return ta - tb || a.id.localeCompare(b.id);
}

export type WarmupClaimQueue = <T>(key: string, claim: () => PromiseLike<T>) => Promise<T>;

/** Serialize claims per domain, while transports still run concurrently. */
export function createWarmupClaimQueue(): WarmupClaimQueue {
  const tails = new Map<string, Promise<void>>();
  return async <T>(key: string, claim: () => PromiseLike<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    tails.set(key, tail);
    await previous;
    try { return await claim(); }
    finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

export interface WarmupLedgerUsage {
  from_mailbox_id: string;
  from_mailbox: { sending_domain_id: string | null } | null;
}

export function warmupUsageFromLedger(rows: WarmupLedgerUsage[]): {
  mailboxUsed: Map<string, number>; budgetUsed: Map<string, number>;
} {
  const mailboxUsed = new Map<string, number>();
  const budgetUsed = new Map<string, number>();
  for (const row of rows) {
    mailboxUsed.set(row.from_mailbox_id, (mailboxUsed.get(row.from_mailbox_id) ?? 0) + 1);
    const key = warmupBudgetKey({ id: row.from_mailbox_id, sending_domain_id: row.from_mailbox?.sending_domain_id ?? null });
    budgetUsed.set(key, (budgetUsed.get(key) ?? 0) + 1);
  }
  return { mailboxUsed, budgetUsed };
}

/** Domain opportunities are paced; mailbox age decides who receives each one. */
export function allocateWarmupOpportunities(
  mailboxes: WarmupMailbox[],
  quotas: Map<string, number>,
  mailboxUsed: Map<string, number>,
  budgetCaps: Map<string, number>,
  budgetUsed: Map<string, number>,
  now = new Date(),
): { remaining: Map<string, number>; budgets: Map<string, number> } {
  const budgets = new Map<string, number>();
  for (const [key, cap] of budgetCaps) {
    const used = budgetUsed.get(key) ?? 0;
    budgets.set(key, Math.max(0, Math.min(cap - used, meshSendsDueBy(key, cap, now) - used)));
  }
  const available = new Map(budgets);
  const remaining = new Map(mailboxes.map((mb) => [mb.id, 0]));
  const ordered = [...mailboxes].sort(oldestWarmupFirst);
  // Give everyone one turn before a mailbox receives a second original message.
  let assigned: boolean;
  do {
    assigned = false;
    for (const mb of ordered) {
      const key = warmupBudgetKey(mb);
      const n = remaining.get(mb.id) ?? 0;
      if ((available.get(key) ?? 0) <= 0 || n + (mailboxUsed.get(mb.id) ?? 0) >= (quotas.get(mb.id) ?? 0)) continue;
      remaining.set(mb.id, n + 1);
      available.set(key, (available.get(key) ?? 0) - 1);
      assigned = true;
    }
  } while (assigned);
  return { remaining, budgets };
}

export interface WarmupSchedulerObservation {
  mailbox_id: string;
  reason: string;
  had_opportunity: boolean;
}

export async function recordWarmupSchedulerDay(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> },
  observations: WarmupSchedulerObservation[],
): Promise<void> {
  for (let i = 0; i < observations.length; i += 500) {
    const { error } = await supabase.rpc('record_warmup_scheduler_day', { p_rows: observations.slice(i, i + 500) });
    if (error) throw new Error(`record_warmup_scheduler_day failed: ${error.message}`);
  }
}
