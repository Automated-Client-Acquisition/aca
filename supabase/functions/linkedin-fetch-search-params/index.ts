import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * LinkedIn Fetch Search Parameters Edge Function
 *
 * Fetches search parameter options (locations, industries, companies, etc.)
 * from the Unipile SDK for use in the search filter UI.
 *
 * GET /api/v1/linkedin/search/parameters?account_id=X&type=TYPE&keywords=TERM
 *
 * Supported parameter types:
 * - location: Geographic locations (countries, cities, regions)
 * - industry: Industry categories
 * - company: Company names (for current/past company filters)
 * - school: Educational institutions
 * - skill: Professional skills
 * - function: Job functions
 * - seniority: Seniority levels
 */

// Parameter types accepted by frontend (lowercase)
type ParameterType = 'location' | 'industry' | 'company' | 'school' | 'skill' | 'function' | 'seniority';

// Mapping to Unipile API types (uppercase)
const PARAM_TYPE_MAP: Record<ParameterType, string> = {
  'location': 'LOCATION',
  'industry': 'INDUSTRY',
  'company': 'COMPANY',
  'school': 'SCHOOL',
  'skill': 'SKILL',
  'function': 'JOB_FUNCTION',
  'seniority': 'SENIORITY_LEVEL',
};

interface SearchParameter {
  id: string;
  name: string;
  urn?: string;
  type?: string;
}

interface SearchParamsResponse {
  items?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { accountId, parameterType, keywords = '' } = await req.json();

    if (!accountId) {
      throw new Error('accountId is required');
    }

    if (!parameterType) {
      throw new Error('parameterType is required');
    }

    const validTypes: ParameterType[] = ['location', 'industry', 'company', 'school', 'skill', 'function', 'seniority'];
    if (!validTypes.includes(parameterType as ParameterType)) {
      throw new Error(`Invalid parameterType. Must be one of: ${validTypes.join(', ')}`);
    }

    console.log(`[LinkedIn Search Params] Fetching ${parameterType} params for account ${accountId}, keywords: "${keywords}"`);

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: 'Account not found', parameters: [] }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, account.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (account.status !== 'active') {
      throw new Error('LinkedIn account is not active');
    }

    // Create SDK client
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const client = new UnipileClient(dsnUrl, apiKey);

    // Map frontend type to Unipile API type (uppercase)
    const unipileType = PARAM_TYPE_MAP[parameterType as ParameterType];
    if (!unipileType) {
      throw new Error(`Unknown parameter type: ${parameterType}`);
    }

    // Build query parameters for the API call
    // Required: account_id, type
    // Optional: keywords, limit
    // Note: All query params must be strings for the SDK
    const queryParams: Record<string, string> = {
      account_id: account.unipile_account_id,
      type: unipileType,
      limit: '50', // Return more results for better autocomplete
    };

    // Add keywords if provided (for filtering/search)
    if (keywords) {
      queryParams.keywords = String(keywords);
    }

    console.log(`[LinkedIn Search Params] SDK request: /api/v1/linkedin/search/parameters`, queryParams);

    // Use direct fetch instead of SDK's request.send (which has issues with this endpoint)
    let data: SearchParamsResponse | Record<string, unknown>[];
    try {
      // Build URL with query parameters
      const searchParams = new URLSearchParams(queryParams);
      const url = `${dsnUrl}/api/v1/linkedin/search/parameters?${searchParams.toString()}`;

      console.log(`[LinkedIn Search Params] Making direct fetch to:`, url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LinkedIn Search Params] API error ${response.status}:`, errorText);
        throw new Error(`Unipile API error: ${response.status} - ${errorText}`);
      }

      data = await response.json() as SearchParamsResponse | Record<string, unknown>[];
    } catch (error) {
      console.error(`[LinkedIn Search Params] Fetch error:`, error instanceof Error ? error.message : String(error));
      throw error;
    }

    // Normalize response - Unipile returns { object: "LinkedinSearchParametersList", items: [...] }
    let parameters: SearchParameter[] = [];

    console.log(`[LinkedIn Search Params] Raw response:`, JSON.stringify(data).substring(0, 500));

    // Handle the documented response format: { object: "...", items: [...] }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const response = data as SearchParamsResponse;
      if (response.items && Array.isArray(response.items)) {
        parameters = response.items.map(normalizeParameter);
      } else if (response.results && Array.isArray(response.results)) {
        parameters = response.results.map(normalizeParameter);
      }
    } else if (Array.isArray(data)) {
      parameters = data.map(normalizeParameter);
    }

    // No need to filter by type or keywords - API already handles that via query params

    console.log(`[LinkedIn Search Params] Found ${parameters.length} ${parameterType} options`);

    return new Response(JSON.stringify({ parameters }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[LinkedIn Search Params] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      parameters: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Normalize parameter object from Unipile response format
 * Response format: { object: "LinkedinSearchParameter", id: "...", title: "...", picture_url: "..." }
 */
function normalizeParameter(param: Record<string, unknown>): SearchParameter {
  return {
    // Unipile uses 'id' for the parameter ID
    id: String(param.id || param.urn || param.value || ''),
    // Unipile uses 'title' for the display name
    name: String(param.title || param.name || param.text || param.label || ''),
    urn: param.urn as string | undefined,
    type: param.type as string | undefined,
  };
}
