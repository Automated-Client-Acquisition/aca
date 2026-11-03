import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { draftReply } from '../_shared/ai-reply-drafter.ts';
import { hasOllamaKey } from '../_shared/llm-client.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InboxAiDraftRequest {
  conversationId: string;
  contactId: string;
  channel: string;
  direction?: string;
}

/**
 * Inbox AI Draft Edge Function
 *
 * Generates an AI-powered reply draft for a conversation using the
 * shared ai-reply-drafter module. Requires user authentication.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

  // Authenticate user from Bearer token
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace('Bearer ', '');

  // Create a service role client for database operations
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Verify the user token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    // Get org's OpenRouter API key (encrypted, per-org "bring your own key")
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'openrouter')
      .single();

    if ((apiKeyError || !apiKeyData?.key_encrypted) && !(await hasOllamaKey(supabase, organizationId))) {
      return new Response(JSON.stringify({
        error: 'OpenRouter API key not configured. Please add your API key in Settings → API Keys.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let openRouterApiKey: string;
    try {
      openRouterApiKey = apiKeyData?.key_encrypted ? await decryptApiKey(apiKeyData.key_encrypted, encryptionKey!) : '';
    } catch (decryptError) {
      console.error('[Inbox AI Draft] Failed to decrypt OpenRouter API key:', decryptError);
      return new Response(JSON.stringify({
        error: 'Failed to decrypt API key. Please re-add your OpenRouter API key in Settings.',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get org's default LLM model
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', organizationId)
      .maybeSingle();

    // Parse request body
    const body: InboxAiDraftRequest = await req.json();

    if (!body.conversationId || !body.contactId || !body.channel) {
      return new Response(JSON.stringify({
        error: 'Missing required fields',
        required: ['conversationId', 'contactId', 'channel'],
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify conversation belongs to the user's organization
    const { data: conversation, error: convError } = await supabase
      .from('crm_conversations')
      .select('id, organization_id, metadata')
      .eq('id', body.conversationId)
      .eq('organization_id', organizationId)
      .single();

    if (convError || !conversation) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load agent profile KB config if conversation has one assigned
    let useKnowledgeBase: boolean | undefined;
    let knowledgeDocumentIds: string[] | undefined;

    const metadata = (conversation.metadata || {}) as Record<string, unknown>;
    const autopilotConfig = metadata.autopilot_config as Record<string, unknown> | undefined;

    if (autopilotConfig) {
      useKnowledgeBase = autopilotConfig.use_knowledge_base as boolean | undefined;
      const docIds = autopilotConfig.knowledge_document_ids as string[] | undefined;
      if (docIds?.length) {
        knowledgeDocumentIds = docIds;
      }
    }

    // Generate AI draft via shared module
    console.log(`[Inbox AI Draft] Generating draft for conversation ${body.conversationId}`);

    const result = await draftReply(
      supabase,
      {
        conversationId: body.conversationId,
        contactId: body.contactId,
        channel: body.channel,
        userId: user.id,
        organizationId,
        model: orgSettings?.default_llm_model || undefined,
        direction: body.direction || undefined,
        useKnowledgeBase,
        knowledgeDocumentIds,
      },
      openRouterApiKey,
    );

    console.log(`[Inbox AI Draft] Draft generated (${result.outputTokens} tokens)`);

    return new Response(JSON.stringify({
      draft: result.draft,
      toneUsed: result.toneUsed,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Inbox AI Draft] Error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
