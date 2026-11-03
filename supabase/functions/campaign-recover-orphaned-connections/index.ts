/**
 * Campaign Orphaned-Connection Recovery (one-off, manually invoked)
 *
 * Bug: when a campaign sequence was edited/re-saved, node IDs regenerated
 * and leads waiting on the connectionRequest node became "orphaned" —
 * campaign-connection-checker force-completed them with
 * error_message "Sequence modified — node X no longer exists" WITHOUT ever
 * checking Unipile for the real acceptance status. That code path is fixed
 * (see campaign-connection-checker/index.ts), but leads that were already
 * stranded before the fix never got a chance to have their real status
 * recorded. This is a one-time recovery pass for those leads: it re-checks
 * Unipile's accepted-invitations list and, for leads that really were
 * accepted, backfills connection_accepted_at and the connections_accepted
 * analytic so connection_rate reflects reality.
 *
 * Deliberately does NOT touch status/current_node_id — these contacts
 * accepted the connection days/weeks/months ago and the sequence already
 * moved on; resuming messaging to them now would be an unsolicited surprise.
 * This corrects the stats only.
 *
 * Invoke once with: { "organization_id": "<uuid>" }
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StrandedLead {
  id: string;
  campaign_id: string;
  contact_id: string;
  sender_account_id: string;
}

interface UnipileInvitation {
  invited_user_id: string | null;
  invited_user_public_id: string | null;
  invited_user: string | null;
  provider_id?: string;
  profile?: { id: string; name?: string };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // One-off backfill that acts on any org with the service-role client: internal calls only.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const organizationId: string | undefined = body.organization_id;

    if (!organizationId) {
      return new Response(JSON.stringify({ error: 'organization_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find stranded leads: force-completed by the orphan-handling bug,
    // invitation was sent, but we never recorded a real accept/reject.
    const { data: strandedRaw, error: strandedError } = await supabase
      .from('campaign_lead_progress')
      .select('id, campaign_id, contact_id, sender_account_id, linkedin_campaigns!inner(organization_id)')
      .eq('linkedin_campaigns.organization_id', organizationId)
      .eq('status', 'completed')
      .ilike('error_message', 'Sequence modified%')
      .not('connection_sent_at', 'is', null)
      .is('connection_accepted_at', null)
      .not('sender_account_id', 'is', null);

    if (strandedError) {
      throw new Error(`Failed to fetch stranded leads: ${strandedError.message}`);
    }

    const stranded = (strandedRaw || []) as unknown as StrandedLead[];

    if (stranded.length === 0) {
      return new Response(JSON.stringify({ success: true, checked: 0, recovered: 0, message: 'No stranded leads found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group by sender account so we fetch each account's invitations once.
    const leadsByAccount = new Map<string, StrandedLead[]>();
    for (const lead of stranded) {
      const list = leadsByAccount.get(lead.sender_account_id) || [];
      list.push(lead);
      leadsByAccount.set(lead.sender_account_id, list);
    }

    let checked = 0;
    let recovered = 0;
    let stillNotAccepted = 0;
    let errorsCount = 0;
    const details: Array<{ leadId: string; contactId: string; result: string }> = [];

    for (const [accountId, leads] of leadsByAccount) {
      try {
        const { data: account, error: accountError } = await supabase
          .from('unipile_accounts')
          .select('*')
          .eq('id', accountId)
          .single();

        if (accountError || !account) {
          console.error(`[Recover Connections] Account ${accountId} not found`);
          errorsCount += leads.length;
          continue;
        }

        const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
        const dsnUrl = normalizeDsnUrl(account.dsn_url);

        const acceptedResponse = await fetch(
          `${dsnUrl}/api/v1/users/invitations?account_id=${account.unipile_account_id}&status=ACCEPTED&limit=100`,
          { headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' } }
        );

        if (!acceptedResponse.ok) {
          console.error(`[Recover Connections] Account ${accountId}: invitations fetch failed ${acceptedResponse.status}`);
          errorsCount += leads.length;
          continue;
        }

        const acceptedData = await acceptedResponse.json();
        const acceptedInvitations: UnipileInvitation[] = acceptedData.items || [];
        const acceptedIds = new Set(
          acceptedInvitations.map((inv) => inv.invited_user_id || inv.provider_id || inv.profile?.id).filter(Boolean)
        );

        // Contact identities for this batch of leads
        const contactIds = leads.map((l) => l.contact_id);
        const { data: identities } = await supabase
          .from('crm_contact_identities')
          .select('contact_id, platform_user_id')
          .in('contact_id', contactIds)
          .eq('channel', 'linkedin');

        const identityMap = new Map<string, string>();
        for (const identity of identities || []) {
          identityMap.set(identity.contact_id, identity.platform_user_id);
        }

        for (const lead of leads) {
          checked++;
          const linkedInId = identityMap.get(lead.contact_id);

          if (!linkedInId || !acceptedIds.has(linkedInId)) {
            stillNotAccepted++;
            details.push({ leadId: lead.id, contactId: lead.contact_id, result: 'not_accepted' });
            continue;
          }

          const nowIso = new Date().toISOString();

          const { error: updateError } = await supabase
            .from('campaign_lead_progress')
            .update({ connection_accepted_at: nowIso, updated_at: nowIso })
            .eq('id', lead.id);

          if (updateError) {
            console.error(`[Recover Connections] Failed to update lead ${lead.id}: ${updateError.message}`);
            errorsCount++;
            continue;
          }

          await supabase.from('campaign_action_log').insert({
            campaign_id: lead.campaign_id,
            progress_id: lead.id,
            contact_id: lead.contact_id,
            sender_account_id: accountId,
            node_id: 'system_connection_recovered',
            node_type: 'system',
            action_type: 'connection_recovered',
            status: 'success',
            error_message: 'Recovered from orphaned-node bug: connection was actually accepted',
            executed_at: nowIso,
          });

          await supabase.rpc('increment_campaign_analytics', {
            p_organization_id: organizationId,
            p_campaign_id: lead.campaign_id,
            p_account_id: accountId,
            p_metric: 'connections_accepted',
            p_value: 1,
          });

          recovered++;
          details.push({ leadId: lead.id, contactId: lead.contact_id, result: 'recovered' });
        }
      } catch (accountErr) {
        console.error(`[Recover Connections] Error processing account ${accountId}:`, accountErr);
        errorsCount += leads.length;
      }
    }

    console.log(`[Recover Connections] org=${organizationId} checked=${checked} recovered=${recovered} stillNotAccepted=${stillNotAccepted} errors=${errorsCount}`);

    return new Response(JSON.stringify({
      success: true,
      organizationId,
      checked,
      recovered,
      stillNotAccepted,
      errors: errorsCount,
      details,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Recover Connections] Fatal error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
