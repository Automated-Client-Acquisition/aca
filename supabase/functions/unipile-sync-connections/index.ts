import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey, UnipileRelation, UnipilePaginatedResponse, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { buildLeadDmMessage } from '../_shared/lead-magnet-link.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Unipile Sync Connections Edge Function
 *
 * Imports all LinkedIn connections (network) for a connected account.
 * This syncs your entire LinkedIn network into CRM contacts.
 * Uses the official Unipile SDK.
 *
 * Parameters:
 * - account_id: UUID of the unipile_accounts record
 * - limit: Max connections per API call (default: 100, API max usually 100)
 * - max_total: Max total connections to import (default: 5000)
 */
serve(async (req) => {
  // Always handle CORS preflight first
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Wrap entire handler in try-catch to ensure CORS headers are always returned
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const jobId = crypto.randomUUID();
    const startTime = Date.now();

    let contactsImported = 0;
    let contactsSkipped = 0;
    let contactsUpdated = 0;
    let leadsDelivered = 0;
    const errors: string[] = [];
    const body = await req.json();
    const {
      account_id,
      limit = 1000, // Unipile API max is 1000
      max_total = 10000, // High cap — client controls batching via start_cursor
      start_cursor = null, // Support resuming from a specific cursor
    } = body;

    if (!account_id) {
      throw new Error('account_id is required');
    }

    console.log(`[Sync Connections] Starting job ${jobId} for account ${account_id}`);

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ success: false, error: 'Account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, account.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (account.status !== 'active') {
      throw new Error(`Account is not active: ${account.status}`);
    }

    if (account.provider.toLowerCase() !== 'linkedin') {
      throw new Error('This function only works with LinkedIn accounts');
    }

    // Decrypt API key
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);

    console.log(`[Sync Connections] Fetching LinkedIn connections...`);

    let cursor: string | null = start_cursor;
    let totalFetched = 0;

    if (start_cursor) {
      console.log(`[Sync Connections] Resuming from cursor: ${start_cursor}`);
    }

    // Paginate through all connections
    while (totalFetched < max_total) {
      console.log(`[Sync Connections] Fetching page, cursor: ${cursor || 'none'}, fetched so far: ${totalFetched}`);

      let relationsData: UnipilePaginatedResponse<UnipileRelation>;
      try {
        // Build URL with query params
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

        relationsData = await response.json() as UnipilePaginatedResponse<UnipileRelation>;

      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        console.error(`[Sync Connections] API error: ${errorMessage}`);

        // If we get rate limited, wait and retry
        if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate')) {
          console.log('[Sync Connections] Rate limited, waiting 60 seconds...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }

        throw new Error(`Failed to fetch relations: ${errorMessage}`);
      }

      const connections = relationsData.items || relationsData.results || [];

      if (!Array.isArray(connections) || connections.length === 0) {
        console.log('[Sync Connections] No more connections to fetch');
        break;
      }

      console.log(`[Sync Connections] Processing ${connections.length} connections...`);

      // Process each connection
      for (const connection of connections) {
        try {
          const result = await processConnection(
            supabase,
            account.organization_id,
            account_id, // Pass the account ID to link the connection
            connection
          );

          if (result === 'imported') {
            contactsImported++;
          } else if (result === 'updated') {
            contactsUpdated++;
          } else {
            contactsSkipped++;
          }

          // Check for pending leads that were awaiting this connection
          const providerId = (connection.id || connection.provider_id || connection.public_identifier || connection.urn) as string;
          if (providerId) {
            const deliveredForThisConnection = await deliverPendingLeadMagnets(
              supabase,
              account.organization_id,
              providerId
            );
            leadsDelivered += deliveredForThisConnection;
          }

          totalFetched++;

          // Rate limit: small delay between contacts
          if (totalFetched % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

        } catch (connError) {
          const errorMsg = connError instanceof Error ? connError.message : 'Unknown error';
          console.error(`[Sync Connections] Error processing connection:`, errorMsg);
          errors.push(`Connection error: ${errorMsg}`);
          totalFetched++;
        }
      }

      // Check for next page cursor
      cursor = relationsData.cursor || relationsData.next_cursor || null;

      if (!cursor) {
        console.log('[Sync Connections] No more pages');
        break;
      }

      // Add a small delay between pages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Update account to mark connections sync complete
    await supabase
      .from('unipile_accounts')
      .update({
        last_synced_at: new Date().toISOString(),
        metadata: {
          ...account.metadata,
          connections_sync_completed: true,
          connections_sync_at: new Date().toISOString(),
          connections_sync_stats: {
            imported: contactsImported,
            updated: contactsUpdated,
            skipped: contactsSkipped,
            total: totalFetched,
          },
        },
      })
      .eq('id', account_id);

    const duration = Date.now() - startTime;
    console.log(`[Sync Connections] Job ${jobId} completed in ${duration}ms`);
    console.log(`[Sync Connections] Stats: imported=${contactsImported}, updated=${contactsUpdated}, skipped=${contactsSkipped}, total=${totalFetched}, leads_delivered=${leadsDelivered}`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      duration,
      stats: {
        contactsImported,
        contactsUpdated,
        contactsSkipped,
        leadsDelivered,
        totalProcessed: totalFetched,
      },
      next_cursor: cursor, // Return cursor for resumption if there are more
      has_more: cursor !== null,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit error messages
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
 * Process a single connection and create/update contact
 */
async function processConnection(
  supabase: SupabaseClient<any>,
  organizationId: string,
  accountId: string, // The unipile_accounts.id this connection belongs to
  connection: Record<string, unknown>
): Promise<'imported' | 'updated' | 'skipped'> {
  // Extract connection info - Unipile returns various field formats
  const providerId = (connection.id || connection.provider_id || connection.public_identifier || connection.urn) as string;

  if (!providerId) {
    console.log('[Sync Connections] Skipping connection without ID');
    return 'skipped';
  }

  const displayName = (
    connection.name ||
    connection.display_name ||
    connection.full_name ||
    (connection.first_name && connection.last_name
      ? `${connection.first_name} ${connection.last_name}`
      : null) ||
    connection.first_name ||
    'Unknown'
  ) as string;

  const firstName = (connection.first_name || connection.firstName) as string | undefined;
  const lastName = (connection.last_name || connection.lastName) as string | undefined;
  const headline = (connection.headline || connection.title || connection.occupation) as string | undefined;
  const company = (
    connection.company ||
    connection.company_name ||
    (connection.current_company as Record<string, unknown>)?.name
  ) as string | undefined;
  const avatarUrl = (
    connection.avatar_url ||
    connection.profile_picture_url ||
    connection.picture_url ||
    connection.image_url
  ) as string | undefined;
  const profileUrl = (
    connection.profile_url ||
    connection.public_profile_url ||
    connection.linkedin_url ||
    (connection.public_identifier ? `https://www.linkedin.com/in/${connection.public_identifier}` : null)
  ) as string | undefined;
  const email = (connection.email || connection.primary_email) as string | undefined;

  // Connection date - when they connected with you
  // Unipile may return timestamps in milliseconds (Unix epoch ms) or ISO strings
  const rawConnectedAt = (
    connection.connected_at ||
    connection.connection_date ||
    connection.created_at
  );

  let connectedAt: string | undefined;
  if (rawConnectedAt) {
    // Check if it's a Unix timestamp in milliseconds (large number)
    if (typeof rawConnectedAt === 'number' || (typeof rawConnectedAt === 'string' && /^\d{10,13}$/.test(rawConnectedAt))) {
      const timestamp = typeof rawConnectedAt === 'number' ? rawConnectedAt : parseInt(rawConnectedAt, 10);
      // If it's in seconds (10 digits), convert to ms; if already ms (13 digits), use as-is
      const msTimestamp = timestamp > 9999999999 ? timestamp : timestamp * 1000;
      connectedAt = new Date(msTimestamp).toISOString();
    } else if (typeof rawConnectedAt === 'string') {
      // Already an ISO string or other date format
      connectedAt = rawConnectedAt;
    }
  }

  // Check if contact already exists by LinkedIn identity
  const { data: existingIdentity } = await supabase
    .from('crm_contact_identities')
    .select('contact_id, linked_account_ids')
    .eq('organization_id', organizationId)
    .eq('channel', 'linkedin')
    .eq('platform_user_id', providerId)
    .single();

  if (existingIdentity) {
    // Update existing contact with latest info
    // Also update first_seen_at if we have a valid connection date from LinkedIn
    const updateData: Record<string, unknown> = {
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      job_title: headline,
      company: company,
      avatar_url: avatarUrl,
      primary_linkedin_url: profileUrl,
      is_linkedin_connection: true, // Ensure this is set
      updated_at: new Date().toISOString(),
    };

    // Update linkedin_connected_at if we have the actual LinkedIn connection date
    // NOTE: Do NOT overwrite first_seen_at — that tracks when WE first saw the contact,
    // not when they connected on LinkedIn. Overwriting it would push contacts down in
    // the default sort order (first_seen_at desc), hiding recently synced updates.
    if (connectedAt) {
      updateData.linkedin_connected_at = connectedAt;
    }

    const { error: updateError } = await supabase
      .from('crm_contacts')
      .update(updateData)
      .eq('id', existingIdentity.contact_id);

    if (updateError) {
      throw new Error(`Failed to update contact: ${updateError.message}`);
    }

    // Update identity to add this account to linked_account_ids if not already present
    const existingAccountIds: string[] = Array.isArray(existingIdentity.linked_account_ids)
      ? existingIdentity.linked_account_ids
      : [];
    if (!existingAccountIds.includes(accountId)) {
      const { error: identityError } = await supabase
        .from('crm_contact_identities')
        .update({
          linked_account_ids: [...existingAccountIds, accountId],
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId)
        .eq('channel', 'linkedin')
        .eq('platform_user_id', providerId);

      if (identityError) {
        console.error(`[Sync Connections] Failed to update identity linked_account_ids: ${identityError.message}`);
      }
    }

    return 'updated';
  }

  // Create new contact
  const { data: newContact, error: contactError } = await supabase
    .from('crm_contacts')
    .insert({
      organization_id: organizationId,
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      job_title: headline,
      company: company,
      avatar_url: avatarUrl,
      primary_email: email,
      primary_linkedin_url: profileUrl,
      source: 'linkedin_connection',
      status: 'active',
      is_linkedin_connection: true, // Mark as LinkedIn connection
      linkedin_connected_at: connectedAt || new Date().toISOString(),
      first_seen_at: new Date().toISOString(), // When WE first saw them (import time), not LinkedIn connection date
      last_activity_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (contactError || !newContact) {
    throw new Error(`Failed to create contact: ${contactError?.message}`);
  }

  // Create LinkedIn identity with linked_account_ids
  await supabase.from('crm_contact_identities').insert({
    organization_id: organizationId,
    contact_id: newContact.id,
    channel: 'linkedin',
    platform_user_id: providerId,
    platform_username: displayName,
    platform_profile_url: profileUrl,
    platform_avatar_url: avatarUrl,
    is_primary: true,
    linked_account_ids: [accountId], // Track which LinkedIn account this connection belongs to
  });

  // Log activity
  await supabase.from('crm_activities').insert({
    organization_id: organizationId,
    contact_id: newContact.id,
    activity_type: 'contact_created',
    title: 'Contact imported from LinkedIn',
    description: `LinkedIn connection synced: ${displayName}`,
    metadata: {
      channel: 'linkedin',
      platformUserId: providerId,
      imported: true,
      connectedAt,
    },
    performed_by_type: 'system',
  });

  return 'imported';
}

/**
 * Check for and deliver pending lead magnets when a connection is synced
 */
async function deliverPendingLeadMagnets(
  supabase: SupabaseClient<any>,
  organizationId: string,
  connectionUserId: string
): Promise<number> {
  try {
    // Find pending leads awaiting connection from this user
    const { data: pendingLeads, error } = await supabase
      .from('unipile_leads')
      .select(`
        *,
        campaign:unipile_campaigns(
          *,
          account:unipile_accounts(*)
        )
      `)
      .eq('organization_id', organizationId)
      .eq('commenter_id', connectionUserId)
      .eq('status', 'awaiting_connection');

    if (error || !pendingLeads || pendingLeads.length === 0) {
      return 0;
    }

    console.log(`[Sync Connections] Found ${pendingLeads.length} pending leads for new connection ${connectionUserId}`);

    let delivered = 0;

    for (const lead of pendingLeads) {
      const campaign = lead.campaign;
      if (!campaign) continue;
      if (!campaign.auto_send_on_connection) continue;
      if (!campaign.is_active) continue;

      const account = campaign.account;
      if (!account || account.status !== 'active') continue;

      try {
        // Queue DM for delivery
        const dmDelaySeconds = campaign.dm_delay_seconds || 10;
        const scheduledFor = new Date(Date.now() + dmDelaySeconds * 1000).toISOString();

        const dmMessage = buildLeadDmMessage({
          template: campaign.dm_template,
          commenterName: lead.commenter_name || '',
          matchedKeyword: lead.matched_keyword || '',
          leadId: lead.id,
          leadMagnetUrl: campaign.lead_magnet_url,
          supabaseUrl: Deno.env.get('SUPABASE_URL')!,
        });

        await supabase
          .from('unipile_message_queue')
          .insert({
            campaign_id: campaign.id,
            lead_id: lead.id,
            account_id: account.id,
            organization_id: organizationId,
            recipient_platform_id: connectionUserId,
            recipient_name: lead.commenter_name,
            message_text: dmMessage,
            scheduled_for: scheduledFor,
            status: 'pending',
          });

        // Update lead status
        await supabase
          .from('unipile_leads')
          .update({
            status: 'pending',
            is_connected: true,
            connection_detected_at: new Date().toISOString(),
            connection_source: 'sync',
          })
          .eq('id', lead.id);

        delivered++;
        console.log(`[Sync Connections] Queued DM for lead ${lead.id}`);

        // Notify webhook if configured
        if (campaign.webhook_url) {
          try {
            await fetch(campaign.webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'connection_detected',
                lead_id: lead.id,
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                commenter_id: connectionUserId,
                commenter_name: lead.commenter_name,
                matched_keyword: lead.matched_keyword,
                detection_source: 'sync',
                dm_scheduled_for: scheduledFor,
                timestamp: new Date().toISOString(),
              }),
            });
          } catch (webhookError) {
            console.error(`[Sync Connections] Webhook failed:`, webhookError);
          }
        }
      } catch (leadError) {
        console.error(`[Sync Connections] Error processing lead ${lead.id}:`, leadError);
      }
    }

    return delivered;
  } catch (error) {
    console.error(`[Sync Connections] Error delivering pending lead magnets:`, error);
    return 0;
  }
}
