/**
 * Unipile connection layer for accounts that run on v1 and v2 at the same time.
 *
 * Callers get one shape back and branch on `apiVersion`, so endpoints can move to v2 one group at a time.
 * v2 needs only an API key: the host is fixed and the account id is in the path. v1 still needs the
 * org's DSN until its accounts migrate.
 *
 * @see docs/planning/unipile-v2-and-instagram-2026-10-21.md (Phase 1)
 */

import { createUnipileClientFromAccount, decryptApiKey, type UnipileClient } from '../unipile-client.ts';
import { UnipileV2Client } from './v2-client.ts';

export * from './errors.ts';
export * from './v2-client.ts';

export type UnipileApiVersion = 'v1' | 'v2';

export interface UnipileAccountSource {
  apiVersion: UnipileApiVersion;
  /** unipile_accounts.unipile_account_id: an `acc_…` id on v2, the provider id on v1. */
  unipileAccountId: string;
  /**
   * Encrypted API key. v1 accounts always have one (unipile_accounts.access_token_encrypted).
   * v2 accounts have one only when the org brings its own key. Platform-owned v2 accounts pass null
   * and use UNIPILE_V2_API_KEY.
   */
  encryptedApiKey: string | null;
  /** v1 only. Ignored on v2. */
  dsnUrl?: string | null;
}

export type UnipileConnection =
  | { apiVersion: 'v1'; accountId: string; sdk: UnipileClient }
  | { apiVersion: 'v2'; accountId: string; client: UnipileV2Client };

/**
 * Opens the connection for one account. The v2 client uses the org's own key when the account has one,
 * otherwise the platform key.
 */
export async function openUnipileConnection(
  source: UnipileAccountSource,
  encryptionKey: string,
): Promise<UnipileConnection> {
  if (source.apiVersion === 'v1') {
    if (!source.encryptedApiKey) throw new Error('Unipile v1 account has no API key');
    const sdk = await createUnipileClientFromAccount(
      { accessTokenEncrypted: source.encryptedApiKey, dsnUrl: source.dsnUrl },
      encryptionKey,
    );
    return { apiVersion: 'v1', accountId: source.unipileAccountId, sdk };
  }

  const apiKey = source.encryptedApiKey
    ? await decryptApiKey(source.encryptedApiKey, encryptionKey)
    : getPlatformUnipileV2ApiKey();
  return {
    apiVersion: 'v2',
    accountId: source.unipileAccountId,
    client: new UnipileV2Client({ apiKey }),
  };
}

/** The ACA-owned v2 key (edge secret UNIPILE_V2_API_KEY). Throws when it is not set. */
export function getPlatformUnipileV2ApiKey(): string {
  const apiKey = Deno.env.get('UNIPILE_V2_API_KEY');
  if (!apiKey) throw new Error('No Unipile API key. Add one in Settings > API Keys (or set UNIPILE_V2_API_KEY).');
  return apiKey;
}
