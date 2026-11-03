/**
 * Pick a proxy from lb_proxy_pool by consistent-hashing the workerId,
 * so different machines land on different proxies without coordination.
 * On failure the caller calls rotate() to skip to the next.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProxyConfig } from './proxy-connect.js';

export interface ProxyRow {
  id: string;
  kind: 'socks5' | 'http';
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  status: string | null;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export class ProxyShard {
  private pool: ProxyRow[] = [];
  private idx = 0;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workerId: string,
  ) {}

  async load(): Promise<void> {
    // Schema: lb_proxy_pool uses (proxy_type, active, username_enc,
    // password_enc) — earlier code referenced a phantom `kind` column and
    // a `status='active'` text column that don't exist. Map the real
    // columns to ProxyRow's `kind` field so callers don't need to know
    // about the rename.
    const { data, error } = await this.supabase
      .from('lb_proxy_pool')
      .select('id, proxy_type, host, port, username_enc, password_enc, active')
      .eq('active', true)
      .is('retired_at', null)
      .order('id');
    if (error) {
      console.warn('[proxy-shard] load failed', error);
      this.pool = [];
      return;
    }
    type Row = {
      id: string;
      proxy_type: string;
      host: string;
      port: number;
      username_enc: string | null;
      password_enc: string | null;
    };
    this.pool = ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      kind: (r.proxy_type === 'socks5' ? 'socks5' : 'http') as 'socks5' | 'http',
      host: r.host,
      port: r.port,
      username: r.username_enc,
      password: r.password_enc,
      status: 'active',
    }));
    this.idx = this.pool.length ? hashString(this.workerId) % this.pool.length : 0;
  }

  current(): ProxyConfig | undefined {
    const row = this.pool[this.idx];
    if (!row) return undefined;
    return {
      kind: row.kind,
      host: row.host,
      port: row.port,
      username: row.username ?? undefined,
      password: row.password ?? undefined,
    };
  }

  rotate(): ProxyConfig | undefined {
    if (this.pool.length === 0) return undefined;
    this.idx = (this.idx + 1) % this.pool.length;
    return this.current();
  }

  size(): number {
    return this.pool.length;
  }
}
