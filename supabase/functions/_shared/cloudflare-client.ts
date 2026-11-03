/**
 * Cloudflare API v4 client.
 *
 * Wraps the subset of Cloudflare's API needed for ACA's managed-DNS flow:
 * token verification, account listing, zone listing, and (added in commit 2)
 * DNS record CRUD + batch push with conflict cleanup.
 *
 * Pattern mirrors _shared/registrar-client.ts. A single class, a single
 * factory, structured errors.
 */

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'initializing' | 'moved' | 'deleted' | 'deactivated';
  name_servers: string[];
  account: { id: string; name: string };
}

export interface CloudflareTokenVerification {
  valid: boolean;
  // List of permission group IDs from /user/tokens/verify response. We pass this
  // through to the UI so it can flag "your token is read-only" before the user
  // hits a write failure later.
  permissions?: string[];
  expires_on?: string | null;
  not_before?: string | null;
  error?: string;
}

export class CloudflareError extends Error {
  constructor(public code: number, message: string, public status?: number) {
    super(message);
    this.name = 'CloudflareError';
  }
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
  result_info?: { page: number; per_page: number; total_pages: number; count: number; total_count: number };
}

export class CloudflareClient {
  constructor(private token: string) {
    if (!token) throw new Error('CloudflareClient: token is required');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${CLOUDFLARE_API}${path}`;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');

    let attempt = 0;
    while (true) {
      attempt += 1;
      const res = await fetch(url, { ...init, headers });
      // Rate limit: respect Retry-After, retry up to 3 times with exp backoff.
      if (res.status === 429 && attempt <= 3) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 1000 * 2 ** (attempt - 1));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      const body = await res.json().catch(() => ({ success: false, errors: [{ code: 0, message: `Invalid JSON (HTTP ${res.status})` }] }));
      const envelope = body as CloudflareEnvelope<T>;
      if (!res.ok || !envelope.success) {
        const first = envelope.errors?.[0];
        throw new CloudflareError(first?.code ?? res.status, first?.message ?? `HTTP ${res.status}`, res.status);
      }
      return envelope.result;
    }
  }

  /**
   * Verify the token is valid. Hits /user/tokens/verify which returns
   * { status: "active" } for live tokens. Used at validate-and-store time.
   */
  async verifyToken(): Promise<CloudflareTokenVerification> {
    try {
      const result = await this.request<{ id: string; status: string; expires_on?: string; not_before?: string }>(
        '/user/tokens/verify',
      );
      return {
        valid: result.status === 'active',
        expires_on: result.expires_on ?? null,
        not_before: result.not_before ?? null,
      };
    } catch (err) {
      if (err instanceof CloudflareError) {
        return { valid: false, error: err.message };
      }
      throw err;
    }
  }

  /**
   * List accounts the token has access to. Most users will have exactly one.
   * Used to populate dns_providers.account_id and account_name at connect time.
   */
  async listAccounts(): Promise<CloudflareAccount[]> {
    return this.request<CloudflareAccount[]>('/accounts?per_page=50');
  }

  /**
   * List zones accessible to the token. Paginates internally up to 500 zones
   * (10 pages of 50) — enough for any realistic org. Optional name filter is
   * a server-side contains match.
   */
  async listZones(opts: { name?: string; accountId?: string } = {}): Promise<CloudflareZone[]> {
    const all: CloudflareZone[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const params = new URLSearchParams();
      params.set('per_page', '50');
      params.set('page', String(page));
      if (opts.name) params.set('name', opts.name);
      if (opts.accountId) params.set('account.id', opts.accountId);
      const zones = await this.request<CloudflareZone[]>(`/zones?${params}`);
      all.push(...zones);
      if (zones.length < 50) break;
    }
    return all;
  }

  /**
   * Fetch a single zone by ID. Used when we already have the zone_id cached
   * on the domain row and want to read its current status / nameservers.
   */
  async getZone(zoneId: string): Promise<CloudflareZone> {
    return this.request<CloudflareZone>(`/zones/${zoneId}`);
  }

  /**
   * Convenience: count zones without fetching them all. Used at validate-and-store
   * time to show a "we see N zones in your account" affordance in the UI.
   */
  async countZones(): Promise<number> {
    const params = new URLSearchParams({ per_page: '1', page: '1' });
    const url = `${CLOUDFLARE_API}/zones?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const first = body?.errors?.[0];
      throw new CloudflareError(first?.code ?? res.status, first?.message ?? `HTTP ${res.status}`, res.status);
    }
    return body.result_info?.total_count ?? body.result.length;
  }

  // ==========================================================================
  // DNS record CRUD
  // ==========================================================================

  async listDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]> {
    const all: CloudflareDnsRecord[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const params = new URLSearchParams({ per_page: '100', page: String(page) });
      const rows = await this.request<CloudflareDnsRecord[]>(`/zones/${zoneId}/dns_records?${params}`);
      all.push(...rows);
      if (rows.length < 100) break;
    }
    return all;
  }

  async createDnsRecord(zoneId: string, record: Omit<CloudflareDnsRecord, 'id'>): Promise<CloudflareDnsRecord> {
    return this.request<CloudflareDnsRecord>(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });
  }

  async updateDnsRecord(zoneId: string, recordId: string, record: Partial<CloudflareDnsRecord>): Promise<CloudflareDnsRecord> {
    return this.request<CloudflareDnsRecord>(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  }

  // ==========================================================================
  // Batch push with conflict detection
  // ==========================================================================
  //
  // Conflict detection rules (mirrors the verifier's logic in dns-utils.ts):
  //   - Duplicate SPF (TXT at apex starting v=spf1)            → delete extras
  //   - Duplicate DMARC (TXT at _dmarc.X starting v=DMARC1)    → delete extras
  //   - Extra MX records (any MX with value != our target)     → delete extras
  //   - Stale DKIM CNAME (selectorN._domainkey.X with wrong value) → delete
  //   - Stale autodiscover CNAME (≠ autodiscover.outlook.com)  → delete
  //
  // The detection is whitelist-narrow on purpose: we only touch the exact name
  // patterns ACA uses. We never delete the user's www CNAME, A records, or
  // unrelated TXTs. This is the load-bearing safety property.

  async batchPushRecords(
    zoneId: string,
    targetRecords: PushTargetRecord[],
    options: BatchPushOptions = {},
  ): Promise<BatchPushResult> {
    const { cleanupConflicts = true, confirmDestructive = false, dryRun = false } = options;

    const existing = await this.listDnsRecords(zoneId);
    const plan = planBatchPush(existing, targetRecords);

    // Short-circuit when conflicts need user confirmation.
    if (cleanupConflicts && !confirmDestructive && plan.conflicts.length > 0) {
      return {
        requires_confirmation: true,
        plan,
        results: [],
      };
    }

    if (dryRun) {
      return { requires_confirmation: false, plan, results: [] };
    }

    const results: PushRecordResult[] = [];

    // Delete conflicts first (only when user has opted in).
    if (cleanupConflicts && confirmDestructive) {
      for (const conflict of plan.conflicts) {
        try {
          await this.deleteDnsRecord(zoneId, conflict.id);
          results.push({ action: 'deleted', record: conflict, success: true });
        } catch (err) {
          results.push({
            action: 'deleted',
            record: conflict,
            success: false,
            error: err instanceof Error ? err.message : 'Delete failed',
          });
        }
      }
    }

    // Updates next (so we don't accidentally hit unique-record constraints when
    // the create paths run).
    for (const upd of plan.updates) {
      try {
        const updated = await this.updateDnsRecord(zoneId, upd.current.id!, recordToCloudflare(upd.target));
        results.push({ action: 'updated', record: { ...upd.target, id: updated.id }, success: true });
      } catch (err) {
        results.push({
          action: 'updated',
          record: upd.target,
          success: false,
          error: err instanceof Error ? err.message : 'Update failed',
        });
      }
    }

    // Creates last.
    for (const add of plan.adds) {
      try {
        const created = await this.createDnsRecord(zoneId, recordToCloudflare(add));
        results.push({ action: 'created', record: { ...add, id: created.id }, success: true });
      } catch (err) {
        results.push({
          action: 'created',
          record: add,
          success: false,
          error: err instanceof Error ? err.message : 'Create failed',
        });
      }
    }

    // No-ops surfaced as "skipped" for UI completeness.
    for (const keep of plan.keeps) {
      results.push({ action: 'skipped', record: keep, success: true });
    }

    return { requires_confirmation: false, plan, results };
  }
}

export function createCloudflareClient(token: string): CloudflareClient {
  return new CloudflareClient(token);
}

// ============================================================================
// DNS record types + batch-push planning
// ============================================================================

export interface CloudflareDnsRecord {
  id?: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'CAA';
  name: string;
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
  comment?: string;
}

/**
 * The shape ACA stores in email_sending_domains.dns_records. Slightly different
 * from CloudflareDnsRecord (`value` vs `content`, no `id`, optional `ttl`).
 */
export interface PushTargetRecord {
  type: 'A' | 'CNAME' | 'TXT' | 'MX';
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
  description?: string;
}

export interface ConflictRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  reason: string;
}

export interface BatchPushPlan {
  adds: PushTargetRecord[];
  updates: Array<{ current: CloudflareDnsRecord; target: PushTargetRecord; reason: string }>;
  keeps: PushTargetRecord[];
  conflicts: ConflictRecord[];
}

export interface BatchPushOptions {
  cleanupConflicts?: boolean;
  confirmDestructive?: boolean;
  dryRun?: boolean;
}

export interface PushRecordResult {
  action: 'created' | 'updated' | 'deleted' | 'skipped';
  record: PushTargetRecord | ConflictRecord;
  success: boolean;
  error?: string;
}

export interface BatchPushResult {
  requires_confirmation: boolean;
  plan: BatchPushPlan;
  results: PushRecordResult[];
}

function recordToCloudflare(r: PushTargetRecord): Omit<CloudflareDnsRecord, 'id'> {
  // Cloudflare's docs say TXT content "must be in quotation marks." They'll
  // add them for us if missing, but quoting ourselves removes any ambiguity
  // and avoids edge cases with values that contain whitespace or semicolons
  // (DMARC, longer SPF lines). Don't double-quote if it's already wrapped.
  const content =
    r.type === 'TXT' && !(r.value.startsWith('"') && r.value.endsWith('"'))
      ? `"${r.value}"`
      : r.value;
  return {
    type: r.type,
    name: r.name,
    content,
    ttl: r.ttl ?? 1, // 1 = "auto" in CF — best for DKIM CNAMEs (CF flattening)
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    proxied: false, // email records must never be CF-proxied
    comment: 'managed by ACA',
  };
}

function normalize(s: string): string {
  // Strip surrounding double-quotes so quoted/unquoted TXT values compare equal.
  // Without this, a record stored quoted in CF would always look "different"
  // from our unquoted target value, causing every push to spuriously update.
  const trimmed = s.trim().replace(/\.$/, '');
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return unquoted.toLowerCase();
}

/**
 * Compute the diff between what's in the zone today and what ACA wants.
 * Pure function — no network calls — so we can unit-test conflict rules later
 * without standing up CF mocks.
 */
export function planBatchPush(
  existing: CloudflareDnsRecord[],
  target: PushTargetRecord[],
): BatchPushPlan {
  const adds: PushTargetRecord[] = [];
  const updates: BatchPushPlan['updates'] = [];
  const keeps: PushTargetRecord[] = [];
  const conflicts: ConflictRecord[] = [];

  // Index existing records by (type|name) for fast lookup
  const existingByKey = new Map<string, CloudflareDnsRecord[]>();
  for (const r of existing) {
    const key = `${r.type}|${normalize(r.name)}`;
    const list = existingByKey.get(key) ?? [];
    list.push(r);
    existingByKey.set(key, list);
  }

  // First pass: classify our target records as add / update / keep
  for (const tgt of target) {
    const key = `${tgt.type}|${normalize(tgt.name)}`;
    const matches = existingByKey.get(key) ?? [];

    // Exact value match (CF stores TXT values without surrounding quotes)
    const exactMatch = matches.find((m) => normalize(m.content) === normalize(tgt.value));
    if (exactMatch) {
      keeps.push(tgt);
      continue;
    }

    // For TXT/SPF/DMARC and apex MX we may have a stale value of the same kind
    // — those go to updates (not deletes) so the user keeps the line item.
    const sameKind = matches.find((m) => isSameKind(m, tgt));
    if (sameKind) {
      updates.push({
        current: sameKind,
        target: tgt,
        reason: `replacing existing ${tgt.type} record value`,
      });
      continue;
    }

    adds.push(tgt);
  }

  // Second pass: scan for conflicts (duplicates / extras / stale)
  // We pass over the existing zone records and flag anything that:
  //   - matches a pattern ACA owns (SPF/DMARC/MX/DKIM/autodiscover at expected names)
  //   - and isn't the record we're keeping or updating
  const targetSpf = target.find((t) => t.type === 'TXT' && t.value.toLowerCase().startsWith('v=spf1'));
  const targetDmarc = target.find((t) => t.type === 'TXT' && t.value.toLowerCase().startsWith('v=dmarc1'));
  const targetMx = target.find((t) => t.type === 'MX');
  const targetAutodiscover = target.find((t) => t.type === 'CNAME' && normalize(t.name).startsWith('autodiscover.'));
  const targetDkim = target.filter((t) => t.type === 'CNAME' && normalize(t.name).includes('._domainkey.'));

  // Records we plan to keep or update — never flag those as conflicts
  const protectedIds = new Set<string>([
    ...updates.map((u) => u.current.id!).filter(Boolean),
  ]);

  for (const r of existing) {
    if (r.id && protectedIds.has(r.id)) continue;
    if (!r.id) continue; // can't delete records without IDs

    const rNameNorm = normalize(r.name);
    const rContentNorm = normalize(r.content);

    // Duplicate SPF — any TXT at apex starting with v=spf1, other than our target.
    if (
      targetSpf &&
      r.type === 'TXT' &&
      rNameNorm === normalize(targetSpf.name) &&
      rContentNorm.startsWith('v=spf1') &&
      rContentNorm !== normalize(targetSpf.value)
    ) {
      conflicts.push({
        id: r.id,
        type: r.type,
        name: r.name,
        value: r.content,
        reason: 'duplicate SPF — multiple v=spf1 records cause PERMERROR (RFC 7208)',
      });
      continue;
    }

    // Duplicate DMARC — any TXT at _dmarc.X starting v=DMARC1, other than our target.
    if (
      targetDmarc &&
      r.type === 'TXT' &&
      rNameNorm === normalize(targetDmarc.name) &&
      rContentNorm.startsWith('v=dmarc1') &&
      rContentNorm !== normalize(targetDmarc.value)
    ) {
      conflicts.push({
        id: r.id,
        type: r.type,
        name: r.name,
        value: r.content,
        reason: 'duplicate DMARC — multiple records cause the policy to be ignored (RFC 7489)',
      });
      continue;
    }

    // Extra MX — any MX at apex other than our target. ACA always uses a single MX.
    if (
      targetMx &&
      r.type === 'MX' &&
      rNameNorm === normalize(targetMx.name) &&
      rContentNorm !== normalize(targetMx.value)
    ) {
      conflicts.push({
        id: r.id,
        type: r.type,
        name: r.name,
        value: r.content,
        reason: 'extra MX record — splits inbound mail between hosts',
      });
      continue;
    }

    // Stale DKIM CNAME — any selectorN._domainkey.X CNAME not matching our targets.
    if (r.type === 'CNAME' && rNameNorm.includes('._domainkey.')) {
      const matchingTarget = targetDkim.find((t) => normalize(t.name) === rNameNorm);
      if (matchingTarget && normalize(matchingTarget.value) !== rContentNorm) {
        conflicts.push({
          id: r.id,
          type: r.type,
          name: r.name,
          value: r.content,
          reason: 'stale DKIM CNAME — points to a different tenant or partition',
        });
        continue;
      }
    }

    // Stale autodiscover CNAME — replace with autodiscover.outlook.com.
    if (
      targetAutodiscover &&
      r.type === 'CNAME' &&
      rNameNorm === normalize(targetAutodiscover.name) &&
      rContentNorm !== normalize(targetAutodiscover.value)
    ) {
      conflicts.push({
        id: r.id,
        type: r.type,
        name: r.name,
        value: r.content,
        reason: 'autodiscover CNAME points elsewhere — would break Outlook client setup',
      });
    }
  }

  return { adds, updates, keeps, conflicts };
}

/**
 * "Same kind" = same logical record family that should have exactly one row.
 * Used to flag stale-but-replaceable records (so they go to updates, not deletes).
 */
function isSameKind(existing: CloudflareDnsRecord, target: PushTargetRecord): boolean {
  const ename = normalize(existing.name);
  const tname = normalize(target.name);
  if (ename !== tname) return false;
  if (existing.type !== target.type) return false;

  // For MS=... ownership TXTs there should only ever be one — replace value if found.
  if (target.type === 'TXT' && target.value.startsWith('MS=') && existing.content.startsWith('MS=')) {
    return true;
  }
  // Autodiscover CNAME — always single record.
  if (target.type === 'CNAME' && tname.startsWith('autodiscover.')) {
    return true;
  }
  // DKIM CNAMEs — match by full name (selector1._domainkey.X)
  if (target.type === 'CNAME' && tname.includes('._domainkey.')) {
    return true;
  }
  return false;
}
