import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UnipileConnection {
  id: string;
  account_id?: string;
  provider_id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  headline?: string;
  occupation?: string;
  company?: string;
  location?: string;
  profile_picture_url?: string;
  avatar_url?: string;
  public_profile_url?: string;
  profile_url?: string;
  connected_at?: string;
  created_at?: string;
}

/**
 * Check if a LinkedIn profile picture URL is expired or about to expire
 * LinkedIn URLs have an 'e' parameter with unix timestamp for expiry
 */
function isAvatarUrlExpired(url: string | null | undefined): boolean {
  if (!url) return true;

  try {
    const urlObj = new URL(url);
    const expiryParam = urlObj.searchParams.get('e');
    if (!expiryParam) return false; // No expiry param, assume valid

    const expiryTimestamp = parseInt(expiryParam, 10);
    if (isNaN(expiryTimestamp)) return false;

    // Add 1 day buffer - refresh if expiring within 24 hours
    const now = Math.floor(Date.now() / 1000);
    const oneDayInSeconds = 86400;

    return expiryTimestamp < (now + oneDayInSeconds);
  } catch {
    return true; // Invalid URL, consider expired
  }
}

/**
 * Fetch fresh profile data from Unipile to get current avatar URL
 */
async function fetchFreshProfilePicture(
  linkedinId: string,
  accountId: string,
  dsnUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const url = `${dsnUrl}/api/v1/users/${encodeURIComponent(linkedinId)}?account_id=${encodeURIComponent(accountId)}&linkedin_sections=*_preview`;

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.log(`[Sync Connections] Failed to fetch fresh profile for ${linkedinId}: ${response.status}`);
      return null;
    }

    const profile = await response.json();
    return profile?.profile_picture_url || null;
  } catch (error) {
    console.log(`[Sync Connections] Error fetching fresh profile for ${linkedinId}:`, error);
    return null;
  }
}

interface SyncResult {
  success: boolean;
  accountId: string;
  connectionsSynced: number;
  connectionsTotal: number;
  error?: string;
}

/**
 * LinkedIn Sync Connections Edge Function
 *
 * Syncs LinkedIn connections from Unipile API to local database.
 * Called from the My Network page to refresh connection data.
 *
 * Supports:
 * - Single account sync: POST { accountId: "uuid" }
 * - All accounts sync: POST {} (syncs all active LinkedIn accounts for the org)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { accountId, organizationId: bodyOrgId, cron } = body;

    let organizationId: string | null = bodyOrgId || null;

    // Cron job: syncs every org, so only the pg_cron job's service-role key may
    // ask for it (the anon key is public).
    if (cron === true) {
      if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
      console.log('[Sync Connections] Running as cron job - syncing all organizations');
      // Get all organizations with active LinkedIn accounts
      const { data: orgsWithAccounts, error: orgsError } = await supabase
        .from('unipile_accounts')
        .select('organization_id')
        .eq('provider', 'LINKEDIN')
        .eq('status', 'active');

      if (orgsError || !orgsWithAccounts || orgsWithAccounts.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No active LinkedIn accounts to sync',
          results: [],
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get unique organization IDs
      const uniqueOrgIds = [...new Set(orgsWithAccounts.map(a => a.organization_id))];
      console.log(`[Sync Connections] Found ${uniqueOrgIds.length} organizations with active LinkedIn accounts`);

      // Sync each organization
      const allResults: SyncResult[] = [];
      for (const orgId of uniqueOrgIds) {
        const orgResults = await syncOrganizationConnections(supabase, orgId, null);
        allResults.push(...orgResults);
      }

      const totalSynced = allResults.reduce((sum, r) => sum + r.connectionsSynced, 0);
      const successCount = allResults.filter(r => r.success).length;

      return new Response(JSON.stringify({
        success: successCount > 0,
        message: `Synced ${totalSynced} connections from ${successCount}/${allResults.length} accounts across ${uniqueOrgIds.length} organizations`,
        results: allResults,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Regular authenticated request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user from auth header
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's organization
    const { data: membership, error: memberError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return new Response(JSON.stringify({ error: 'User not in organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    organizationId = membership.organization_id;

    // Sync connections for this organization
    const results = await syncOrganizationConnections(supabase, organizationId, accountId);

    const totalSynced = results.reduce((sum, r) => sum + r.connectionsSynced, 0);
    const successCount = results.filter(r => r.success).length;

    return new Response(JSON.stringify({
      success: successCount > 0,
      message: `Synced ${totalSynced} connections from ${successCount}/${results.length} accounts`,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Sync Connections] Fatal error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Decrypt API key using AES-256-GCM
 */
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Sync LinkedIn connections for an organization
 */
async function syncOrganizationConnections(
  supabase: SupabaseClient<any>,
  organizationId: string,
  specificAccountId: string | null
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

  // Get LinkedIn accounts for this organization
  let query = supabase
    .from('unipile_accounts')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('provider', 'LINKEDIN')
    .eq('status', 'active');

  if (specificAccountId) {
    query = query.eq('id', specificAccountId);
  }

  const { data: accounts, error: accountsError } = await query;

  if (accountsError || !accounts || accounts.length === 0) {
    console.log(`[Sync Connections] No active LinkedIn accounts for org ${organizationId}`);
    return results;
  }

  console.log(`[Sync Connections] Found ${accounts.length} accounts for org ${organizationId}`);

  for (const account of accounts) {
    const result: SyncResult = {
      success: false,
      accountId: account.id,
      connectionsSynced: 0,
      connectionsTotal: 0,
    };

    try {
      const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
      const dsnUrl = normalizeDsnUrl(account.dsn_url);

      // Fetch connections from Unipile
      let cursor: string | null = null;
      let totalFetched = 0;
      const maxTotal = 500; // Reasonable limit per sync
      const limit = 100;

      while (totalFetched < maxTotal) {
        const url = new URL(`${dsnUrl}/api/v1/users/relations`);
        url.searchParams.set('account_id', account.unipile_account_id);
        url.searchParams.set('limit', String(limit));
        if (cursor) {
          url.searchParams.set('cursor', cursor);
        }

        const response = await fetch(url.toString(), {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Unipile API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const connections = data.items || data.results || [];

        if (!Array.isArray(connections) || connections.length === 0) {
          break;
        }

        // Process each connection
        for (const connection of connections) {
          try {
            await processAndSyncConnection(supabase, organizationId, account.id, connection);
            result.connectionsSynced++;
          } catch (connError) {
            console.error(`[Sync Connections] Error processing connection:`, connError);
          }
          totalFetched++;
          result.connectionsTotal++;
        }

        cursor = data.cursor || data.next_cursor || null;
        if (!cursor) break;

        // Small delay between pages
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Update account sync timestamp
      await supabase
        .from('unipile_accounts')
        .update({
          last_synced_at: new Date().toISOString(),
          metadata: {
            ...account.metadata,
            connections_sync_at: new Date().toISOString(),
          },
        })
        .eq('id', account.id);

      result.success = true;
      console.log(`[Sync Connections] Account ${account.id}: synced ${result.connectionsSynced}/${result.connectionsTotal}`);
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Sync Connections] Account ${account.id} failed:`, result.error);
    }

    results.push(result);
  }

  return results;
}

/**
 * Process a single connection and sync to CRM
 */
async function processAndSyncConnection(
  supabase: SupabaseClient<any>,
  organizationId: string,
  accountId: string,
  connection: UnipileConnection
): Promise<void> {
  const providerId = connection.id || connection.provider_id;
  if (!providerId) return;

  const displayName = connection.name ||
    (connection.first_name && connection.last_name
      ? `${connection.first_name} ${connection.last_name}`
      : connection.first_name || 'Unknown');

  const avatarUrl = connection.profile_picture_url || connection.avatar_url;
  const profileUrl = connection.public_profile_url || connection.profile_url;

  // Parse connected_at timestamp
  let connectedAt: string | undefined;
  const rawConnectedAt = connection.connected_at || connection.created_at;
  if (rawConnectedAt) {
    if (typeof rawConnectedAt === 'string' && /^\d{10,13}$/.test(rawConnectedAt)) {
      const timestamp = parseInt(rawConnectedAt, 10);
      const msTimestamp = timestamp > 9999999999 ? timestamp : timestamp * 1000;
      connectedAt = new Date(msTimestamp).toISOString();
    } else {
      connectedAt = rawConnectedAt;
    }
  }

  // Check if contact already exists
  const { data: existingIdentity } = await supabase
    .from('crm_contact_identities')
    .select('contact_id, linked_account_ids')
    .eq('organization_id', organizationId)
    .eq('channel', 'linkedin')
    .eq('platform_user_id', providerId)
    .single();

  if (existingIdentity) {
    // Update existing contact
    const updateData: Record<string, unknown> = {
      display_name: displayName,
      first_name: connection.first_name,
      last_name: connection.last_name,
      job_title: connection.headline || connection.occupation,
      company: connection.company,
      avatar_url: avatarUrl,
      primary_linkedin_url: profileUrl,
      is_linkedin_connection: true,
      updated_at: new Date().toISOString(),
    };

    if (connectedAt) {
      updateData.linkedin_connected_at = connectedAt;
    }

    await supabase
      .from('crm_contacts')
      .update(updateData)
      .eq('id', existingIdentity.contact_id);

    // Update linked_account_ids if needed
    const existingAccountIds: string[] = Array.isArray(existingIdentity.linked_account_ids)
      ? existingIdentity.linked_account_ids
      : [];
    if (!existingAccountIds.includes(accountId)) {
      await supabase
        .from('crm_contact_identities')
        .update({
          linked_account_ids: [...existingAccountIds, accountId],
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId)
        .eq('channel', 'linkedin')
        .eq('platform_user_id', providerId);
    }
  } else {
    // Create new contact
    const { data: newContact, error: contactError } = await supabase
      .from('crm_contacts')
      .insert({
        organization_id: organizationId,
        display_name: displayName,
        first_name: connection.first_name,
        last_name: connection.last_name,
        job_title: connection.headline || connection.occupation,
        company: connection.company,
        avatar_url: avatarUrl,
        primary_linkedin_url: profileUrl,
        source: 'linkedin_connection',
        status: 'active',
        is_linkedin_connection: true,
        linkedin_connected_at: connectedAt || new Date().toISOString(),
        first_seen_at: connectedAt || new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (contactError || !newContact) {
      throw new Error(`Failed to create contact: ${contactError?.message}`);
    }

    // Create LinkedIn identity
    await supabase.from('crm_contact_identities').insert({
      organization_id: organizationId,
      contact_id: newContact.id,
      channel: 'linkedin',
      platform_user_id: providerId,
      platform_username: displayName,
      platform_profile_url: profileUrl,
      platform_avatar_url: avatarUrl,
      is_primary: true,
      linked_account_ids: [accountId],
    });
  }
}
