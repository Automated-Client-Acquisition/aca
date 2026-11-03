/**
 * ACA List Building Engine — Proxy Manager
 *
 * Round-robins across an org's BYO proxy pool with per-domain throttling so
 * we don't hammer a single MX from one egress IP. Failing proxies get
 * retired automatically once their failure ratio exceeds 20% over 10+ runs.
 *
 * Spec: ACA_List_Building_Engine_Spec v1.0, section 6.3.
 */

import { decryptValue } from '../encryption.ts';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export interface ProxyRecord {
  id: string;
  organization_id: string | null;
  provider: 'brightdata' | 'smartproxy' | 'oxylabs' | 'custom';
  proxy_type: 'datacenter' | 'residential' | 'dedicated_smtp';
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  active: boolean;
  success_count: number;
  fail_count: number;
  metadata: Record<string, unknown> | null;
}

/**
 * Shape consumed by smtp-verifier's `verifyEmail({ proxy })` option. Kept in
 * sync with `ProxyTunnelConfig` in ./smtp-verifier.ts.
 */
export interface PickedProxy {
  id: string;
  type: 'socks5' | 'http_connect';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX_PER_WINDOW = 3;

export class ProxyManager {
  private pool: ProxyRecord[] = [];
  private cursor = 0;
  private loaded = false;
  private domainHits = new Map<string, number[]>();

  constructor(
    private supabase: SupabaseLike,
    private orgId: string
  ) {}

  // ------------------------------------------------------------------ pool

  async loadActivePool(): Promise<ProxyRecord[]> {
    const { data, error } = await this.supabase
      .from('lb_proxy_pool')
      .select('*')
      .or(`organization_id.eq.${this.orgId},organization_id.is.null`)
      .eq('active', true)
      .is('retired_at', null);

    if (error || !data) {
      this.pool = [];
      this.loaded = true;
      return [];
    }

    const decrypted: ProxyRecord[] = [];
    for (const row of data) {
      let username: string | null = null;
      let password: string | null = null;
      try {
        if (row.username_enc) username = await decryptValue(row.username_enc);
      } catch (err) {
        console.error('[proxy-manager] username decrypt failed', row.id, err);
      }
      try {
        if (row.password_enc) password = await decryptValue(row.password_enc);
      } catch (err) {
        console.error('[proxy-manager] password decrypt failed', row.id, err);
      }
      decrypted.push({
        id: row.id,
        organization_id: row.organization_id,
        provider: row.provider,
        proxy_type: row.proxy_type,
        host: row.host,
        port: row.port,
        username,
        password,
        active: row.active,
        success_count: row.success_count ?? 0,
        fail_count: row.fail_count ?? 0,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      });
    }

    this.pool = decrypted;
    this.loaded = true;
    return decrypted;
  }

  // -------------------------------------------------------- picking logic

  /**
   * Round-robin pick, skipping proxies that would exceed the per-domain
   * throttle. Returns a `PickedProxy` (the shape smtp-verifier expects) or
   * null if pool is empty or all throttled.
   *
   * All proxy_types map to `socks5` by default. An individual proxy row can
   * override this by setting `metadata.tunnel = 'http_connect'` in jsonb.
   */
  pickForDomain(
    domain: string,
    proxyType?: ProxyRecord['proxy_type']
  ): PickedProxy | null {
    if (!this.loaded || this.pool.length === 0) return null;

    // Prune throttle window
    const now = Date.now();
    const hits = this.domainHits.get(domain) ?? [];
    const recent = hits.filter((ts) => now - ts < THROTTLE_WINDOW_MS);
    if (recent.length >= THROTTLE_MAX_PER_WINDOW) {
      this.domainHits.set(domain, recent);
      return null;
    }

    const candidates = proxyType
      ? this.pool.filter((p) => p.proxy_type === proxyType)
      : this.pool;
    if (candidates.length === 0) return null;

    const pick = candidates[this.cursor % candidates.length];
    this.cursor = (this.cursor + 1) % Math.max(candidates.length, 1);

    recent.push(now);
    this.domainHits.set(domain, recent);

    const tunnelOverride = pick.metadata && typeof pick.metadata === 'object'
      ? (pick.metadata as Record<string, unknown>).tunnel
      : undefined;
    const type: PickedProxy['type'] =
      tunnelOverride === 'http_connect' ? 'http_connect' : 'socks5';

    return {
      id: pick.id,
      type,
      host: pick.host,
      port: pick.port,
      username: pick.username ?? undefined,
      password: pick.password ?? undefined,
    };
  }

  // -------------------------------------------------------- result tracking

  async recordSuccess(proxyId: string): Promise<void> {
    const entry = this.pool.find((p) => p.id === proxyId);
    if (entry) entry.success_count += 1;

    await this.supabase.rpc?.('noop').catch?.(() => {});
    await this.supabase
      .from('lb_proxy_pool')
      .update({
        success_count: entry?.success_count ?? 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', proxyId);
  }

  async recordFailure(proxyId: string, err: string): Promise<void> {
    const entry = this.pool.find((p) => p.id === proxyId);
    if (entry) entry.fail_count += 1;

    const total = (entry?.success_count ?? 0) + (entry?.fail_count ?? 0);
    const failRatio = total > 0 ? (entry?.fail_count ?? 0) / total : 0;
    const shouldRetire = total >= 10 && failRatio > 0.2;

    const patch: Record<string, unknown> = {
      fail_count: entry?.fail_count ?? 1,
      last_failed_at: new Date().toISOString(),
    };
    if (shouldRetire) {
      patch.retired_at = new Date().toISOString();
      patch.active = false;
      if (entry) entry.active = false;
    }

    await this.supabase
      .from('lb_proxy_pool')
      .update(patch)
      .eq('id', proxyId);

    if (err) console.error(`[proxy-manager] ${proxyId} failure:`, err);
  }
}
