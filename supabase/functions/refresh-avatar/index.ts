/**
 * Refresh Avatar Edge Function
 *
 * Given a contact_id, looks up the LinkedIn identity, fetches a fresh profile
 * from Unipile, and saves the new avatar_url to crm_contacts.
 *
 * POST /refresh-avatar  { contact_id: string }
 * Returns { success, avatar_url }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { contact_id } = await req.json();
    if (!contact_id) {
      return new Response(JSON.stringify({ error: 'contact_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's org
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (!userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    // Get the contact's LinkedIn identity
    const { data: identity } = await supabase
      .from('crm_contact_identities')
      .select('platform_user_id, linked_account_ids')
      .eq('contact_id', contact_id)
      .eq('organization_id', organizationId)
      .eq('channel', 'linkedin')
      .eq('is_primary', true)
      .maybeSingle();

    if (!identity?.platform_user_id) {
      return new Response(JSON.stringify({ success: false, error: 'No LinkedIn identity' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pick the first linked account to use for the API call
    const linkedAccountIds: string[] = identity.linked_account_ids || [];
    const accountInternalId = linkedAccountIds[0];

    if (!accountInternalId) {
      return new Response(JSON.stringify({ success: false, error: 'No linked account' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the Unipile account credentials
    const { data: account } = await supabase
      .from('unipile_accounts')
      .select('unipile_account_id, access_token_encrypted, dsn_url')
      .eq('id', accountInternalId)
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .maybeSingle();

    if (!account) {
      return new Response(JSON.stringify({ success: false, error: 'Account not found or inactive' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get org's Unipile API key
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'unipile')
      .eq('is_valid', true)
      .maybeSingle();

    if (!apiKeyData?.key_encrypted) {
      return new Response(JSON.stringify({ success: false, error: 'No Unipile API key' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const keyMeta = apiKeyData.metadata as Record<string, string> | null;
    const baseUrl = normalizeDsnUrl(keyMeta?.dsn_url || account.dsn_url);

    // Fetch profile from Unipile
    const res = await fetch(
      `${baseUrl}/api/v1/users/${encodeURIComponent(identity.platform_user_id)}?account_id=${account.unipile_account_id}`,
      {
        method: 'GET',
        headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: `Unipile API ${res.status}` }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const profile = await res.json() as Record<string, unknown>;
    const avatarUrl = (
      profile?.profile_picture_url ||
      profile?.avatar_url ||
      profile?.picture_url ||
      profile?.image_url ||
      null
    ) as string | null;

    // Update both crm_contacts and crm_contact_identities
    if (avatarUrl) {
      await supabase
        .from('crm_contacts')
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq('id', contact_id)
        .eq('organization_id', organizationId);

      await supabase
        .from('crm_contact_identities')
        .update({ platform_avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq('contact_id', contact_id)
        .eq('organization_id', organizationId)
        .eq('channel', 'linkedin');
    }

    return new Response(
      JSON.stringify({ success: true, avatar_url: avatarUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
