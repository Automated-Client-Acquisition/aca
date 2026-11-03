/**
 * ZapMail API Client
 *
 * Centralized client for ZapMail API interactions.
 * ZapMail handles inbox infrastructure only: domain management,
 * mailbox provisioning, and compliance. It does NOT handle sending,
 * warmup, or inbox reading — those are done via SMTP/IMAP.
 *
 * Base URL: https://api.zapmail.ai/api
 * Auth: x-auth-zapmail header with API key
 */

const ZAPMAIL_BASE_URL = 'https://api.zapmail.ai/api';

export interface ZapMailRequestOptions {
  method?: string;
  path: string;
  apiKey: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  workspaceId?: string;
  serviceProvider?: 'GOOGLE' | 'MICROSOFT';
}

export interface ZapMailMailbox {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  appPassword: string;
  secret: string;
  recoveryEmail: string;
  status: string;
  profilePicture: string | null;
  domain: string;
  domainId: string;
  assignedOn: string;
  expireOn: string;
  createdAt: string;
  isWarmedUp: boolean;
}

export interface ZapMailDomain {
  id: string;
  domain: string;
  status: string;
  mailboxes: ZapMailMailbox[];
}

export interface ZapMailListMailboxesResponse {
  status: number;
  message: string;
  data: {
    totalSearchedCount: number;
    currentPage: number;
    nextPage: number;
    totalPages: number;
    purchasedMailboxes: number;
    totalAssignedMailboxes: number;
    totalActiveMailboxes: number;
    availableMailboxes: number;
    domains: ZapMailDomain[];
  };
}

export interface ZapMailDomainHealth {
  domain: {
    id: string;
    domain: string;
    dnsManagedBy: string;
    status: string;
  };
  averageScore: number;
  isAbused: boolean;
}

export interface ZapMailWorkspace {
  id: string;
  name: string;
  domainCount?: string;
  mailboxCount?: string;
  // v2 API fields (actual response uses Google/Microsoft split)
  domainCountGoogle?: string;
  domainCountMicrosoft?: string;
  assignedMailboxesCountGoogle?: string;
  assignedMailboxesCountMicrosoft?: string;
}

export interface ZapMailListWorkspacesResponse {
  status: number;
  message: string;
  data: {
    totalWorkspacesCount: number;
    currentPage: number;
    totalPages: number;
    currentWorkspace: ZapMailWorkspace;
    workspaces: ZapMailWorkspace[];
  };
}

/**
 * Make an authenticated request to the ZapMail API.
 */
export async function zapMailRequest<T = unknown>(opts: ZapMailRequestOptions): Promise<T> {
  const url = new URL(`${ZAPMAIL_BASE_URL}${opts.path}`);

  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    'x-auth-zapmail': opts.apiKey,
    'Content-Type': 'application/json',
  };

  if (opts.workspaceId) {
    headers['x-workspace-id'] = opts.workspaceId;
    headers['x-workspace-key'] = opts.workspaceId;
  }

  if (opts.serviceProvider) {
    headers['x-service-provider'] = opts.serviceProvider;
  }

  const response = await fetch(url.toString(), {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (response.status === 429) {
    throw new Error('ZapMail rate limit exceeded. Please wait and retry.');
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ZapMail API error (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Validate an API key by fetching user details.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await zapMailRequest({
      path: '/v2/mailboxes/list',
      apiKey,
      query: { page: '1', limit: '1' },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all workspaces for the authenticated user.
 */
export async function listWorkspaces(apiKey: string): Promise<ZapMailWorkspace[]> {
  const response = await zapMailRequest<ZapMailListWorkspacesResponse>({
    path: '/v2/workspaces',
    apiKey,
    query: { page: '1', limit: '50' },
  });

  const allWorkspaces: ZapMailWorkspace[] = [];

  // The v2 API returns currentWorkspace + workspaces array
  if (response.data?.currentWorkspace) {
    const cw = response.data.currentWorkspace;
    allWorkspaces.push({
      ...cw,
      domainCount: cw.domainCountGoogle || cw.domainCount || '0',
      mailboxCount: cw.assignedMailboxesCountGoogle || cw.mailboxCount || '0',
    });
  }

  if (response.data?.workspaces && Array.isArray(response.data.workspaces)) {
    for (const ws of response.data.workspaces) {
      allWorkspaces.push({
        ...ws,
        domainCount: ws.domainCountGoogle || ws.domainCount || '0',
        mailboxCount: ws.assignedMailboxesCountGoogle || ws.mailboxCount || '0',
      });
    }
  }

  console.log(`[ZapMail] listWorkspaces total: ${allWorkspaces.length} workspaces`);
  return allWorkspaces;
}

/**
 * List all mailboxes across all domains, paginating through all pages.
 * Optionally scoped to a specific workspace via workspaceId.
 */
export async function listAllMailboxes(apiKey: string, workspaceId?: string): Promise<ZapMailMailbox[]> {
  const allMailboxes: ZapMailMailbox[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await zapMailRequest<ZapMailListMailboxesResponse>({
      path: '/v2/mailboxes/list',
      apiKey,
      workspaceId,
      query: { page: String(page), limit: '50' },
    });

    totalPages = response.data.totalPages;

    for (const domain of response.data.domains) {
      for (const mailbox of domain.mailboxes) {
        allMailboxes.push(mailbox);
      }
    }

    page++;
  } while (page <= totalPages);

  return allMailboxes;
}

/**
 * Get mailbox details by ID.
 */
export async function getMailboxById(apiKey: string, mailboxId: string): Promise<unknown> {
  return zapMailRequest({
    path: '/v2/mailboxes',
    apiKey,
    query: { id: mailboxId },
  });
}

/**
 * Get domain health score.
 */
export async function getDomainHealth(
  apiKey: string,
  domainId: string
): Promise<ZapMailDomainHealth> {
  const response = await zapMailRequest<{ status: number; data: ZapMailDomainHealth }>({
    path: '/domains/health-score',
    apiKey,
    query: { domainId },
  });

  return response.data;
}

// ============================================================================
// Key Decryption (uses ENCRYPTION_KEY — same as validate-api-key, AES-256-GCM)
// Falls back to SMTP_ENCRYPTION_KEY for keys migrated from zapmail_api_keys.
// ============================================================================

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function getEncryptionKey(): Uint8Array<ArrayBuffer> {
  const keyHex = Deno.env.get('ENCRYPTION_KEY');
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return hexToBytes(keyHex);
}

async function decryptWithKey(encrypted: string, keyBytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function encryptWithKey(plain: string, keyBytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(plain));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Check if a string looks like AES-GCM encrypted data (base64 with IV prefix).
 * AES-GCM encrypted data is base64 and when decoded is at least 12 bytes (IV) + some ciphertext.
 * Plaintext API keys (UUIDs, alphanumeric tokens) will fail this check.
 */
function looksEncrypted(value: string): boolean {
  try {
    const decoded = atob(value);
    // AES-GCM: 12-byte IV + at least 16-byte auth tag = minimum 28 bytes
    return decoded.length >= 28;
  } catch {
    // Not valid base64 → plaintext
    return false;
  }
}

/**
 * Decrypt an API key. Tries ENCRYPTION_KEY first, then falls back to
 * SMTP_ENCRYPTION_KEY for keys migrated from the old zapmail_api_keys table.
 * If the value is plaintext (not encrypted), returns it as-is.
 */
export async function decryptApiKey(encrypted: string): Promise<string> {
  // If it doesn't look like encrypted data, it's a plaintext legacy key
  if (!looksEncrypted(encrypted)) {
    return encrypted;
  }

  // Try primary key first
  try {
    return await decryptWithKey(encrypted, getEncryptionKey());
  } catch {
    // Fall back to SMTP_ENCRYPTION_KEY (for migrated keys)
    const smtpKeyHex = Deno.env.get('SMTP_ENCRYPTION_KEY');
    if (smtpKeyHex && smtpKeyHex.length === 64) {
      return await decryptWithKey(encrypted, hexToBytes(smtpKeyHex));
    }
    throw new Error('Failed to decrypt API key with any available key');
  }
}

/**
 * Re-encrypt a key with ENCRYPTION_KEY (used for migrating old keys).
 */
export async function reEncryptApiKey(plain: string): Promise<string> {
  return encryptWithKey(plain, getEncryptionKey());
}

// ============================================================================
// Multi-Key Org Lookup (reads from api_keys table, provider='zapmail')
// ============================================================================

export interface StoredZapMailKey {
  id: string;
  name: string;
  api_key: string;
  workspace_ids: string[];
  is_valid: boolean;
}

/**
 * Get all ZapMail API keys for an organization from the shared api_keys table.
 * Decrypts each key using ENCRYPTION_KEY.
 */
export async function getOrgApiKeys(
  supabase: any,
  organizationId: string
): Promise<StoredZapMailKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_encrypted, key_hint, is_valid, metadata')
    .eq('organization_id', organizationId)
    .eq('provider', 'zapmail')
    .eq('is_valid', true);

  if (error || !data || data.length === 0) return [];

  const results: StoredZapMailKey[] = [];
  for (const row of data) {
    let apiKey: string;
    try {
      apiKey = await decryptApiKey(row.key_encrypted);
    } catch {
      console.error(`[ZapMail] Failed to decrypt key ${row.id}`);
      continue;
    }
    const meta = row.metadata || {};
    results.push({
      id: row.id,
      name: meta.zapmail_name || row.key_hint || 'ZapMail Key',
      api_key: apiKey,
      workspace_ids: meta.workspace_ids || [],
      is_valid: row.is_valid,
    });
  }
  return results;
}

/**
 * Backward-compatible: get first valid API key for an organization.
 */
export async function getOrgApiKey(supabase: any, organizationId: string): Promise<string | null> {
  const keys = await getOrgApiKeys(supabase, organizationId);
  if (keys.length > 0) return keys[0].api_key;

  // Fallback: check environment variable
  const envKey = Deno.env.get('ZAPMAIL_API_KEY');
  return envKey || null;
}

/**
 * Look up and decrypt a single stored key by ID from the api_keys table.
 */
export async function getStoredKeyById(
  supabase: any,
  keyId: string
): Promise<{ api_key: string; name: string; workspace_ids: string[] } | null> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('key_encrypted, key_hint, metadata')
    .eq('id', keyId)
    .eq('provider', 'zapmail')
    .single();

  if (error || !data) return null;

  let apiKey: string;
  try {
    apiKey = await decryptApiKey(data.key_encrypted);
  } catch {
    console.error(`[ZapMail] Failed to decrypt key ${keyId}`);
    return null;
  }

  // If the stored value was plaintext, re-encrypt it with ENCRYPTION_KEY
  if (!looksEncrypted(data.key_encrypted)) {
    try {
      const reEncrypted = await reEncryptApiKey(apiKey);
      await supabase
        .from('api_keys')
        .update({ key_encrypted: reEncrypted })
        .eq('id', keyId);
      console.log(`[ZapMail] Re-encrypted plaintext key ${keyId}`);
    } catch (e) {
      console.error(`[ZapMail] Failed to re-encrypt key ${keyId}:`, e);
    }
  }

  const meta = data.metadata || {};
  return {
    api_key: apiKey,
    name: meta.zapmail_name || data.key_hint || 'ZapMail Key',
    workspace_ids: meta.workspace_ids || [],
  };
}
