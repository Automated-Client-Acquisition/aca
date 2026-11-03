/**
 * Unipile v2 accounts for every provider: which application an org uses, saving a linked account,
 * syncing an org's accounts, and keeping the application's webhook endpoint in place.
 *
 * An org runs on its own v2 application when it saved a v2 key (api_keys provider 'unipile_v2'),
 * otherwise on ACA's platform application (edge secret UNIPILE_V2_API_KEY). Rows on the org's own
 * application carry a copy of that key in access_token_encrypted; platform rows carry none.
 *
 * Accounts on the platform application are only ever attributed to an org through the `state` of
 * a hosted-auth link that org created: the platform key sees every tenant's accounts.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, encryptApiKey } from '../unipile-client.ts';
import { resolveApiKey } from '../resolve-api-key.ts';
import { isUnipileApiError } from './errors.ts';
import { accountPath, UNIPILE_V2_BASE_URL, UnipileV2Client } from './v2-client.ts';
import { getPlatformUnipileV2ApiKey } from './index.ts';

/** unipile_accounts.provider -> v2 provider. Messenger and X are not on Unipile v2. */
export const V2_PROVIDER_BY_ACA: Record<string, string> = {
  LINKEDIN: 'linkedin',
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
  INSTAGRAM: 'instagram',
  GOOGLE: 'google',
  OUTLOOK: 'outlook',
  MAIL: 'imap',
};

const ACA_PROVIDER_BY_V2: Record<string, string> = Object.fromEntries(
  Object.entries(V2_PROVIDER_BY_ACA).map(([aca, v2]) => [v2, aca]),
);

const PROVIDER_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  google: 'Google',
  outlook: 'Outlook',
  imap: 'Your mail server',
};

/** `/users/me` exists for these providers only. */
const SOCIAL_PROVIDERS = new Set(['linkedin', 'whatsapp', 'telegram', 'instagram']);

export const V2_WEBHOOK_EVENTS = [
  'message.new',
  'relation.new',
  'account.add',
  'account.reconnect',
  'account.remove',
  'account.status.disconnected',
  'account.status.running',
  'account.status.errored',
  'account.locked',
  'account.unlocked',
];

export interface V2Account {
  id: string;
  provider?: string;
  status?: string;
  is_locked?: boolean;
  name?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

interface V2Me {
  id?: string;
  public_identifier?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  profile_url?: string;
  public_picture_url?: string;
  specifics?: Record<string, unknown>;
}

export interface OrgV2Key {
  apiKey: string;
  /** Copy stored on rows of an org-owned application. NULL on ACA's platform application. */
  encryptedKey: string | null;
  /**
   * The org that owns the application: the key's org, or the parent it is inherited from. NULL on
   * ACA's platform application. Only the owner's sync may claim every account on it.
   */
  appOwnerOrgId: string | null;
}

export function v2ProviderLabel(provider: string | undefined): string {
  return PROVIDER_LABEL[provider ?? ''] ?? 'Your';
}

/** The org's own v2 key when it saved one on its own application, otherwise ACA's platform key. */
export async function resolveOrgV2Key(
  supabase: SupabaseClient,
  organizationId: string,
  encryptionKey: string,
): Promise<OrgV2Key> {
  const platformKey = Deno.env.get('UNIPILE_V2_API_KEY') ?? null;
  const own = await resolveApiKey(supabase, organizationId, 'unipile_v2');
  if (own?.key_encrypted) {
    const apiKey = await decryptApiKey(own.key_encrypted, encryptionKey);
    // A second key on ACA's own application is still the platform: never let it claim every
    // tenant's accounts.
    if (!platformKey || !(await isPlatformApplication(supabase, apiKey, platformKey))) {
      return { apiKey, encryptedKey: own.key_encrypted, appOwnerOrgId: own.source_organization_id };
    }
  }
  return { apiKey: getPlatformUnipileV2ApiKey(), encryptedKey: null, appOwnerOrgId: null };
}

/**
 * True when `apiKey` reaches ACA's platform application. Webhook endpoints and accounts belong to
 * one application, so a key that can read the platform's endpoint, or an account the platform key
 * also sees, is on the same application.
 */
async function isPlatformApplication(supabase: SupabaseClient, apiKey: string, platformKey: string): Promise<boolean> {
  if (apiKey === platformKey) return true;
  const client = new UnipileV2Client({ apiKey });
  const notFound = (error: unknown) =>
    isUnipileApiError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');

  const { data: endpoint } = await supabase
    .from('unipile_v2_webhook_endpoints')
    .select('id')
    .is('organization_id', null)
    .limit(1)
    .maybeSingle();
  if (endpoint) {
    try {
      await client.get(`/webhooks/endpoints/${encodeURIComponent(endpoint.id)}`, { noCache: true });
      return true;
    } catch (error) {
      if (isUnipileApiError(error) && error.code === 'NOT_FOUND') return false;
      // Not a Service key: compare an account instead.
    }
  }

  const page = await client.get<{ data?: V2Account[] }>('/accounts', { query: { limit: 1 }, noCache: true });
  const sample = page?.data?.[0];
  if (!sample) return false;
  try {
    await new UnipileV2Client({ apiKey: platformKey }).get(`/accounts/${encodeURIComponent(sample.id)}`, { noCache: true });
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}

/** The key for one v2 row: the org's own key copy when it has one, otherwise the platform key. */
export async function v2ApiKeyForAccount(
  row: { access_token_encrypted?: string | null },
  encryptionKey: string,
): Promise<string> {
  return row.access_token_encrypted
    ? await decryptApiKey(row.access_token_encrypted, encryptionKey)
    : getPlatformUnipileV2ApiKey();
}

/** unipile_accounts.status and error_message for a v2 Account. */
export function statusFromV2(account: V2Account): { status: string; error_message: string | null } {
  const label = v2ProviderLabel(account.provider);
  if (account.is_locked) {
    return { status: 'error', error_message: 'Unipile locked this account. Check the Unipile subscription.' };
  }
  switch (account.status) {
    case 'disconnected':
      return { status: 'expired', error_message: `${label} logged this account out. Please reconnect it.` };
    case 'errored':
      return { status: 'error', error_message: 'Unipile reported an error on this account. It usually recovers by itself.' };
    default: // running, partial, degraded
      return { status: 'active', error_message: null };
  }
}

/**
 * Saves (or refreshes) a linked v2 account for an org. `account` is the Account object, or its id
 * to fetch it: a successful read also proves the account is on the application `client` reaches.
 */
export async function saveV2Account(
  supabase: SupabaseClient,
  client: UnipileV2Client,
  organizationId: string,
  account: V2Account | string,
  encryptedKey: string | null,
): Promise<{ id: string; provider: string }> {
  const acc = typeof account === 'string'
    ? await client.get<V2Account>(`/accounts/${encodeURIComponent(account)}`, { noCache: true })
    : account;
  const v2Provider = acc.provider ?? '';
  const provider = ACA_PROVIDER_BY_V2[v2Provider];
  if (!provider) throw new Error(`Unipile ${v2Provider || 'unknown'} accounts are not supported yet`);

  // One v2 account belongs to one workspace.
  const { data: elsewhere } = await supabase
    .from('unipile_accounts')
    .select('organization_id')
    .eq('unipile_account_id', acc.id)
    .neq('organization_id', organizationId)
    .neq('status', 'disconnected')
    .limit(1)
    .maybeSingle();
  if (elsewhere) throw new Error(`This ${v2ProviderLabel(v2Provider)} account is already connected in another workspace.`);

  let me: V2Me = {};
  if (SOCIAL_PROVIDERS.has(v2Provider)) {
    try {
      me = await client.get<V2Me>(accountPath(acc.id, '/users/me'), { noCache: true });
    } catch (error) {
      console.warn(`[Unipile v2] Could not read own profile for ${acc.id}:`, isUnipileApiError(error) ? error.message : error);
    }
  }

  const { data: existing } = await supabase
    .from('unipile_accounts')
    .select('metadata')
    .eq('organization_id', organizationId)
    .eq('unipile_account_id', acc.id)
    .maybeSingle();

  const displayName = me.display_name || [me.first_name, me.last_name].filter(Boolean).join(' ') || acc.name || null;
  const memberId = me.id || acc.user_id || null;
  const { status, error_message } = statusFromV2(acc);

  const metadata: Record<string, unknown> = {
    ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
    unipile_v2: {
      provider: v2Provider,
      user_id: memberId,
      member_id: me.specifics?.member_id ?? null,
      is_premium: me.specifics?.is_premium ?? null,
      products: acc.metadata?.products_connection_status ?? null,
      connected_at: new Date().toISOString(),
    },
  };
  // Same shape v1 LinkedIn rows carry, so self-message and same-person checks keep working.
  if (provider === 'LINKEDIN' && memberId) {
    metadata.connection_params = {
      im: { id: memberId, publicIdentifier: me.public_identifier ?? null, username: me.public_identifier ?? null },
    };
  }

  const { data, error } = await supabase
    .from('unipile_accounts')
    .upsert({
      organization_id: organizationId,
      unipile_account_id: acc.id,
      provider,
      api_version: 'v2',
      display_name: displayName,
      first_name: me.first_name || null,
      last_name: me.last_name || null,
      username: me.public_identifier || null,
      profile_url: me.profile_url || null,
      avatar_url: me.public_picture_url || null,
      access_token_encrypted: encryptedKey,
      dsn_url: UNIPILE_V2_BASE_URL,
      status,
      error_message,
      last_synced_at: new Date().toISOString(),
      metadata,
    }, { onConflict: 'organization_id,unipile_account_id' })
    .select('id')
    .single();

  if (error || !data) {
    console.error(`[Unipile v2] Failed to store account ${acc.id}:`, error);
    throw new Error('Failed to save the account');
  }
  return { id: data.id, provider };
}

export interface V2SyncResult {
  imported: number;
  updated: number;
  disconnected: number;
  /** ok, or not_permitted when the key may not manage webhooks (inbound messages won't arrive). */
  webhook: 'ok' | 'not_permitted' | 'skipped';
}

/**
 * Brings an org's v2 accounts in line with Unipile.
 * - On an application the org owns, every account is the org's: missing ones are imported and
 *   rows that are gone from it are marked disconnected.
 * - Every other row (ACA's platform application, a parent's inherited key, an older key) is
 *   refreshed one by one with its own key.
 */
export async function syncV2AccountsForOrg(
  supabase: SupabaseClient,
  organizationId: string,
  encryptionKey: string,
  supabaseUrl: string,
): Promise<V2SyncResult> {
  const result: V2SyncResult = { imported: 0, updated: 0, disconnected: 0, webhook: 'skipped' };

  const { data: rows, error } = await supabase
    .from('unipile_accounts')
    .select('id, unipile_account_id, status, error_message, access_token_encrypted')
    .eq('organization_id', organizationId)
    .eq('api_version', 'v2');
  if (error) throw error;

  let key: OrgV2Key | null = null;
  try {
    key = await resolveOrgV2Key(supabase, organizationId, encryptionKey);
  } catch (keyError) {
    console.warn('[Unipile v2 Sync] No v2 key available:', keyError instanceof Error ? keyError.message : keyError);
  }

  const markDisconnected = async (rowId: string) => {
    await supabase
      .from('unipile_accounts')
      .update({
        status: 'disconnected',
        error_message: 'Account no longer exists in Unipile. Please reconnect or delete.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', rowId);
    result.disconnected++;
  };

  const applyStatus = async (row: { id: string; status: string; error_message: string | null }, acc: V2Account) => {
    const next = statusFromV2(acc);
    if (next.status === row.status && next.error_message === row.error_message) return;
    await supabase
      .from('unipile_accounts')
      .update({ ...next, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id);
    result.updated++;
  };

  // Rows the application listing below accounts for; everything else is refreshed one by one.
  const covered = new Set<string>();

  if (key?.appOwnerOrgId) {
    const client = new UnipileV2Client({ apiKey: key.apiKey });

    if (key.appOwnerOrgId === organizationId) {
      const accounts = await listAllAccounts(client);
      const live = new Set(accounts.map((a) => a.id));
      const byId = new Map((rows ?? []).map((r) => [r.unipile_account_id, r]));

      for (const acc of accounts) {
        const row = byId.get(acc.id);
        try {
          if (row) {
            await applyStatus(row, acc);
            covered.add(row.id);
          } else {
            await saveV2Account(supabase, client, organizationId, acc, key.encryptedKey);
            result.imported++;
          }
        } catch (saveError) {
          console.warn(`[Unipile v2 Sync] Skipped ${acc.id}:`, saveError instanceof Error ? saveError.message : saveError);
        }
      }

      // A row on this same key that the application no longer lists is gone.
      for (const row of rows ?? []) {
        if (covered.has(row.id) || !row.access_token_encrypted || row.status === 'disconnected') continue;
        if (live.has(row.unipile_account_id)) continue;
        if ((await decryptApiKey(row.access_token_encrypted, encryptionKey)) !== key.apiKey) continue;
        await markDisconnected(row.id);
        covered.add(row.id);
      }
    }

    result.webhook = await ensureV2WebhookEndpoint(supabase, client, key.appOwnerOrgId, supabaseUrl);
  }

  // The platform endpoint must carry account.add so a closed popup doesn't lose an account.
  try {
    const platform = new UnipileV2Client({ apiKey: getPlatformUnipileV2ApiKey() });
    const platformWebhook = await ensureV2WebhookEndpoint(supabase, platform, null, supabaseUrl);
    if (!key?.appOwnerOrgId) result.webhook = platformWebhook;
  } catch (webhookError) {
    console.warn('[Unipile v2 Sync] Platform webhook check failed:', webhookError instanceof Error ? webhookError.message : webhookError);
  }

  for (const row of rows ?? []) {
    if (covered.has(row.id) || row.status === 'disconnected') continue;
    try {
      const client = new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(row, encryptionKey) });
      const acc = await client.get<V2Account>(`/accounts/${encodeURIComponent(row.unipile_account_id)}`, { noCache: true });
      await applyStatus(row, acc);
    } catch (getError) {
      if (isUnipileApiError(getError) && getError.code === 'NOT_FOUND') await markDisconnected(row.id);
      else console.warn(`[Unipile v2 Sync] Could not read ${row.unipile_account_id}:`, getError instanceof Error ? getError.message : getError);
    }
  }

  return result;
}

async function listAllAccounts(client: UnipileV2Client): Promise<V2Account[]> {
  const all: V2Account[] = [];
  const limit = 100;
  for (let offset = 0; offset < 10_000; offset += limit) {
    const page = await client.get<{ data?: V2Account[]; has_more?: boolean }>('/accounts', {
      query: { offset, limit },
      noCache: true,
    });
    const items = page?.data ?? [];
    all.push(...items);
    if (!page?.has_more || items.length === 0) break;
  }
  return all;
}

interface WebhookEndpoint {
  id: string;
  url?: string;
  trigger_events?: string[];
  secret?: string;
}

/**
 * Makes sure the application `client` reaches posts V2_WEBHOOK_EVENTS to unipile-v2-webhook, and
 * that we hold the endpoint's signing secret. `organizationId` null = ACA's platform application.
 * Needs a Service API key; any other key gets not_permitted.
 */
export async function ensureV2WebhookEndpoint(
  supabase: SupabaseClient,
  client: UnipileV2Client,
  organizationId: string | null,
  supabaseUrl: string,
): Promise<'ok' | 'not_permitted'> {
  const url = `${supabaseUrl}/functions/v1/unipile-v2-webhook`;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

  let stored = supabase.from('unipile_v2_webhook_endpoints').select('id, trigger_events');
  stored = organizationId ? stored.eq('organization_id', organizationId) : stored.is('organization_id', null);
  const { data: rows } = await stored.limit(1);
  const row = rows?.[0];

  try {
    if (row) {
      const missing = V2_WEBHOOK_EVENTS.filter((e) => !(row.trigger_events ?? []).includes(e));
      if (missing.length === 0) return 'ok';
      const events = Array.from(new Set([...(row.trigger_events ?? []), ...V2_WEBHOOK_EVENTS]));
      await client.patch(`/webhooks/endpoints/${encodeURIComponent(row.id)}`, { body: { trigger_events: events } });
      await supabase.from('unipile_v2_webhook_endpoints').update({ trigger_events: events }).eq('id', row.id);
      return 'ok';
    }

    // Adopt an endpoint already pointing at us (added in the Unipile dashboard) rather than
    // creating a second one, which would deliver every event twice.
    const listed = await client.get<{ data?: WebhookEndpoint[] }>('/webhooks/endpoints', { query: { limit: 100 }, noCache: true });
    let endpoint = (listed?.data ?? []).find((e) => e.url === url && e.secret);
    if (endpoint) {
      // Already stored for another owner of the same application: nothing to add.
      const { data: known } = await supabase
        .from('unipile_v2_webhook_endpoints')
        .select('id')
        .eq('id', endpoint.id)
        .maybeSingle();
      if (known) return 'ok';

      const events = Array.from(new Set([...(endpoint.trigger_events ?? []), ...V2_WEBHOOK_EVENTS]));
      if (events.length !== (endpoint.trigger_events ?? []).length) {
        await client.patch(`/webhooks/endpoints/${encodeURIComponent(endpoint.id)}`, { body: { trigger_events: events } });
      }
      endpoint = { ...endpoint, trigger_events: events };
    } else {
      endpoint = await client.post<WebhookEndpoint>('/webhooks/endpoints', {
        body: { url, trigger_events: V2_WEBHOOK_EVENTS, description: 'ACA inbox, replies and account status' },
      });
    }
    if (!endpoint?.id || !endpoint.secret) throw new Error('Unipile returned no webhook secret');

    await supabase.from('unipile_v2_webhook_endpoints').upsert({
      id: endpoint.id,
      url,
      trigger_events: endpoint.trigger_events ?? V2_WEBHOOK_EVENTS,
      secret_encrypted: await encryptApiKey(endpoint.secret, encryptionKey),
      organization_id: organizationId,
    });
    return 'ok';
  } catch (error) {
    if (isUnipileApiError(error) && (error.code === 'FORBIDDEN' || error.code === 'AUTHENTICATION_FAILED')) {
      console.warn(`[Unipile v2] Key cannot manage webhooks for ${organizationId ?? 'platform'}: ${error.message}`);
      return 'not_permitted';
    }
    throw error;
  }
}
