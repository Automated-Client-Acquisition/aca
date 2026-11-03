/**
 * Delete Lead from Instantly
 *
 * Deletes leads from an Instantly campaign to free up contact slots.
 * Uses the Instantly API v2 delete endpoint.
 *
 * @see https://developer.instantly.ai/api/v2/lead/deletelead
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteFromInstantlyRequest {
  connectionId: string;
  handoffIds: string[];
}

interface DeleteResult {
  success: boolean;
  deleted: number;
  failed: number;
  errors: Array<{ handoffId: string; error: string }>;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Get encryption key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: DeleteFromInstantlyRequest = await req.json();
    const { connectionId, handoffIds } = body;

    // Validate required fields
    if (!connectionId || !handoffIds || handoffIds.length === 0) {
      throw new Error('Missing required fields: connectionId, handoffIds');
    }

    // Fetch connection and decrypt API key
    const { data: connection, error: connectionError } = await supabase
      .from('email_tool_connections')
      .select('*')
      .eq('id', connectionId)
      .single();

    if (connectionError || !connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], connection.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (connection.tool_type !== 'instantly') {
      throw new Error(`Invalid connection type: expected instantly, got ${connection.tool_type}`);
    }

    const apiKey = await decryptApiKey(connection.api_key_encrypted, encryptionKey);

    // Fetch handoffs to delete
    const { data: handoffs, error: handoffsError } = await supabase
      .from('lead_handoffs')
      .select(`
        id,
        external_lead_id,
        external_campaign_id,
        contact_id,
        crm_contacts!inner(primary_email)
      `)
      .in('id', handoffIds)
      // Handoffs of other orgs are ignored. lead_handoffs.connection_id is NULL on
      // existing rows, so scope by the connection's org instead.
      .eq('organization_id', connection.organization_id)
      .eq('tool_type', 'instantly')
      .eq('status', 'sent')
      .is('deletion_status', null);

    if (handoffsError) {
      throw new Error(`Failed to fetch handoffs: ${handoffsError.message}`);
    }

    if (!handoffs || handoffs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          deleted: 0,
          failed: 0,
          errors: [],
          message: 'No eligible handoffs found to delete',
        } as DeleteResult),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Mark handoffs as pending deletion
    await supabase
      .from('lead_handoffs')
      .update({ deletion_status: 'pending' })
      .in('id', handoffs.map(h => h.id));

    const result: DeleteResult = {
      success: true,
      deleted: 0,
      failed: 0,
      errors: [],
    };

    // Group handoffs by campaign for batch deletion
    const byCampaign = new Map<string, typeof handoffs>();
    for (const handoff of handoffs) {
      const campaignId = handoff.external_campaign_id;
      if (!campaignId) continue;

      if (!byCampaign.has(campaignId)) {
        byCampaign.set(campaignId, []);
      }
      byCampaign.get(campaignId)!.push(handoff);
    }

    // Delete from each campaign
    for (const [campaignId, campaignHandoffs] of byCampaign) {
      // Instantly API accepts email list for deletion
      const emails = campaignHandoffs
        .map(h => (h.crm_contacts as any)?.primary_email)
        .filter(Boolean);

      if (emails.length === 0) continue;

      try {
        // Instantly delete endpoint
        const instantlyUrl = `https://api.instantly.ai/api/v2/leads`;
        const response = await fetch(instantlyUrl, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            campaign_id: campaignId,
            delete_list: emails,
          }),
        });

        const responseData = await response.json();

        if (response.ok) {
          // Mark handoffs as deleted
          const deletedCount = responseData.deleted_count || campaignHandoffs.length;

          await supabase
            .from('lead_handoffs')
            .update({
              deletion_status: 'deleted',
              deleted_at: new Date().toISOString(),
            })
            .in('id', campaignHandoffs.map(h => h.id));

          result.deleted += deletedCount;
        } else {
          // Mark as failed
          const errorMessage = responseData.error || responseData.message || 'Unknown Instantly error';

          await supabase
            .from('lead_handoffs')
            .update({
              deletion_status: 'failed',
              deletion_error: errorMessage,
            })
            .in('id', campaignHandoffs.map(h => h.id));

          result.failed += campaignHandoffs.length;
          for (const h of campaignHandoffs) {
            result.errors.push({ handoffId: h.id, error: errorMessage });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        await supabase
          .from('lead_handoffs')
          .update({
            deletion_status: 'failed',
            deletion_error: errorMessage,
          })
          .in('id', campaignHandoffs.map(h => h.id));

        result.failed += campaignHandoffs.length;
        for (const h of campaignHandoffs) {
          result.errors.push({ handoffId: h.id, error: errorMessage });
        }
      }
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Delete from Instantly error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        deleted: 0,
        failed: 0,
        errors: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
