/**
 * Backfill Avatars Edge Function
 *
 * One-time backfill to populate avatar_url for existing unipile_accounts.
 * Fetches the user's own LinkedIn profile via Unipile to get their avatar.
 *
 * Endpoint: POST /backfill-avatars
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Fetch all active accounts missing an avatar, include metadata for connection_params
    const { data: accounts, error: queryError } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, access_token_encrypted, dsn_url, metadata')
      .is('avatar_url', null)
      .eq('status', 'active');

    if (queryError) {
      throw new Error(`Failed to query accounts: ${queryError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No accounts need avatar backfill' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Backfill Avatars] Found ${accounts.length} accounts to process`);

    let updated = 0;
    let failed = 0;
    const errors: Array<{ accountId: string; error: string }> = [];

    for (const account of accounts) {
      try {
        // Get the user's LinkedIn identifier from stored connection_params
        const connParams = account.metadata?.connection_params as Record<string, unknown> | undefined;
        const imParams = connParams?.im as Record<string, unknown> | undefined;
        const identifier = imParams?.publicIdentifier || imParams?.id;

        if (!identifier) {
          errors.push({ accountId: account.id, error: 'No LinkedIn identifier in metadata' });
          failed++;
          continue;
        }

        const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
        const dsnUrl = normalizeDsnUrl(account.dsn_url);

        // Fetch the user's own LinkedIn profile
        const res = await fetch(
          `${dsnUrl}/api/v1/users/${encodeURIComponent(String(identifier))}?account_id=${account.unipile_account_id}`,
          {
            method: 'GET',
            headers: {
              'X-API-KEY': apiKey,
              'Accept': 'application/json',
            },
          }
        );

        if (!res.ok) {
          throw new Error(`Unipile API returned ${res.status}: ${await res.text()}`);
        }

        const profile = await res.json() as Record<string, unknown>;

        const avatarUrl = (
          profile?.profile_picture_url ||
          profile?.avatar_url ||
          profile?.picture_url ||
          profile?.image_url ||
          null
        ) as string | null;

        if (avatarUrl) {
          const { error: updateError } = await supabase
            .from('unipile_accounts')
            .update({ avatar_url: avatarUrl })
            .eq('id', account.id);

          if (updateError) {
            console.error(`[Backfill Avatars] Failed to update ${account.id}:`, updateError);
            errors.push({ accountId: account.id, error: `DB update: ${updateError.message}` });
            failed++;
          } else {
            console.log(`[Backfill Avatars] Updated avatar for ${account.id}`);
            updated++;
          }
        } else {
          console.log(`[Backfill Avatars] No avatar found in profile for ${account.id}`);
          errors.push({ accountId: account.id, error: 'No avatar URL in profile response' });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Backfill Avatars] Error processing ${account.id}:`, msg);
        errors.push({ accountId: account.id, error: msg });
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: accounts.length,
        updated,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Backfill Avatars] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
