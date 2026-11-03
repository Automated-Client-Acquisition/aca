/**
 * Edge Function: Test Agent Profile
 *
 * Simulates a multi-turn conversation with an AI agent profile.
 * No real CRM records are created — everything is ephemeral.
 * The frontend sends the full conversation history each turn (stateless backend).
 *
 * Input: { agentProfileId, messages, contactContext?, channel? }
 *   messages[].kind = 'campaign' marks the message the campaign sent first (e.g. the
 *   DBR text): it is our side of the thread but not an agent reply.
 * Output: { classification, matchedRule, escalation, reply, action, phase, delivery,
 *           explanation, agent }
 *   delivery says what production would do with the reply: auto_send, draft (waits
 *   for approval), escalated, stopped, snoozed or no_action.
 *
 * Mirrors processAutopilot's decisions (rule match, confidence threshold, max
 * replies, escalation, require_approval) and generateAgentDraft's prompt. Not
 * applied here: the owner's tone profile and stored goal progress.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { classifyReply, type ClassificationResult } from '../_shared/reply-classifier.ts';
import {
  shouldEscalate,
  normalizeAgentConfig,
  type AutopilotConfig,
  type AutopilotConversationState,
} from '../_shared/conversation-autopilot.ts';
import { buildContactContext, buildChatMessages } from '../_shared/ai-reply-drafter.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { retrieveOrgChunks, retrieveChunksByDocIds, formatKnowledgeContext } from '../_shared/knowledge-retrieval.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DRAFTER_TIMEOUT_MS = 20_000;

interface TestMessage {
  role: 'lead' | 'agent';
  content: string;
  kind?: 'campaign';
}

type Delivery = 'auto_send' | 'draft' | 'escalated' | 'stopped' | 'snoozed' | 'no_action';

interface TestRequest {
  agentProfileId: string;
  messages: TestMessage[];
  contactContext?: {
    firstName?: string;
    lastName?: string;
    company?: string;
    jobTitle?: string;
  };
  channel?: string;
}

const CHANNEL_HINTS: Record<string, string> = {
  email: `This is an email conversation. Write your reply as a proper email body:
- Use a brief greeting (e.g. "Hi [Name],") and sign off naturally
- Write in full sentences with proper paragraphs
- Be professional but warm`,
  linkedin: `This is a LinkedIn DM conversation. Write your reply as a chat message:
- No greeting or sign-off needed unless it's a first message
- Keep it to 1-3 sentences, professional but conversational`,
  instagram: `This is an Instagram DM conversation. Write your reply as a chat message:
- Very casual and friendly tone, 1-2 sentences max`,
  whatsapp: `This is a WhatsApp conversation. Write your reply as a chat message:
- Short and direct, 1-3 sentences, conversational tone`,
  telegram: `This is a Telegram conversation. Write your reply as a chat message:
- Concise and direct, 1-2 sentences, casual tone`,
  sms: `This is an SMS conversation. Write your reply as a text message:
- Very short, 1-2 sentences max, direct and to the point`,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth: verify caller's JWT
    const authHeader = req.headers.get('Authorization') || '';
    const userSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body: TestRequest = await req.json();
    const { agentProfileId, messages, contactContext, channel = 'email' } = body;

    if (!agentProfileId || !messages?.length) {
      return json({ error: 'agentProfileId and messages are required' }, 400);
    }

    // Load agent profile (scoped by org membership)
    const { data: profile } = await supabase
      .from('ai_agent_profiles')
      .select('id, organization_id, config')
      .eq('id', agentProfileId)
      .single();

    if (!profile) {
      return json({ error: 'Agent profile not found' }, 404);
    }

    // Verify user belongs to the profile's organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return json({ error: 'Access denied' }, 403);
    }

    const config = normalizeAgentConfig(profile.config);
    const orgId = profile.organization_id;

    // Load OpenRouter API key
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData) {
      return json({ error: 'No OpenRouter API key configured. Add one in Settings > API Keys.' }, 400);
    }

    const encKey = Deno.env.get('ENCRYPTION_KEY')!;
    const openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encKey);

    // Get the last lead message for classification
    const lastLeadMessage = [...messages].reverse().find((m) => m.role === 'lead');
    if (!lastLeadMessage) {
      return json({ error: 'No lead message found in conversation' }, 400);
    }

    // Build thread context from last 3 messages for better classification
    const threadContext = messages
      .slice(-3)
      .map((m) => `${m.role === 'lead' ? 'Them' : 'You'}: ${m.content}`)
      .join('\n');

    // 1. Classify the last lead message
    const classification: ClassificationResult = await classifyReply(
      {
        from_email: 'test@example.com',
        subject: '(test conversation)',
        body_text: lastLeadMessage.content,
        thread_context: threadContext,
      },
      openRouterKey,
    );

    // 2. Find matching rule (same logic as processAutopilot)
    const matchedRule =
      config.rules.find((r) => r.intent === classification.intent) ||
      (classification.intent === 'meeting_booked'
        ? config.rules.find((r) => r.intent === 'interested')
        : undefined) ||
      config.rules.find((r) => r.intent === 'neutral') ||
      null;

    // 3. Estimate conversation state from message count (the campaign's opening
    //    message is ours but not an agent reply)
    const agentTurnCount = messages.filter((m) => m.role === 'agent' && m.kind !== 'campaign').length;
    const estimatedState: AutopilotConversationState = {
      phase: agentTurnCount === 0 ? 'greeting' : agentTurnCount < 3 ? 'discovery' : 'qualification',
      turn_count: agentTurnCount,
      last_autopilot_at: new Date().toISOString(),
    };

    // 4. Check escalation
    const escalation = shouldEscalate(
      config,
      estimatedState,
      classification.intent,
      classification.confidence,
      lastLeadMessage.content,
    );

    // Determine action (same order as processAutopilot)
    let action = matchedRule?.action || 'none';
    let skipReason: string | null = null;
    const threshold = (matchedRule as { confidence_threshold?: number } | null)?.confidence_threshold;
    if (matchedRule && threshold != null && classification.confidence < threshold) {
      action = 'none';
      skipReason = `Confidence ${Math.round(classification.confidence * 100)}% is below this rule's ${Math.round(threshold * 100)}% threshold, so the agent stays quiet.`;
    }
    const bookingCapable = !!config.ghl_calendar_id;
    if (agentTurnCount >= config.max_auto_replies && !bookingCapable) {
      action = 'none';
      skipReason = `The agent already sent ${agentTurnCount} replies (its limit is ${config.max_auto_replies}), so it stops here and leaves the thread to you.`;
    }
    if (escalation.escalate) {
      action = 'escalate';
    }
    if (classification.intent === 'auto_reply' || classification.intent === 'do_not_contact') {
      action = 'stop';
    }

    const delivery: Delivery =
      action === 'stop' ? 'stopped'
      : action === 'escalate' ? 'escalated'
      : action === 'auto_followup_after_return' ? 'snoozed'
      : action === 'none' ? 'no_action'
      : action === 'draft_for_approval' ? 'draft'
      : config.require_approval ? 'draft' : 'auto_send';

    const explanation =
      delivery === 'auto_send' ? 'Live, this reply would be sent straight away.'
      : delivery === 'draft' ? (action === 'draft_for_approval'
          ? 'Live, this reply would wait in the inbox for your approval (the rule for this intent always drafts).'
          : 'Live, this reply would wait in the inbox for your approval ("Require approval" is on for this agent).')
      : delivery === 'escalated' ? `Live, the agent would hand this conversation to you${escalation.reason ? `: ${escalation.reason}` : ''}. Any reply below is only a suggested draft.`
      : delivery === 'stopped' ? 'Live, the agent would stop: this looks like an automatic reply or a request not to be contacted.'
      : delivery === 'snoozed' ? 'Live, the agent would wait until the contact is back, then follow up.'
      : skipReason ?? 'No rule matches this intent, so the agent would do nothing.';

    // 5. Generate reply (unless it's a stop/OOO action)
    let reply: string | null = null;

    if (action !== 'stop' && action !== 'auto_followup_after_return' && action !== 'none') {
      // Build contact context from provided data
      const contact = contactContext
        ? {
            first_name: contactContext.firstName || null,
            last_name: contactContext.lastName || null,
            company: contactContext.company || null,
            job_title: contactContext.jobTitle || null,
          }
        : null;
      const contactCtx = buildContactContext(contact);

      // Optional: Knowledge base retrieval
      let kbBlock = '';
      if (config.use_knowledge_base) {
        try {
          const searchQuery = messages
            .slice(-3)
            .map((m) => m.content)
            .join(' ')
            .slice(0, 500);

          if (searchQuery.trim()) {
            const kbResult = config.knowledge_document_ids?.length
              ? await retrieveChunksByDocIds(
                  supabase, orgId, config.knowledge_document_ids, searchQuery, openRouterKey, 3,
                )
              : await retrieveOrgChunks(supabase, orgId, searchQuery, openRouterKey, 3);
            if (kbResult.chunks.length > 0) {
              kbBlock = formatKnowledgeContext(kbResult.chunks) + '\n';
            }
          }
        } catch (e) {
          console.error('[test-agent] KB retrieval failed:', e);
        }
      }

      const channelHint =
        CHANNEL_HINTS[channel] ||
        `This is a ${channel} messaging conversation. Write your reply as a chat message — keep it short, conversational, 1-3 sentences.`;

      const systemPrompt = `You are an AI assistant replying in a ${channel} conversation.

CHANNEL: ${channelHint}

CONTACT CONTEXT:
${contactCtx}

CONVERSATION PHASE: ${estimatedState.phase} (turn ${estimatedState.turn_count + 1})

${kbBlock}GOAL: ${config.conversation_goal || 'Help the contact and guide toward a productive outcome'}

ADDITIONAL INSTRUCTIONS:
${config.system_instructions || '(none)'}

RULES:
1. Your reply MUST directly address what the contact said in their latest message
2. Ground your reply in the actual conversation history
3. Steer toward the GOAL naturally
4. Follow the CHANNEL formatting guidance above
5. Use KNOWLEDGE BASE facts when relevant — never fabricate information
6. ${config.ghl_calendar_id
        ? 'When scheduling is discussed, DO NOT confirm bookings — say you\'ll check availability.'
        : 'NEVER agree to specific meeting times — you don\'t have calendar access. Suggest the contact connect with the team for scheduling.'}
7. Never share pricing unless explicitly instructed
8. Return ONLY the reply text — no JSON, no explanation, no signatures

After the conversation messages below, draft the next reply.`;

      // Convert test messages to the format buildChatMessages expects
      const threadMessages = messages.map((m) => ({
        content: m.content,
        sender_type: m.role === 'agent' ? (m.kind === 'campaign' ? 'automation' : 'user') : 'contact',
      }));

      const chatMessages = buildChatMessages(threadMessages, systemPrompt);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DRAFTER_TIMEOUT_MS);

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: DEFAULT_FAST_TEXT_MODEL,
            messages: chatMessages,
            temperature: 0.7,
            max_tokens: 600,
          }),
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await response.json();
          const raw = data.choices?.[0]?.message?.content?.trim();
          reply = raw ? sanitizeAIOutput(raw) : null;
        } else {
          console.error('[test-agent] LLM error:', await response.text());
        }
      } catch (e) {
        console.error('[test-agent] Draft generation error:', e);
      } finally {
        clearTimeout(timeout);
      }
    }

    return json({
      classification: {
        intent: classification.intent,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
      },
      matchedRule: matchedRule ? { intent: matchedRule.intent, action: matchedRule.action } : null,
      escalation: escalation.escalate ? { escalate: true, reason: escalation.reason } : null,
      reply,
      action,
      phase: estimatedState.phase,
      delivery,
      explanation,
      agent: {
        enabled: config.enabled,
        require_approval: config.require_approval,
        max_auto_replies: config.max_auto_replies,
        replies_so_far: agentTurnCount,
        goal: config.conversation_goal || null,
        tone_profile_not_simulated: !!config.use_tone_profile,
      },
    });
  } catch (error) {
    console.error('[test-agent] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});
