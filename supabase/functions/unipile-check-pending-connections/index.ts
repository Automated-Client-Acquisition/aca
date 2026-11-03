import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { buildLeadDmMessage } from '../_shared/lead-magnet-link.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReceivedInvitation {
  id: string;
  inviter?: {
    inviter_name: string;
    inviter_id: string;
    inviter_public_identifier: string;
    inviter_description: string | null;
  };
  specifics?: {
    provider: string;
    shared_secret: string;
  };
  date?: string;
  invitation_text?: string | null;
}

/**
 * Check Pending Connections
 *
 * Cron job that runs every 15 minutes to:
 * 1. Get all leads with status='awaiting_connection'
 * 2. For campaigns with auto_accept_connections enabled:
 *    - Fetch received invitations from Unipile
 *    - Auto-accept invitations from leads awaiting connection
 * 3. Check if leads are now in our connections (via crm_contact_identities)
 * 4. If connected, queue the lead magnet DM
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const jobId = crypto.randomUUID();
  const startTime = Date.now();
  let leadsChecked = 0;
  let connectionsFound = 0;
  let connectionsAccepted = 0;
  let dmsQueued = 0;
  const errors: string[] = [];

  try {
    console.log(`[Check Pending Connections] Starting job ${jobId}`);

    // Log job start immediately so we have visibility even if the function times out
    await supabase.from('unipile_job_logs').insert({
      job_type: 'check_pending_connections',
      status: 'started',
      items_processed: 0,
      items_created: 0,
      items_failed: 0,
      duration_ms: 0,
    });

    // Get all leads awaiting connection, with campaign info
    const { data: pendingLeads, error: leadsError } = await supabase
      .from('unipile_leads')
      .select(`
        *,
        campaign:unipile_campaigns(
          *,
          account:unipile_accounts(*)
        )
      `)
      .eq('status', 'awaiting_connection')
      .order('created_at', { ascending: true })
      .limit(100);

    if (leadsError) {
      throw new Error(`Failed to fetch pending leads: ${leadsError.message}`);
    }

    if (!pendingLeads || pendingLeads.length === 0) {
      console.log('[Check Pending Connections] No pending leads');
      await logJob(supabase, jobId, 'completed', startTime, { message: 'No pending leads' });
      return new Response(JSON.stringify({ success: true, message: 'No pending leads' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Check Pending Connections] Found ${pendingLeads.length} pending leads`);

    // Group leads by organization for efficient processing
    const leadsByOrg: Map<string, typeof pendingLeads> = new Map();
    for (const lead of pendingLeads) {
      const orgId = lead.campaign?.organization_id;
      if (orgId) {
        const orgLeads = leadsByOrg.get(orgId) || [];
        orgLeads.push(lead);
        leadsByOrg.set(orgId, orgLeads);
      }
    }

    // =========================================================================
    // Phase 1: Auto-accept incoming connection requests from awaiting leads
    // =========================================================================

    // Group leads by account for invitation fetching
    const leadsByAccount: Map<string, typeof pendingLeads> = new Map();
    for (const lead of pendingLeads) {
      const account = lead.campaign?.account;
      if (account && account.status === 'active' && lead.campaign?.auto_accept_connections !== false) {
        const accountId = account.unipile_account_id;
        const accountLeads = leadsByAccount.get(accountId) || [];
        accountLeads.push(lead);
        leadsByAccount.set(accountId, accountLeads);
      }
    }

    for (const [unipileAccountId, accountLeads] of leadsByAccount) {
      try {
        // Get account credentials (use the first lead's campaign account)
        const account = accountLeads[0].campaign.account;
        const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
        const unipileApiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
        const unipileDsn = normalizeDsnUrl(account.dsn_url);

        // Build lookup sets for matching invitations to leads.
        // LinkedIn uses two ID formats: URN (ACoAA...) from comment API and numeric from invitation API.
        // We match on both commenter_id AND commenter_public_identifier to bridge this gap.
        const awaitingCommenterIds = new Set(accountLeads.map(l => l.commenter_id));
        const awaitingByPublicId = new Map<string, typeof accountLeads[0][]>();
        for (const lead of accountLeads) {
          if (lead.commenter_public_identifier) {
            const existing = awaitingByPublicId.get(lead.commenter_public_identifier) || [];
            existing.push(lead);
            awaitingByPublicId.set(lead.commenter_public_identifier, existing);
          }
        }

        // Fetch received invitations from Unipile
        console.log(`[Check Pending Connections] Fetching received invitations for account ${unipileAccountId}`);

        let invitations: ReceivedInvitation[] = [];
        try {
          const invUrl = `${unipileDsn}/api/v1/users/invite/received?account_id=${encodeURIComponent(unipileAccountId)}&limit=100`;
          const invResp = await fetch(invUrl, {
            headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
          });
          if (!invResp.ok) {
            const errBody = await invResp.text();
            throw new Error(`HTTP ${invResp.status}: ${errBody}`);
          }
          const invitationsResponse = await invResp.json() as { items?: ReceivedInvitation[] };

          invitations = invitationsResponse.items || [];
          console.log(`[Check Pending Connections] Found ${invitations.length} received invitations`);
        } catch (invErr) {
          console.error(`[Check Pending Connections] Failed to fetch invitations:`, invErr);
          errors.push(`Account ${unipileAccountId}: Failed to fetch invitations — ${invErr instanceof Error ? invErr.message : String(invErr)}`);
          continue;
        }

        // Match invitations against awaiting leads.
        // Match by inviter_id (numeric) OR inviter_public_identifier (slug) to handle both ID formats.
        for (const invitation of invitations) {
          const inviterId = invitation.inviter?.inviter_id;
          const inviterPublicId = invitation.inviter?.inviter_public_identifier;
          const matchesById = inviterId && awaitingCommenterIds.has(inviterId);
          const matchesByPublicId = inviterPublicId && awaitingByPublicId.has(inviterPublicId);
          if (!matchesById && !matchesByPublicId) {
            continue;
          }

          console.log(`[Check Pending Connections] Found matching invitation from ${invitation.inviter?.inviter_name} (${inviterId})`);

          // Accept the invitation
          try {
            const sharedSecret = invitation.specifics?.shared_secret;
            if (!sharedSecret) {
              console.warn(`[Check Pending Connections] No shared_secret for invitation ${invitation.id}, skipping`);
              continue;
            }

            const acceptUrl = `${unipileDsn}/api/v1/users/invite/received/${encodeURIComponent(invitation.id)}`;
            const acceptResp = await fetch(acceptUrl, {
              method: 'POST',
              headers: {
                'X-API-KEY': unipileApiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                provider: 'LINKEDIN',
                shared_secret: sharedSecret,
                account_id: unipileAccountId,
                action: 'accept',
              }),
            });
            if (!acceptResp.ok) {
              const errBody = await acceptResp.text();
              throw new Error(`HTTP ${acceptResp.status}: ${errBody}`);
            }

            connectionsAccepted++;
            console.log(`[Check Pending Connections] Accepted connection from ${invitation.inviter?.inviter_name}`);

            // Find all matching leads for this inviter and queue DM for the first eligible one.
            // Multiple leads can exist for the same commenter (commented on different posts),
            // but we should only send one DM per person per acceptance event.
            // Match by commenter_id (numeric) OR commenter_public_identifier (slug) to bridge ID format differences.
            const matchingLeads = accountLeads.filter(l =>
              (inviterId && l.commenter_id === inviterId) ||
              (inviterPublicId && l.commenter_public_identifier === inviterPublicId)
            );
            let dmQueuedForInviter = false;
            for (const lead of matchingLeads) {
              const campaign = lead.campaign;
              if (!campaign || !campaign.is_active || !campaign.auto_send_on_connection) {
                continue;
              }

              if (dmQueuedForInviter) {
                // Already queued a DM for this person — just update remaining leads' connection status
                await supabase
                  .from('unipile_leads')
                  .update({
                    is_connected: true,
                    connection_detected_at: new Date().toISOString(),
                    connection_source: 'auto_accept',
                  })
                  .eq('id', lead.id);
                (lead as Record<string, unknown>)._processed = true;
                continue;
              }

              const queueResult = await queueDmAndUpdateLead(
                supabase, lead, campaign, 'auto_accept'
              );

              if (queueResult.success) {
                dmsQueued++;
                connectionsFound++;
                dmQueuedForInviter = true;
              } else if (queueResult.error) {
                errors.push(`Lead ${lead.id}: ${queueResult.error}`);
              }
            }
          } catch (acceptErr) {
            const parsed = parseUnipileError(acceptErr);
            console.error(`[Check Pending Connections] Failed to accept invitation ${invitation.id}:`, parsed.message);
            errors.push(`Invitation ${invitation.id}: ${parsed.message}`);
          }
        }
      } catch (accountErr) {
        console.error(`[Check Pending Connections] Error processing account ${unipileAccountId}:`, accountErr);
        errors.push(`Account ${unipileAccountId}: ${accountErr instanceof Error ? accountErr.message : 'Unknown error'}`);
      }
    }

    // =========================================================================
    // Phase 2: Check existing connections (original logic, catches webhook misses)
    // =========================================================================

    for (const [orgId, orgLeads] of leadsByOrg) {
      const commenterIds = [...new Set(orgLeads.map(l => l.commenter_id))];

      // Batch check which ones are now connected
      const { data: connectedIdentities, error: identitiesError } = await supabase
        .from('crm_contact_identities')
        .select('platform_user_id')
        .eq('organization_id', orgId)
        .eq('channel', 'linkedin')
        .in('platform_user_id', commenterIds);

      if (identitiesError) {
        console.error(`[Check Pending Connections] Failed to check connections for org ${orgId}:`, identitiesError);
        errors.push(`Org ${orgId}: ${identitiesError.message}`);
        continue;
      }

      const connectedSet = new Set(
        (connectedIdentities || []).map(i => i.platform_user_id)
      );

      for (const lead of orgLeads) {
        leadsChecked++;

        // Skip leads already handled in Phase 1
        if (lead._processed) continue;

        let isConnected = connectedSet.has(lead.commenter_id);

        // Fallback: live Unipile API check if DB doesn't have the connection
        // The DB only has connections that were synced; this catches connections
        // that exist on LinkedIn but haven't been synced yet.
        if (!isConnected && lead.commenter_id) {
          try {
            const campaign = lead.campaign;
            const account = campaign?.account;
            if (account && account.status === 'active') {
              const encKey = Deno.env.get('ENCRYPTION_KEY')!;
              const apiKey = await decryptApiKey(account.access_token_encrypted, encKey);
              const dsnUrl = normalizeDsnUrl(account.dsn_url);

              const profileUrl = `${dsnUrl}/api/v1/users/${encodeURIComponent(lead.commenter_id)}?account_id=${account.unipile_account_id}&notify=false`;
              const profileResp = await fetch(profileUrl, {
                headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
              });
              if (profileResp.ok) {
                const profileData = await profileResp.json();
                if (profileData.network_distance === 'FIRST_DEGREE') {
                  isConnected = true;
                  console.log(`[Check Pending Connections] Unipile API confirmed FIRST_DEGREE for ${lead.commenter_name}`);
                }
              }
            }
          } catch (apiErr) {
            // Non-fatal — just means we can't verify via API this time
            console.warn(`[Check Pending Connections] Profile API check failed for ${lead.commenter_id}:`, apiErr);
          }
        }

        if (isConnected) {
          connectionsFound++;
          console.log(`[Check Pending Connections] Connection found for lead ${lead.id}`);

          const campaign = lead.campaign;
          if (!campaign || !campaign.is_active || !campaign.auto_send_on_connection) {
            continue;
          }

          const account = campaign.account;
          if (!account || account.status !== 'active') {
            // Account inactive — still record the connection so the lead isn't stuck forever
            await supabase
              .from('unipile_leads')
              .update({
                is_connected: true,
                connection_detected_at: new Date().toISOString(),
                connection_source: 'poll',
                dm_error: `Account ${account?.id || 'unknown'} is ${account?.status || 'missing'}, cannot send DM`,
              })
              .eq('id', lead.id);
            continue;
          }

          const queueResult = await queueDmAndUpdateLead(
            supabase, lead, campaign, 'poll'
          );

          if (queueResult.success) {
            dmsQueued++;
          } else if (queueResult.error) {
            errors.push(`Lead ${lead.id}: ${queueResult.error}`);
          }
        }
      }
    }

    // Log job completion
    await logJob(supabase, jobId, 'completed', startTime, {
      leadsChecked,
      connectionsFound,
      connectionsAccepted,
      dmsQueued,
      errors: errors.length > 0 ? errors : undefined,
    });

    console.log(`[Check Pending Connections] Job ${jobId} completed: checked ${leadsChecked}, found ${connectionsFound}, accepted ${connectionsAccepted}, queued ${dmsQueued}`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      leadsChecked,
      connectionsFound,
      connectionsAccepted,
      dmsQueued,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Check Pending Connections] Fatal error:', error);

    await logJob(supabase, jobId, 'failed', startTime, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

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
 * Queue DM for a lead and update its status to connected
 */
async function queueDmAndUpdateLead(
  supabase: SupabaseClient,
  lead: Record<string, unknown>,
  campaign: Record<string, unknown>,
  connectionSource: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const account = campaign.account as Record<string, unknown>;

    const dmDelaySeconds = (campaign.dm_delay_seconds as number) || 10;
    const scheduledFor = new Date(Date.now() + dmDelaySeconds * 1000).toISOString();

    const dmMessage = buildLeadDmMessage({
      template: campaign.dm_template as string,
      commenterName: (lead.commenter_name as string) || '',
      matchedKeyword: (lead.matched_keyword as string) || '',
      leadId: lead.id as string,
      leadMagnetUrl: (campaign.lead_magnet_url as string) || null,
      supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    });

    if (!dmMessage.trim()) {
      return { success: false, error: 'Empty DM message (no template or lead magnet URL configured)' };
    }

    const { error: queueError } = await supabase
      .from('unipile_message_queue')
      .insert({
        campaign_id: campaign.id,
        lead_id: lead.id,
        account_id: account.id,
        organization_id: campaign.organization_id,
        recipient_platform_id: lead.commenter_id,
        recipient_name: lead.commenter_name,
        message_text: dmMessage,
        scheduled_for: scheduledFor,
        status: 'pending',
      });

    if (queueError) {
      console.error(`[Check Pending Connections] Failed to queue DM for lead ${lead.id}:`, queueError);
      return { success: false, error: queueError.message };
    }

    // Update lead status
    await supabase
      .from('unipile_leads')
      .update({
        status: 'pending',
        is_connected: true,
        connection_detected_at: new Date().toISOString(),
        connection_source: connectionSource,
      })
      .eq('id', lead.id);

    // Mark as processed so Phase 2 skips it
    (lead as Record<string, unknown>)._processed = true;

    console.log(`[Check Pending Connections] Queued DM for lead ${lead.id} (source: ${connectionSource})`);

    // Notify webhook if configured
    if (campaign.webhook_url) {
      try {
        await fetch(campaign.webhook_url as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'connection_detected',
            lead_id: lead.id,
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            commenter_id: lead.commenter_id,
            commenter_name: lead.commenter_name,
            matched_keyword: lead.matched_keyword,
            detection_source: connectionSource,
            dm_scheduled_for: scheduledFor,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (webhookError) {
        console.error(`[Check Pending Connections] Webhook failed:`, webhookError);
      }
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMsg };
  }
}

/**
 * Log job execution to unipile_job_logs
 */
async function logJob(
  supabase: SupabaseClient,
  _jobId: string,
  status: string,
  startTime: number,
  result: Record<string, unknown>
) {
  const duration = Date.now() - startTime;

  await supabase.from('unipile_job_logs').insert({
    job_type: 'check_pending_connections',
    status,
    items_processed: (result.leadsChecked as number) || 0,
    items_created: (result.connectionsConfirmed as number) || 0,
    items_failed: 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors } : null,
    duration_ms: duration,
  });
}
