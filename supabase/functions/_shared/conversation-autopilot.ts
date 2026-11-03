/**
 * Conversation Autopilot Module (shared)
 *
 * Full conversational agent engine that processes AI-driven automation rules
 * for conversations based on intent classification. Supports auto-reply,
 * calendly sends, draft-for-approval, smart snooze for OOO contacts,
 * escalation, conversation state tracking, knowledge base retrieval,
 * and tone-matched replies.
 *
 * Used by:
 *   - email-imap-poller (inline, on classified inbound)
 *   - campaign-processor (inline, on reply detection)
 */

import { parseOOOReturnDate } from './ooo-date-parser.ts';
import { sanitizeAIOutput } from './sanitize-ai-output.ts';
import { retrieveOrgChunks, retrieveChunksByDocIds, formatKnowledgeContext } from './knowledge-retrieval.ts';
import { loadOrCreateToneProfile, buildContactContext, buildChatMessages } from './ai-reply-drafter.ts';
import { DEFAULT_FAST_TEXT_MODEL } from './default-models.ts';
import { getGHLAccessToken, getGHLFreeSlots, upsertGHLContact, createGHLAppointment } from './ghl-calendar-client.ts';

// ============================================================================
// Types
// ============================================================================

export interface AutopilotConfig {
  enabled: boolean;
  rules: AutopilotRule[];
  require_approval: boolean;
  max_auto_replies: number;
  // Agent engine extensions
  conversation_goal?: string;
  system_instructions?: string;
  use_knowledge_base?: boolean;
  knowledge_document_ids?: string[];
  use_tone_profile?: boolean;
  max_conversation_turns?: number;
  owner_user_id?: string;
  escalation_rules?: EscalationRule[];
  booking_timezone?: string; // IANA timezone for GHL calendar booking (e.g. 'America/New_York')
  ghl_calendar_id?: string; // GHL calendar for automatic booking when scheduling is detected
}

export interface AutopilotRule {
  intent: string;
  action: 'auto_reply' | 'send_calendly' | 'book_ghl_appointment' | 'auto_followup_after_return' | 'draft_for_approval' | 'escalate';
  message_template?: string;
  calendly_link?: string;
  ghl_calendar_id?: string;
  confidence_threshold?: number;
}

export interface EscalationRule {
  condition: 'low_confidence' | 'hostile_sentiment' | 'explicit_request' | 'max_turns' | 'custom_keyword';
  threshold?: number;
  keywords?: string[];
}

export interface AutopilotConversationState {
  phase: 'greeting' | 'discovery' | 'qualification' | 'objection_handling' | 'closing' | 'post_meeting' | 'escalated';
  turn_count: number;
  last_autopilot_at: string;
  escalation_reason?: string;
  goal_progress?: string;
}

export interface ProcessAutopilotInput {
  conversationId: string;
  contactId: string;
  organizationId: string;
  intent: string;
  confidence: number;
  inboundMessageId: string;
  sequenceId?: string;
  campaignId?: string;
  leadMagnetCampaignId?: string;
  channel: string;
  mailboxId?: string;
  model?: string;
  messageContent?: string;
}

export interface ProcessAutopilotResult {
  action: string;
  queued: boolean;
  sent: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DRAFTER_MODEL = DEFAULT_FAST_TEXT_MODEL;
const DRAFTER_TIMEOUT_MS = 15_000;

// ============================================================================
// Config Normalization
// ============================================================================

/**
 * Normalize a stored agent/autopilot config into a complete AutopilotConfig.
 *
 * Agent profiles created by the playbook generator (generate-playbook-artifacts /
 * onboarding-drip-tick) persist a DIFFERENT shape — { system_prompt, tone_traits,
 * escalation_triggers } — than the AutopilotConfig the engine consumes
 * ({ enabled, rules[], conversation_goal, system_instructions, escalation_rules[] }).
 * Loaded raw, such a profile has no `enabled` and no `rules`, so processAutopilot
 * bails at `if (!config.enabled)` / `if (!matchingRule)` and the agent never acts.
 *
 * This bridges the two schemas (mirrors the frontend normalizeAgentConfig in
 * src/hooks/useAgentProfiles.ts) and, crucially, synthesizes a safe default rule
 * set for profiled agents that have a system prompt but no intent rules. Defaults
 * use `auto_reply`, which honors `require_approval` (default true) — so by default
 * the agent DRAFTS replies for human approval rather than auto-sending.
 */
export function normalizeAgentConfig(raw: unknown): AutopilotConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;

  const config: AutopilotConfig = {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    rules: Array.isArray(r.rules) ? (r.rules as AutopilotRule[]) : [],
    require_approval: typeof r.require_approval === 'boolean' ? r.require_approval : true,
    max_auto_replies: typeof r.max_auto_replies === 'number' ? r.max_auto_replies : 10,
    max_conversation_turns:
      typeof r.max_conversation_turns === 'number' ? r.max_conversation_turns : 10,
    conversation_goal:
      typeof r.conversation_goal === 'string' && r.conversation_goal ? r.conversation_goal : undefined,
    // Playbook profiles store the prompt under `system_prompt`; the engine reads `system_instructions`.
    system_instructions:
      typeof r.system_instructions === 'string' && r.system_instructions
        ? r.system_instructions
        : (typeof r.system_prompt === 'string' && r.system_prompt ? r.system_prompt : undefined),
    use_knowledge_base: typeof r.use_knowledge_base === 'boolean' ? r.use_knowledge_base : undefined,
    knowledge_document_ids: Array.isArray(r.knowledge_document_ids)
      ? (r.knowledge_document_ids as string[])
      : undefined,
    use_tone_profile: typeof r.use_tone_profile === 'boolean' ? r.use_tone_profile : undefined,
    owner_user_id: typeof r.owner_user_id === 'string' ? r.owner_user_id : undefined,
    escalation_rules: Array.isArray(r.escalation_rules)
      ? (r.escalation_rules as EscalationRule[])
      : undefined,
    booking_timezone: typeof r.booking_timezone === 'string' ? r.booking_timezone : undefined,
    ghl_calendar_id: typeof r.ghl_calendar_id === 'string' ? r.ghl_calendar_id : undefined,
  };

  // Map playbook `escalation_triggers` (string[]) → structured escalation_rules.
  if (
    (!config.escalation_rules || config.escalation_rules.length === 0) &&
    Array.isArray(r.escalation_triggers) &&
    r.escalation_triggers.length > 0
  ) {
    config.escalation_rules = [
      { condition: 'explicit_request' },
      { condition: 'max_turns' },
      { condition: 'custom_keyword', keywords: ['cancel', 'refund', 'lawsuit', 'legal', 'complaint'] },
    ];
  }

  // Synthesize a default rule set when a profiled agent has a system prompt / tone
  // profile but no rules. Without rules the engine returns noAction. `auto_reply`
  // honors require_approval, so this drafts-for-approval by default (safe).
  const isProfiledAgent = !!(config.system_instructions || r.system_prompt || config.use_tone_profile);
  if (config.rules.length === 0 && isProfiledAgent) {
    config.rules = [
      { intent: 'interested', action: 'auto_reply' },
      { intent: 'neutral', action: 'auto_reply' },
      { intent: 'not_interested', action: 'auto_reply' },
      { intent: 'out_of_office', action: 'auto_followup_after_return' },
      {
        intent: 'meeting_booked',
        action: config.ghl_calendar_id ? 'book_ghl_appointment' : 'auto_reply',
        ...(config.ghl_calendar_id ? { ghl_calendar_id: config.ghl_calendar_id } : {}),
      },
    ];
  }

  return config;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Process autopilot rules for an inbound message.
 *
 * Resolution order:
 *   1. If no sequenceId, check conversation.ai_enabled flag
 *   2. If sequenceId, load sequence autopilot_config
 *   3. Find matching rule by intent
 *   4. Check confidence threshold
 *   5. Check escalation conditions
 *   6. Execute action (auto-reply, calendly, snooze, escalate, or draft-for-approval)
 *   7. Update conversation state
 */
export async function processAutopilot(
  supabase: any,
  input: ProcessAutopilotInput,
  openRouterApiKey: string,
): Promise<ProcessAutopilotResult> {
  const noAction: ProcessAutopilotResult = { action: 'none', queued: false, sent: false };

  let config: AutopilotConfig | null = null;

  // Helper: load config from agent profile (single source of truth when profile is attached)
  const loadProfileConfig = async (profileId: string): Promise<AutopilotConfig | null> => {
    const { data: profile } = await supabase
      .from('ai_agent_profiles')
      .select('config')
      .eq('id', profileId)
      .eq('organization_id', input.organizationId)
      .single();
    return profile?.config ? normalizeAgentConfig(profile.config) : null;
  };

  if (input.sequenceId) {
    // Load config from the email sequence — agent profile takes priority over inline config
    const { data: sequence } = await supabase
      .from('email_sequences')
      .select('autopilot_config, agent_profile_id')
      .eq('id', input.sequenceId)
      .eq('organization_id', input.organizationId)
      .single();

    if (sequence?.agent_profile_id) {
      config = await loadProfileConfig(sequence.agent_profile_id);
    }
    if (!config && sequence?.autopilot_config) {
      config = normalizeAgentConfig(sequence.autopilot_config);
    }
    if (!config) return noAction;
  } else if (input.campaignId) {
    // Load config from the LinkedIn campaign — agent profile takes priority
    const { data: campaign } = await supabase
      .from('linkedin_campaigns')
      .select('autopilot_config, agent_profile_id')
      .eq('id', input.campaignId)
      .eq('organization_id', input.organizationId)
      .single();

    if (campaign?.agent_profile_id) {
      config = await loadProfileConfig(campaign.agent_profile_id);
    }
    if (!config && campaign?.autopilot_config) {
      config = normalizeAgentConfig(campaign.autopilot_config);
    }
    if (!config) return noAction;
  } else if (input.leadMagnetCampaignId) {
    // Load config from the lead magnet campaign — agent profile takes priority
    const { data: campaign } = await supabase
      .from('unipile_campaigns')
      .select('autopilot_config, agent_profile_id')
      .eq('id', input.leadMagnetCampaignId)
      .eq('organization_id', input.organizationId)
      .single();

    if (campaign?.agent_profile_id) {
      config = await loadProfileConfig(campaign.agent_profile_id);
    }
    if (!config && campaign?.autopilot_config) {
      config = normalizeAgentConfig(campaign.autopilot_config);
    }
    if (!config) return noAction;
  } else {
    // No sequence or campaign — check if conversation has AI enabled
    const { data: conversation } = await supabase
      .from('crm_conversations')
      .select('ai_enabled, metadata, agent_profile_id')
      .eq('id', input.conversationId)
      .eq('organization_id', input.organizationId)
      .single();

    if (!conversation?.ai_enabled) return noAction;

    // Agent profile takes priority over inline metadata config
    if (conversation.agent_profile_id) {
      config = await loadProfileConfig(conversation.agent_profile_id);
    }
    if (!config) {
      const convConfig = conversation.metadata?.autopilot_config;
      if (convConfig) config = normalizeAgentConfig(convConfig);
    }
    if (!config?.enabled) return noAction;
  }

  if (!config || !config.enabled) return noAction;

  // Auto-inject book_ghl_appointment rule if calendar is configured but no booking rule exists
  if (config.ghl_calendar_id && !config.rules.some((r) => r.action === 'book_ghl_appointment')) {
    console.log('[Autopilot] Auto-injecting book_ghl_appointment rule for calendar', config.ghl_calendar_id);
    config.rules.push({
      intent: 'meeting_booked',
      action: 'book_ghl_appointment',
      ghl_calendar_id: config.ghl_calendar_id,
    });
  }

  // Stop conditions: auto_reply and do_not_contact intents should not be processed
  if (input.intent === 'auto_reply') {
    console.log(`[Autopilot] Auto-reply detected for conversation ${input.conversationId} — stopping`);
    return noAction;
  }
  if (input.intent === 'do_not_contact') {
    console.log(`[Autopilot] Do-not-contact intent for conversation ${input.conversationId} — stopping`);
    await supabase
      .from('crm_contacts')
      .update({ status: 'do_not_contact' })
      .eq('id', input.contactId)
      .eq('organization_id', input.organizationId);
    return noAction;
  }

  // Find matching rule — fall back chain:
  // 1. Exact intent match
  // 2. If 'meeting_booked', try 'interested' (booking is a subset of interest)
  // 3. Fall back to 'neutral'
  const matchingRule = config.rules.find((r) => r.intent === input.intent)
    || (input.intent === 'meeting_booked' ? config.rules.find((r) => r.intent === 'interested') : undefined)
    || config.rules.find((r) => r.intent === 'neutral');
  if (!matchingRule) return noAction;

  // Check per-rule confidence threshold
  if (matchingRule.confidence_threshold != null && input.confidence < matchingRule.confidence_threshold) {
    console.log(
      `[Autopilot] Confidence ${input.confidence} below rule threshold ${matchingRule.confidence_threshold} for intent "${input.intent}" — skipping`,
    );
    return noAction;
  }

  // Check auto-reply limit — but bypass if there's a pending GHL booking in progress
  // or if the agent has a calendar configured (booking-only mode).
  const aiMessageCount = await countAiMessages(supabase, input.conversationId);
  let hasPendingBooking = false;
  const bookingCapable = !!config.ghl_calendar_id;
  if (bookingCapable && aiMessageCount >= config.max_auto_replies) {
    const { data: convCheck } = await supabase
      .from('crm_conversations')
      .select('metadata')
      .eq('id', input.conversationId)
      .single();
    hasPendingBooking = !!convCheck?.metadata?.pending_ghl_booking;
    if (hasPendingBooking) {
      console.log(`[Autopilot] Max auto-replies reached (${aiMessageCount}/${config.max_auto_replies}) but pending GHL booking — continuing`);
    }
  }
  // If max replies reached: allow booking-capable agents through in booking-only mode,
  // but block agents without calendar entirely.
  const bookingOnlyMode = aiMessageCount >= config.max_auto_replies && !hasPendingBooking && bookingCapable;
  if (aiMessageCount >= config.max_auto_replies && !hasPendingBooking && !bookingCapable) {
    console.log(
      `[Autopilot] Max auto-replies reached (${aiMessageCount}/${config.max_auto_replies}) for conversation ${input.conversationId}`,
    );
    return noAction;
  }
  if (bookingOnlyMode) {
    console.log(`[Autopilot] Max auto-replies reached (${aiMessageCount}/${config.max_auto_replies}) but calendar configured — booking-only mode`);
  }

  // Load conversation state
  const { data: convForState } = await supabase
    .from('crm_conversations')
    .select('autopilot_state')
    .eq('id', input.conversationId)
    .single();

  const currentState: AutopilotConversationState | null = convForState?.autopilot_state || null;

  // Check escalation conditions — but skip escalation when the matching rule's action
  // is a goal-completing action (booking, calendly). The contact is trying to schedule,
  // which is the conversation goal — don't escalate just because we hit max turns or low confidence.
  const isGoalCompletingAction = matchingRule.action === 'book_ghl_appointment' || matchingRule.action === 'send_calendly';
  const escalation = shouldEscalate(config, currentState, input.intent, input.confidence, input.messageContent);
  if (escalation.escalate && !isGoalCompletingAction) {
    console.log(
      `[Autopilot] Escalation triggered for conversation ${input.conversationId}: ${escalation.reason}`,
    );

    // Generate a draft even when escalating (useful for human reviewer)
    const draft = await generateAgentDraft(supabase, input, config, currentState, openRouterApiKey, input.model);

    await queueForApproval(supabase, input, config, draft || '(Escalated — no draft generated)', 'escalate', false, {
      escalated: true,
      reason: escalation.reason,
    });

    // Update state to escalated
    await updateConversationState(supabase, input.conversationId, currentState, 'escalated_intent', escalation.reason);

    return { action: 'escalate', queued: true, sent: false };
  } else if (escalation.escalate && isGoalCompletingAction) {
    console.log(
      `[Autopilot] Escalation would trigger (${escalation.reason}) but skipping — goal-completing action "${matchingRule.action}" takes priority`,
    );
  }

  // Dispatch based on action type
  let result: ProcessAutopilotResult;

  switch (matchingRule.action) {
    case 'auto_reply':
      result = await handleAutoReply(supabase, input, config, matchingRule, currentState, openRouterApiKey, input.model, bookingOnlyMode);
      break;

    case 'send_calendly':
      result = await handleSendCalendly(supabase, input, config, matchingRule, currentState, openRouterApiKey, input.model);
      break;

    case 'book_ghl_appointment':
      result = await handleBookGHLAppointment(supabase, input, config, matchingRule, currentState, openRouterApiKey, input.model);
      break;

    case 'auto_followup_after_return':
      result = await handleAutoFollowupAfterReturn(supabase, input);
      break;

    case 'draft_for_approval':
      result = await handleDraftForApproval(supabase, input, config, currentState, openRouterApiKey, input.model);
      break;

    case 'escalate':
      result = await handleEscalate(supabase, input, config, currentState, openRouterApiKey, input.model);
      break;

    default:
      console.log(`[Autopilot] Unknown action: ${matchingRule.action}`);
      return noAction;
  }

  // Update conversation state after action (skip for OOO snooze — no agent turn)
  if (matchingRule.action !== 'auto_followup_after_return') {
    await updateConversationState(supabase, input.conversationId, currentState, input.intent);
  }

  return result;
}

// ============================================================================
// Scheduling Detection
// ============================================================================

/**
 * Use LLM to detect scheduling intent, extract any proposed time, and detect timezone.
 */
async function detectSchedulingAndExtractTime(
  messageContent: string,
  bookingTimezone: string,
  openRouterApiKey: string,
  model?: string,
  lastOutboundMessage?: string,
): Promise<{ isScheduling: boolean; proposedTime?: string; contactTimezone?: string; timezoneUnknown?: boolean }> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;
  const today = new Date().toISOString().split('T')[0];
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  // Include last outbound message for context — essential for detecting confirmations
  // like "Yes" or "Sounds good" in response to a proposed time.
  const contextBlock = lastOutboundMessage
    ? `\nPREVIOUS MESSAGE (from us):\n"${lastOutboundMessage}"\n`
    : '';

  const systemPrompt = `You are analyzing a message to determine if the sender is discussing scheduling a meeting, call, or appointment.

TODAY: ${dayName}, ${today}
CALENDAR TIMEZONE: ${bookingTimezone}
${contextBlock}
LATEST MESSAGE (from contact):
"${messageContent}"

Determine:
1. Is this message about scheduling, booking, or meeting timing? This includes:
   - Directly requesting a meeting, call, or demo
   - Proposing specific times
   - Asking about availability
   - **Confirming or accepting a previously proposed time** (e.g. "Yes", "Sounds good", "That works" in response to a time we proposed)
   - Asking to reschedule
2. If a specific date/time is mentioned (either in this message OR in the previous message they are confirming), extract it as an ISO datetime string.
3. Did they mention or imply a timezone? Look for:
   - Explicit: "EST", "PST", "GMT", "CET", "my time", "your time", "UK time", etc.
   - Implicit from location context: "I'm in London", "I'm based in NY"
   - Abbreviations: "ET", "PT", "CT", "MT", "IST", "AEST", etc.
   If they mention a timezone, return the IANA timezone (e.g. "America/New_York").
   If they do NOT mention any timezone and they propose a specific time, set timezoneUnknown to true.
   If no specific time is proposed, timezoneUnknown is irrelevant (set false).

IMPORTANT: When extracting proposedTime, use the contact's timezone if mentioned, otherwise use the calendar timezone (${bookingTimezone}).

Examples:
- "Can we do Tuesday at 2pm EST?" → scheduling, proposed time in America/New_York, contactTimezone: "America/New_York"
- "Monday 3PM works" → scheduling, proposed time in ${bookingTimezone} (assumed), timezoneUnknown: true
- "I'm in London, how about 10am Wednesday?" → scheduling, proposed time in Europe/London, contactTimezone: "Europe/London"
- "3PM your time works" → scheduling, proposed time in ${bookingTimezone}, timezoneUnknown: false (they said "your time")
- "Let's hop on a call" → scheduling, no specific time
- Previous: "Would tomorrow 2PM suit you?" → Contact: "Yes" → scheduling, extract the proposed time from our previous message
- Previous: "How about Thursday at 10am?" → Contact: "Sounds good" → scheduling, extract time from our message
- "Tell me more" → not scheduling

Return ONLY valid JSON:
{"isScheduling": true/false, "proposedTime": "YYYY-MM-DDTHH:MM:00" or null, "contactTimezone": "IANA/Timezone" or null, "timezoneUnknown": true/false}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Analyze the message.' },
        ],
        temperature: 0.1,
        max_tokens: 150,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return { isScheduling: false };
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return { isScheduling: false };

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { isScheduling: false };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isScheduling: !!parsed.isScheduling,
      proposedTime: parsed.proposedTime || undefined,
      contactTimezone: parsed.contactTimezone || undefined,
      timezoneUnknown: !!parsed.timezoneUnknown,
    };
  } catch (err) {
    console.error('[Autopilot] detectSchedulingAndExtractTime error:', err);
    return { isScheduling: false };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Find the closest GHL free slot matching a proposed time (±30 min tolerance).
 * Returns the closest match, not the first match, to avoid ambiguity.
 */
function findMatchingSlot(
  proposedTime: string,
  slotsMap: Record<string, { slots: string[] }>,
): { date: string; time: string } | null {
  const proposed = new Date(proposedTime);
  if (isNaN(proposed.getTime())) return null;

  const proposedDate = proposedTime.split('T')[0];
  const proposedMinutes = proposed.getHours() * 60 + proposed.getMinutes();
  const TOLERANCE_MINUTES = 30;

  // Only match slots on the proposed date
  const daySlots = slotsMap[proposedDate]?.slots || [];
  let bestMatch: { date: string; time: string } | null = null;
  let bestDiff = Infinity;

  for (const slot of daySlots) {
    const slotMinutes = parseSlotMinutes(slot);
    if (slotMinutes < 0) continue;
    const diff = Math.abs(slotMinutes - proposedMinutes);

    if (diff <= TOLERANCE_MINUTES && diff < bestDiff) {
      bestDiff = diff;
      bestMatch = { date: proposedDate, time: slot };
    }
  }

  return bestMatch;
}

/** Parse minutes-from-midnight from a slot string — handles "HH:MM" and ISO "2026-02-25T09:00:00+01:00" */
function parseSlotMinutes(slot: string): number {
  const tIdx = slot.indexOf('T');
  if (tIdx !== -1) {
    // ISO format: parse "HH:MM" after T
    const timePart = slot.substring(tIdx + 1);
    const h = parseInt(timePart.substring(0, 2), 10);
    const m = parseInt(timePart.substring(3, 5), 10);
    return h * 60 + m;
  }
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Convert offered slots array to the slotsMap format used by findMatchingSlot().
 */
function buildSlotsMapFromOffered(
  offeredSlots: Array<{ date: string; time: string }>,
): Record<string, { slots: string[] }> {
  const map: Record<string, { slots: string[] }> = {};
  for (const slot of offeredSlots) {
    if (!map[slot.date]) map[slot.date] = { slots: [] };
    map[slot.date].slots.push(slot.time);
  }
  return map;
}

/**
 * Calculate end time from a slot, handling day boundary rollover.
 */
function calculateEndTime(date: string, time: string, durationMinutes = 30): string {
  // If time is an ISO timestamp, use it directly for date math
  if (time.includes('T')) {
    const start = new Date(time);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    return end.toISOString();
  }

  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + durationMinutes;

  if (totalMinutes >= 24 * 60) {
    // Rolls over to next day
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];
    const overflowMinutes = totalMinutes - 24 * 60;
    const endH = String(Math.floor(overflowMinutes / 60)).padStart(2, '0');
    const endM = String(overflowMinutes % 60).padStart(2, '0');
    return `${nextDateStr}T${endH}:${endM}:00`;
  }

  const endH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const endM = String(totalMinutes % 60).padStart(2, '0');
  return `${date}T${endH}:${endM}:00`;
}

/**
 * Format a date/time string for display, respecting the booking timezone.
 * Without explicit timeZone, Deno edge functions default to UTC which causes
 * times like "10:45 AM Europe/Paris" to display as "9:45 AM".
 */
function formatSlotDateTime(
  timeStr: string,
  tz?: string,
  format: 'long' | 'short' = 'long',
): string {
  const d = new Date(timeStr.includes('T') ? timeStr : `${timeStr}`);
  if (isNaN(d.getTime())) return timeStr;
  const tzOpt = tz ? { timeZone: tz } : {};
  if (format === 'short') {
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...tzOpt })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tzOpt })}`;
  }
  return `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...tzOpt })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tzOpt })}`;
}

/**
 * Convert a datetime string from one timezone to another.
 * Uses Intl.DateTimeFormat for Deno-compatible timezone conversion.
 */
function convertTimezone(
  isoTime: string,
  fromTz: string,
  toTz: string,
): string {
  if (fromTz === toTz) return isoTime;

  try {
    // Parse the time as if it's in fromTz
    // Create a date assuming the string represents fromTz local time
    const [datePart, timePart] = isoTime.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    // Get UTC offset for fromTz at this date/time
    const refDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    const fromFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: fromTz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const toFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: toTz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    // Find the UTC time that, when formatted in fromTz, matches our input
    // We do this by computing the offset between UTC and fromTz
    const fromParts = fromFormatter.formatToParts(refDate);
    const fromH = parseInt(fromParts.find((p) => p.type === 'hour')?.value || '0', 10);
    const fromM = parseInt(fromParts.find((p) => p.type === 'minute')?.value || '0', 10);
    const fromD = parseInt(fromParts.find((p) => p.type === 'day')?.value || '0', 10);

    // Offset between what we want (hour:minute in fromTz) and what refDate shows in fromTz
    const wantedMinutes = hour * 60 + minute;
    const refMinutes = fromH * 60 + fromM;
    let offsetMin = wantedMinutes - refMinutes;
    // Handle day boundary
    if (fromD !== day) {
      offsetMin += (day - fromD) * 24 * 60;
    }

    const correctedUTC = new Date(refDate.getTime() + offsetMin * 60 * 1000);

    // Now format in toTz
    const toParts = toFormatter.formatToParts(correctedUTC);
    const toYear = toParts.find((p) => p.type === 'year')?.value || String(year);
    const toMonth = toParts.find((p) => p.type === 'month')?.value || String(month).padStart(2, '0');
    const toDay = toParts.find((p) => p.type === 'day')?.value || String(day).padStart(2, '0');
    const toHour = toParts.find((p) => p.type === 'hour')?.value || '00';
    const toMinute = toParts.find((p) => p.type === 'minute')?.value || '00';

    return `${toYear}-${toMonth}-${toDay}T${toHour}:${toMinute}:00`;
  } catch (err) {
    console.error('[Autopilot] convertTimezone error:', err);
    return isoTime; // Return original on error
  }
}

/**
 * Use LLM to parse a timezone from the contact's reply.
 */
async function parseTimezoneFromReply(
  messageContent: string,
  openRouterApiKey: string,
  model?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  const systemPrompt = `Extract the timezone from this message. The person is telling us their timezone or location.

MESSAGE:
"${messageContent}"

Look for:
- Timezone abbreviations: EST, PST, GMT, CET, IST, AEST, etc.
- City/country references: "I'm in New York", "London time", "I'm based in Singapore"
- Offset references: "GMT+5", "UTC-8"

Return ONLY valid JSON:
{"timezone": "IANA/Timezone" or null}

Examples:
- "I'm in EST" → {"timezone": "America/New_York"}
- "Pacific time" → {"timezone": "America/Los_Angeles"}
- "I'm based in London" → {"timezone": "Europe/London"}
- "GMT+1" → {"timezone": "Europe/Paris"}
- "I don't know" → {"timezone": null}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Extract the timezone.' },
        ],
        temperature: 0.1,
        max_tokens: 50,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.timezone || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate an AI message asking for the contact's timezone.
 */
async function generateTimezoneRequest(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  proposedTime: string,
  openRouterApiKey: string,
  model?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name')
    .eq('id', input.contactId)
    .single();

  const contactName = contact?.first_name || 'there';

  // Format the proposed time nicely
  const d = new Date(proposedTime);
  const timeStr = !isNaN(d.getTime())
    ? `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : 'that time';

  const systemPrompt = `You are an AI sales assistant. The contact proposed a meeting time (${timeStr}) but didn't specify their timezone. You need to confirm their timezone before booking.

CONTACT NAME: ${contactName}

Write a brief (1-2 sentences), warm message that:
1. Acknowledges their proposed time positively
2. Asks which timezone they're in so you can make sure you're synced up
3. Does NOT commit to the time yet — just confirm the timezone

Return ONLY the message text.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Draft the message.' },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Generate and queue/send an auto-reply.
 * Automatically intercepts scheduling messages to book via GHL or send a calendar link.
 */
async function handleAutoReply(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  rule: AutopilotRule,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
  bookingOnlyMode = false,
): Promise<ProcessAutopilotResult> {
  const calendarId = config.ghl_calendar_id;

  // --- Automatic scheduling intercept ---
  if (calendarId && input.messageContent) {
    // Check for in-progress booking state (Phase 2 continuation)
    const { data: convData } = await supabase
      .from('crm_conversations')
      .select('metadata')
      .eq('id', input.conversationId)
      .single();

    const pendingBooking = convData?.metadata?.pending_ghl_booking;

    // Skip entire booking flow if a meeting was already booked recently (< 24h) and no pending state
    const lastBooking = convData?.metadata?.last_ghl_booking;
    const recentlyBooked = lastBooking?.booked_at && !pendingBooking
      && (Date.now() - new Date(lastBooking.booked_at).getTime()) < 24 * 60 * 60 * 1000;

    if (recentlyBooked) {
      console.log('[Autopilot] Meeting already booked in this conversation — skipping booking intercept');
    }

    if (!recentlyBooked) {
    // Clear stale pending booking state (offered slots older than 24h)
    if (pendingBooking?.offered_at) {
      const offeredAgo = Date.now() - new Date(pendingBooking.offered_at).getTime();
      if (offeredAgo > 24 * 60 * 60 * 1000) {
        console.log('[Autopilot] Clearing stale pending booking (offered >24h ago)');
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: { pending_ghl_booking: null },
        });
        // Fall through to fresh scheduling detection below
      }
    }

    // Handle in-progress booking: awaiting email (max 3 retries)
    if (pendingBooking?.awaiting_email) {
      const emailRetries = pendingBooking.email_retries || 0;

      // Max retries reached — give up and fall through to normal auto-reply
      if (emailRetries >= 3) {
        console.log('[Autopilot] Max email request retries reached (3) — clearing pending booking');
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: { pending_ghl_booking: null },
        });
        // Fall through to normal auto-reply below
      } else {
      const emailMatch = input.messageContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const phoneMatch = input.messageContent.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/);

      console.log(`[Autopilot] awaiting_email: message="${input.messageContent.substring(0, 60)}" emailMatch=${emailMatch?.[0] || 'null'} phoneMatch=${phoneMatch?.[0] || 'null'}`);

      if (emailMatch || phoneMatch) {
        const { data: contact } = await supabase
          .from('crm_contacts')
          .select('email, phone')
          .eq('id', input.contactId)
          .single();

        const updatePayload: Record<string, string> = {};
        if (emailMatch && !contact?.email) updatePayload.email = emailMatch[0];
        if (phoneMatch && !contact?.phone) updatePayload.phone = phoneMatch[0].trim();

        if (Object.keys(updatePayload).length > 0) {
          const { error: contactUpdateErr } = await supabase.from('crm_contacts').update(updatePayload).eq('id', input.contactId);
          if (contactUpdateErr) {
            console.error('[Autopilot] CRITICAL: Failed to save contact email/phone:', contactUpdateErr.message);
          } else {
            console.log(`[Autopilot] Saved contact info: ${JSON.stringify(updatePayload)} on contact ${input.contactId}`);
          }
        }

        // Clear awaiting_email, proceed to fetch slots
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: { pending_ghl_booking: null },
        });

        // Fall through to slot fetching below
        return await handleAutoBookingPhase1(supabase, input, config, calendarId, null, openRouterApiKey, model);
      } else {
        // Increment retry counter atomically
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: {
            pending_ghl_booking: { ...pendingBooking, email_retries: emailRetries + 1 },
          },
        });

        const draft = 'Could you share your email address or phone number so I can get you booked in?';
        await queueForApproval(supabase, input, config, draft, 'auto_reply', true);
        return { action: 'auto_reply', queued: true, sent: false };
      }
      }
    }

    // Handle in-progress booking: awaiting timezone confirmation
    if (pendingBooking?.awaiting_timezone) {
      const tzResult = await parseTimezoneFromReply(input.messageContent, openRouterApiKey, model);
      if (tzResult) {
        console.log(`[Autopilot] Contact timezone parsed: ${tzResult}`);
        // Convert the stored proposed time from contact's timezone to booking timezone
        const storedTime = pendingBooking.proposed_time;
        const convertedTime = convertTimezone(storedTime, tzResult, config.booking_timezone || 'UTC');

        // Clear awaiting_timezone, proceed to booking with converted time
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: { pending_ghl_booking: null },
        });

        return await handleAutoBookingPhase1(supabase, input, config, calendarId, convertedTime, openRouterApiKey, model);
      } else {
        // Still can't parse timezone — offer slots instead
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: { pending_ghl_booking: null },
        });
        return await handleAutoBookingPhase1(supabase, input, config, calendarId, null, openRouterApiKey, model);
      }
    }

    // Handle in-progress booking: contact chose from offered slots (Phase 2)
    if (pendingBooking?.offered_slots && !pendingBooking?.awaiting_email) {
      return await handleBookingConfirmation(supabase, input, config, calendarId, pendingBooking, openRouterApiKey, model);
    }

    // No pending state — detect scheduling intent via LLM + keyword fallback
    // Fetch the last outbound message for context (critical for detecting confirmations like "Yes" / "Sounds good")
    const { data: lastOutbound } = await supabase
      .from('crm_messages')
      .select('content')
      .eq('conversation_id', input.conversationId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const bookingTimezone = config.booking_timezone || 'UTC';

    // Fast keyword-based scheduling detection (fallback for when LLM misses or errors)
    const bookingKeywords = /\b(book\s*(me\s*)?in|lock\s*(it\s*)?in|schedule\s*(a\s*)?(call|meeting|demo)|let'?s\s+book|set\s+up\s+a?\s*(call|meeting|demo)|when\s+can\s+we\s+meet|pick\s+a\s+time)\b/i;
    const isKeywordScheduling = bookingKeywords.test(input.messageContent) || input.intent === 'meeting_booked';

    const scheduling = await detectSchedulingAndExtractTime(
      input.messageContent, bookingTimezone, openRouterApiKey, model, lastOutbound?.content || undefined,
    );

    // Use keyword detection as fallback if LLM says no scheduling
    if (!scheduling.isScheduling && isKeywordScheduling) {
      console.log(`[Autopilot] LLM missed scheduling — keyword fallback triggered for: "${input.messageContent.substring(0, 80)}" (intent=${input.intent})`);
      scheduling.isScheduling = true;
    }

    if (!scheduling.isScheduling) {
      console.log(`[Autopilot] Scheduling NOT detected for: "${input.messageContent.substring(0, 80)}" (intent=${input.intent})`);
    }

    if (scheduling.isScheduling) {
      console.log('[Autopilot] Scheduling detected —', scheduling.proposedTime ? `proposed: ${scheduling.proposedTime}` : 'no specific time',
        scheduling.contactTimezone ? `tz: ${scheduling.contactTimezone}` : scheduling.timezoneUnknown ? '(tz unknown)' : '');

      // Check contact has email/phone (GHL requirement)
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('email, phone')
        .eq('id', input.contactId)
        .single();

      if (!contact?.email && !contact?.phone) {
        console.log(`[Autopilot] Contact ${input.contactId} has no email/phone — requesting contact info`);
        const draft = await generateContactInfoRequest(supabase, input, config, state, openRouterApiKey, model);
        const { error: rpcError } = await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: {
            pending_ghl_booking: { awaiting_email: true, calendar_id: calendarId },
          },
        });

        if (rpcError) {
          console.error('[Autopilot] CRITICAL: Failed to set pending_ghl_booking.awaiting_email:', rpcError.message);
        } else {
          console.log('[Autopilot] Set pending_ghl_booking.awaiting_email on conversation', input.conversationId);
        }

        if (draft) {
          await queueForApproval(supabase, input, config, draft, 'auto_reply', true);
        }
        return { action: 'auto_reply', queued: !!draft, sent: false };
      }

      // If contact proposed a specific time but timezone is unknown, ask for it
      if (scheduling.proposedTime && scheduling.timezoneUnknown) {
        console.log('[Autopilot] Proposed time with unknown timezone — asking contact');
        const draft = await generateTimezoneRequest(supabase, input, config, scheduling.proposedTime, openRouterApiKey, model);
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: {
            pending_ghl_booking: {
              awaiting_timezone: true,
              calendar_id: calendarId,
              proposed_time: scheduling.proposedTime,
            },
          },
        });

        if (draft) {
          await queueForApproval(supabase, input, config, draft, 'auto_reply', true);
        }
        return { action: 'auto_reply', queued: !!draft, sent: false };
      }

      // If contact specified a timezone, convert the proposed time to booking timezone
      let resolvedTime = scheduling.proposedTime || null;
      if (resolvedTime && scheduling.contactTimezone && scheduling.contactTimezone !== bookingTimezone) {
        resolvedTime = convertTimezone(resolvedTime, scheduling.contactTimezone, bookingTimezone);
        console.log(`[Autopilot] Converted ${scheduling.proposedTime} from ${scheduling.contactTimezone} to ${bookingTimezone}: ${resolvedTime}`);
      }

      // Contact has email — proceed with booking
      return await handleAutoBookingPhase1(supabase, input, config, calendarId, resolvedTime, openRouterApiKey, model);
    }
    } // end if (!recentlyBooked)
  }

  // No calendar configured — check for calendly link as fallback for scheduling
  if (!calendarId && input.messageContent) {
    const schedulingPattern = /\b(?:meet(?:ing)?|call|demo|catch up|hop on|schedule|calendar|book(?:ing)?|slot|available|availability|book\s+me\s+in)\b/i;
    const isSchedulingIntent = input.intent === 'meeting_booked' || input.intent === 'interested';

    if (isSchedulingIntent || schedulingPattern.test(input.messageContent)) {
      const calendlyRule = config.rules.find((r) => r.action === 'send_calendly' && r.calendly_link);
      if (calendlyRule) {
        console.log('[Autopilot] Scheduling detected, no GHL calendar — redirecting to send_calendly');
        return handleSendCalendly(supabase, input, config, calendlyRule, state, openRouterApiKey, model);
      }
    }
  }

  // In booking-only mode (max replies reached but calendar configured), don't generate
  // normal auto-replies — only booking flow messages are allowed past the limit.
  if (bookingOnlyMode) {
    console.log('[Autopilot] Booking-only mode — no scheduling detected, stopping');
    return { action: 'auto_reply', queued: false, sent: false };
  }

  // --- Normal auto-reply (no scheduling or no calendar) ---
  const draft = rule.message_template
    ? rule.message_template
    : await generateAgentDraft(supabase, input, config, state, openRouterApiKey, model);

  if (!draft) {
    console.error('[Autopilot] Failed to generate auto-reply draft');
    return { action: 'auto_reply', queued: false, sent: false };
  }

  if (config.require_approval) {
    await queueForApproval(supabase, input, config, draft, 'auto_reply');
    return { action: 'auto_reply', queued: true, sent: false };
  }

  await queueForApproval(supabase, input, config, draft, 'auto_reply', true);
  return { action: 'auto_reply', queued: true, sent: false };
}

/**
 * Book a specific slot directly via GHL API.
 * Shared between Phase 1 (direct time match) and Phase 2 (confirmation match / new time proposal).
 */
async function bookSlotDirectly(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  calendarId: string,
  slot: { date: string; time: string },
  bookingTimezone: string,
  openRouterApiKey: string,
  model: string,
): Promise<ProcessAutopilotResult> {
  // --- Race condition guard: prevent double-booking if two messages process in parallel ---
  const { data: convCheck } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', input.conversationId)
    .single();

  const lastBooking = convCheck?.metadata?.last_ghl_booking;
  if (lastBooking?.booked_at) {
    const bookedAgo = Date.now() - new Date(lastBooking.booked_at).getTime();
    if (bookedAgo < 60_000) {
      console.log(`[Autopilot] bookSlotDirectly: Booking already completed ${Math.round(bookedAgo / 1000)}s ago — skipping to prevent double-booking`);
      return { action: 'book_ghl_appointment', queued: false, sent: false };
    }
  }

  const startTime = slot.time.includes('T') ? slot.time : `${slot.date}T${slot.time}:00`;
  const endTime = calculateEndTime(slot.date, slot.time, 30);

  const sourceType = input.sequenceId ? 'email_sequence' : input.campaignId ? 'linkedin_campaign' : 'lead_magnet';
  const sourceId = input.sequenceId || input.campaignId || input.leadMagnetCampaignId;

  try {
    const { accessToken, locationId } = await getGHLAccessToken(supabase, input.organizationId);

    const { data: crmContact } = await supabase
      .from('crm_contacts')
      .select('first_name, last_name, email, phone, company, job_title, linkedin_url')
      .eq('id', input.contactId)
      .single();

    if (!crmContact?.email && !crmContact?.phone) {
      console.error('[Autopilot] bookSlotDirectly: Contact has no email or phone — cannot book');
      return { action: 'book_ghl_appointment', queued: false, sent: false };
    }

    const ghlContact = await upsertGHLContact(accessToken, locationId, {
      email: crmContact.email || undefined,
      phone: crmContact.phone || undefined,
      firstName: crmContact.first_name || undefined,
      lastName: crmContact.last_name || undefined,
      companyName: crmContact.company || undefined,
      source: 'ACA Autopilot Booking',
      tags: ['autopilot-booking'],
      customFields: [
        ...(crmContact.job_title ? [{ key: 'job_title', field_value: crmContact.job_title }] : []),
        ...(crmContact.linkedin_url ? [{ key: 'linkedin_url', field_value: crmContact.linkedin_url }] : []),
      ],
    });
    console.log('[Autopilot] bookSlotDirectly: Upserted GHL contact:', ghlContact.id);

    const appointment = await createGHLAppointment(accessToken, {
      calendarId,
      locationId,
      contactId: ghlContact.id,
      startTime,
      endTime,
      title: 'Meeting',
      appointmentStatus: 'new',
      toNotify: true,
    });
    console.log('[Autopilot] bookSlotDirectly: Created GHL appointment:', appointment.id);

    await supabase.from('ghl_appointment_log').insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      ghl_calendar_id: calendarId,
      ghl_contact_id: ghlContact.id,
      ghl_appointment_id: appointment.id,
      appointment_status: 'booked',
      start_time: startTime,
      end_time: endTime,
      timezone: bookingTimezone,
      title: 'Meeting',
      source_type: sourceType,
      source_id: sourceId || null,
    });

    const confirmDraft = await generateBookingConfirmationDraft(
      supabase, input, config, { startTime, endTime }, openRouterApiKey, model, bookingTimezone,
    );

    await supabase.rpc('merge_conversation_metadata', {
      p_conversation_id: input.conversationId,
      p_metadata_update: {
        pending_ghl_booking: null,
        last_ghl_booking: {
          appointment_id: appointment.id,
          ghl_contact_id: ghlContact.id,
          booked_at: new Date().toISOString(),
          start_time: startTime,
        },
      },
    });

    const finalConfirm = confirmDraft || `Great news — your meeting is confirmed for ${startTime ? formatSlotDateTime(startTime, bookingTimezone) : 'the requested time'}! Looking forward to connecting with you.`;
    await queueForApproval(supabase, input, config, finalConfirm, 'book_ghl_appointment', true);
    return { action: 'book_ghl_appointment', queued: true, sent: false };
  } catch (err: any) {
    console.error('[Autopilot] bookSlotDirectly error:', err?.message || err);
    const errMsg = String(err?.message || '');
    if (errMsg.includes('slot') || errMsg.includes('available') || errMsg.includes('conflict')) {
      return await handleSlotUnavailable(supabase, input, config, calendarId, openRouterApiKey, model, bookingTimezone);
    }
    return { action: 'book_ghl_appointment', queued: false, sent: false };
  }
}

/**
 * Automatic booking Phase 1: Fetch slots, try direct booking if time proposed, or offer options.
 */
async function handleAutoBookingPhase1(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  calendarId: string,
  proposedTime: string | null,
  openRouterApiKey: string,
  model?: string,
): Promise<ProcessAutopilotResult> {
  const bookingTimezone = config.booking_timezone || 'UTC';

  const now = new Date();
  const startDate = now.toISOString().split('T')[0];
  const endDate = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`[Autopilot] handleAutoBookingPhase1: calendarId=${calendarId}, orgId=${input.organizationId}, range=${startDate}→${endDate}, tz=${bookingTimezone}, proposedTime=${proposedTime}`);

  // Fetch free slots from GHL directly (no edge function hop)
  let slotsMap: Record<string, { slots: string[] }>;
  try {
    console.log(`[Autopilot] Getting GHL access token for org ${input.organizationId}...`);
    const { accessToken } = await getGHLAccessToken(supabase, input.organizationId);
    console.log(`[Autopilot] Got GHL token, fetching free slots for calendar ${calendarId}...`);

    // Use millisecond timestamps for GHL API
    const startMs = now.getTime();
    const endMs = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).getTime();
    const rawSlots = await getGHLFreeSlots(accessToken, calendarId, startMs, endMs, bookingTimezone);

    const slotDays = Object.keys(rawSlots || {}).length;
    const totalSlots = Object.values(rawSlots || {}).reduce((sum: number, d: any) => sum + (d?.slots?.length || 0), 0);
    console.log(`[Autopilot] GHL free slots: ${slotDays} days, ${totalSlots} total slots. Raw: ${JSON.stringify(rawSlots).substring(0, 500)}`);
    slotsMap = rawSlots as Record<string, { slots: string[] }>;
  } catch (err) {
    console.error('[Autopilot] FAILED to fetch GHL free slots:', err);
    // Fall back to guardrailed auto-reply
    const fallback = await generateAgentDraft(supabase, input, config, null, openRouterApiKey, model);
    if (fallback) await queueForApproval(supabase, input, config, fallback, 'auto_reply', true);
    return { action: 'auto_reply', queued: !!fallback, sent: false };
  }

  // If contact proposed a specific time, try to book it directly
  if (proposedTime) {
    const matchedSlot = findMatchingSlot(proposedTime, slotsMap);

    if (matchedSlot) {
      console.log(`[Autopilot] Proposed time matches slot: ${matchedSlot.date} ${matchedSlot.time} — booking directly`);
      return await bookSlotDirectly(supabase, input, config, calendarId, matchedSlot, bookingTimezone, openRouterApiKey, model || DEFAULT_DRAFTER_MODEL);
    } else {
      console.log('[Autopilot] Proposed time not available — will offer alternatives');
    }
  }

  // No proposed time, or proposed time not available — offer slot options
  const representativeSlots = pickRepresentativeSlots(slotsMap, 6);

  if (representativeSlots.length === 0) {
    console.warn('[Autopilot] No free slots available for calendar', calendarId);
    const fallback = await generateCalendarFullDraft(supabase, input, config, openRouterApiKey, model);
    if (fallback) await queueForApproval(supabase, input, config, fallback, 'auto_reply', true);
    return { action: 'auto_reply', queued: !!fallback, sent: false };
  }

  const isRetry = !!proposedTime; // If they proposed a time that wasn't available, note it
  const draft = await generateBookingDraft(supabase, input, config, null, representativeSlots, openRouterApiKey, model, isRetry, bookingTimezone);

  if (!draft) {
    console.error('[Autopilot] Failed to generate booking draft');
    return { action: 'auto_reply', queued: false, sent: false };
  }

  // Expire any stale pending queue items for this conversation (e.g. old "calendar full" drafts)
  await supabase
    .from('inbox_autopilot_queue')
    .update({ status: 'expired' })
    .eq('conversation_id', input.conversationId)
    .eq('status', 'pending');

  // Store pending booking state for Phase 2
  await supabase.rpc('merge_conversation_metadata', {
    p_conversation_id: input.conversationId,
    p_metadata_update: {
      pending_ghl_booking: {
        calendar_id: calendarId,
        offered_slots: representativeSlots,
        offered_at: new Date().toISOString(),
        timezone: bookingTimezone,
      },
    },
  });

  await queueForApproval(supabase, input, config, draft, 'auto_reply', true);
  return { action: 'auto_reply', queued: true, sent: false };
}

/**
 * Generate and queue/send a message with the calendly link embedded.
 */
async function handleSendCalendly(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  rule: AutopilotRule,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
): Promise<ProcessAutopilotResult> {
  const calendlyLink = rule.calendly_link || '';
  if (!calendlyLink) {
    console.error('[Autopilot] No calendly_link configured for send_calendly rule');
    return { action: 'send_calendly', queued: false, sent: false };
  }

  // Generate a message that naturally includes the calendly link
  const draft = await generateCalendlyDraft(supabase, input, config, state, calendlyLink, openRouterApiKey, model);

  if (!draft) {
    console.error('[Autopilot] Failed to generate calendly draft');
    return { action: 'send_calendly', queued: false, sent: false };
  }

  if (config.require_approval) {
    await queueForApproval(supabase, input, config, draft, 'send_calendly');
    return { action: 'send_calendly', queued: true, sent: false };
  }

  await queueForApproval(supabase, input, config, draft, 'send_calendly', true);
  return { action: 'send_calendly', queued: true, sent: false };
}

/**
 * Handle OOO auto-followup: parse the return date and set a snooze.
 */
async function handleAutoFollowupAfterReturn(
  supabase: any,
  input: ProcessAutopilotInput,
): Promise<ProcessAutopilotResult> {
  // Fetch the inbound message body to parse the OOO return date
  const { data: inboundMessage } = await supabase
    .from('crm_messages')
    .select('content')
    .eq('id', input.inboundMessageId)
    .single();

  const body = inboundMessage?.content || '';
  const returnDate = parseOOOReturnDate(body);

  if (returnDate) {
    // Set snooze on the conversation
    const { error } = await supabase
      .from('crm_conversations')
      .update({
        snoozed_until: returnDate.toISOString(),
        metadata: await mergeMetadata(supabase, input.conversationId, {
          ooo_return_date: returnDate.toISOString(),
          ooo_detected_at: new Date().toISOString(),
          ooo_trigger_message_id: input.inboundMessageId,
        }),
      })
      .eq('id', input.conversationId);

    if (error) {
      console.error('[Autopilot] Failed to set snooze:', error.message);
    } else {
      console.log(
        `[Autopilot] Set snooze until ${returnDate.toISOString()} for conversation ${input.conversationId}`,
      );
    }
  } else {
    console.log(
      `[Autopilot] Could not parse OOO return date for conversation ${input.conversationId}`,
    );
  }

  return { action: 'auto_followup_after_return', queued: false, sent: false };
}

/**
 * Generate a draft and queue it for human approval.
 */
async function handleDraftForApproval(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
): Promise<ProcessAutopilotResult> {
  const draft = await generateAgentDraft(supabase, input, config, state, openRouterApiKey, model);

  if (!draft) {
    console.error('[Autopilot] Failed to generate draft for approval');
    return { action: 'draft_for_approval', queued: false, sent: false };
  }

  await queueForApproval(supabase, input, config, draft, 'draft_for_approval');
  return { action: 'draft_for_approval', queued: true, sent: false };
}

/**
 * Generate a draft and queue it with escalation metadata.
 */
async function handleEscalate(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
): Promise<ProcessAutopilotResult> {
  const draft = await generateAgentDraft(supabase, input, config, state, openRouterApiKey, model);

  await queueForApproval(supabase, input, config, draft || '(Escalated — no draft generated)', 'escalate', false, {
    escalated: true,
    reason: 'Explicit escalate rule matched',
  });

  return { action: 'escalate', queued: true, sent: false };
}

// ============================================================================
// LLM Draft Generation — Agent Engine
// ============================================================================

/**
 * Generate a contextual agent reply using full conversation context,
 * contact CRM data, optional knowledge base, and optional tone profile.
 */
async function generateAgentDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  // Fetch full conversation history for context
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('content, sender_type, created_at, email_subject')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false });

  const threadMessages = (messages || []).reverse();

  // Fetch full contact context via buildContactContext
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name, company, job_title, lead_score, tags, enrichment_data')
    .eq('id', input.contactId)
    .single();

  const contactContext = buildContactContext(contact);

  // Optional: Knowledge base retrieval
  let kbBlock = '';
  if (config.use_knowledge_base) {
    try {
      const searchQuery = threadMessages
        .slice(-3)
        .map((m: any) => m.content || '')
        .join(' ')
        .slice(0, 500);

      if (searchQuery.trim()) {
        const kbResult = config.knowledge_document_ids?.length
          ? await retrieveChunksByDocIds(
              supabase, input.organizationId, config.knowledge_document_ids, searchQuery, openRouterApiKey, 3,
            )
          : await retrieveOrgChunks(
              supabase, input.organizationId, searchQuery, openRouterApiKey, 3,
            );
        if (kbResult.chunks.length > 0) {
          kbBlock = formatKnowledgeContext(kbResult.chunks) + '\n';
        }
      }
    } catch (kbError) {
      console.error('[Autopilot] KB retrieval failed (non-critical):', kbError);
    }
  }

  // Optional: Tone profile loading
  let toneBlock = '';
  if (config.use_tone_profile && config.owner_user_id) {
    try {
      const { toneSummary } = await loadOrCreateToneProfile(
        supabase,
        config.owner_user_id,
        input.organizationId,
        input.channel,
        openRouterApiKey,
        effectiveModel,
      );
      if (toneSummary) {
        toneBlock = `TONE REFERENCE (match this writing style):\n${toneSummary}\n\n`;
      }
    } catch (toneError) {
      console.error('[Autopilot] Tone profile loading failed (non-critical):', toneError);
    }
  }

  const channelHints: Record<string, string> = {
    email: `This is an email conversation. Write your reply as a proper email body:
- Use a brief greeting (e.g. "Hi [Name],") and sign off naturally
- Write in full sentences with proper paragraphs
- Stay on the email subject topic
- Be professional but warm — match the formality of the thread`,
    linkedin: `This is a LinkedIn DM conversation. Write your reply as a chat message:
- No greeting or sign-off needed unless it's a first message
- Keep it to 1-3 sentences, professional but conversational
- Write like a networking chat, not a formal email`,
    instagram: `This is an Instagram DM conversation. Write your reply as a chat message:
- Very casual and friendly tone
- 1-2 sentences max, like texting
- Use natural language, no formalities`,
    whatsapp: `This is a WhatsApp conversation. Write your reply as a chat message:
- Short and direct, 1-3 sentences
- Conversational tone, like texting a colleague
- No greeting or sign-off needed`,
    telegram: `This is a Telegram conversation. Write your reply as a chat message:
- Concise and direct, 1-2 sentences
- Casual tone, no formalities`,
    messenger: `This is a Messenger conversation. Write your reply as a chat message:
- Casual and friendly, 1-2 sentences
- Like texting a friend`,
    twitter: `This is a Twitter/X DM conversation. Write your reply as a chat message:
- Short and punchy, 1-2 sentences
- Casual and direct`,
    sms: `This is an SMS conversation. Write your reply as a text message:
- Very short, 1-2 sentences max
- Direct and to the point, like texting`,
  };
  const channelHint = channelHints[input.channel] || `This is a ${input.channel} messaging conversation. Write your reply as a chat message — keep it short, conversational, 1-3 sentences.`;

  const systemPrompt = `You are an AI assistant replying in a ${input.channel} conversation.

CHANNEL: ${channelHint}

CONTACT CONTEXT:
${contactContext}

CONVERSATION PHASE: ${state?.phase || 'greeting'} (turn ${(state?.turn_count || 0) + 1})
${state?.goal_progress ? `PROGRESS SO FAR: ${state.goal_progress}` : ''}

${toneBlock}${kbBlock}GOAL: ${config.conversation_goal || 'Help the contact and guide toward a productive outcome'}

ADDITIONAL INSTRUCTIONS:
${config.system_instructions || '(none)'}

RULES:
1. Your reply MUST directly address what the contact said in their latest message — read it carefully
2. Ground your reply in the actual conversation history — reference earlier points when relevant to show continuity
3. Steer toward the GOAL naturally, but only when it fits what the contact is discussing
4. Match the tone reference closely (if provided), otherwise match the contact's tone
5. Use KNOWLEDGE BASE facts when relevant — never fabricate information
6. Follow the CHANNEL formatting guidance above — emails are structured, all other channels are short chat messages
7. ${config.ghl_calendar_id
    ? 'When the contact wants to schedule a meeting or confirms a time, DO NOT say the meeting is "booked", "locked in", "confirmed", or "scheduled". Instead, ask for their preferred time if not yet discussed, or say something like "Great, let me check availability for that time" or "Perfect, I\'ll get that set up for you right now". The booking system handles the actual scheduling separately — you must NOT claim it\'s already done.'
    : 'NEVER agree to specific meeting times, propose time slots, confirm availability, or promise to send calendar invites. You do NOT have calendar access. If the contact wants to schedule a meeting, say you\'d love to find a time and that you\'ll have someone follow up with booking details shortly.'}
8. Never share pricing unless explicitly instructed
9. If unsure or uncomfortable, suggest connecting with the team
10. Return ONLY the reply text — no JSON, no explanation, no signatures

After the conversation messages below, draft the next reply.`;

  // Build chat messages with proper role mapping for native conversation understanding
  const chatMessages = buildChatMessages(threadMessages, systemPrompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DRAFTER_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Autopilot] LLM error:', errorText);
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    return raw ? sanitizeAIOutput(raw) : null;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Autopilot] Draft generation timed out');
    } else {
      console.error('[Autopilot] Draft generation error:', error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a draft that naturally incorporates a calendly link.
 * Enhanced with full contact context, optional tone, and knowledge base.
 */
async function generateCalendlyDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  calendlyLink: string,
  openRouterApiKey: string,
  model?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  // Fetch full conversation history for context
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('content, sender_type, created_at, email_subject')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false });

  const threadMessages = (messages || []).reverse();

  // Fetch full contact context
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name, company, job_title, lead_score, tags, enrichment_data')
    .eq('id', input.contactId)
    .single();

  const contactContext = buildContactContext(contact);

  // Optional: Tone profile loading
  let toneBlock = '';
  if (config.use_tone_profile && config.owner_user_id) {
    try {
      const { toneSummary } = await loadOrCreateToneProfile(
        supabase,
        config.owner_user_id,
        input.organizationId,
        input.channel,
        openRouterApiKey,
        effectiveModel,
      );
      if (toneSummary) {
        toneBlock = `TONE REFERENCE (match this writing style):\n${toneSummary}\n\n`;
      }
    } catch (toneError) {
      console.error('[Autopilot] Calendly tone loading failed (non-critical):', toneError);
    }
  }

  const systemPrompt = `You are an AI sales agent drafting a reply that naturally invites the contact to book a meeting.

GOAL: Guide the contact to book a meeting via the scheduling link.

CONTACT CONTEXT:
${contactContext}

CONVERSATION PHASE: ${state?.phase || 'greeting'} (turn ${(state?.turn_count || 0) + 1})

Calendly link: ${calendlyLink}

${toneBlock}RULES:
1. Naturally reference the scheduling link — do not just paste it
2. Match the tone reference closely (if provided)
3. Keep it to 2-3 sentences
4. Be warm and professional
5. Reference specific details from the conversation when relevant
6. Return ONLY the reply text — no JSON, no explanation

After the conversation messages below, draft a reply that naturally includes the scheduling link.`;

  // Build chat messages with proper role mapping
  const chatMessages = buildChatMessages(threadMessages, systemPrompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DRAFTER_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Autopilot] Calendly draft LLM error:', errorText);
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    return raw ? sanitizeAIOutput(raw) : null;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Autopilot] Calendly draft timed out');
    } else {
      console.error('[Autopilot] Calendly draft error:', error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// GHL Appointment Booking (two-phase conversational flow)
// ============================================================================

/**
 * Handle the "book_ghl_appointment" autopilot action.
 *
 * Two-phase flow:
 *   Phase 1: Fetch free slots, suggest times to contact
 *   Phase 2: Parse contact's chosen time, book the appointment
 *
 * If contact lacks email/phone, asks for contact info first.
 */
async function handleBookGHLAppointment(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  rule: AutopilotRule,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
): Promise<ProcessAutopilotResult> {
  const calendarId = rule.ghl_calendar_id;
  if (!calendarId) {
    console.error('[Autopilot] No ghl_calendar_id configured for book_ghl_appointment rule');
    return { action: 'book_ghl_appointment', queued: false, sent: false };
  }

  // Check conversation metadata for pending booking state
  const { data: convData } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', input.conversationId)
    .single();

  const pendingBooking = convData?.metadata?.pending_ghl_booking;

  // Check if contact has email or phone (GHL requirement)
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('email, phone, first_name, last_name')
    .eq('id', input.contactId)
    .single();

  const hasContactInfo = !!(contact?.email || contact?.phone);

  // If awaiting email from a previous turn, try to capture it
  if (pendingBooking?.awaiting_email && input.messageContent) {
    const emailMatch = input.messageContent.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const phoneMatch = input.messageContent.match(/[\+]?[\d\s\-().]{7,}/);

    if (emailMatch || phoneMatch) {
      // Update the CRM contact with captured info
      const updatePayload: Record<string, string> = {};
      if (emailMatch && !contact?.email) updatePayload.email = emailMatch[0];
      if (phoneMatch && !contact?.phone) updatePayload.phone = phoneMatch[0].trim();

      if (Object.keys(updatePayload).length > 0) {
        await supabase
          .from('crm_contacts')
          .update(updatePayload)
          .eq('id', input.contactId);
      }

      // Clear awaiting_email flag and proceed to Phase 1
      await supabase.rpc('merge_conversation_metadata', {
        p_conversation_id: input.conversationId,
        p_metadata_update: { pending_ghl_booking: null },
      });

      // Fall through to Phase 1 below
    } else {
      // Still no email/phone — ask again
      const draft = 'Could you share your email address or phone number so I can get you booked in?';
      await queueForApproval(supabase, input, config, draft, 'book_ghl_appointment', true);
      return { action: 'book_ghl_appointment', queued: true, sent: false };
    }
  }

  // If no contact info and not in awaiting_email state, ask for it
  if (!hasContactInfo && !pendingBooking?.awaiting_email) {
    const draft = await generateContactInfoRequest(supabase, input, config, state, openRouterApiKey, model);

    // Set awaiting_email state atomically
    await supabase.rpc('merge_conversation_metadata', {
      p_conversation_id: input.conversationId,
      p_metadata_update: {
        pending_ghl_booking: { awaiting_email: true, calendar_id: calendarId },
      },
    });

    if (draft) {
      await queueForApproval(supabase, input, config, draft, 'book_ghl_appointment', true);
    }
    return { action: 'book_ghl_appointment', queued: !!draft, sent: false };
  }

  // Phase 2: If we already offered slots, parse the contact's choice
  if (pendingBooking?.offered_slots && !pendingBooking?.awaiting_email) {
    return await handleBookingConfirmation(supabase, input, config, calendarId, pendingBooking, openRouterApiKey, model);
  }

  // Phase 1: Fetch free slots and suggest times
  const bookingTimezone = config.booking_timezone || 'UTC';

  const now = new Date();

  let slotsMap: Record<string, { slots: string[] }>;
  try {
    console.log(`[Autopilot] handleBookGHLAppointment Phase 1: fetching slots for calendar ${calendarId}, org ${input.organizationId}`);
    const { accessToken } = await getGHLAccessToken(supabase, input.organizationId);
    const startMs = now.getTime();
    const endMs = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).getTime();
    const rawSlots = await getGHLFreeSlots(accessToken, calendarId, startMs, endMs, bookingTimezone);

    const slotDays = Object.keys(rawSlots || {}).length;
    const totalSlots = Object.values(rawSlots || {}).reduce((sum: number, d: any) => sum + (d?.slots?.length || 0), 0);
    console.log(`[Autopilot] GHL free slots (rule path): ${slotDays} days, ${totalSlots} total slots`);
    slotsMap = rawSlots as Record<string, { slots: string[] }>;
  } catch (err) {
    console.error('[Autopilot] Failed to fetch GHL free slots (rule path):', err);
    // Fall back to a generic interested reply
    const fallback = await generateAgentDraft(supabase, input, config, state, openRouterApiKey, model);
    if (fallback) await queueForApproval(supabase, input, config, fallback, 'book_ghl_appointment', true);
    return { action: 'book_ghl_appointment', queued: !!fallback, sent: false };
  }

  const representativeSlots = pickRepresentativeSlots(slotsMap, 6);

  if (representativeSlots.length === 0) {
    console.warn('[Autopilot] No free slots available for calendar', calendarId);
    const fallback = await generateCalendarFullDraft(supabase, input, config, openRouterApiKey, model);
    if (fallback) await queueForApproval(supabase, input, config, fallback, 'book_ghl_appointment', true);
    return { action: 'book_ghl_appointment', queued: !!fallback, sent: false };
  }

  // Generate AI draft suggesting times
  const draft = await generateBookingDraft(supabase, input, config, state, representativeSlots, openRouterApiKey, model, false, bookingTimezone);

  if (!draft) {
    console.error('[Autopilot] Failed to generate booking draft');
    return { action: 'book_ghl_appointment', queued: false, sent: false };
  }

  // Store pending booking state atomically
  await supabase.rpc('merge_conversation_metadata', {
    p_conversation_id: input.conversationId,
    p_metadata_update: {
      pending_ghl_booking: {
        calendar_id: calendarId,
        offered_slots: representativeSlots,
        offered_at: new Date().toISOString(),
        timezone: bookingTimezone,
      },
    },
  });

  await queueForApproval(supabase, input, config, draft, 'book_ghl_appointment', true);
  return { action: 'book_ghl_appointment', queued: true, sent: false };
}

/**
 * Phase 2: Parse the contact's reply to identify which slot they chose and book it.
 * Now also handles direct time requests (e.g. "book me in for 3PM") by checking the
 * full GHL calendar, not just the previously offered subset.
 */
async function handleBookingConfirmation(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  calendarId: string,
  pendingBooking: any,
  openRouterApiKey: string,
  model?: string,
): Promise<ProcessAutopilotResult> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;
  const bookingTimezone = pendingBooking.timezone || config.booking_timezone || 'UTC';

  // Fetch the inbound message
  const { data: inboundMsg } = await supabase
    .from('crm_messages')
    .select('content')
    .eq('id', input.inboundMessageId)
    .single();

  const contactReply = inboundMsg?.content || input.messageContent || '';
  const offeredSlots: Array<{ date: string; time: string }> = pendingBooking.offered_slots || [];

  // Fetch last outbound for context (critical for detecting "Yes" / "Sounds good" confirmations)
  const { data: lastOutbound } = await supabase
    .from('crm_messages')
    .select('content')
    .eq('conversation_id', input.conversationId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // --- Step 1: Understand what the contact ACTUALLY wants ---
  // Short numeric replies like "3", "2", "1" are almost certainly positional references
  // ("option 3"), not times ("3PM"). Skip scheduling detection for these — go straight
  // to extractChosenSlot which handles positional refs properly.
  const isShortNumericReply = /^\s*\d{1,2}\s*[.!]?\s*$/.test(contactReply);
  const scheduling = isShortNumericReply
    ? { isScheduling: false, proposedTime: undefined, contactTimezone: undefined, timezoneUnknown: false }
    : await detectSchedulingAndExtractTime(
        contactReply, bookingTimezone, openRouterApiKey, model, lastOutbound?.content || undefined,
      );

  // --- Step 2: If they proposed a specific time, try to book it ---
  if (scheduling.proposedTime) {
    console.log(`[Autopilot] Phase 2: Contact proposed specific time: ${scheduling.proposedTime} (tz: ${scheduling.contactTimezone || 'assumed ' + bookingTimezone})`);

    // Handle timezone conversion if needed
    let resolvedTime = scheduling.proposedTime;
    if (scheduling.contactTimezone && scheduling.contactTimezone !== bookingTimezone) {
      resolvedTime = convertTimezone(scheduling.proposedTime, scheduling.contactTimezone, bookingTimezone);
      console.log(`[Autopilot] Phase 2: Converted ${scheduling.proposedTime} from ${scheduling.contactTimezone} to ${bookingTimezone}: ${resolvedTime}`);
    }

    // --- Ambiguity check: if the contact said only a time (no date) and multiple offered
    // slots match that time on different dates, ask them to clarify the date instead of
    // silently booking the LLM's best guess. ---
    const proposedHHMM = resolvedTime.split('T')[1]?.substring(0, 5); // "15:00"
    if (proposedHHMM) {
      const matchingOfferedByDate = offeredSlots.filter((s) => {
        const slotHHMM = s.time.includes('T')
          ? s.time.substring(s.time.indexOf('T') + 1, s.time.indexOf('T') + 6)
          : s.time.substring(0, 5);
        return slotHHMM === proposedHHMM;
      });
      const uniqueDates = [...new Set(matchingOfferedByDate.map((s) => s.date))];

      if (uniqueDates.length > 1) {
        // Multiple dates have the same time — check if the contact specified a date
        const hasDateRef = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next\s+week|\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\s+\/\s*\d))/i.test(contactReply);

        if (!hasDateRef) {
          console.log(`[Autopilot] Phase 2: Ambiguous — ${proposedHHMM} matches on ${uniqueDates.join(', ')} but no date specified. Asking to clarify.`);
          const ambiguousSlots = matchingOfferedByDate.map((s) => {
            const d = new Date(s.time.includes('T') ? s.time : `${s.date}T${s.time}`);
            const tzOpt = bookingTimezone ? { timeZone: bookingTimezone } : {};
            return !isNaN(d.getTime())
              ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...tzOpt })
              : s.date;
          });
          const clarifyDraft = `I've got ${proposedHHMM.replace(/^0/, '')} available on both ${ambiguousSlots.join(' and ')} — which date works best for you?`;
          await queueForApproval(supabase, input, config, clarifyDraft, 'book_ghl_appointment', true);
          return { action: 'book_ghl_appointment', queued: true, sent: false };
        }
      }
    }

    // Step 2a: Try matching against offered slots first (no API call needed)
    const offeredSlotsMap = buildSlotsMapFromOffered(offeredSlots);
    const offeredMatch = findMatchingSlot(resolvedTime, offeredSlotsMap);

    if (offeredMatch) {
      console.log(`[Autopilot] Phase 2: Proposed time matches offered slot: ${offeredMatch.date} ${offeredMatch.time} — booking directly`);
      return await bookSlotDirectly(supabase, input, config, calendarId, offeredMatch, bookingTimezone, openRouterApiKey, effectiveModel);
    }

    // Step 2b: Not in offered slots — re-fetch FULL GHL calendar
    console.log('[Autopilot] Phase 2: Proposed time not in offered slots — checking full calendar');
    try {
      const { accessToken } = await getGHLAccessToken(supabase, input.organizationId);
      const now = new Date();
      const startMs = now.getTime();
      const endMs = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).getTime();
      const fullSlotsMap = await getGHLFreeSlots(accessToken, calendarId, startMs, endMs, bookingTimezone) as Record<string, { slots: string[] }>;

      const fullMatch = findMatchingSlot(resolvedTime, fullSlotsMap);

      if (fullMatch) {
        console.log(`[Autopilot] Phase 2: Proposed time matches full calendar slot: ${fullMatch.date} ${fullMatch.time} — booking directly`);
        return await bookSlotDirectly(supabase, input, config, calendarId, fullMatch, bookingTimezone, openRouterApiKey, effectiveModel);
      }

      // Step 2c: Time not available ANYWHERE — tell them specifically and offer alternatives
      console.log(`[Autopilot] Phase 2: Proposed time ${resolvedTime} not available in calendar — offering alternatives`);
      const newRepSlots = pickRepresentativeSlots(fullSlotsMap, 6);

      // Update pending booking with fresh slots
      if (newRepSlots.length > 0) {
        await supabase.rpc('merge_conversation_metadata', {
          p_conversation_id: input.conversationId,
          p_metadata_update: {
            pending_ghl_booking: {
              ...pendingBooking,
              offered_slots: newRepSlots,
              offered_at: new Date().toISOString(),
            },
          },
        });
      }

      const unavailDraft = await generateTimeUnavailableDraft(
        supabase, input, config, resolvedTime, newRepSlots, bookingTimezone, openRouterApiKey, effectiveModel,
      );
      if (unavailDraft) {
        await queueForApproval(supabase, input, config, unavailDraft, 'book_ghl_appointment', true);
      }
      return { action: 'book_ghl_appointment', queued: !!unavailDraft, sent: false };
    } catch (err) {
      console.error('[Autopilot] Phase 2: Failed to fetch full GHL slots:', err);
      // Fall through to extractChosenSlot as last resort
    }
  }

  // --- Step 3: No specific time proposed — try matching against offered slots ---
  // Handles generic replies like "yes", "option 2", "the first one", "3PM works"
  const extraction = await extractChosenSlot(contactReply, offeredSlots, openRouterApiKey, effectiveModel, bookingTimezone);

  if (extraction.slotChosen) {
    // Build a slot object from the extraction for bookSlotDirectly
    const chosenDate = extraction.startTime?.split('T')[0] || '';
    const chosenTime = extraction.startTime?.includes('T') ? extraction.startTime.split('T')[1]?.replace(/:00$/, '') : '';
    // Find the original offered slot that matches, or construct from extraction
    const matchedOffered = offeredSlots.find((_s, i) => i === (extraction as any).slotIndex)
      || (chosenDate && chosenTime ? { date: chosenDate, time: extraction.startTime! } : null);

    if (matchedOffered) {
      console.log(`[Autopilot] Phase 2: extractChosenSlot matched — booking ${matchedOffered.date} ${matchedOffered.time}`);
      return await bookSlotDirectly(supabase, input, config, calendarId, matchedOffered, bookingTimezone, openRouterApiKey, effectiveModel);
    }

    // Fallback: if extraction has startTime/endTime but we couldn't map to a slot object, book using raw times
    if (extraction.startTime && extraction.endTime) {
      const fallbackSlot = { date: extraction.startTime.split('T')[0], time: extraction.startTime };
      console.log(`[Autopilot] Phase 2: extractChosenSlot matched (fallback) — booking ${fallbackSlot.date} ${fallbackSlot.time}`);
      return await bookSlotDirectly(supabase, input, config, calendarId, fallbackSlot, bookingTimezone, openRouterApiKey, effectiveModel);
    }
  }

  // --- Step 4: Could not match — generate clarification ---
  const slotsText = offeredSlots.map((s: any) => {
    const timeVal = s.time.includes('T') ? s.time : `${s.date}T${s.time}`;
    const formatted = formatSlotDateTime(timeVal, bookingTimezone, 'short');
    return formatted !== timeVal ? `${formatted} (${bookingTimezone})` : `${s.date} at ${s.time}`;
  }).join(', ');
  const clarifyDraft = await generateClarificationDraft(
    supabase, input, config, slotsText, openRouterApiKey, effectiveModel, contactReply,
  );
  if (clarifyDraft) {
    await queueForApproval(supabase, input, config, clarifyDraft, 'book_ghl_appointment', true);
  }
  return { action: 'book_ghl_appointment', queued: !!clarifyDraft, sent: false };
}

/**
 * Handle case where the chosen slot is no longer available.
 * Re-fetches free slots and offers new times.
 */
async function handleSlotUnavailable(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  calendarId: string,
  openRouterApiKey: string,
  model?: string,
  bookingTimezone?: string,
): Promise<ProcessAutopilotResult> {
  const tz = bookingTimezone || config.booking_timezone || 'UTC';

  const now = new Date();

  try {
    const { accessToken } = await getGHLAccessToken(supabase, input.organizationId);
    const startMs = now.getTime();
    const endMs = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).getTime();
    const rawSlots = await getGHLFreeSlots(accessToken, calendarId, startMs, endMs, tz);
    const newSlots = pickRepresentativeSlots(rawSlots as Record<string, { slots: string[] }>, 6);

    if (newSlots.length === 0) {
      const fallback = 'I apologize, but it looks like there are no available slots at the moment. Could we try again next week?';
      await queueForApproval(supabase, input, config, fallback, 'book_ghl_appointment', true);
      return { action: 'book_ghl_appointment', queued: true, sent: false };
    }

    const draft = await generateBookingDraft(supabase, input, config, null, newSlots, openRouterApiKey, model, true, tz);

    // Update pending booking with new slots
    await supabase.rpc('merge_conversation_metadata', {
      p_conversation_id: input.conversationId,
      p_metadata_update: {
        pending_ghl_booking: {
          calendar_id: calendarId,
          offered_slots: newSlots,
          offered_at: new Date().toISOString(),
          timezone: tz,
        },
      },
    });

    if (draft) {
      await queueForApproval(supabase, input, config, draft, 'book_ghl_appointment', true);
    }
    return { action: 'book_ghl_appointment', queued: !!draft, sent: false };
  } catch (err) {
    console.error('[Autopilot] handleSlotUnavailable error:', err);
    return { action: 'book_ghl_appointment', queued: false, sent: false };
  }
}

// ============================================================================
// GHL Booking Helpers
// ============================================================================

/**
 * Pick representative time slots across different days and times.
 */
function pickRepresentativeSlots(
  slotsMap: Record<string, { slots: string[] }>,
  maxSlots: number,
): Array<{ date: string; time: string }> {
  const result: Array<{ date: string; time: string }> = [];

  // Filter out non-date keys (e.g. "traceId" from GHL response)
  const sortedDates = Object.keys(slotsMap).filter((k) => /^\d{4}-\d{2}-\d{2}/.test(k)).sort();

  // Extract hour from slot string — handles both "HH:MM" and ISO "2026-02-25T09:00:00+01:00"
  const getHour = (s: string): number => {
    const tIdx = s.indexOf('T');
    if (tIdx !== -1) {
      // ISO format: extract HH from after 'T'
      return parseInt(s.substring(tIdx + 1, tIdx + 3), 10);
    }
    return parseInt(s.split(':')[0], 10);
  };

  for (const date of sortedDates) {
    const daySlots = slotsMap[date]?.slots || [];
    if (daySlots.length === 0) continue;

    // Pick morning, midday, and afternoon slots for variety
    const morning = daySlots.find((s) => { const h = getHour(s); return h >= 9 && h < 12; });
    const midday = daySlots.find((s) => { const h = getHour(s); return h >= 12 && h < 15; });
    const afternoon = daySlots.find((s) => { const h = getHour(s); return h >= 15 && h < 18; });

    for (const slot of [morning, midday, afternoon]) {
      if (slot && result.length < maxSlots) {
        result.push({ date, time: slot });
      }
    }

    if (result.length >= maxSlots) break;
  }

  // If we didn't get enough from the variety approach, just fill from any available
  if (result.length < maxSlots) {
    for (const date of sortedDates) {
      const daySlots = slotsMap[date]?.slots || [];
      for (const slot of daySlots) {
        const h = getHour(slot);
        // Skip very early slots (midnight-7am) unless we're desperate
        if (h < 7 && result.length < maxSlots - 2) continue;
        const existing = result.find((r) => r.date === date && r.time === slot);
        if (!existing && result.length < maxSlots) {
          result.push({ date, time: slot });
        }
      }
      if (result.length >= maxSlots) break;
    }
  }

  return result;
}

/**
 * Generate an AI message asking for the contact's email or phone.
 */
async function generateContactInfoRequest(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  openRouterApiKey: string,
  model?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name')
    .eq('id', input.contactId)
    .single();

  const contactName = contact?.first_name || 'there';

  const systemPrompt = `You are an AI sales agent. The contact expressed interest in a meeting. You need their email or phone number to book it.

CONTACT NAME: ${contactName}

Write a brief (1-2 sentences), warm message asking for their email address so you can send them a meeting invite. Do not mention internal systems. Return ONLY the message text.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Draft the message.' },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a friendly message when no calendar slots are available (calendar full).
 */
async function generateCalendarFullDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  openRouterApiKey: string,
  model?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name')
    .eq('id', input.contactId)
    .single();

  const contactName = contact?.first_name || 'there';

  const systemPrompt = `You are an AI sales agent. The contact wants to schedule a meeting, but the calendar is completely full for the next week.

CONTACT NAME: ${contactName}
${config.conversation_goal ? `GOAL: ${config.conversation_goal}` : ''}

Write a brief (2-3 sentences), warm message that:
1. Acknowledges their interest in meeting
2. Lets them know the calendar is currently full
3. Promises to follow up with available times as soon as they open up, or invites them to check back in a few days

Do NOT mention any internal systems, APIs, or technical details. Return ONLY the message text.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Draft the message.' },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate an AI message suggesting available time slots.
 */
async function generateBookingDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  slots: Array<{ date: string; time: string }>,
  openRouterApiKey: string,
  model?: string,
  isRetry?: boolean,
  timezone?: string,
): Promise<string | null> {
  const effectiveModel = model || DEFAULT_DRAFTER_MODEL;

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name, company, job_title')
    .eq('id', input.contactId)
    .single();

  const contactContext = buildContactContext(contact);

  // Format slots nicely
  const tzOpt = timezone ? { timeZone: timezone } : {};
  const slotsText = slots
    .map((s) => {
      const d = new Date(s.time.includes('T') ? s.time : `${s.date}T${s.time}`);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long', ...tzOpt });
      const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...tzOpt });
      const timeDisplay = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tzOpt });
      return `${dayName}, ${monthDay} at ${timeDisplay}`;
    })
    .join('\n  - ');

  // Fetch recent thread for context (include email_subject for email threads)
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('content, sender_type, created_at, email_subject')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false });

  const threadMessages = (messages || []).reverse();

  const retryNote = isRetry
    ? '\nIMPORTANT: The previously suggested time is no longer available. Apologize briefly and suggest these new times instead.'
    : '';

  const tzLabel = timezone || 'UTC';

  const systemPrompt = `You are an AI sales agent scheduling a meeting with a contact.

CONTACT CONTEXT:
${contactContext}

GOAL: ${config.conversation_goal || 'Schedule a meeting with the contact'}
${retryNote}

AVAILABLE TIME SLOTS (all times in ${tzLabel}):
  - ${slotsText}

RULES:
1. Naturally suggest 3-5 of the available times
2. Be warm and professional
3. Keep it to 2-4 sentences
4. Ask which time works best
5. ALWAYS mention the timezone (${tzLabel}) when presenting times so the contact knows which timezone the slots are in
6. Reference the conversation context if relevant
7. Return ONLY the reply text — no JSON

After the conversation messages below, draft a reply suggesting available meeting times.`;

  // Build chat messages with proper role mapping
  const chatMessages = buildChatMessages(threadMessages, systemPrompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    return raw ? sanitizeAIOutput(raw) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Use LLM to extract which time slot the contact chose from their reply.
 */
async function extractChosenSlot(
  contactReply: string,
  offeredSlots: Array<{ date: string; time: string }>,
  openRouterApiKey: string,
  model: string,
  timezone?: string,
): Promise<{ slotChosen: boolean; startTime?: string; endTime?: string; timezone?: string }> {
  const tzLabel = timezone || 'UTC';
  const slotsDescription = offeredSlots
    .map((s, i) => `${i + 1}. ${s.date} at ${s.time} (${tzLabel})`)
    .join('\n');

  const today = new Date().toISOString().split('T')[0];
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const systemPrompt = `You are parsing a contact's reply to determine which meeting time they chose from a list we offered.

TODAY: ${dayName}, ${today}

OFFERED TIMES (all in ${tzLabel}):
${slotsDescription}

CONTACT'S REPLY:
"${contactReply}"

INSTRUCTIONS:
- If the contact clearly chose one of the offered times, return the chosen slot as JSON
- If the contact says "tomorrow", "next Monday", etc., resolve the date relative to today (${today})
- If the contact mentions a time (like "3PM") that matches EXACTLY ONE offered slot, pick that one
- If the contact mentions a time that matches MULTIPLE offered slots on different dates (ambiguous), set slotChosen to false
- If the contact asks for a time NOT in the offered list (e.g. "10PM" when no 22:00 slot exists), set slotChosen to false
- If the contact is ambiguous or didn't pick a specific time, set slotChosen to false
- Assume meetings are 30 minutes unless specified otherwise
- All times are in ${tzLabel} — return startTime and endTime in that timezone (no Z suffix)
- slotIndex is 0-based (first slot = 0)

Return ONLY valid JSON in this format:
{
  "slotChosen": true/false,
  "slotIndex": 0,
  "startTime": "YYYY-MM-DDTHH:MM:00",
  "endTime": "YYYY-MM-DDTHH:MM:00"
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Parse the reply.' },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { slotChosen: false };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();

    if (!raw) return { slotChosen: false };

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { slotChosen: false };

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.slotChosen) return { slotChosen: false };

    // If LLM returned a slot index, use the offered slot data
    if (parsed.slotIndex != null && offeredSlots[parsed.slotIndex]) {
      const slot = offeredSlots[parsed.slotIndex];
      // slot.time is already an ISO timestamp (e.g. "2026-03-03T10:00:00+01:00")
      const startTime = slot.time.includes('T') ? slot.time : `${slot.date}T${slot.time}:00`;
      const endTime = calculateEndTime(slot.date, slot.time, 30);
      return {
        slotChosen: true,
        startTime,
        endTime,
      };
    }

    return {
      slotChosen: parsed.slotChosen,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      timezone: parsed.timezone,
    };
  } catch (err) {
    console.error('[Autopilot] extractChosenSlot error:', err);
    return { slotChosen: false };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a clarification message when the contact's time choice is unclear.
 */
async function generateClarificationDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  slotsText: string,
  openRouterApiKey: string,
  model: string,
  contactReply?: string,
): Promise<string | null> {
  const systemPrompt = `You are an AI sales agent. The contact replied to your meeting slot offer.

CONTACT'S REPLY: "${contactReply || '(unclear)'}"

AVAILABLE TIMES: ${slotsText}

INSTRUCTIONS:
- If the contact asked for a time that's not available (e.g. a time outside the offered slots), acknowledge that specific time isn't available and suggest the closest alternatives from the list above.
- If the contact's reply is unclear or ambiguous, ask them to pick from the available times.
- Be brief (1-2 sentences), friendly, and conversational. This is a DM, not an email.
- Return ONLY the message text, no quotes or formatting.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Draft the clarification.' },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a message explaining that the contact's proposed time is not available
 * and offering the closest alternatives. Unlike generateClarificationDraft(), this
 * specifically addresses the exact time the contact asked for.
 */
async function generateTimeUnavailableDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  proposedTime: string,
  alternativeSlots: Array<{ date: string; time: string }>,
  timezone: string,
  openRouterApiKey: string,
  model: string,
): Promise<string | null> {
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name')
    .eq('id', input.contactId)
    .single();

  const contactName = contact?.first_name || 'there';

  const proposedStr = formatSlotDateTime(proposedTime, timezone) !== proposedTime
    ? formatSlotDateTime(proposedTime, timezone)
    : 'that time';

  const altsText = alternativeSlots.length > 0
    ? alternativeSlots.map((s) => {
        const timeVal = s.time.includes('T') ? s.time : `${s.date}T${s.time}`;
        return formatSlotDateTime(timeVal, timezone, 'short');
      }).join(', ')
    : 'no current openings';

  const systemPrompt = `You are an AI sales assistant helping schedule a meeting via DM.

CONTACT NAME: ${contactName}
THEIR REQUESTED TIME: ${proposedStr} (${timezone})
THIS TIME IS NOT AVAILABLE.

AVAILABLE ALTERNATIVES (${timezone}): ${altsText}

Write a brief (2-3 sentences), warm message that:
1. Acknowledges specifically what they asked for
2. Explains that specific time isn't available (without being robotic)
3. Suggests the closest alternative times from the list above
4. Asks which of those works for them

Do NOT just re-list slots generically. Address their specific request.
This is a DM, not an email — keep it conversational.
Return ONLY the message text, no quotes or formatting.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Draft the message.' },
        ],
        temperature: 0.7,
        max_tokens: 250,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    return raw ? sanitizeAIOutput(raw) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a booking confirmation message.
 */
async function generateBookingConfirmationDraft(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig,
  extraction: { startTime?: string; endTime?: string },
  openRouterApiKey: string,
  model: string,
  bookingTimezone?: string,
): Promise<string | null> {
  const timeStr = extraction.startTime
    ? formatSlotDateTime(extraction.startTime, bookingTimezone)
    : 'the selected time';

  const systemPrompt = `You are an AI sales agent confirming a booked meeting.

BOOKED TIME: ${timeStr}

Write a brief (1-2 sentences), warm confirmation message. Mention the specific time. Express excitement about the upcoming meeting. Return ONLY the message text.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Draft the confirmation.' },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    return raw ? sanitizeAIOutput(raw) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Escalation
// ============================================================================

/**
 * Determine whether the conversation should be escalated to a human.
 */
export function shouldEscalate(
  config: AutopilotConfig,
  state: AutopilotConversationState | null,
  intent: string,
  confidence: number,
  messageContent?: string,
): { escalate: boolean; reason: string } {
  // Check max conversation turns
  if (
    config.max_conversation_turns != null &&
    state != null &&
    state.turn_count >= config.max_conversation_turns
  ) {
    return { escalate: true, reason: `Max conversation turns reached (${state.turn_count}/${config.max_conversation_turns})` };
  }

  // Check escalation rules
  if (config.escalation_rules && config.escalation_rules.length > 0) {
    for (const rule of config.escalation_rules) {
      switch (rule.condition) {
        case 'low_confidence':
          if (rule.threshold != null && confidence < rule.threshold) {
            return { escalate: true, reason: `Low confidence (${confidence} < ${rule.threshold})` };
          }
          break;

        case 'hostile_sentiment':
          if (intent === 'do_not_contact') {
            return { escalate: true, reason: 'Hostile sentiment detected (do_not_contact intent)' };
          }
          break;

        case 'explicit_request':
          if (messageContent) {
            const explicitPattern = /\b(speak\s+(to|with)\s+(a\s+)?(human|person|manager|rep|representative|someone)|talk\s+to\s+(a\s+)?(human|person|manager|rep|representative|someone)|real\s+person|not\s+a\s+bot|stop\s+the\s+bot|human\s+please)\b/i;
            if (explicitPattern.test(messageContent)) {
              return { escalate: true, reason: 'Contact explicitly requested human assistance' };
            }
          }
          break;

        case 'max_turns':
          if (rule.threshold != null && state != null && state.turn_count >= rule.threshold) {
            return { escalate: true, reason: `Escalation rule: max turns reached (${state.turn_count}/${rule.threshold})` };
          }
          break;

        case 'custom_keyword':
          if (messageContent && rule.keywords && rule.keywords.length > 0) {
            const lowerContent = messageContent.toLowerCase();
            const matched = rule.keywords.find((kw) => lowerContent.includes(kw.toLowerCase()));
            if (matched) {
              return { escalate: true, reason: `Custom keyword matched: "${matched}"` };
            }
          }
          break;
      }
    }
  }

  return { escalate: false, reason: '' };
}

// ============================================================================
// Conversation State Management
// ============================================================================

/**
 * Update the conversation's autopilot state after an agent action.
 */
async function updateConversationState(
  supabase: any,
  conversationId: string,
  currentState: AutopilotConversationState | null,
  intent: string,
  escalationReason?: string,
): Promise<AutopilotConversationState> {
  const newPhase = inferPhase(currentState, intent);

  const newState: AutopilotConversationState = {
    phase: newPhase,
    turn_count: (currentState?.turn_count || 0) + 1,
    last_autopilot_at: new Date().toISOString(),
    escalation_reason: newPhase === 'escalated'
      ? (escalationReason || currentState?.escalation_reason || `Escalated on intent: ${intent}`)
      : undefined,
    goal_progress: currentState?.goal_progress,
  };

  const { error } = await supabase
    .from('crm_conversations')
    .update({ autopilot_state: newState })
    .eq('id', conversationId);

  if (error) {
    console.error('[Autopilot] Failed to update conversation state:', error.message);
  }

  return newState;
}

/**
 * Infer the conversation phase from the current state and latest intent.
 */
function inferPhase(
  currentState: AutopilotConversationState | null,
  intent: string,
): AutopilotConversationState['phase'] {
  // No current state or turn 0 → greeting
  if (!currentState || currentState.turn_count === 0) {
    return 'greeting';
  }

  // Explicit escalation
  if (intent === 'escalated_intent') {
    return 'escalated';
  }

  // Meeting booked → post_meeting
  if (intent === 'meeting_booked') {
    return 'post_meeting';
  }

  // Interested: advance through funnel
  if (intent === 'interested') {
    if (currentState.phase === 'greeting') return 'discovery';
    if (currentState.phase === 'discovery') return 'qualification';
    // Already in qualification or later — stay
    return currentState.phase;
  }

  // Not interested → objection handling
  if (intent === 'not_interested') {
    return 'objection_handling';
  }

  // Default: keep current phase
  return currentState.phase;
}

// ============================================================================
// Queue & Helpers
// ============================================================================

/**
 * Insert a draft into inbox_autopilot_queue for approval or auto-send.
 */
async function queueForApproval(
  supabase: any,
  input: ProcessAutopilotInput,
  config: AutopilotConfig | null,
  draftMessage: string,
  triggerAction: string,
  autoSend: boolean = false,
  extraMetadata: Record<string, unknown> = {},
): Promise<void> {
  // For email channels, derive the reply subject from the thread
  let draftSubject: string | null = null;
  if (input.channel === 'email') {
    const { data: subjectMsg } = await supabase
      .from('crm_messages')
      .select('email_subject')
      .eq('conversation_id', input.conversationId)
      .not('email_subject', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subjectMsg?.email_subject) {
      const subj = subjectMsg.email_subject;
      draftSubject = /^re:\s/i.test(subj) ? subj : `Re: ${subj}`;
    }
  }

  const { error } = await supabase
    .from('inbox_autopilot_queue')
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      draft_message: draftMessage,
      draft_subject: draftSubject,
      trigger_intent: input.intent,
      trigger_message_id: input.inboundMessageId,
      status: 'pending',
      owner_user_id: config?.owner_user_id || null,
      metadata: {
        action: triggerAction,
        channel: input.channel,
        auto_send: autoSend,
        sequence_id: input.sequenceId || null,
        campaign_id: input.campaignId || null,
        lead_magnet_campaign_id: input.leadMagnetCampaignId || null,
        mailbox_id: input.mailboxId || null,
        confidence: input.confidence,
        ...extraMetadata,
      },
    });

  if (error) {
    console.error('[Autopilot] Failed to queue draft:', error.message);
    throw new Error(`Failed to queue draft: ${error.message}`);
  } else {
    console.log(
      `[Autopilot] Queued ${triggerAction} draft for conversation ${input.conversationId} (auto_send: ${autoSend})`,
    );
  }
}

/**
 * Count AI-generated messages in a conversation.
 */
async function countAiMessages(
  supabase: any,
  conversationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('crm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'ai');

  if (error) {
    console.error('[Autopilot] Failed to count AI messages:', error.message);
    return 0;
  }

  return count || 0;
}

/**
 * Merge new fields into existing conversation metadata.
 */
async function mergeMetadata(
  supabase: any,
  conversationId: string,
  newFields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();

  return {
    ...(conversation?.metadata || {}),
    ...newFields,
  };
}
