import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { fetchChatCompletions, hasOllamaKey, isOllamaModel, isAlibabaModel } from '../_shared/llm-client.ts';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { loadOrCreateToneProfile } from '../_shared/ai-reply-drafter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CommentAiDraftRequest {
  commentText: string;
  commenterName: string;
  commenterHeadline?: string;
  postUrl?: string;
  matchedKeyword?: string;
  direction?: string;
}

const DRAFTER_TIMEOUT_MS = 15_000;

/**
 * Comment AI Draft Edge Function
 *
 * Generates an AI-powered reply draft for a social media comment.
 * Uses commenter context, user tone profile, and optional direction.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Get org's OpenRouter API key
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'openrouter')
      .single();

    if ((apiKeyError || !apiKeyData?.key_encrypted) && !(await hasOllamaKey(supabase, organizationId))) {
      return new Response(JSON.stringify({
        error: 'OpenRouter API key not configured. Please add your API key in Settings.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let openRouterApiKey: string | undefined;
    try {
      openRouterApiKey = apiKeyData?.key_encrypted ? await decryptApiKey(apiKeyData.key_encrypted, encryptionKey!) : undefined;
    } catch {
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

    const body: CommentAiDraftRequest = await req.json();

    if (!body.commentText || !body.commenterName) {
      return new Response(JSON.stringify({
        error: 'Missing required fields',
        required: ['commentText', 'commenterName'],
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const effectiveModel = orgSettings?.default_llm_model || DEFAULT_FAST_TEXT_MODEL;

    // Load user's tone profile (reuses the shared module)
    const { toneSummary } = await loadOrCreateToneProfile(
      supabase,
      user.id,
      organizationId,
      'linkedin', // comment replies are social media
      openRouterApiKey ?? '',
      effectiveModel,
    );

    // Build commenter context
    const commenterParts: string[] = [`Name: ${body.commenterName}`];
    if (body.commenterHeadline) commenterParts.push(`Headline: ${body.commenterHeadline}`);
    if (body.matchedKeyword) commenterParts.push(`Matched Keyword: ${body.matchedKeyword}`);
    const commenterContext = commenterParts.join('\n');

    const directionBlock = body.direction
      ? `\nDIRECTION (the user wants the reply to achieve this goal):\n${body.direction}\n`
      : '';

    const systemPrompt = `You are a social media comment reply ghostwriter. Draft a natural, engaging reply to the comment below.

COMMENTER CONTEXT:
${commenterContext}

TONE REFERENCE (match this writing style):
${toneSummary}
${directionBlock}
RULES:
1. Address the commenter's message directly and naturally
2. Match the tone reference — same level of formality, greeting style, emoji usage
3. Be concise — 1-3 sentences, appropriate for a social media comment reply
4. Sound human and authentic, not robotic or overly corporate
5. If the comment is a question, answer it helpfully
6. If the comment shows interest (matched a keyword), acknowledge their interest naturally
7. Never fabricate facts or make specific claims
8. Do not use hashtags unless the tone reference shows the user typically does

Return ONLY the reply text. No JSON, no markdown, no explanation.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Comment from ${body.commenterName}:\n"${body.commentText}"${body.postUrl ? `\n\n(On post: ${body.postUrl})` : ''}\n\nDraft a reply to this comment.` },
    ];

    // max_tokens is the budget for EVERYTHING the model emits, and on a
    // reasoning model (grok, qwen3.x, o-series…) the thinking pass is billed
    // against it first — see ai-reply-drafter.ts's draftReply() for the same
    // fix applied to inbox replies. Cap the thinking pass on OpenRouter and
    // retry once with a bigger budget if it still gets cut off.
    const isOpenRouterModel = !isOllamaModel(effectiveModel) && !isAlibabaModel(effectiveModel);
    const reasoningCap = isOpenRouterModel ? { reasoning: { effort: 'low' as const } } : {};

    let draft = '';
    let finishReason: string | undefined;
    let maxTokens = 300;

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DRAFTER_TIMEOUT_MS);

      try {
        const response = await fetchChatCompletions({
          model: effectiveModel,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
          ...reasoningCap,
        }, {
          openRouterApiKey,
          supabase,
          organizationId,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0];
        finishReason = choice?.finish_reason;
        draft = sanitizeAIOutput(choice?.message?.content?.trim() || '');

        if (draft && finishReason !== 'length') break;

        console.warn('[Comment AI Draft] Truncated/empty response:', JSON.stringify({
          attempt, maxTokens, finishReason, hasDraft: !!draft, usage: data.usage, model: effectiveModel,
        }));
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Reply drafting timed out');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (attempt === 0) maxTokens = Math.min(2000, maxTokens * 4);
    }

    if (!draft) {
      throw new Error(finishReason === 'length'
        ? `${effectiveModel} used its entire ${maxTokens}-token output budget on reasoning before writing a reply, even after a retry with a larger budget. Pick a model with a smaller reasoning pass in Settings → AI Models.`
        : `${effectiveModel} returned an empty response${finishReason ? ` (finish_reason: ${finishReason})` : ''}.`);
    }

    return new Response(JSON.stringify({ draft, toneUsed: toneSummary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Comment AI Draft] Error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
