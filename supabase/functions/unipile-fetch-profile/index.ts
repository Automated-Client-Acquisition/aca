/**
 * Edge Function: Fetch LinkedIn Profile via Unipile
 *
 * Retrieves detailed profile information for a LinkedIn user using the Unipile API.
 * Supports fetching profile sections like experience, education, skills, etc.
 *
 * @see https://developer.unipile.com/docs/nodejs-sdk
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FetchProfileRequest {
  /** LinkedIn provider_id or public_identifier (username) */
  identifier: string;
  /** The Unipile account ID to use for fetching */
  accountId: string;
  /** Profile sections to fetch (defaults to preview data) */
  sections?: string[];
  /** Whether to notify the user of profile view (default: false) */
  notify?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: FetchProfileRequest = await req.json();
    const { identifier, accountId, sections, notify = false } = body;

    if (!identifier || !accountId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: identifier, accountId', received: { identifier, accountId } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (userError) {
      return new Response(
        JSON.stringify({ error: 'Failed to get user organization' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    // Verify the account belongs to this organization
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, provider')
      .eq('unipile_account_id', accountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found or not authorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get organization's Unipile API key (BYOK required)
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'unipile')
      .eq('is_valid', true)
      .maybeSingle();

    if (!apiKeyData?.key_encrypted) {
      return new Response(
        JSON.stringify({ error: 'Unipile API key not configured. Please add your API key in Settings > API Keys.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const apiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const keyMetadata = apiKeyData.metadata as Record<string, string> | null;
    const baseUrl = normalizeDsnUrl(keyMetadata?.dsn_url);

    // Build sections parameter - use preview data by default to avoid throttling
    const linkedinSections = (sections && sections.length > 0) ? sections : [
      '*_preview',  // All sections with preview data (less throttling risk)
      'experience', // Full work experience
      'education',  // Full education
      'skills',     // Full skills
    ];

    let profile;

    // Build query params with repeated linkedin_sections for array format
    const params = new URLSearchParams();
    params.append('account_id', accountId);
    params.append('notify', String(notify));
    linkedinSections.forEach(section => {
      params.append('linkedin_sections', section);
    });

    const url = `${baseUrl}/api/v1/users/${encodeURIComponent(identifier)}?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('API error response:', errorBody);
      throw new Error(`API error: ${response.status} - ${errorBody}`);
    }

    profile = await response.json();
    console.log('Profile fetched:', profile?.provider_id || 'unknown',
      'exp:', profile?.work_experience?.length || 0,
      'skills:', profile?.skills?.length || 0);

    // Trim payload — only send fields the UI actually uses
    const trimmedProfile = {
      // Core identity
      provider: profile.provider,
      provider_id: profile.provider_id,
      public_identifier: profile.public_identifier,
      first_name: profile.first_name,
      last_name: profile.last_name,
      headline: profile.headline,
      summary: profile.summary,
      location: profile.location,
      profile_picture_url: profile.profile_picture_url,
      public_profile_url: profile.public_profile_url,
      object: profile.object,

      // Contact info
      contact_info: profile.contact_info,

      // Status flags used by UI
      can_send_inmail: profile.can_send_inmail,
      is_open_profile: profile.is_open_profile,
      is_premium: profile.is_premium,
      is_influencer: profile.is_influencer,
      is_creator: profile.is_creator,
      is_hiring: profile.is_hiring,
      is_open_to_work: profile.is_open_to_work,

      // Connection info
      network_distance: profile.network_distance,
      follower_count: profile.follower_count,
      connections_count: profile.connections_count,
      shared_connections_count: profile.shared_connections_count,

      // Detail sections
      work_experience: profile.work_experience,
      education: profile.education,
      skills: profile.skills,
      languages: profile.languages,
      certifications: profile.certifications,
      projects: profile.projects,
      hashtags: profile.hashtags,

      // Throttling info (useful for UI feedback)
      throttled_sections: profile.throttled_sections,
    };

    return new Response(
      JSON.stringify({
        success: true,
        profile: trimmedProfile,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fetching profile:', error);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));

    const parsedError = parseUnipileError(error);

    // Include raw error details for debugging
    const rawError = error && typeof error === 'object'
      ? {
          message: (error as Error).message,
          body: (error as { body?: unknown }).body,
          stack: (error as Error).stack?.split('\n').slice(0, 3).join('\n'),
        }
      : String(error);

    return new Response(
      JSON.stringify({
        success: false,
        error: parsedError.message,
        code: parsedError.code,
        retryable: parsedError.retryable,
        debug: {
          rawError,
          requestedIdentifier: 'see logs',
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
