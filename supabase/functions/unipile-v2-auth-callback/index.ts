/**
 * Unipile v2 hosted-auth redirect target.
 *
 * Unipile sends the browser here after the user connects (or reconnects) an account on a v2
 * application: success carries `account_id`, `provider`, `state`; a critical failure carries
 * `error_type`, `error_title`, `error_detail`. The org comes only from `state`, which
 * unipile-connect stored in oauth_states. The account is saved with api_version = 'v2' and the
 * org's own v2 key copy, or none on ACA's platform application.
 *
 * The account.add webhook saves the same account from the same state, so either may land first.
 * The popup then goes to the app's /connect/complete page (see _shared/unipile/connect-complete.ts).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isUnipileApiError, UnipileV2Client } from '../_shared/unipile/index.ts';
import { resolveOrgV2Key, saveV2Account, v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { redirectToConnectComplete } from '../_shared/unipile/connect-complete.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  let accountId = url.searchParams.get('account_id');
  const provider = url.searchParams.get('provider') ?? undefined;
  const errorType = url.searchParams.get('error_type');
  const errorDetail = url.searchParams.get('error_detail');

  // The same identity is already linked to the application: Unipile names it in detail.
  if (!accountId && errorType === 'api/already_exists' && errorDetail?.startsWith('acc_')) {
    accountId = errorDetail;
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let appUrl: string | null = null;

  try {
    if (!state) throw new Error('Missing state');

    const { data: stateRow } = await supabase
      .from('oauth_states')
      .select('organization_id, expires_at, app_url')
      .eq('state', state)
      .maybeSingle();
    if (!stateRow) {
      // The webhook may have saved the account already; the link is spent but the work is done.
      if (accountId) {
        const { data: saved } = await supabase
          .from('unipile_accounts')
          .select('id')
          .eq('unipile_account_id', accountId)
          .eq('api_version', 'v2')
          .limit(1)
          .maybeSingle();
        if (saved) return redirectToConnectComplete(null, { ok: true, provider });
      }
      throw new Error('This connection link is invalid or was already used. Please start again.');
    }
    appUrl = stateRow.app_url;
    if (new Date(stateRow.expires_at) < new Date()) throw new Error('This connection link expired. Please start again.');

    if (!accountId) {
      const title = url.searchParams.get('error_title') || 'The account could not be connected';
      throw new Error(errorDetail ? `${title}: ${errorDetail}` : title);
    }

    // A reconnect stays on the application the row already lives on.
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { data: existing } = await supabase
      .from('unipile_accounts')
      .select('access_token_encrypted')
      .eq('organization_id', stateRow.organization_id)
      .eq('unipile_account_id', accountId)
      .eq('api_version', 'v2')
      .maybeSingle();
    const key = existing
      ? { apiKey: await v2ApiKeyForAccount(existing, encryptionKey), encryptedKey: existing.access_token_encrypted }
      : await resolveOrgV2Key(supabase, stateRow.organization_id, encryptionKey);
    const saved = await saveV2Account(
      supabase, new UnipileV2Client({ apiKey: key.apiKey }), stateRow.organization_id, accountId, key.encryptedKey,
    );
    await supabase.from('oauth_states').delete().eq('state', state);
    console.log(`[Unipile v2 Callback] Saved ${accountId} (${saved.provider}) as ${saved.id} for org ${stateRow.organization_id}`);

    return redirectToConnectComplete(appUrl, { ok: true, provider: provider ?? saved.provider });
  } catch (error) {
    const message = isUnipileApiError(error)
      ? `Unipile: ${error.message}`
      : error instanceof Error ? error.message : 'Connection failed';
    console.error('[Unipile v2 Callback] Error:', message);
    return redirectToConnectComplete(appUrl, { ok: false, provider, message });
  }
});
