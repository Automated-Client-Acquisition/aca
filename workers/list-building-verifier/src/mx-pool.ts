/**
 * Per-MX connection pool with adaptive concurrency ramp.
 *
 * - Max 3 live sessions per MX host.
 * - Max 20 RCPT TO per session before forced reconnect.
 * - Idle timeout 30s.
 * - On 421/45x: concurrency[mx] = max(1, c/2).
 * - On 10 consecutive 250s: concurrency[mx] = min(max, c*2).
 * - Records attempts/successes/rate_limit_hits into lb_mx_throughput every minute.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SmtpSession, type RcptResult } from './smtp-session.js';
import { nextConcurrency } from './adaptive-ramp.js';
import { connectThroughProxy, directConnect, type ProxyConfig } from './proxy-connect.js';

const MAX_SESSIONS_PER_MX = 3;
const MAX_RCPTS_PER_SESSION = 20;
const IDLE_TIMEOUT_MS = 30_000;

interface PoolSlot {
  session: SmtpSession;
  busy: boolean;
  lastUsed: number;
}

interface MxState {
  slots: PoolSlot[];
  concurrency: number;
  maxConcurrency: number;
  consecutiveOk: number;
  // minute-bucket metrics
  bucket: string;
  attempts: number;
  successes: number;
  rateLimitHits: number;
}

export interface MxPoolOptions {
  supabase: SupabaseClient;
  heloDomain: string;
  mailFrom: string;
  proxy?: ProxyConfig;
  maxConcurrencyPerMx?: number;
}

export class MxPool {
  private readonly state = new Map<string, MxState>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: MxPoolOptions) {
    this.flushTimer = setInterval(() => this.flushMetrics().catch(() => {}), 60_000);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  async verify(mxHost: string, email: string): Promise<RcptResult> {
    const mx = this.getOrInit(mxHost);
    mx.attempts++;

    const slot = await this.acquireSlot(mxHost, mx);
    try {
      const result = await slot.session.verify(email);
      slot.lastUsed = Date.now();

      if (result.kind === 'ok') mx.successes++;
      if (result.kind === 'rate_limited') mx.rateLimitHits++;

      // Adapt concurrency.
      const kind = result.kind === 'ok' ? 'ok' : result.kind === 'rate_limited' ? 'rate_limited' : 'error';
      const { next, consecutiveOk } = nextConcurrency(mx.concurrency, mx.maxConcurrency, mx.consecutiveOk, kind);
      mx.concurrency = next;
      mx.consecutiveOk = consecutiveOk;

      // Recycle session if it's done too many RCPTs or hit rate limit.
      if (slot.session.rcptsSent >= MAX_RCPTS_PER_SESSION || result.kind === 'rate_limited') {
        await slot.session.close().catch(() => {});
        mx.slots = mx.slots.filter((s) => s !== slot);
      } else {
        slot.busy = false;
      }

      return result;
    } catch (err) {
      try { await slot.session.close(); } catch { /* ignore */ }
      mx.slots = mx.slots.filter((s) => s !== slot);
      return { code: 0, kind: 'error', raw: err instanceof Error ? err.message : String(err) };
    }
  }

  async drain(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    for (const [, mx] of this.state) {
      for (const s of mx.slots) {
        try { await s.session.close(); } catch { /* ignore */ }
      }
      mx.slots = [];
    }
    await this.flushMetrics().catch(() => {});
  }

  private getOrInit(mxHost: string): MxState {
    const existing = this.state.get(mxHost);
    if (existing) return existing;
    const fresh: MxState = {
      slots: [],
      concurrency: 1,
      maxConcurrency: this.opts.maxConcurrencyPerMx ?? 10,
      consecutiveOk: 0,
      bucket: this.currentBucket(),
      attempts: 0,
      successes: 0,
      rateLimitHits: 0,
    };
    this.state.set(mxHost, fresh);
    return fresh;
  }

  private async acquireSlot(mxHost: string, mx: MxState): Promise<PoolSlot> {
    // Prune idle/stale.
    const now = Date.now();
    mx.slots = mx.slots.filter((s) => {
      if (!s.busy && now - s.lastUsed > IDLE_TIMEOUT_MS) {
        s.session.close().catch(() => {});
        return false;
      }
      return true;
    });

    const free = mx.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free;
    }

    if (mx.slots.length < Math.min(MAX_SESSIONS_PER_MX, mx.concurrency)) {
      const session = await this.openSession(mxHost);
      const slot: PoolSlot = { session, busy: true, lastUsed: Date.now() };
      mx.slots.push(slot);
      return slot;
    }

    // Wait for a slot.
    while (true) {
      await new Promise((r) => setTimeout(r, 50));
      const f = mx.slots.find((s) => !s.busy);
      if (f) {
        f.busy = true;
        return f;
      }
    }
  }

  private async openSession(mxHost: string): Promise<SmtpSession> {
    const session = new SmtpSession({
      mxHost,
      port: 25,
      heloDomain: this.opts.heloDomain,
      mailFrom: this.opts.mailFrom,
      socketFactory: this.opts.proxy
        ? () => connectThroughProxy(this.opts.proxy!, mxHost, 25)
        : () => directConnect(mxHost, 25),
    });
    await session.connect();
    return session;
  }

  private currentBucket(): string {
    const d = new Date();
    d.setSeconds(0, 0);
    return d.toISOString();
  }

  private async flushMetrics(): Promise<void> {
    const rows: Array<{
      mx_host: string;
      minute_bucket: string;
      attempts: number;
      successes: number;
      rate_limit_hits: number;
    }> = [];
    for (const [mx_host, s] of this.state) {
      if (s.attempts === 0 && s.successes === 0 && s.rateLimitHits === 0) continue;
      rows.push({
        mx_host,
        minute_bucket: s.bucket,
        attempts: s.attempts,
        successes: s.successes,
        rate_limit_hits: s.rateLimitHits,
      });
      s.bucket = this.currentBucket();
      s.attempts = 0;
      s.successes = 0;
      s.rateLimitHits = 0;
    }
    if (rows.length === 0) return;
    try {
      await this.opts.supabase.from('lb_mx_throughput').upsert(rows, {
        onConflict: 'mx_host,minute_bucket',
      });
    } catch (err) {
      console.warn('[mx-pool] metric flush failed', err);
    }
  }
}
