import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CalendarItem {
  id: string;
  name: string;
  is_primary: boolean;
  can_create_events: boolean;
  color?: string;
}

/**
 * Calendar List Calendars Edge Function
 *
 * Lists all available calendars for a connected calendar account.
 * Used to let users select which calendar to use for scheduling.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header to identify user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    // Verify the user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Invalid authorization token');
    }

    const { calendarAccountId, organizationId } = await req.json();

    if (!calendarAccountId) {
      throw new Error('Calendar account ID is required');
    }

    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    console.log(`[Calendar List] Fetching calendars for account:`, calendarAccountId);

    // Verify user has access to this organization
    const { data: membership, error: memberError } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      throw new Error('You do not have access to this organization');
    }

    // Get the calendar account
    const { data: calendarAccount, error: accountError } = await supabase
      .from('calendar_accounts')
      .select('*')
      .eq('id', calendarAccountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !calendarAccount) {
      throw new Error('Calendar account not found');
    }

    // Get Unipile credentials from org's BYOK
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'unipile')
      .eq('is_valid', true)
      .maybeSingle();

    if (!apiKeyData?.key_encrypted) {
      throw new Error('Unipile API key not configured. Please add your Unipile API key in Settings > API Keys.');
    }

    console.log('[Calendar List] Using BYOK');
    const unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl((apiKeyData.metadata as Record<string, string>)?.dsn_url);

    // Create SDK client
    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Fetch calendars from Unipile
    const calendarsResponse = await client.request.send({
      path: '/api/v1/calendars',
      method: 'GET',
      query: { account_id: calendarAccount.unipile_account_id },
    }) as { items?: Array<Record<string, unknown>> };

    console.log('[Calendar List] Calendars response:', JSON.stringify(calendarsResponse, null, 2));

    // Transform the response
    const calendars: CalendarItem[] = (calendarsResponse?.items || []).map((cal: Record<string, unknown>) => ({
      id: cal.id as string,
      name: (cal.name || cal.summary || 'Unnamed Calendar') as string,
      is_primary: (cal.is_primary || false) as boolean,
      can_create_events: true, // Most calendars allow this
      color: cal.color as string | undefined,
    }));

    // Update cached calendars in account
    await supabase
      .from('calendar_accounts')
      .update({
        last_sync_at: new Date().toISOString(),
      })
      .eq('id', calendarAccountId);

    return new Response(
      JSON.stringify({
        success: true,
        calendars,
        accountId: calendarAccountId,
        unipileAccountId: calendarAccount.unipile_account_id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Calendar List] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
