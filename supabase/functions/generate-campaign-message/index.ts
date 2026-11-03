/**
 * Generate Campaign Message Edge Function
 *
 * Uses AI to craft personalized campaign messages with {{variables}}.
 * The generated message will work across all contacts in a lead list
 * because it uses variables that get replaced per-contact.
 *
 * Endpoint: POST /generate-campaign-message
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { isOllamaModel, resolveOllamaConfig, resolveChatEndpoint, type ChatEndpoint } from '../_shared/llm-client.ts';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type MessageType = 'connectionRequest' | 'message' | 'inmail' | 'email' | 'emailSequence';
type TonePreference = 'formal' | 'casual' | 'friendly' | 'professional';

interface GenerateCampaignMessageRequest {
  messageType: MessageType;
  context?: {
    userOffering?: string;
    campaignGoal?: string;
    tonePreference?: TonePreference;
  };
  sampleEnrichment?: Record<string, unknown>;
  existingMessage?: string;
  userPrompt?: string;
  generateVariations?: boolean;
  model?: string;
  temperature?: number;
}

interface GenerateCampaignMessageResponse {
  message: string;
  variations?: string[];
  usedVariables: string[];
  characterCount: number;
}

// Character limits by message type
const CHARACTER_LIMITS: Record<MessageType, number> = {
  connectionRequest: 300,
  message: 8000,
  inmail: 1900,
  email: 5000,
  emailSequence: 5000,
};

// Available variables for the AI to use
const AVAILABLE_VARIABLES = {
  contact: [
    { key: '{{first_name}}', description: "Contact's first name" },
    { key: '{{last_name}}', description: "Contact's last name" },
    { key: '{{full_name}}', description: "Contact's full name" },
    { key: '{{position}}', description: "Contact's job title" },
    { key: '{{company}}', description: "Contact's company name" },
    { key: '{{location}}', description: "Contact's location" },
    { key: '{{industry}}', description: "Contact's industry" },
  ],
  ai_analysis: [
    { key: '{{ai_primary_need}}', description: "What they need most (AI-analyzed, unconfirmed hypothesis)" },
    { key: '{{ai_primary_need_reason}}', description: "Why this need fits them" },
    { key: '{{ai_primary_need_evidence}}', description: "The observed fact the need hypothesis is grounded in" },
    { key: '{{ai_primary_need_confidence}}', description: "How directly the evidence supports the need (low/medium/high)" },
    { key: '{{ai_cold_email_angle}}', description: "AI writer guidance on what's safe to ask/reference and what not to imply - an instruction, not send-ready copy" },
    { key: '{{ai_company_niche}}', description: "Specific niche (e.g., AI-powered HR software)" },
    { key: '{{ai_company_offering}}', description: "What they sell" },
    { key: '{{ai_company_target}}', description: "Who their customers are" },
    { key: '{{ai_company_tagline}}', description: "Their value proposition" },
    { key: '{{ai_best_hook}}', description: "Icebreaker from their LinkedIn" },
    { key: '{{ai_linkedin_topic_1}}', description: "Topic they post about" },
    { key: '{{ai_priority_1}}', description: "Their top priority" },
    { key: '{{ai_growth_signal_1}}', description: "Top growth signal" },
    { key: '{{ai_latest_funding}}', description: "Series X info" },
    { key: '{{ai_funding_amount}}', description: "Dollar amount raised" },
  ],
  sender: [
    { key: '{{sender_name}}', description: "Your sender account name" },
    { key: '{{sender_first_name}}', description: "Your sender first name" },
    { key: '{{sender_last_name}}', description: "Your sender last name" },
  ],
};

function buildSystemPrompt(messageType: MessageType, charLimit: number, tone: TonePreference): string {
  const toneDescriptions: Record<TonePreference, string> = {
    formal: 'professional and business-like, using proper salutations and polished language',
    casual: 'relaxed and conversational, like messaging a colleague',
    friendly: 'warm and approachable, personable yet professional',
    professional: 'confident and direct, focused on value delivery',
  };

  const typeGuidelines: Record<MessageType, string> = {
    connectionRequest: `This is a LinkedIn CONNECTION REQUEST. It must:
- Be extremely concise (under 300 characters!)
- Focus on ONE compelling reason to connect
- NOT be salesy - just establish relevance
- End with a soft reason to connect (shared interest, mutual benefit)`,

    message: `This is a LinkedIn MESSAGE (already connected). It can:
- Be more detailed and conversational
- Include a clear value proposition
- End with a specific, low-friction CTA`,

    inmail: `This is a LinkedIn INMAIL (cold outreach). It should:
- Open with a personalized hook
- Establish credibility quickly
- Present a clear value proposition
- End with a specific but low-pressure CTA`,

    email: `This is a cold EMAIL. It should:
- Have a strong personalized opening line
- Get to the point quickly
- Provide social proof or credibility
- End with a clear call-to-action`,

    emailSequence: `This is a multi-email COLD EMAIL SEQUENCE. It should:
- Generate a single compelling email (part of a larger sequence)
- Have a strong personalized opening line
- Get to the point quickly
- Each email in the sequence has a different angle/hook
- Include a clear call-to-action
- Be suitable for automated cold outreach`,
  };

  const variablesSection = [
    '**Contact Variables:**',
    ...AVAILABLE_VARIABLES.contact.map(v => `- ${v.key}: ${v.description}`),
    '',
    '**AI Analysis Variables (for personalization):**',
    ...AVAILABLE_VARIABLES.ai_analysis.map(v => `- ${v.key}: ${v.description}`),
    '',
    '**Sender Variables:**',
    ...AVAILABLE_VARIABLES.sender.map(v => `- ${v.key}: ${v.description}`),
  ].join('\n');

  return `You are an expert B2B outreach copywriter who creates highly personalized messages.

**YOUR TASK**: Generate a ${messageType} message using template variables.

**CRITICAL RULES**:
0. NEVER use an em dash or an en dash. Use a plain hyphen, a comma, or a full stop. Em dashes are the clearest tell that a message was written by AI, and these go to real prospects.
1. Use {{variables}} for personalization - these get replaced per-contact
2. Keep the message under ${charLimit} characters
3. NEVER use generic phrases like:
   - "I came across your profile"
   - "I hope this message finds you well"
   - "I noticed you work at..."
4. Make every word count - no fluff
5. Sound human, not like a template

**TONE**: ${toneDescriptions[tone]}

**MESSAGE TYPE GUIDELINES**:
${typeGuidelines[messageType]}

**AVAILABLE VARIABLES**:
${variablesSection}

**OUTPUT FORMAT**:
Return ONLY the message text. Do not include:
- "Here's the message:" or similar preamble
- Quotation marks around the message
- Any explanation or commentary
- Subject line (unless email type, then include as first line)

Just the message, ready to use.`;
}

function countCharacters(message: string): number {
  // Estimate character count with variables replaced
  const variableLengths: Record<string, number> = {
    '{{first_name}}': 6,
    '{{last_name}}': 7,
    '{{full_name}}': 14,
    '{{position}}': 15,
    '{{company}}': 12,
    '{{location}}': 18,
    '{{industry}}': 12,
    '{{sender_name}}': 12,
    '{{sender_first_name}}': 6,
    '{{sender_last_name}}': 7,
    '{{ai_primary_need}}': 50,
    '{{ai_primary_need_reason}}': 60,
    '{{ai_primary_need_evidence}}': 60,
    '{{ai_primary_need_confidence}}': 6,
    '{{ai_cold_email_angle}}': 55,
    '{{ai_company_niche}}': 30,
    '{{ai_company_offering}}': 40,
    '{{ai_company_target}}': 35,
    '{{ai_company_tagline}}': 40,
    '{{ai_best_hook}}': 60,
    '{{ai_linkedin_topic_1}}': 20,
    '{{ai_priority_1}}': 30,
    '{{ai_growth_signal_1}}': 25,
    '{{ai_latest_funding}}': 10,
    '{{ai_funding_amount}}': 8,
  };

  let count = message.length;
  for (const [variable, avgLength] of Object.entries(variableLengths)) {
    const regex = new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g');
    const matches = message.match(regex) || [];
    count = count - (variable.length * matches.length) + (avgLength * matches.length);
  }

  return count;
}

function extractUsedVariables(message: string): string[] {
  const allVariables = [
    ...AVAILABLE_VARIABLES.contact,
    ...AVAILABLE_VARIABLES.ai_analysis,
    ...AVAILABLE_VARIABLES.sender,
  ];

  return allVariables
    .filter(v => message.includes(v.key))
    .map(v => v.key);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Get auth header and verify user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

    // Create client with user's auth token
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get user's organization
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's organization (use limit(1) since user may belong to multiple orgs)
    const { data: memberships } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1);

    const membership = memberships?.[0];

    if (!membership) {
      return new Response(
        JSON.stringify({ success: false, error: 'No organization found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: GenerateCampaignMessageRequest = await req.json();
    const {
      messageType,
      context,
      sampleEnrichment,
      existingMessage,
      userPrompt,
      generateVariations = false,
    } = body;

    if (!messageType) {
      return new Response(
        JSON.stringify({ success: false, error: 'messageType is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const charLimit = CHARACTER_LIMITS[messageType];
    const tone = context?.tonePreference || 'professional';

    // Resolve the LLM endpoint: Ollama models route to the org's Ollama
    // server; everything else needs the org's OpenRouter key.
    let chatEndpoint: ChatEndpoint;
    if (isOllamaModel(body.model || '')) {
      const ollamaConfig = await resolveOllamaConfig(supabase, membership.organization_id);
      if (!ollamaConfig) {
        return new Response(
          JSON.stringify({ success: false, error: 'Ollama is not configured for this organization' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      chatEndpoint = await resolveChatEndpoint({ model: body.model!, ollamaConfig });
    } else {
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', membership.organization_id)
        .eq('provider', 'openrouter')
        .single();

      if (!apiKeyData) {
        return new Response(
          JSON.stringify({ success: false, error: 'OpenRouter API key not configured. Please add it in Settings > API Keys.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      chatEndpoint = await resolveChatEndpoint({ model: body.model || '', openRouterApiKey: openRouterKey, referer: supabaseUrl });
    }

    // Build the user prompt
    let userMessageContent = '';

    if (existingMessage) {
      userMessageContent = `Improve this existing message while keeping its intent:\n\n"${existingMessage}"\n\n`;
    }

    if (context?.campaignGoal) {
      userMessageContent += `Campaign Goal: ${context.campaignGoal}\n`;
    }

    if (context?.userOffering) {
      userMessageContent += `What I'm offering: ${context.userOffering}\n`;
    }

    if (sampleEnrichment && Object.keys(sampleEnrichment).length > 0) {
      userMessageContent += `\nSample contact data (for reference on what AI variables will contain):\n${JSON.stringify(sampleEnrichment, null, 2)}\n`;
    }

    if (userPrompt) {
      userMessageContent += `\nAdditional instructions: ${userPrompt}\n`;
    }

    if (!userMessageContent.trim()) {
      userMessageContent = `Generate a compelling ${messageType} message for B2B outreach.`;
    }

    userMessageContent += `\n\nRemember: Keep under ${charLimit} characters. Use {{variables}} for personalization.`;

    const systemPrompt = buildSystemPrompt(messageType, charLimit, tone);

    if (!body.model) {
      return new Response(
        JSON.stringify({ success: false, error: 'No model selected. Please choose a model from the list.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const selectedModel = body.model;
    const selectedTemperature = body.temperature ?? 0.7;

    console.log('Generating campaign message:', { messageType, tone, charLimit, model: selectedModel });

    // Generate the message
    const aiResponse = await fetch(chatEndpoint.url, {
      method: 'POST',
      headers: chatEndpoint.headers,
      body: JSON.stringify({
        model: chatEndpoint.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessageContent }
        ],
        temperature: selectedTemperature,
        max_tokens: 1000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('OpenRouter error:', aiResponse.status, errorText);
      let userError = 'AI generation failed. Please try again.';
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.error?.message) {
          userError = `AI error: ${parsed.error.message}`;
        }
      } catch { /* ignore parse errors */ }
      if (aiResponse.status === 401) {
        userError = 'Invalid OpenRouter API key. Please check your API key in Settings.';
      } else if (aiResponse.status === 402) {
        userError = 'Insufficient OpenRouter credits. Please add credits to your account.';
      } else if (aiResponse.status === 429) {
        userError = 'Rate limited by AI provider. Please wait a moment and try again.';
      }
      return new Response(
        JSON.stringify({ success: false, error: userError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    let message = sanitizeAIOutput(aiData.choices?.[0]?.message?.content?.trim() || '');

    // Clean up the message (remove any quotes or preamble)
    message = message.replace(/^["']|["']$/g, '');

    // Generate variations if requested
    let variations: string[] | undefined;
    if (generateVariations) {
      const variationPrompt = `Generate 2 alternative versions of this message with different angles/hooks:\n\n"${message}"\n\nRules:\n- Keep each under ${charLimit} characters\n- Use the same {{variables}}\n- Change the hook or approach\n- Maintain the same overall intent\n\nReturn exactly 2 variations, separated by "---" on its own line.`;

      const variationResponse = await fetch(chatEndpoint.url, {
        method: 'POST',
        headers: chatEndpoint.headers,
        body: JSON.stringify({
          model: chatEndpoint.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: variationPrompt }
          ],
          temperature: Math.min(selectedTemperature + 0.1, 1.0),
          max_tokens: 2000,
        }),
      });

      if (variationResponse.ok) {
        const variationData = await variationResponse.json();
        const variationContent = variationData.choices?.[0]?.message?.content?.trim() || '';
        variations = variationContent
          .split('---')
          .map((v: string) => sanitizeAIOutput(v.trim()))
          .filter((v: string) => v.length > 0 && v.length < charLimit * 1.5);
      }
    }

    const response: GenerateCampaignMessageResponse = {
      message,
      variations,
      usedVariables: extractUsedVariables(message),
      characterCount: countCharacters(message),
    };

    console.log('Message generated:', {
      length: message.length,
      estimatedChars: response.characterCount,
      variablesUsed: response.usedVariables.length,
      hasVariations: !!variations,
    });

    return new Response(
      JSON.stringify({ success: true, ...response }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating campaign message:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
