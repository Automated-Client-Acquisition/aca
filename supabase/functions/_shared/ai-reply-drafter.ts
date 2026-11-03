/**
 * AI Reply Drafter Module (shared)
 *
 * Drafts contextual replies using conversation thread, contact CRM data,
 * the user's writing style (tone profile), and optionally the org's knowledge
 * base (RAG). Tone profiles are auto-generated from past messages and cached
 * in inbox_user_tone_profiles.
 *
 * Used by:
 *   - conversation-autopilot.ts (auto-reply / draft-for-approval)
 *   - inbox API endpoints (ghost-write suggestions)
 */

import { retrieveOrgChunks, retrieveChunksByDocIds, formatKnowledgeContext } from './knowledge-retrieval.ts';
import { sanitizeAIOutput } from './sanitize-ai-output.ts';
import { DEFAULT_FAST_TEXT_MODEL } from './default-models.ts';
import { fetchChatCompletions, isOllamaModel, isAlibabaModel, type LlmFetchOptions } from './llm-client.ts';

// ============================================================================
// Types
// ============================================================================

export interface DraftReplyInput {
  conversationId: string;
  contactId: string;
  channel: string;
  userId: string;
  organizationId: string;
  model?: string;
  direction?: string;
  useKnowledgeBase?: boolean;
  knowledgeDocumentIds?: string[];
}

export interface DraftReplyOutput {
  draft: string;
  toneUsed: string;
  inputTokens: number;
  outputTokens: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DRAFTER_MODEL = DEFAULT_FAST_TEXT_MODEL;
const DRAFTER_TIMEOUT_MS = 15_000;
const TONE_ANALYZER_TIMEOUT_MS = 12_000;

/**
 * fetchChatCompletions, but survives the org's chosen model being retired.
 *
 * OpenRouter pulls stealth models (e.g. stealth/space-bunny-alpha) at launch and
 * answers 404 "No endpoints found for <model>" from then on, while the id stays
 * saved as organization_settings.default_llm_model. Without this, every inbox
 * draft 500s until someone notices and re-picks a model in Settings. Note the
 * "for": "No endpoints found that support image input" is a different 404.
 */
export async function fetchDrafterCompletion(
  body: Record<string, unknown> & { model: string },
  opts: LlmFetchOptions,
): Promise<{ response: Response; model: string }> {
  const response = await fetchChatCompletions(body, opts);
  if (response.status !== 404 || body.model === DEFAULT_DRAFTER_MODEL) {
    return { response, model: body.model };
  }
  const errorText = await response.clone().text();
  if (!/no endpoints found for/i.test(errorText)) return { response, model: body.model };

  console.warn(
    `[AI Reply Drafter] ${body.model} is no longer served by OpenRouter; using ${DEFAULT_DRAFTER_MODEL}. ` +
    `Re-pick the default model in Settings → AI Models.`,
  );
  return {
    response: await fetchChatCompletions({ ...body, model: DEFAULT_DRAFTER_MODEL }, opts),
    model: DEFAULT_DRAFTER_MODEL,
  };
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Draft a contextual reply for a conversation.
 *
 * Steps:
 *   1. Fetch last 10 messages from the conversation
 *   2. Fetch contact CRM data (company, job title, enrichment, tags)
 *   3. Load or generate the user's tone profile for this channel
 *   4. Call LLM to draft a reply
 */
export async function draftReply(
  supabase: any,
  input: DraftReplyInput,
  openRouterApiKey: string,
): Promise<DraftReplyOutput> {
  const { conversationId, contactId, channel, userId, organizationId, model, direction } = input;
  let effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  // 1. Fetch full conversation history for context
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('content, sender_type, created_at, email_subject')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  const threadMessages = (messages || []).reverse();

  // 2. Fetch contact data
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name, company, job_title, lead_score, tags, enrichment_data')
    .eq('id', contactId)
    .single();

  // 3. Load or generate tone profile
  const { toneSummary } = await loadOrCreateToneProfile(
    supabase,
    userId,
    organizationId,
    channel,
    openRouterApiKey,
    effectiveModel,
  );

  // 4. Build prompts and call LLM
  const contactContext = buildContactContext(contact);

  // 4b. Knowledge base retrieval (non-critical)
  // Respects agent profile config: specific doc IDs if set, org-wide fallback otherwise
  let kbContext = '';
  if (input.useKnowledgeBase !== false) {
    try {
      const searchQuery = threadMessages
        .slice(-3)
        .map((m: any) => m.content || '')
        .join(' ')
        .slice(0, 500);

      if (searchQuery.trim()) {
        const kbResult = input.knowledgeDocumentIds?.length
          ? await retrieveChunksByDocIds(
              supabase, organizationId, input.knowledgeDocumentIds, searchQuery, openRouterApiKey, 3,
            )
          : await retrieveOrgChunks(
              supabase, organizationId, searchQuery, openRouterApiKey, 3,
            );
        if (kbResult.chunks.length > 0) {
          kbContext = formatKnowledgeContext(kbResult.chunks);
        }
      }
    } catch (kbError) {
      console.error('[AI Reply Drafter] KB retrieval failed (non-critical):', kbError);
    }
  }

  const directionBlock = direction
    ? `\nDIRECTION (the user wants the reply to achieve this goal):\n${direction}\n`
    : '';

  const systemPrompt = `You are a reply ghostwriter. Draft a natural, contextual reply continuing the conversation below.

CONTACT CONTEXT:
${contactContext}

TONE REFERENCE (match this writing style):
${toneSummary}
${directionBlock}
${kbContext ? kbContext + '\n' : ''}RULES:
1. Address the contact's latest message directly, while maintaining awareness of the full conversation history
2. Reference earlier conversation points when it shows continuity or strengthens the reply
3. Match the tone reference closely — same level of formality, greeting style, sentence length
4. Be concise — 1-4 sentences unless a longer reply is clearly warranted${direction ? '\n4b. Prioritize the DIRECTION above — steer the reply toward that goal naturally' : ''}
5. Reference specific details from the conversation or contact info when relevant
6. Never fabricate facts, commitments, or company claims
7. Do not include a subject line — just the message body
8. Do not include greetings like "Hi [Name]" unless the tone reference shows the user typically does this
9. In CONTACT CONTEXT, "Primary Need" is an unconfirmed hypothesis, not a fact - never state it as something you know to be true. "Safe Angle" is an instruction describing what's safe to ask/reference and what not to imply - write your own natural phrasing from it, do not paste it verbatim or treat it as a drafted line.

After the conversation messages below, draft the next reply. Return ONLY the draft reply text. No JSON, no markdown, no explanation.`;

  // Build chat messages with proper role mapping for native conversation understanding
  const chatMessages = buildChatMessages(threadMessages, systemPrompt);

  // max_tokens is the budget for EVERYTHING the model emits, and on a reasoning
  // model (grok, qwen3.x, o-series…) the thinking pass is billed against it
  // first. A flat 600 is fine for a non-reasoning model but is often entirely
  // consumed by the thinking pass on a reasoning model, so the draft comes back
  // empty (finish_reason: 'length') — see generate-email-sequence/index.ts for
  // the same failure mode. Cap the thinking pass via `reasoning.effort` on
  // OpenRouter and retry once with a bigger budget if it still gets cut off.
  const isOpenRouterModel = !isOllamaModel(effectiveModel) && !isAlibabaModel(effectiveModel);
  const reasoningCap = isOpenRouterModel ? { reasoning: { effort: 'low' as const } } : {};

  let draft = '';
  let finishReason: string | undefined;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let maxTokens = 600;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DRAFTER_TIMEOUT_MS);

    try {
      const { response, model: servedModel } = await fetchDrafterCompletion({
        model: effectiveModel,
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: maxTokens,
        ...reasoningCap,
      }, {
        openRouterApiKey,
        supabase,
        organizationId,
        signal: controller.signal,
      });
      effectiveModel = servedModel;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      finishReason = choice?.finish_reason;
      usage = data.usage;
      draft = sanitizeAIOutput(choice?.message?.content?.trim() || '');

      if (draft && finishReason !== 'length') break;

      console.warn('[AI Reply Drafter] Truncated/empty response:', JSON.stringify({
        attempt, maxTokens, finishReason, hasDraft: !!draft, usage: data.usage, model: effectiveModel,
      }));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[AI Reply Drafter] Timeout after', DRAFTER_TIMEOUT_MS, 'ms');
        throw new Error('Reply drafting timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt === 0) maxTokens = Math.min(4000, maxTokens * 4);
  }

  if (!draft) {
    throw new Error(finishReason === 'length'
      ? `${effectiveModel} used its entire ${maxTokens}-token output budget on reasoning before writing a reply, even after a retry with a larger budget. Pick a model with a smaller reasoning pass in Settings → AI Models.`
      : `${effectiveModel} returned an empty response${finishReason ? ` (finish_reason: ${finishReason})` : ''}.`);
  }

  return {
    draft,
    toneUsed: toneSummary,
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
  };
}

// ============================================================================
// Tone Profile
// ============================================================================

/**
 * Load an existing tone profile or generate one from recent outbound messages.
 * Stores the result in inbox_user_tone_profiles for reuse.
 */
export async function loadOrCreateToneProfile(
  supabase: any,
  userId: string,
  organizationId: string,
  channel: string,
  openRouterApiKey: string,
  model: string,
): Promise<{ toneSummary: string }> {
  // Try to load existing profile
  const { data: existing } = await supabase
    .from('inbox_user_tone_profiles')
    .select('tone_summary, updated_at')
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (existing?.tone_summary) {
    // Check freshness — refresh if older than 7 days
    const age = Date.now() - new Date(existing.updated_at).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    if (age < sevenDays) {
      return { toneSummary: existing.tone_summary };
    }
  }

  // Generate new tone profile
  return refreshToneProfile(supabase, userId, organizationId, channel, openRouterApiKey, model);
}

/**
 * Analyze recent outbound messages to build a tone profile,
 * then store/update in inbox_user_tone_profiles.
 */
export async function refreshToneProfile(
  supabase: any,
  userId: string,
  organizationId: string,
  channel: string,
  openRouterApiKey: string,
  model?: string,
): Promise<{ toneSummary: string }> {
  // Fetch last 20 outbound messages by this user (scoped to org for multi-tenancy)
  const { data: outboundMessages } = await supabase
    .from('crm_messages')
    .select('content, created_at, conversation_id')
    .eq('sender_type', 'user')
    .eq('sender_user_id', userId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!outboundMessages || outboundMessages.length < 3) {
    const fallback = 'Professional and concise. Uses standard greetings and sign-offs. Moderate formality.';

    // Store fallback so we don't keep regenerating
    await upsertToneProfile(supabase, userId, organizationId, channel, fallback);
    return { toneSummary: fallback };
  }

  // Build sample text for analysis
  const samples = outboundMessages
    .map((m: any, i: number) => `Message ${i + 1}: ${(m.content || '').slice(0, 300)}`)
    .join('\n\n');

  const analysisPrompt = `Analyze these messages and describe the writing style in 2-3 sentences. Focus on: formality level, humor usage, sentence length, greeting style, sign-off style, emoji usage.

${samples}

Return ONLY the style description. No JSON, no markdown.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TONE_ANALYZER_TIMEOUT_MS);

  try {
    const { response } = await fetchDrafterCompletion({
      model: model || DEFAULT_DRAFTER_MODEL,
      messages: [
        { role: 'system', content: 'You are a writing style analyst. Describe writing patterns concisely.' },
        { role: 'user', content: analysisPrompt },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }, {
      openRouterApiKey,
      supabase,
      organizationId,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Tone Profile] LLM error:', errorText);
      const fallback = 'Professional and concise. Standard business communication style.';
      await upsertToneProfile(supabase, userId, organizationId, channel, fallback);
      return { toneSummary: fallback };
    }

    const data = await response.json();
    const toneSummary = data.choices?.[0]?.message?.content?.trim()
      || 'Professional and concise. Standard business communication style.';

    // Store the profile
    await upsertToneProfile(supabase, userId, organizationId, channel, toneSummary);

    return { toneSummary };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Tone Profile] Timeout after', TONE_ANALYZER_TIMEOUT_MS, 'ms');
    } else {
      console.error('[Tone Profile] Error:', error);
    }

    const fallback = 'Professional and concise. Standard business communication style.';
    await upsertToneProfile(supabase, userId, organizationId, channel, fallback);
    return { toneSummary: fallback };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Upsert a tone profile record.
 */
async function upsertToneProfile(
  supabase: any,
  userId: string,
  organizationId: string,
  channel: string,
  toneSummary: string,
): Promise<void> {
  const nowISO = new Date().toISOString();

  const { error } = await supabase
    .from('inbox_user_tone_profiles')
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        channel,
        tone_summary: toneSummary,
        updated_at: nowISO,
      },
      { onConflict: 'user_id,channel,organization_id' },
    );

  if (error) {
    console.error('[Tone Profile] Failed to upsert:', error.message);
  }
}

/**
 * Build a contact context string from CRM data.
 */
export function buildContactContext(contact: any): string {
  if (!contact) return 'No contact data available.';

  const parts: string[] = [];

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  if (name) parts.push(`Name: ${name}`);
  if (contact.company) parts.push(`Company: ${contact.company}`);
  if (contact.job_title) parts.push(`Job Title: ${contact.job_title}`);
  if (contact.lead_score != null) parts.push(`Lead Score: ${contact.lead_score}`);

  if (contact.tags?.length) {
    parts.push(`Tags: ${contact.tags.join(', ')}`);
  }

  // Extract key enrichment fields if available
  const enrichment = contact.enrichment_data;
  if (enrichment && typeof enrichment === 'object') {
    if (enrichment.primary_need) parts.push(`Primary Need (unconfirmed hypothesis, do not state as fact): ${enrichment.primary_need}`);
    if (enrichment.primary_need_evidence) parts.push(`Observed Evidence: ${enrichment.primary_need_evidence}`);
    if (enrichment.primary_need_confidence) parts.push(`Confidence: ${enrichment.primary_need_confidence}`);
    if (enrichment.cold_email_angle) parts.push(`Safe Angle: ${enrichment.cold_email_angle}`);
    if (enrichment.company_niche) parts.push(`Company Niche: ${enrichment.company_niche}`);
    if (Array.isArray(enrichment.growth_signals) && enrichment.growth_signals.length > 0) {
      const labels = enrichment.growth_signals
        .map((s: unknown) => (s && typeof s === 'object' ? (s as Record<string, unknown>).signal : s))
        .filter(Boolean);
      if (labels.length > 0) parts.push(`Growth Signals: ${labels.join(', ')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : 'No contact data available.';
}

/**
 * Format conversation thread messages for the LLM prompt.
 * For email conversations, prepends the email subject line for context.
 * Long threads (>10 messages) get early messages summarized as snippets,
 * with the last 8 shown in full with timestamps and separators.
 */
export function formatThread(messages: any[], channel?: string): string {
  if (!messages?.length) return '(no messages yet)';

  let header = '';
  if (channel === 'email') {
    const subjectMsg = messages.find((m: any) => m.email_subject);
    if (subjectMsg) {
      header = `EMAIL SUBJECT: ${subjectMsg.email_subject}\n\n`;
    }
  }

  const MAX_FULL_MESSAGES = 8;
  const PER_MSG_LIMIT = 2000;

  let summaryBlock = '';
  let fullMessages = messages;

  if (messages.length > MAX_FULL_MESSAGES + 2) {
    const earlyMessages = messages.slice(0, messages.length - MAX_FULL_MESSAGES);
    fullMessages = messages.slice(messages.length - MAX_FULL_MESSAGES);

    const earlyTopics = earlyMessages
      .map((m: any) => {
        // Our side = anything not from the contact (person, AI agent, campaign send)
        const label = m.sender_type === 'contact' ? 'Them' : 'You';
        const snippet = (m.content || '').slice(0, 80).replace(/\n/g, ' ');
        return `${label}: "${snippet}${(m.content || '').length > 80 ? '...' : ''}"`;
      })
      .join('; ');

    summaryBlock = `EARLIER IN THIS THREAD (${earlyMessages.length} messages, summarized):\n${earlyTopics}\n\n---\n\nRECENT MESSAGES (last ${fullMessages.length}):\n`;
  }

  const formattedMessages = fullMessages
    .map((m: any, i: number) => {
      const msgNumber = messages.length > MAX_FULL_MESSAGES + 2
        ? messages.length - fullMessages.length + i + 1
        : i + 1;
      const label = m.sender_type === 'user' ? 'You' : 'Them';
      const timestamp = m.created_at ? formatTimestamp(m.created_at) : '';
      const isLatest = i === fullMessages.length - 1;
      const latestTag = isLatest ? ' [LATEST]' : '';
      const content = (m.content || '').slice(0, PER_MSG_LIMIT);

      return `[${msgNumber}] ${label}${timestamp ? ` (${timestamp})` : ''}${latestTag}:\n${content}`;
    })
    .join('\n---\n');

  return header + summaryBlock + formattedMessages;
}

/**
 * Format a timestamp as a relative or absolute time string.
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Build an array of chat messages from thread history for the LLM API.
 * Maps thread messages to proper user/assistant roles for native
 * conversation understanding. Context (CRM, tone, KB) stays in system prompt.
 *
 * Role mapping: sender_type==='user' (our side) → assistant (ghostwriting for them),
 * contact messages → user (what the LLM responds to).
 */
export function buildChatMessages(
  threadMessages: any[],
  systemPrompt: string,
  maxMessages = 16,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  const relevantMessages = threadMessages.slice(-maxMessages);

  for (const msg of relevantMessages) {
    // Only the contact speaks as 'user'. Everything from our side (a person, the AI
    // agent, a campaign/automation send) is 'assistant'; before this, 'ai' and
    // 'automation' messages reached the model as if the lead had written them.
    const role: 'user' | 'assistant' = msg.sender_type === 'contact' ? 'user' : 'assistant';
    const content = (msg.content || '').slice(0, 2000);
    if (content.trim()) {
      messages.push({ role, content });
    }
  }

  messages.push({ role: 'user', content: '[Draft the next reply in this conversation]' });

  return messages;
}
