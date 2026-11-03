/**
 * Campaign Connection Checker Edge Function
 *
 * Checks for connection acceptances and advances leads in campaigns.
 * Runs every 15 minutes via cron job.
 *
 * Flow:
 * 1. Find leads waiting for connection acceptance
 * 2. Group by sender account for batching
 * 3. Check connection status via Unipile
 * 4. For accepted connections: advance to next node
 * 5. For timed-out connections: handle withdrawal/move to not_accepted branch
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

import {
  WorkflowNode,
  WorkflowEdge,
  findNodeById,
  getNextNode,
  getAutoWithdrawSettings,
} from '../_shared/workflow-utils.ts';
import { normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { isUnipileApiError, UnipileV2Client } from '../_shared/unipile/index.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { cancelRelationRequest, getProfile, listPendingSentRequests } from '../_shared/unipile/linkedin-v2.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Types
// ============================================================================

interface WaitingLead {
  id: string;
  campaign_id: string;
  contact_id: string;
  sender_account_id: string;
  status: string;
  current_node_id: string | null;
  connection_sent_at: string;
  connection_accepted_at: string | null;
  variation_index: number;
}

interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  sequence_nodes: WorkflowNode[];
  sequence_edges: WorkflowEdge[];
}

interface UnipileAccount {
  id: string;
  unipile_account_id: string;
  access_token_encrypted: string;
  dsn_url: string | null;
  status: string;
}

interface ContactIdentity {
  contact_id: string;
  platform_user_id: string;
}

interface UnipileInvitation {
  id: string;
  // Unipile API returns these fields for invitations
  invited_user_id: string | null;
  invited_user_public_id: string | null;
  invited_user: string | null;
  // Legacy fields (may still be used in some responses)
  provider_id?: string;
  profile?: {
    id: string;
    name?: string;
  };
}

interface CheckResult {
  leadId: string;
  contactId: string;
  action: 'accepted' | 'timeout' | 'withdrawn' | 'still_pending' | 'error' | 'complete_orphaned';
  success: boolean;
  error?: string;
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const jobId = crypto.randomUUID();
  const startTime = Date.now();
  const results: CheckResult[] = [];
  const errors: string[] = [];

  try {
    console.log(`[Connection Checker] Starting job ${jobId}`);

    // 1. Get leads waiting for connection acceptance
    const { data: waitingLeads, error: leadsError } = await supabase
      .from('campaign_lead_progress')
      .select(`
        *,
        campaign:linkedin_campaigns(id, organization_id, name, sequence_nodes, sequence_edges)
      `)
      .not('connection_sent_at', 'is', null)
      .is('connection_accepted_at', null)
      .eq('status', 'waiting')
      .order('connection_sent_at', { ascending: true })
      .limit(100);

    if (leadsError) {
      throw new Error(`Failed to fetch waiting leads: ${leadsError.message}`);
    }

    if (!waitingLeads || waitingLeads.length === 0) {
      console.log('[Connection Checker] No leads waiting for connection acceptance');
      await logJob(supabase, jobId, 'completed', startTime, { message: 'No waiting leads' });
      return new Response(JSON.stringify({ success: true, message: 'No waiting leads' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Connection Checker] Found ${waitingLeads.length} leads waiting for connection`);

    // 2. Group leads by sender account
    const leadsByAccount = new Map<string, (WaitingLead & { campaign: Campaign })[]>();

    for (const lead of waitingLeads) {
      if (!lead.sender_account_id) continue;

      const accountLeads = leadsByAccount.get(lead.sender_account_id) || [];
      accountLeads.push(lead as WaitingLead & { campaign: Campaign });
      leadsByAccount.set(lead.sender_account_id, accountLeads);
    }

    console.log(`[Connection Checker] Grouped into ${leadsByAccount.size} sender accounts`);

    // 3. Process each account
    for (const [accountId, leads] of leadsByAccount) {
      try {
        await processAccountConnections(supabase, accountId, leads, results, errors);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Connection Checker] Error processing account ${accountId}: ${errorMsg}`);
        errors.push(`Account ${accountId}: ${errorMsg}`);
      }
    }

    // 4. Log job completion
    const summary = {
      leadsChecked: waitingLeads.length,
      accountsProcessed: leadsByAccount.size,
      accepted: results.filter(r => r.action === 'accepted').length,
      timedOut: results.filter(r => r.action === 'timeout').length,
      withdrawn: results.filter(r => r.action === 'withdrawn').length,
      stillPending: results.filter(r => r.action === 'still_pending').length,
      errors: errors.length > 0 ? errors : undefined,
    };

    await logJob(supabase, jobId, 'completed', startTime, summary);

    console.log(`[Connection Checker] Job ${jobId} completed:`, summary);

    return new Response(JSON.stringify({ success: true, jobId, ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Connection Checker] Fatal error:', error);

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

// ============================================================================
// Connection Processing
// ============================================================================

async function processAccountConnections(
  supabase: SupabaseClient,
  accountId: string,
  leads: (WaitingLead & { campaign: Campaign })[],
  results: CheckResult[],
  errors: string[]
): Promise<void> {
  // Get account details
  const { data: account, error: accountError } = await supabase
    .from('unipile_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (accountError || !account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  if (account.status !== 'active') {
    // Leads for disconnected senders are handled by the
    // trigger_sender_account_disconnected DB trigger on unipile_accounts.status
    console.log(`[Connection Checker] Skipping inactive account ${accountId} (status: ${account.status})`);
    return;
  }

  if (account.api_version === 'v2') {
    await processAccountConnectionsV2(supabase, account, leads, results, errors);
    return;
  }

  // Decrypt API key
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
  const dsnUrl = normalizeDsnUrl(account.dsn_url);

  // Get contact identities for all leads
  const contactIds = leads.map(l => l.contact_id);
  const { data: identities } = await supabase
    .from('crm_contact_identities')
    .select('contact_id, platform_user_id')
    .in('contact_id', contactIds)
    .eq('channel', 'linkedin');

  const identityMap = new Map<string, string>();
  for (const identity of (identities || [])) {
    identityMap.set(identity.contact_id, identity.platform_user_id);
  }

  // Fetch invitations from Unipile
  let acceptedInvitations: UnipileInvitation[] = [];
  let pendingInvitations: UnipileInvitation[] = [];

  try {
    // Get accepted invitations
    const acceptedResponse = await fetch(
      `${dsnUrl}/api/v1/users/invitations?account_id=${account.unipile_account_id}&status=ACCEPTED&limit=100`,
      {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
      }
    );

    if (acceptedResponse.ok) {
      const data = await acceptedResponse.json();
      acceptedInvitations = data.items || [];
    } else {
      console.warn(`[Connection Checker] Failed to fetch accepted invitations: ${acceptedResponse.status}`);
    }

    // Get pending invitations
    const pendingResponse = await fetch(
      `${dsnUrl}/api/v1/users/invitations?account_id=${account.unipile_account_id}&status=PENDING&limit=100`,
      {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
      }
    );

    if (pendingResponse.ok) {
      const data = await pendingResponse.json();
      pendingInvitations = data.items || [];
    } else {
      console.warn(`[Connection Checker] Failed to fetch pending invitations: ${pendingResponse.status}`);
    }
  } catch (error) {
    console.error(`[Connection Checker] Error fetching invitations: ${error}`);
    errors.push(`Invitation fetch error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return;
  }

  // Build lookup sets using the correct Unipile API field names
  const acceptedIds = new Set(
    acceptedInvitations.map(inv => inv.invited_user_id || inv.provider_id || inv.profile?.id).filter(Boolean)
  );
  const pendingIds = new Set(
    pendingInvitations.map(inv => inv.invited_user_id || inv.provider_id || inv.profile?.id).filter(Boolean)
  );

  console.log(`[Connection Checker] Account ${accountId}: ${acceptedIds.size} accepted, ${pendingIds.size} pending`);

  // Process each lead
  for (const lead of leads) {
    try {
      const linkedInId = identityMap.get(lead.contact_id);

      if (!linkedInId) {
        console.warn(`[Connection Checker] No LinkedIn ID for contact ${lead.contact_id}`);
        results.push({
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'error',
          success: false,
          error: 'No LinkedIn ID',
        });
        continue;
      }

      const result = await processLeadConnection(
        supabase,
        lead,
        linkedInId,
        acceptedIds,
        pendingIds,
        (id) => withdrawInvitation(apiKey, dsnUrl, account.unipile_account_id, id)
      );

      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Connection Checker] Error processing lead ${lead.id}: ${errorMsg}`);
      results.push({
        leadId: lead.id,
        contactId: lead.contact_id,
        action: 'error',
        success: false,
        error: errorMsg,
      });
    }
  }
}

/**
 * Unipile v2 sender. Pending = in the account's sent relation requests. A lead that is no
 * longer pending is accepted when its profile shows FIRST_DEGREE; otherwise the timeout rules
 * below apply as for v1. Withdrawing cancels the request by its id.
 */
async function processAccountConnectionsV2(
  supabase: SupabaseClient,
  account: { id: string; unipile_account_id: string; access_token_encrypted?: string | null },
  leads: (WaitingLead & { campaign: Campaign })[],
  results: CheckResult[],
  errors: string[]
): Promise<void> {
  const client = new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, Deno.env.get('ENCRYPTION_KEY')!) });

  const { data: identities } = await supabase
    .from('crm_contact_identities')
    .select('contact_id, platform_user_id')
    .in('contact_id', leads.map(l => l.contact_id))
    .eq('channel', 'linkedin');
  const identityMap = new Map((identities || []).map(i => [i.contact_id, i.platform_user_id as string]));

  let pendingRequests: Map<string, string>;
  try {
    pendingRequests = await listPendingSentRequests(client, account.unipile_account_id);
  } catch (error) {
    const message = isUnipileApiError(error) ? `${error.type ?? error.code} ${error.message}` : String(error);
    console.error(`[Connection Checker] v2 sent-requests fetch failed for ${account.id}: ${message}`);
    errors.push(`Account ${account.id} (v2): ${message}`);
    return;
  }

  const acceptedIds = new Set<string>();
  for (const lead of leads) {
    const linkedInId = identityMap.get(lead.contact_id);
    if (!linkedInId || pendingRequests.has(linkedInId)) continue;
    try {
      const profile = await getProfile(client, account.unipile_account_id, linkedInId, true);
      if (profile.specifics?.network_distance === 'FIRST_DEGREE') acceptedIds.add(linkedInId);
    } catch (error) {
      console.warn(`[Connection Checker] v2 profile check failed for lead ${lead.id}:`, isUnipileApiError(error) ? error.message : error);
    }
  }

  const pendingIds = new Set(pendingRequests.keys());
  const withdraw: WithdrawFn = (linkedInId) => {
    const requestId = pendingRequests.get(linkedInId);
    return requestId
      ? cancelRelationRequest(client, account.unipile_account_id, requestId)
      : Promise.resolve({ success: false, error: 'No pending relation request found to withdraw' });
  };

  for (const lead of leads) {
    const linkedInId = identityMap.get(lead.contact_id);
    if (!linkedInId) {
      results.push({ leadId: lead.id, contactId: lead.contact_id, action: 'error', success: false, error: 'No LinkedIn ID' });
      continue;
    }
    try {
      results.push(await processLeadConnection(supabase, lead, linkedInId, acceptedIds, pendingIds, withdraw));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.push({ leadId: lead.id, contactId: lead.contact_id, action: 'error', success: false, error: errorMsg });
    }
  }
}

type WithdrawFn = (linkedInId: string) => Promise<{ success: boolean; error?: string }>;

async function processLeadConnection(
  supabase: SupabaseClient,
  lead: WaitingLead & { campaign: Campaign },
  linkedInId: string,
  acceptedIds: Set<string>,
  pendingIds: Set<string>,
  withdraw: WithdrawFn
): Promise<CheckResult> {
  const nodes = lead.campaign.sequence_nodes || [];
  const edges = lead.campaign.sequence_edges || [];
  const currentNode = lead.current_node_id ? findNodeById(lead.current_node_id, nodes) : null;
  const isOrphaned = !!(lead.current_node_id && !currentNode);

  // Check Unipile's truth FIRST, even for a lead whose node was deleted by a
  // sequence edit — a real acceptance must never be silently discarded just
  // because there's nowhere left to route the lead to. (Previously the
  // orphan check below ran before this and force-completed orphaned leads
  // without ever consulting acceptedIds/pendingIds, permanently losing any
  // acceptance that happened after the sequence was edited.)
  if (acceptedIds.has(linkedInId)) {
    console.log(`[Connection Checker] Connection accepted for lead ${lead.id}`);

    // Find next node (accepted branch) — none if the node graph no longer
    // has this lead's node at all.
    const nextNode = isOrphaned
      ? null
      : getNextNode(lead.current_node_id || '', nodes, edges, 'accepted');

    await supabase
      .from('campaign_lead_progress')
      .update({
        connection_accepted_at: new Date().toISOString(),
        current_node_id: nextNode?.id || null,
        status: nextNode ? 'pending' : 'completed',
        next_action_at: null, // Ready for immediate processing
        condition_entered_at: null, // Clear if waiting at conditionConnection
        error_message: isOrphaned
          ? `Sequence modified — node ${lead.current_node_id} no longer exists (connection was accepted)`
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    // Log the acceptance
    await supabase.from('campaign_action_log').insert({
      campaign_id: lead.campaign_id,
      progress_id: lead.id,
      contact_id: lead.contact_id,
      sender_account_id: lead.sender_account_id,
      node_id: lead.current_node_id || 'unknown',
      node_type: currentNode?.type || 'connectionRequest',
      action_type: 'connection_accepted',
      status: 'success',
      executed_at: new Date().toISOString(),
    });

    // Increment campaign analytics for connection acceptance
    await supabase.rpc('increment_campaign_analytics', {
      p_organization_id: lead.campaign.organization_id,
      p_campaign_id: lead.campaign_id,
      p_account_id: lead.sender_account_id,
      p_metric: 'connections_accepted',
      p_value: 1,
    });

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'accepted',
      success: true,
    };
  }

  // Not accepted. If the lead's node was deleted (sequence modified
  // mid-campaign), there's nothing left to route it to — mark as completed.
  if (isOrphaned) {
    console.log(
      `[Connection Checker] Lead ${lead.id} was on deleted node ${lead.current_node_id} — marking as completed`
    );
    await supabase
      .from('campaign_lead_progress')
      .update({
        status: 'completed',
        current_node_id: null,
        error_message: `Sequence modified — node ${lead.current_node_id} no longer exists`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'complete_orphaned' as const,
      success: true,
    };
  }

  // Check if connection is still pending
  if (pendingIds.has(linkedInId)) {
    // Check for timeout
    const sentAt = new Date(lead.connection_sent_at);
    const daysSinceSent = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24);

    // Get auto-withdraw settings from node
    const withdrawSettings = currentNode
      ? getAutoWithdrawSettings(currentNode)
      : { enabled: false, afterDays: 7 };

    if (withdrawSettings.enabled && daysSinceSent >= withdrawSettings.afterDays) {
      console.log(`[Connection Checker] Auto-withdrawing invitation for lead ${lead.id} (${daysSinceSent.toFixed(1)} days)`);

      // Withdraw the invitation
      const withdrawResult = await withdraw(linkedInId);

      if (withdrawResult.success) {
        // Move to notAccepted branch
        const nextNode = getNextNode(
          lead.current_node_id || '',
          nodes,
          edges,
          'notAccepted'
        );

        await supabase
          .from('campaign_lead_progress')
          .update({
            current_node_id: nextNode?.id || null,
            status: nextNode ? 'pending' : 'completed',
            next_action_at: null,
            condition_entered_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        // Log the withdrawal
        await supabase.from('campaign_action_log').insert({
          campaign_id: lead.campaign_id,
          progress_id: lead.id,
          contact_id: lead.contact_id,
          sender_account_id: lead.sender_account_id,
          node_id: lead.current_node_id || 'unknown',
          node_type: currentNode?.type || 'connectionRequest',
          action_type: 'invitation_withdrawn',
          status: 'success',
          executed_at: new Date().toISOString(),
        });

        return {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'withdrawn',
          success: true,
        };
      } else {
        return {
          leadId: lead.id,
          contactId: lead.contact_id,
          action: 'error',
          success: false,
          error: withdrawResult.error,
        };
      }
    }

    // Still pending, not timed out
    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'still_pending',
      success: true,
    };
  }

  // Not in accepted or pending - might have been declined or expired
  const sentAt = new Date(lead.connection_sent_at);
  const daysSinceSent = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24);

  // Get timeout settings
  const timeoutDays = currentNode
    ? (currentNode.data.timeoutDays as number) || 14
    : 14;

  if (daysSinceSent >= timeoutDays) {
    console.log(`[Connection Checker] Connection timed out for lead ${lead.id} (${daysSinceSent.toFixed(1)} days)`);

    // Move to not_accepted branch
    const nextNode = getNextNode(
      lead.current_node_id || '',
      nodes,
      edges,
      'notAccepted'
    );

    await supabase
      .from('campaign_lead_progress')
      .update({
        current_node_id: nextNode?.id || null,
        status: nextNode ? 'pending' : 'completed',
        next_action_at: null,
        condition_entered_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    // Log the timeout
    await supabase.from('campaign_action_log').insert({
      campaign_id: lead.campaign_id,
      progress_id: lead.id,
      contact_id: lead.contact_id,
      sender_account_id: lead.sender_account_id,
      node_id: lead.current_node_id || 'unknown',
      node_type: currentNode?.type || 'connectionRequest',
      action_type: 'connection_timeout',
      status: 'success',
      executed_at: new Date().toISOString(),
    });

    return {
      leadId: lead.id,
      contactId: lead.contact_id,
      action: 'timeout',
      success: true,
    };
  }

  // Still within timeout period, treat as pending
  return {
    leadId: lead.id,
    contactId: lead.contact_id,
    action: 'still_pending',
    success: true,
  };
}

// ============================================================================
// Unipile API Actions
// ============================================================================

async function withdrawInvitation(
  apiKey: string,
  dsnUrl: string,
  accountId: string,
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${dsnUrl}/api/v1/users/${encodeURIComponent(profileId)}/invite`,
      {
        method: 'DELETE',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          account_id: accountId,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Connection Checker] Withdraw failed: ${response.status} - ${errorText}`);
      return { success: false, error: `${response.status}: ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Connection Checker] Withdraw error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function logJob(
  supabase: SupabaseClient,
  _jobId: string,
  status: string,
  startTime: number,
  result: Record<string, unknown>
): Promise<void> {
  const duration = Date.now() - startTime;

  await supabase.from('unipile_job_logs').insert({
    job_type: 'campaign_connection_checker',
    status,
    items_processed: (result.leadsChecked as number) || 0,
    items_created: (result.connectionsFound as number) || 0,
    items_failed: 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors } : null,
    duration_ms: duration,
  });
}

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
