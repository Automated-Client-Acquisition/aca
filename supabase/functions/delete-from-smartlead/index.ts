/**
 * Delete Lead from SmartLead
 *
 * Deletes leads from a SmartLead campaign to free up contact slots.
 * Uses the SmartLead API delete endpoint.
 *
 * @see https://api.smartlead.ai/reference/delete-lead-by-campaign-id
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

interface DeleteFromSmartleadRequest {
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
    const body: DeleteFromSmartleadRequest = await req.json();
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

    if (connection.tool_type !== 'smartlead') {
      throw new Error(`Invalid connection type: expected smartlead, got ${connection.tool_type}`);
    }

    const apiKey = await decryptApiKey(connection.api_key_encrypted, encryptionKey);

    // Fetch handoffs to delete
    const { data: handoffs, error: handoffsError } = await supabase
      .from('lead_handoffs')
      .select('id, external_lead_id, external_campaign_id')
      .in('id', handoffIds)
      // Handoffs of other orgs are ignored. lead_handoffs.connection_id is NULL on
      // existing rows, so scope by the connection's org instead.
      .eq('organization_id', connection.organization_id)
      .eq('tool_type', 'smartlead')
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

    // SmartLead requires individual deletion per lead
    for (const handoff of handoffs) {
      const { id, external_lead_id, external_campaign_id } = handoff;

      // Skip if missing required IDs
      if (!external_lead_id || !external_campaign_id) {
        await supabase
          .from('lead_handoffs')
          .update({
            deletion_status: 'skipped',
            deletion_error: 'Missing external_lead_id or external_campaign_id',
          })
          .eq('id', id);

        result.failed++;
        result.errors.push({
          handoffId: id,
          error: 'Missing external_lead_id or external_campaign_id',
        });
        continue;
      }

      try {
        // SmartLead delete endpoint
        const smartleadUrl = `https://server.smartlead.ai/api/v1/campaigns/${external_campaign_id}/leads/${external_lead_id}?api_key=${apiKey}`;
        const response = await fetch(smartleadUrl, {
          method: 'DELETE',
        });

        const responseData = await response.json();

        if (response.ok && responseData.ok !== false) {
          // Mark handoff as deleted
          await supabase
            .from('lead_handoffs')
            .update({
              deletion_status: 'deleted',
              deleted_at: new Date().toISOString(),
            })
            .eq('id', id);

          result.deleted++;
        } else {
          // Mark as failed
          const errorMessage = responseData.error || responseData.message || 'Unknown SmartLead error';

          await supabase
            .from('lead_handoffs')
            .update({
              deletion_status: 'failed',
              deletion_error: errorMessage,
            })
            .eq('id', id);

          result.failed++;
          result.errors.push({ handoffId: id, error: errorMessage });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        await supabase
          .from('lead_handoffs')
          .update({
            deletion_status: 'failed',
            deletion_error: errorMessage,
          })
          .eq('id', id);

        result.failed++;
        result.errors.push({ handoffId: id, error: errorMessage });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Delete from SmartLead error:', error);
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
