import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { isUnipileApiError, UnipileV2Client } from '../_shared/unipile/index.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Unipile Delete Account Edge Function
 *
 * Deletes a Unipile account both from the Unipile API and from our database.
 * If the Unipile API call fails (e.g. account already gone, bad credentials),
 * we still delete the local DB record so orphans get cleaned up.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Missing authorization header' }, 401);
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const accountId = body.accountId as string | undefined;
    if (!accountId) {
      return jsonResponse({ success: false, error: 'accountId is required' }, 400);
    }

    // Fetch the account to get Unipile details
    const { data: account, error: fetchError } = await supabase
      .from('unipile_accounts')
      .select('id, organization_id, unipile_account_id, access_token_encrypted, dsn_url, api_version')
      .eq('id', accountId)
      .single();

    if (fetchError || !account) {
      // Account already gone — treat as success (idempotent delete)
      console.warn(`[Delete Account] Account ${accountId} not found in DB — already deleted`);
      return jsonResponse({ success: true, unipileDeleted: false, alreadyDeleted: true });
    }

    // Verify user belongs to this organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', account.organization_id)
      .single();

    if (!membership) {
      return jsonResponse({ success: false, error: 'You do not have access to this account' }, 403);
    }

    // Try to delete from Unipile API (best-effort)
    let unipileDeleted = false;
    if (account.api_version === 'v2') {
      // Unipile bills the peak count of linked accounts, so the account must really go, not just
      // our row.
      try {
        const client = new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) });
        await client.delete(`/accounts/${encodeURIComponent(account.unipile_account_id)}`);
        unipileDeleted = true;
      } catch (err) {
        unipileDeleted = isUnipileApiError(err) && err.code === 'NOT_FOUND';
        if (!unipileDeleted) console.warn('[Delete Account] Unipile v2 delete failed — will still delete locally:', err);
      }
    } else try {
      const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
      const dsnUrl = normalizeDsnUrl(account.dsn_url);

      const response = await fetch(
        `${dsnUrl}/api/v1/accounts/${account.unipile_account_id}`,
        {
          method: 'DELETE',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        }
      );

      unipileDeleted = response.ok || response.status === 404;
      if (!response.ok && response.status !== 404) {
        console.warn(`[Delete Account] Unipile API returned ${response.status} — will still delete locally`);
      }
    } catch (err) {
      // Decryption or network failure — still delete locally
      console.warn('[Delete Account] Could not reach Unipile API:', err);
    }

    // Delete from our database regardless
    const { error: deleteError } = await supabase
      .from('unipile_accounts')
      .delete()
      .eq('id', accountId);

    if (deleteError) {
      console.error('[Delete Account] DB delete failed:', deleteError);
      return jsonResponse({ success: false, error: `Failed to delete account: ${deleteError.message}` }, 500);
    }

    return jsonResponse({ success: true, unipileDeleted });
  } catch (error) {
    console.error('[Delete Account] Unexpected error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
