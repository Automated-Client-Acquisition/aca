import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, encryptApiKey, isPersistableProvider, normalizeDsnUrl } from './unipile-client.ts';
import { resolveApiKey } from './resolve-api-key.ts';
import { unipileWebhookHeaders } from './unipile-webhook-auth.ts';

export interface SyncResult {
  checked: number;
  updated: number;
  imported: number;
  /** Accounts Unipile returned whose type we cannot store — see isPersistableProvider. */
  skipped: number;
  webhooksRegistered: number;
  dbAccounts: number;
}

async function registerWebhooks(
  unipileAccountId: string,
  provider: string,
  apiKey: string,
  dsnUrl: string,
  webhookUrl: string,
): Promise<string[]> {
  const webhookIds: string[] = [];

  try {
    const res = await fetch(`${dsnUrl}/api/v1/webhooks`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        account_ids: [unipileAccountId],
        request_url: webhookUrl,
        source: 'messaging',
        events: ['message_received'],
        format: 'json',
        enabled: true,
        headers: await unipileWebhookHeaders(),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const id = data.id || data.webhook_id;
      if (id) webhookIds.push(String(id));
    }
  } catch (e) {
    console.warn(`[Status Sync] messaging webhook for ${unipileAccountId}:`, e);
  }

  if (provider === 'LINKEDIN') {
    try {
      const res = await fetch(`${dsnUrl}/api/v1/webhooks`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          account_ids: [unipileAccountId],
          request_url: webhookUrl,
          source: 'users',
          events: ['new_relation'],
          format: 'json',
          enabled: true,
          headers: await unipileWebhookHeaders(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const id = data.id || data.webhook_id;
        if (id) webhookIds.push(String(id));
      }
    } catch (e) {
      console.warn(`[Status Sync] users webhook for ${unipileAccountId}:`, e);
    }
  }

  return webhookIds;
}

/**
 * Sync Unipile account statuses for a single organization.
 * - Imports any accounts present in Unipile but missing in our DB
 * - Updates statuses for existing accounts
 * - Marks DB accounts as disconnected if absent from Unipile
 * - Registers webhooks where missing
 */
export async function syncUnipileStatusesForOrg(
  supabase: SupabaseClient,
  organizationId: string,
  supabaseUrl: string,
  encryptionKey: string,
): Promise<SyncResult> {
  const apiKeyData = await resolveApiKey(supabase, organizationId, 'unipile');
  if (!apiKeyData?.key_encrypted) {
    return { checked: 0, updated: 0, imported: 0, skipped: 0, webhooksRegistered: 0, dbAccounts: 0 };
  }

  let unipileApiKey: string;
  try {
    unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
  } catch {
    throw new Error('Failed to decrypt Unipile API key');
  }

  const dsnUrl = normalizeDsnUrl(apiKeyData.metadata?.dsn_url);
  const webhookUrl = `${supabaseUrl}/functions/v1/unipile-webhook-handler`;

  // Fetch all accounts from Unipile
  const unipileAccounts: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${dsnUrl}/api/v1/accounts`);
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Unipile API ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    unipileAccounts.push(...items);
    cursor = data.cursor || undefined;
  } while (cursor);

  // v2 rows live on ACA's own application, never in this org's v1 account list: without this
  // filter the "no longer exists in Unipile" pass below would mark every one disconnected.
  const { data: dbAccounts, error: dbError } = await supabase
    .from('unipile_accounts')
    .select('id, unipile_account_id, provider, status, metadata')
    .eq('organization_id', organizationId)
    .eq('api_version', 'v1');
  if (dbError) throw dbError;

  const dbAccountMap = new Map((dbAccounts || []).map(a => [a.unipile_account_id, a]));
  const unipileAccountIds = new Set(unipileAccounts.map(a => String(a.id)));

  let updated = 0;
  let imported = 0;
  let webhooksRegistered = 0;
  let skipped = 0;

  const accessTokenEncrypted = await encryptApiKey(unipileApiKey, encryptionKey);

  for (const uniAccount of unipileAccounts) {
    const unipileId = String(uniAccount.id);
    const dbAccount = dbAccountMap.get(unipileId);

    const sources = Array.isArray(uniAccount.sources) ? uniAccount.sources : [];
    const sourceStatus = (((sources[0] as Record<string, unknown>)?.status as string) || '').toUpperCase();

    let newStatus: string;
    let errorMessage: string | null = null;

    if (sourceStatus === 'OK' || sourceStatus === 'CONNECTING') {
      newStatus = 'active';
    } else if (sourceStatus === 'CREDENTIALS') {
      newStatus = 'expired';
      errorMessage = 'Credentials need refreshing. Please reconnect this account.';
    } else if (sourceStatus === 'STOPPED' || sourceStatus === 'ERROR') {
      newStatus = 'error';
      errorMessage = `Unipile service ${sourceStatus.toLowerCase()}. Please reconnect this account.`;
    } else if (sourceStatus === 'PERMISSIONS') {
      newStatus = 'error';
      errorMessage = 'Missing permissions. Please reconnect this account.';
    } else {
      newStatus = 'active';
    }

    if (dbAccount) {
      const existingMeta = (dbAccount.metadata || {}) as Record<string, unknown>;
      const freshConnParams = uniAccount.connection_params as Record<string, unknown> | undefined;
      const updatedMetadata = {
        ...existingMeta,
        connection_params: freshConnParams ?? existingMeta.connection_params,
        sources: uniAccount.sources ?? existingMeta.sources,
      };

      if (newStatus !== dbAccount.status) {
        await supabase
          .from('unipile_accounts')
          .update({
            status: newStatus,
            error_message: errorMessage,
            metadata: updatedMetadata,
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbAccount.id);
        updated++;
      } else {
        await supabase
          .from('unipile_accounts')
          .update({
            error_message: newStatus === 'active' ? null : errorMessage,
            metadata: updatedMetadata,
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbAccount.id);
      }

      const existingWebhookIds = existingMeta.webhook_ids as string[] | undefined;
      if (!existingWebhookIds || existingWebhookIds.length === 0) {
        const webhookIds = await registerWebhooks(unipileId, dbAccount.provider, unipileApiKey, dsnUrl, webhookUrl);
        if (webhookIds.length > 0) {
          await supabase
            .from('unipile_accounts')
            .update({
              metadata: {
                ...updatedMetadata,
                webhook_ids: webhookIds,
                webhook_registered_at: new Date().toISOString(),
              },
            })
            .eq('id', dbAccount.id);
          webhooksRegistered++;
        }
      }
    } else {
      const provider = String(uniAccount.type || '').toUpperCase();
      if (!isPersistableProvider(provider)) {
        console.warn(
          `[Status Sync] skipping ${unipileId}: unsupported account type ` +
          `'${uniAccount.type}'. Add it to PERSISTABLE_UNIPILE_PROVIDERS and the ` +
          `unipile_accounts_provider_check constraint to import this account.`
        );
        skipped++;
        continue;
      }
      const connParams = uniAccount.connection_params as Record<string, unknown> | undefined;
      const imParams = connParams?.im as Record<string, unknown> | undefined;
      const displayName = uniAccount.name as string || imParams?.username as string || null;
      const username = imParams?.username as string || imParams?.publicIdentifier as string || null;

      let avatarUrl: string | null = null;
      const profileIdentifier = imParams?.publicIdentifier || imParams?.id;
      if (profileIdentifier) {
        try {
          const profileRes = await fetch(
            `${dsnUrl}/api/v1/users/${encodeURIComponent(String(profileIdentifier))}?account_id=${unipileId}`,
            { method: 'GET', headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' } },
          );
          if (profileRes.ok) {
            const profile = await profileRes.json() as Record<string, unknown>;
            avatarUrl = (
              profile?.profile_picture_url ||
              profile?.avatar_url ||
              profile?.picture_url ||
              profile?.image_url ||
              null
            ) as string | null;
          }
        } catch (e) {
          console.warn(`[Status Sync] avatar fetch for ${unipileId}:`, e);
        }
      }

      const webhookIds = await registerWebhooks(unipileId, provider, unipileApiKey, dsnUrl, webhookUrl);

      const accountMetadata: Record<string, unknown> = {
        connection_params: connParams,
        sources: uniAccount.sources,
        imported_by_sync: true,
      };
      if (webhookIds.length > 0) {
        accountMetadata.webhook_ids = webhookIds;
        accountMetadata.webhook_registered_at = new Date().toISOString();
        webhooksRegistered++;
      }

      const { error: insertError } = await supabase
        .from('unipile_accounts')
        .upsert({
          organization_id: organizationId,
          unipile_account_id: unipileId,
          provider,
          display_name: displayName,
          username,
          profile_url: null,
          avatar_url: avatarUrl,
          access_token_encrypted: accessTokenEncrypted,
          dsn_url: dsnUrl,
          status: newStatus,
          error_message: errorMessage,
          last_synced_at: new Date().toISOString(),
          metadata: accountMetadata,
        }, { onConflict: 'organization_id,unipile_account_id' });

      if (insertError) {
        console.error(`[Status Sync] import failed for ${unipileId}:`, insertError);
      } else {
        imported++;
      }
    }
  }

  for (const [unipileId, dbAccount] of dbAccountMap) {
    if (!unipileAccountIds.has(unipileId) && dbAccount.status !== 'disconnected') {
      await supabase
        .from('unipile_accounts')
        .update({
          status: 'disconnected',
          error_message: 'Account no longer exists in Unipile. Please reconnect or delete.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbAccount.id);
      updated++;
    }
  }

  return {
    checked: unipileAccounts.length,
    updated,
    imported,
    skipped,
    webhooksRegistered,
    dbAccounts: dbAccounts?.length || 0,
  };
}
