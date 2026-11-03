import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organizationId } = await req.json();

    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    console.log('Initiating OAuth flow for organization:', organizationId);

    const clientId = Deno.env.get('GHL_CLIENT_ID');
    if (!clientId) {
      throw new Error('GHL_CLIENT_ID not configured');
    }

    // Hardcode redirect URI - it's public and needs to match GHL exactly
    const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`;

    // Get the current app URL from the request origin
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('?')[0].replace(/\/$/, '');
    
    // Generate unique state for CSRF protection
    const state = crypto.randomUUID();

    // Store state in database with 1-hour expiry and app URL for redirect
    const { error: stateError } = await supabase
      .from('oauth_states')
      .insert({
        state,
        organization_id: organizationId,
        app_url: origin,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

    if (stateError) {
      console.error('Failed to store OAuth state:', stateError);
      throw new Error('Failed to initialize OAuth flow');
    }

    // Build GHL authorization URL with comprehensive scopes
    const scopes = [
      // Social Planner
      'socialplanner/oauth.readonly',
      'socialplanner/oauth.write',
      'socialplanner/post.readonly',
      'socialplanner/post.write',
      'socialplanner/account.readonly',
      'socialplanner/account.write',
      'socialplanner/csv.readonly',
      'socialplanner/csv.write',
      'socialplanner/category.readonly',
      'socialplanner/tag.readonly',
      'socialplanner/statistics.readonly',
      'socialplanner/category.write',
      'socialplanner/tag.write',
      // Media & OAuth & Blogs
      'medias.readonly',
      'medias.write',
      'oauth.readonly',
      'oauth.write',
      'blogs/post.write',
      // Calendars
      'calendars.readonly',
      'calendars.write',
      'calendars/events.readonly',
      'calendars/events.write',
      'calendars/groups.readonly',
      'calendars/groups.write',
      'calendars/resources.readonly',
      'calendars/resources.write',
      // Contacts
      'contacts.readonly',
      'contacts.write',
      // Custom Fields & Values
      'locations/customValues.readonly',
      'locations/customValues.write',
      'locations/customFields.readonly',
      'locations/customFields.write',
    ].join(' ');

    const authUrl = new URL('https://marketplace.leadconnectorhq.com/oauth/chooselocation');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('state', state);

    console.log('Generated OAuth URL with state:', state);

    return new Response(
      JSON.stringify({
        success: true,
        authUrl: authUrl.toString(),
        state,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('OAuth init error:', error);
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
