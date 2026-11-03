/**
 * Campaign Test Contact Edge Function
 *
 * Thin wrapper that allows testing a campaign sequence with a single contact.
 * Creates a test progress row and invokes the campaign-processor in test mode.
 *
 * Actions:
 *   start   — pick a contact + sender, create test row, process first step
 *   advance — process next step (optionally with condition override)
 *   cleanup — remove test progress row and associated action logs
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  console.log('[campaign-test-contact] Request received:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Auth: verify the caller's JWT to get org context
  const authHeader = req.headers.get('Authorization') || '';
  const userSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userSupabase.auth.getUser();
  if (authError || !user) {
    console.log('[campaign-test-contact] Auth failed:', authError?.message);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Service role client for data operations
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    console.log('[campaign-test-contact] Authenticated user:', user.id);
    const body = await req.json();
    const { action, campaignId } = body as { action: string; campaignId: string };
    console.log('[campaign-test-contact] Action:', action, 'Campaign:', campaignId);

    if (!campaignId) {
      return jsonResponse({ error: 'campaignId is required' }, 400);
    }

    // Verify campaign exists and user has access
    const { data: campaign, error: campaignError } = await supabase
      .from('linkedin_campaigns')
      .select('id, organization_id')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return jsonResponse({ error: 'Campaign not found' }, 404);
    }

    // Verify user belongs to the campaign's organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', campaign.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: 'You do not have access to this campaign' }, 403);
    }

    // ---- Action: start ----
    if (action === 'start') {
      const { contactId, senderAccountId } = body as {
        contactId: string;
        senderAccountId: string;
      };

      if (!contactId || !senderAccountId) {
        return jsonResponse({ error: 'contactId and senderAccountId are required' }, 400);
      }

      console.log('[campaign-test-contact] Starting test for contact:', contactId, 'sender:', senderAccountId);

      // Delete any existing test progress for this campaign
      const { error: deleteErr } = await supabase
        .from('campaign_lead_progress')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('is_test_contact', true);
      console.log('[campaign-test-contact] Deleted old test rows:', deleteErr?.message || 'ok');

      // Insert new test progress row
      const { data: progress, error: insertError } = await supabase
        .from('campaign_lead_progress')
        .insert({
          campaign_id: campaignId,
          contact_id: contactId,
          sender_account_id: senderAccountId,
          status: 'pending',
          is_test_contact: true,
          next_action_at: new Date().toISOString(),
          variation_index: 0,
          retry_count: 0,
        })
        .select()
        .single();

      if (insertError || !progress) {
        console.error('[campaign-test-contact] Insert failed:', insertError?.message);
        const isDuplicate = insertError?.message?.includes('duplicate key') || insertError?.code === '23505';
        if (isDuplicate) {
          return jsonResponse({ error: 'This contact is already enrolled in the campaign. Please pick a different contact for testing.' }, 400);
        }
        return jsonResponse({ error: `Failed to create test row: ${insertError?.message}` }, 500);
      }

      console.log('[campaign-test-contact] Created test row:', progress.id, '— invoking processor');

      // Invoke the campaign processor in test mode via direct HTTP
      return await invokeTestMode(supabaseUrl, serviceRoleKey, campaignId, progress.id);
    }

    // ---- Action: advance ----
    if (action === 'advance') {
      const { progressId, conditionOverride } = body as {
        progressId: string;
        conditionOverride?: {
          type: string; // e.g. 'conditionConnection', 'conditionReplyReceived'
          branch: string; // e.g. 'accepted', 'notAccepted', 'replied', 'noReply'
        };
      };

      if (!progressId) {
        return jsonResponse({ error: 'progressId is required' }, 400);
      }

      // Fetch the test progress row
      const { data: progress, error: fetchError } = await supabase
        .from('campaign_lead_progress')
        .select('*')
        .eq('id', progressId)
        .eq('is_test_contact', true)
        .single();

      if (fetchError || !progress) {
        return jsonResponse({ error: 'Test progress row not found' }, 404);
      }

      // Apply condition override if provided
      if (conditionOverride) {
        const updatePayload: Record<string, unknown> = {};

        if (conditionOverride.type === 'conditionConnection') {
          if (conditionOverride.branch === 'accepted') {
            updatePayload.connection_accepted_at = new Date().toISOString();
          }
          // For 'notAccepted', leave connection_accepted_at null — processor will take the notAccepted branch
        }

        if (conditionOverride.type === 'conditionReplyReceived') {
          if (conditionOverride.branch === 'replied') {
            updatePayload.replied_at = new Date().toISOString();
          }
        }

        // Move to the condition node so the processor can evaluate it
        // The current_node_id should already be pointing at the condition node
        updatePayload.status = 'pending';
        updatePayload.next_action_at = new Date().toISOString();

        await supabase
          .from('campaign_lead_progress')
          .update(updatePayload)
          .eq('id', progressId);
      } else {
        // Just reset status to pending so processor picks it up
        await supabase
          .from('campaign_lead_progress')
          .update({
            status: 'pending',
            next_action_at: new Date().toISOString(),
          })
          .eq('id', progressId);
      }

      // Invoke the campaign processor in test mode via direct HTTP
      return await invokeTestMode(supabaseUrl, serviceRoleKey, campaignId, progressId);
    }

    // ---- Action: cleanup ----
    if (action === 'cleanup') {
      // Delete the test progress row (FK cascade cleans action logs if configured,
      // otherwise delete logs first)
      const { data: testRows } = await supabase
        .from('campaign_lead_progress')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('is_test_contact', true);

      if (testRows && testRows.length > 0) {
        const testIds = testRows.map((r: any) => r.id);

        // Delete action logs first (in case no FK cascade)
        await supabase
          .from('campaign_action_log')
          .delete()
          .in('progress_id', testIds);

        // Delete progress rows
        await supabase
          .from('campaign_lead_progress')
          .delete()
          .eq('campaign_id', campaignId)
          .eq('is_test_contact', true);
      }

      return jsonResponse({ success: true, message: 'Test data cleaned up' });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[campaign-test-contact] Inner error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
  } catch (outerError) {
    console.error('[campaign-test-contact] Outer error:', outerError);
    return jsonResponse({
      error: outerError instanceof Error ? outerError.message : 'Unknown error',
    }, 500);
  }
});

async function invokeTestMode(
  supabaseUrl: string,
  serviceRoleKey: string,
  campaignId: string,
  progressId: string,
) {
  // Direct HTTP call to campaign-processor instead of supabase.functions.invoke
  const functionUrl = `${supabaseUrl}/functions/v1/campaign-processor`;
  console.log('[campaign-test-contact] Invoking processor at:', functionUrl);

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
      },
      body: JSON.stringify({ testMode: true, campaignId, progressId }),
    });

    console.log('[campaign-test-contact] Processor responded:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[campaign-test-contact] Processor HTTP error:', res.status, errorText);
      let errorMsg = `Processor returned ${res.status}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error) errorMsg = parsed.error;
      } catch { /* ignore parse errors */ }
      return jsonResponse({ error: errorMsg }, 500);
    }

    const data = await res.json();
    console.log('[campaign-test-contact] Processor result:', JSON.stringify(data).slice(0, 200));
    return jsonResponse(data);
  } catch (fetchError) {
    console.error('[campaign-test-contact] Fetch to processor failed:', fetchError);
    return jsonResponse({ error: `Failed to invoke processor: ${fetchError instanceof Error ? fetchError.message : 'unknown'}` }, 500);
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  });
}
