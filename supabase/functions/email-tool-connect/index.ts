/**
 * Email Tool Connection Management
 *
 * Handles connecting to external email tools (Smartlead, Instantly, Success.ai)
 * and integrations (Notion).
 * - Stores encrypted API keys
 * - Tests connections
 * - Lists available campaigns / databases
 *
 * LeadConnector uses the existing GHL OAuth flow (ghl-oauth-init, oauth-callback).
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { encryptApiKey, decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

interface SmartleadCampaign {
  id: number;
  name: string;
  status: string;
  created_at: string;
}

interface InstantlyCampaign {
  id: string;
  name: string;
  status: number;
  timestamp_created: string;
}

interface SuccessAiCampaign {
  // API may return either format depending on version
  campaignId?: string;
  campaignName?: string;
  id?: string;
  name?: string;
  description?: string;
}

/**
 * Test connection to Smartlead by fetching campaigns
 */
async function testSmartleadConnection(
  apiKey: string
): Promise<{ success: boolean; campaigns?: SmartleadCampaign[]; error?: string }> {
  try {
    const response = await fetch(
      `https://server.smartlead.ai/api/v1/campaigns?api_key=${apiKey}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Smartlead API error: ${response.status} - ${errorText}`,
      };
    }

    const campaigns = await response.json();
    return { success: true, campaigns: campaigns || [] };
  } catch (error) {
    return {
      success: false,
      error: `Failed to connect to Smartlead: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test connection to Instantly by fetching campaigns
 */
async function testInstantlyConnection(
  apiKey: string
): Promise<{ success: boolean; campaigns?: InstantlyCampaign[]; error?: string }> {
  try {
    const response = await fetch(
      `https://api.instantly.ai/api/v2/campaigns?limit=100`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Instantly API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();
    return { success: true, campaigns: data.items || data || [] };
  } catch (error) {
    return {
      success: false,
      error: `Failed to connect to Instantly: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test connection to Success.ai by authenticating and fetching campaigns
 */
async function testSuccessAiConnection(
  apiKey: string
): Promise<{ success: boolean; campaigns?: SuccessAiCampaign[]; error?: string }> {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };

    // First, test authentication
    const authResponse = await fetch(
      'https://api.success.ai/v1/authenticate',
      { method: 'GET', headers }
    );

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      return {
        success: false,
        error: `Success.ai authentication failed: ${authResponse.status} - ${errorText}`,
      };
    }

    // Fetch campaigns list
    const campaignsResponse = await fetch(
      'https://api.success.ai/v1/campaign/list?limit=50&skip=0',
      { method: 'GET', headers }
    );

    if (!campaignsResponse.ok) {
      const errorText = await campaignsResponse.text();
      return {
        success: false,
        error: `Success.ai campaigns fetch failed: ${campaignsResponse.status} - ${errorText}`,
      };
    }

    const rawResponse = await campaignsResponse.json();
    console.log('[Success.ai] Raw campaigns response type:', typeof rawResponse, 'isArray:', Array.isArray(rawResponse));
    if (Array.isArray(rawResponse) && rawResponse.length > 0) {
      console.log('[Success.ai] First campaign keys:', Object.keys(rawResponse[0]));
    } else if (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)) {
      console.log('[Success.ai] Response is object with keys:', Object.keys(rawResponse));
    }

    // Handle both array and wrapped responses
    const campaigns = Array.isArray(rawResponse)
      ? rawResponse
      : Array.isArray(rawResponse?.data)
        ? rawResponse.data
        : Array.isArray(rawResponse?.campaigns)
          ? rawResponse.campaigns
          : [];

    return { success: true, campaigns };
  } catch (error) {
    return {
      success: false,
      error: `Failed to connect to Success.ai: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

interface NotionDatabase {
  id: string;
  name: string;
}

/**
 * Test connection to Notion by verifying the token and listing databases
 */
async function testNotionConnection(
  apiKey: string
): Promise<{ success: boolean; databases?: NotionDatabase[]; error?: string }> {
  try {
    // Verify token by fetching the bot user
    const userRes = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!userRes.ok) {
      const errorText = await userRes.text();
      return {
        success: false,
        error: `Notion authentication failed: ${userRes.status} - ${errorText}`,
      };
    }

    // List databases the integration has access to
    // Notion API renamed 'database' → 'data_source' in recent versions
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter: { property: 'object', value: 'data_source' } }),
    });

    if (!searchRes.ok) {
      // Token works but search failed — still a success, just no databases found
      console.warn('Notion search failed:', searchRes.status);
      return { success: true, databases: [] };
    }

    const searchData = await searchRes.json();
    console.log('[Notion] Search response: results count =', searchData.results?.length, 'has_more =', searchData.has_more);
    if (searchData.results?.length > 0) {
      console.log('[Notion] First result object type:', searchData.results[0].object, 'id:', searchData.results[0].id);
      console.log('[Notion] First result title:', JSON.stringify(searchData.results[0].title));
    } else {
      console.log('[Notion] No results returned. Full response keys:', Object.keys(searchData));
    }
    const databases: NotionDatabase[] = (searchData.results || []).map(
      (db: { id: string; title?: Array<{ plain_text?: string }> }) => ({
        id: db.id,
        name: db.title?.[0]?.plain_text || 'Untitled',
      })
    );
    console.log('[Notion] Parsed databases:', JSON.stringify(databases));

    return { success: true, databases };
  } catch (error) {
    return {
      success: false,
      error: `Failed to connect to Notion: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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

    // Get auth header for user verification
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const url = new URL(req.url);
    const method = req.method;

    // =========================================================================
    // POST: Create or update connection
    // =========================================================================
    if (method === 'POST') {
      const body = await req.json();
      const { organizationId, toolType, name, apiKey, defaultCampaignId } = body;

      if (!organizationId || !toolType || !name || !apiKey) {
        throw new Error('Missing required fields: organizationId, toolType, name, apiKey');
      }

      if (!['smartlead', 'instantly', 'successai', 'notion'].includes(toolType)) {
        throw new Error('Invalid toolType. Must be "smartlead", "instantly", "successai", or "notion"');
      }

      // Verify user has access to organization
      const { data: membership, error: membershipError } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .single();

      if (membershipError || !membership) {
        throw new Error('You do not have access to this organization');
      }

      // Test the connection first
      let testResult: { success: boolean; campaigns?: unknown[]; databases?: NotionDatabase[]; error?: string };
      if (toolType === 'smartlead') {
        testResult = await testSmartleadConnection(apiKey);
      } else if (toolType === 'instantly') {
        testResult = await testInstantlyConnection(apiKey);
      } else if (toolType === 'notion') {
        testResult = await testNotionConnection(apiKey);
      } else {
        testResult = await testSuccessAiConnection(apiKey);
      }

      if (!testResult.success) {
        return new Response(
          JSON.stringify({
            success: false,
            error: testResult.error,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Encrypt the API key
      const encryptedApiKey = await encryptApiKey(apiKey, encryptionKey);

      // Upsert the connection
      const { data: connection, error: upsertError } = await supabase
        .from('email_tool_connections')
        .upsert(
          {
            organization_id: organizationId,
            tool_type: toolType,
            name,
            api_key_encrypted: encryptedApiKey,
            default_campaign_id: defaultCampaignId || null,
            status: 'active',
            last_verified_at: new Date().toISOString(),
            error_message: null,
          },
          {
            onConflict: 'organization_id,tool_type,name',
          }
        )
        .select()
        .single();

      if (upsertError) {
        throw new Error(`Failed to save connection: ${upsertError.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          connection: {
            id: connection.id,
            toolType: connection.tool_type,
            name: connection.name,
            status: connection.status,
            lastVerifiedAt: connection.last_verified_at,
            defaultCampaignId: connection.default_campaign_id,
          },
          // Notion returns databases instead of campaigns
          campaigns: testResult.campaigns,
          databases: testResult.databases,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // =========================================================================
    // GET: List connections or fetch campaigns
    // =========================================================================
    if (method === 'GET') {
      const organizationId = url.searchParams.get('organizationId');
      const connectionId = url.searchParams.get('connectionId');
      const action = url.searchParams.get('action'); // 'campaigns' to fetch campaigns

      if (!organizationId) {
        throw new Error('Missing organizationId parameter');
      }

      // Verify user has access to organization
      const { data: membership, error: membershipError } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .single();

      if (membershipError || !membership) {
        throw new Error('You do not have access to this organization');
      }

      // Fetch campaigns/databases for a specific connection
      if (connectionId && (action === 'campaigns' || action === 'databases')) {
        const { data: connection, error: connectionError } = await supabase
          .from('email_tool_connections')
          .select('*')
          .eq('id', connectionId)
          .eq('organization_id', organizationId)
          .single();

        if (connectionError || !connection) {
          throw new Error('Connection not found');
        }

        // Decrypt API key
        let apiKey: string;
        try {
          apiKey = await decryptApiKey(connection.api_key_encrypted, encryptionKey);
        } catch (decryptErr) {
          // Mark connection as needing re-authentication
          await supabase
            .from('email_tool_connections')
            .update({ status: 'error', error_message: 'API key decryption failed. Please delete and re-add this connection.' })
            .eq('id', connectionId);
          throw new Error('Connection credentials expired. Please delete this connection in Settings → Integrations and re-add it.');
        }

        // Notion connections return databases
        if (connection.tool_type === 'notion') {
          const result = await testNotionConnection(apiKey);
          return new Response(
            JSON.stringify({ success: true, databases: result.databases || [] }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Email tool connections return campaigns
        let campaigns;
        if (connection.tool_type === 'smartlead') {
          const result = await testSmartleadConnection(apiKey);
          campaigns = result.campaigns || [];
        } else if (connection.tool_type === 'instantly') {
          const result = await testInstantlyConnection(apiKey);
          campaigns = result.campaigns || [];
        } else {
          const result = await testSuccessAiConnection(apiKey);
          // Normalize Success.ai campaign format to match others
          // API may return {campaignId, campaignName} or {id, name}
          campaigns = (result.campaigns || []).map((c: SuccessAiCampaign) => ({
            id: c.campaignId || c.id || '',
            name: c.campaignName || c.name || 'Unnamed Campaign',
          }));
          console.log(`[Success.ai] Normalized ${campaigns.length} campaigns`);
        }

        return new Response(
          JSON.stringify({ success: true, campaigns }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // List all connections for organization
      const { data: connections, error: listError } = await supabase
        .from('email_tool_connections')
        .select('id, tool_type, name, status, last_verified_at, default_campaign_id, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (listError) {
        throw new Error(`Failed to fetch connections: ${listError.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, connections }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // =========================================================================
    // DELETE: Remove connection
    // =========================================================================
    if (method === 'DELETE') {
      const connectionId = url.searchParams.get('connectionId');
      const organizationId = url.searchParams.get('organizationId');

      if (!connectionId || !organizationId) {
        throw new Error('Missing connectionId or organizationId');
      }

      // Verify user has access to organization
      const { data: membership, error: membershipError } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .single();

      if (membershipError || !membership) {
        throw new Error('You do not have access to this organization');
      }

      // Nullify references in lead_handoffs first (in case FK lacks ON DELETE SET NULL)
      await supabase
        .from('lead_handoffs')
        .update({ connection_id: null })
        .eq('connection_id', connectionId);

      const { error: deleteError } = await supabase
        .from('email_tool_connections')
        .delete()
        .eq('id', connectionId)
        .eq('organization_id', organizationId);

      if (deleteError) {
        throw new Error(`Failed to delete connection: ${deleteError.message}`);
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Email tool connect error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
