/**
 * Conversation Autopilot Module (Node.js port)
 *
 * Processes AI-driven automation rules for conversations based on intent
 * classification. Supports auto-reply, calendly sends, draft-for-approval,
 * smart snooze for OOO contacts, escalation, and conversation state tracking.
 *
 * Used by:
 *   - imap-poller worker (inline, on classified inbound)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseOOOReturnDate } from './ooo-date-parser.js';
import { sanitizeAIOutput } from './sanitize.js';
import { DEFAULT_FAST_TEXT_MODEL } from './default-models.js';

// ============================================================================
// Types
// ============================================================================

export interface AutopilotConfig {
  enabled: boolean;
  rules: AutopilotRule[];
  require_approval: boolean;
  max_auto_replies: number;
  conversation_goal?: string;
  system_instructions?: string;
  use_knowledge_base?: boolean;
  knowledge_document_ids?: string[];
  use_tone_profile?: boolean;
  max_conversation_turns?: number;
  owner_user_id?: string;
  escalation_rules?: EscalationRule[];
  booking_timezone?: string;
  ghl_calendar_id?: string;
}

export interface AutopilotRule {
  intent: string;
  action: 'auto_reply' | 'send_calendly' | 'book_ghl_appointment' | 'auto_followup_after_return' | 'draft_for_approval' | 'escalate';
  message_template?: string;
  calendly_link?: string;
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

const DEFAULT_DRAFTER_MODEL = DEFAULT_FAST_TEXT_MODEL;
const DRAFTER_TIMEOUT_MS = 15_000;

// ============================================================================
// Config Normalization
// ============================================================================

/**
 * Normalize a stored agent/autopilot config into a complete AutopilotConfig.
 *
 * Playbook-generated agent profiles persist { system_prompt, tone_traits,
 * escalation_triggers } rather than the AutopilotConfig the engine consumes
 * ({ enabled, rules[], conversation_goal, system_instructions, escalation_rules[] }).
 * Without `enabled`/`rules` the engine returns noAction. This bridges the schemas
 * (mirror of the edge _shared/conversation-autopilot.ts normalizeAgentConfig) and
 * synthesizes safe default rules (auto_reply honors require_approval → drafts).
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

  const isProfiledAgent = !!(config.system_instructions || r.system_prompt || config.use_tone_profile);
  if (config.rules.length === 0 && isProfiledAgent) {
    config.rules = [
      { intent: 'interested', action: 'auto_reply' },
      { intent: 'neutral', action: 'auto_reply' },
      { intent: 'not_interested', action: 'auto_reply' },
      { intent: 'out_of_office', action: 'auto_followup_after_return' },
      { intent: 'meeting_booked', action: config.ghl_calendar_id ? 'book_ghl_appointment' : 'auto_reply' },
    ];
  }

  return config;
}

// ============================================================================
// Main Export
// ============================================================================

export async function processAutopilot(
  supabase: SupabaseClient,
  input: ProcessAutopilotInput,
  openRouterApiKey: string,
): Promise<ProcessAutopilotResult> {
  const noAction: ProcessAutopilotResult = { action: 'none', queued: false, sent: false };

  let config: AutopilotConfig | null = null;

  // Helper: load config from an agent profile (single source of truth when attached).
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
  } else {
    const { data: conversation } = await supabase
      .from('crm_conversations')
      .select('ai_enabled, metadata, agent_profile_id')
      .eq('id', input.conversationId)
      .eq('organization_id', input.organizationId)
      .single();
    if (!conversation?.ai_enabled) return noAction;
    if (conversation.agent_profile_id) {
      config = await loadProfileConfig(conversation.agent_profile_id);
    }
    if (!config) {
      const convConfig = (conversation.metadata as any)?.autopilot_config;
      if (convConfig) config = normalizeAgentConfig(convConfig);
    }
    if (!config?.enabled) return noAction;
  }

  if (!config || !config.enabled) return noAction;

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

  // Check auto-reply limit — bypass if there's a pending GHL booking
  const { count } = await supabase
    .from('crm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', input.conversationId)
    .eq('sender_type', 'ai');
  const aiMsgCount = count || 0;
  let hasPendingBookingBypass = false;
  if (config.ghl_calendar_id && aiMsgCount >= config.max_auto_replies) {
    const { data: convCheck } = await supabase
      .from('crm_conversations')
      .select('metadata')
      .eq('id', input.conversationId)
      .single();
    hasPendingBookingBypass = !!convCheck?.metadata?.pending_ghl_booking;
    if (hasPendingBookingBypass) {
      console.log(`[Autopilot] Max auto-replies reached (${aiMsgCount}/${config.max_auto_replies}) but pending GHL booking — continuing`);
    }
  }
  if (aiMsgCount >= config.max_auto_replies && !hasPendingBookingBypass) return noAction;

  // Load conversation state
  let autopilotState: AutopilotConversationState | null = null;
  try {
    const { data: conv } = await supabase
      .from('crm_conversations')
      .select('autopilot_state')
      .eq('id', input.conversationId)
      .single();
    if (conv?.autopilot_state) {
      autopilotState = conv.autopilot_state as AutopilotConversationState;
    }
  } catch { /* non-fatal */ }

  // Already escalated — stop autopilot, user was already notified
  if (autopilotState?.phase === 'escalated') {
    console.log(`[Autopilot] Conversation ${input.conversationId} already escalated — skipping`);
    return noAction;
  }

  // Check escalation before dispatching — but skip for goal-completing actions
  // (booking, calendly). The contact is trying to schedule, which is the conversation
  // goal — don't escalate just because we hit max turns or low confidence.
  const isGoalCompletingAction = matchingRule.action === 'book_ghl_appointment' || matchingRule.action === 'send_calendly';
  if (shouldEscalate(config, input, autopilotState) && !isGoalCompletingAction) {
    const reason = buildEscalationReason(config, input, autopilotState);
    try {
      await updateConversationState(supabase, input.conversationId, autopilotState, 'escalated', reason);
    } catch { /* non-fatal */ }
    await queueForApproval(supabase, input, config, '', 'escalate', false, reason);
    return { action: 'escalate', queued: true, sent: false };
  } else if (shouldEscalate(config, input, autopilotState) && isGoalCompletingAction) {
    console.log(
      `[Autopilot] Escalation would trigger but skipping — goal-completing action "${matchingRule.action}" takes priority`,
    );
  }

  // Handle explicit escalate action
  if (matchingRule.action === 'escalate') {
    const ruleReason = `rule_match:${input.intent}`;
    try {
      await updateConversationState(supabase, input.conversationId, autopilotState, 'escalated', ruleReason);
    } catch { /* non-fatal */ }
    await queueForApproval(supabase, input, config, '', 'escalate', false, ruleReason);
    return { action: 'escalate', queued: true, sent: false };
  }

  let result: ProcessAutopilotResult;

  switch (matchingRule.action) {
    case 'auto_reply':
      result = await handleAutoReply(supabase, input, config, matchingRule, openRouterApiKey, autopilotState);
      break;
    case 'send_calendly':
      result = await handleSendCalendly(supabase, input, config, matchingRule, openRouterApiKey, autopilotState);
      break;
    case 'book_ghl_appointment':
      // GHL booking requires the Deno edge function — queue for approval so it gets picked up
      result = await handleDraftForApproval(supabase, input, config, openRouterApiKey, autopilotState);
      break;
    case 'auto_followup_after_return':
      result = await handleAutoFollowupAfterReturn(supabase, input);
      return result; // No state update for OOO snooze
    case 'draft_for_approval':
      result = await handleDraftForApproval(supabase, input, config, openRouterApiKey, autopilotState);
      break;
    default:
      return noAction;
  }

  // Update conversation state after action
  if (result.queued || result.sent) {
    try {
      await updateConversationState(supabase, input.conversationId, autopilotState);
    } catch { /* non-fatal */ }
  }

  return result;
}

// ============================================================================
// Escalation Logic
// ============================================================================

function shouldEscalate(
  config: AutopilotConfig,
  input: ProcessAutopilotInput,
  state: AutopilotConversationState | null,
): boolean {
  // Check max conversation turns
  if (config.max_conversation_turns && state) {
    if (state.turn_count >= config.max_conversation_turns) return true;
  }

  // Already escalated — handled by early return in processAutopilot
  if (state?.phase === 'escalated') return false;

  // Check escalation rules
  if (!config.escalation_rules?.length) return false;

  for (const rule of config.escalation_rules) {
    switch (rule.condition) {
      case 'low_confidence':
        if (input.confidence < (rule.threshold || 0.3)) return true;
        break;
      case 'hostile_sentiment':
        if (input.intent === 'do_not_contact') return true;
        break;
      case 'explicit_request':
        if (input.messageContent) {
          const explicitPattern = /\b(speak\s+(to|with)\s+(a\s+)?(human|person|manager|rep|representative|someone)|talk\s+to\s+(a\s+)?(human|person|manager|rep|representative|someone)|real\s+person|not\s+a\s+bot|stop\s+the\s+bot|human\s+please)\b/i;
          if (explicitPattern.test(input.messageContent)) return true;
        }
        break;
      case 'max_turns':
        if (state && rule.threshold && state.turn_count >= rule.threshold) return true;
        break;
      case 'custom_keyword':
        if (rule.keywords?.length && input.messageContent) {
          const lower = input.messageContent.toLowerCase();
          if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return true;
        }
        break;
    }
  }

  return false;
}

function buildEscalationReason(
  config: AutopilotConfig,
  input: ProcessAutopilotInput,
  state: AutopilotConversationState | null,
): string {
  if (config.max_conversation_turns && state && state.turn_count >= config.max_conversation_turns) {
    return `max_turns_reached:${state.turn_count}`;
  }
  if (config.escalation_rules?.length) {
    for (const rule of config.escalation_rules) {
      if (rule.condition === 'low_confidence' && input.confidence < (rule.threshold || 0.3)) {
        return `low_confidence:${input.confidence}`;
      }
      if (rule.condition === 'hostile_sentiment' && input.intent === 'do_not_contact') {
        return `hostile_sentiment:${input.intent}`;
      }
      if (rule.condition === 'explicit_request' && input.messageContent) {
        const explicitPattern = /\b(speak\s+(to|with)\s+(a\s+)?(human|person|manager|rep|representative|someone)|talk\s+to\s+(a\s+)?(human|person|manager|rep|representative|someone)|real\s+person|not\s+a\s+bot|stop\s+the\s+bot|human\s+please)\b/i;
        if (explicitPattern.test(input.messageContent)) return `explicit_request:keyword_match`;
      }
      if (rule.condition === 'custom_keyword' && rule.keywords?.length && input.messageContent) {
        const lower = input.messageContent.toLowerCase();
        const matched = rule.keywords.find((kw) => lower.includes(kw.toLowerCase()));
        if (matched) return `custom_keyword:${matched}`;
      }
    }
  }
  return 'unknown';
}

// ============================================================================
// Conversation State Management
// ============================================================================

async function updateConversationState(
  supabase: SupabaseClient,
  conversationId: string,
  currentState: AutopilotConversationState | null,
  forcePhase?: AutopilotConversationState['phase'],
  escalationReason?: string,
): Promise<void> {
  const turnCount = (currentState?.turn_count || 0) + 1;
  const phase = forcePhase || inferPhase(currentState, turnCount);

  const newState: AutopilotConversationState = {
    phase,
    turn_count: turnCount,
    last_autopilot_at: new Date().toISOString(),
    escalation_reason: escalationReason || currentState?.escalation_reason,
    goal_progress: currentState?.goal_progress,
  };

  await supabase
    .from('crm_conversations')
    .update({ autopilot_state: newState })
    .eq('id', conversationId);
}

function inferPhase(
  currentState: AutopilotConversationState | null,
  turnCount: number,
): AutopilotConversationState['phase'] {
  if (!currentState) return 'greeting';
  if (currentState.phase === 'escalated') return 'escalated';
  if (currentState.phase === 'post_meeting') return 'post_meeting';

  // Simple phase progression based on turn count
  if (turnCount <= 1) return 'greeting';
  if (turnCount <= 3) return 'discovery';
  if (turnCount <= 5) return 'qualification';
  if (turnCount <= 8) return 'objection_handling';
  return 'closing';
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleAutoReply(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
  config: AutopilotConfig, rule: AutopilotRule, apiKey: string,
  state: AutopilotConversationState | null,
): Promise<ProcessAutopilotResult> {
  // Auto-escalate scheduling messages to calendly if configured
  if (input.messageContent) {
    const schedulingPattern = /\b(?:meet(?:ing)?|call|demo|catch up|hop on|schedule|calendar|book(?:ing)?|slot|available|availability|book\s+me\s+in|free\s+(?:at|on|this|next|tomorrow|today|monday|tuesday|wednesday|thursday|friday)|\d{1,2}\s*(?:am|pm|:\d{2}))\b/i;
    const isSchedulingIntent = input.intent === 'meeting_booked' || input.intent === 'interested';

    if (isSchedulingIntent || schedulingPattern.test(input.messageContent)) {
      const calendlyRule = config.rules.find((r: AutopilotRule) => r.action === 'send_calendly' && r.calendly_link);
      if (calendlyRule) {
        console.log('[Autopilot] Scheduling detected in auto_reply — redirecting to send_calendly');
        return handleSendCalendly(supabase, input, config, calendlyRule, apiKey, state);
      }
    }
  }

  const draft = rule.message_template || await generateAgentDraft(supabase, input, config, state, apiKey, input.model);
  if (!draft) return { action: 'auto_reply', queued: false, sent: false };
  await queueForApproval(supabase, input, config, draft, 'auto_reply', !config.require_approval);
  return { action: 'auto_reply', queued: true, sent: false };
}

async function handleSendCalendly(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
  config: AutopilotConfig, rule: AutopilotRule, apiKey: string,
  state: AutopilotConversationState | null,
): Promise<ProcessAutopilotResult> {
  if (!rule.calendly_link) return { action: 'send_calendly', queued: false, sent: false };
  const draft = await generateCalendlyDraft(supabase, input, rule.calendly_link, apiKey, input.model);
  if (!draft) return { action: 'send_calendly', queued: false, sent: false };
  await queueForApproval(supabase, input, config, draft, 'send_calendly', !config.require_approval);
  return { action: 'send_calendly', queued: true, sent: false };
}

async function handleAutoFollowupAfterReturn(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
): Promise<ProcessAutopilotResult> {
  const { data: inboundMessage } = await supabase
    .from('crm_messages')
    .select('content')
    .eq('id', input.inboundMessageId)
    .single();
  const returnDate = parseOOOReturnDate(inboundMessage?.content || '');
  if (returnDate) {
    const { data: conv } = await supabase.from('crm_conversations').select('metadata').eq('id', input.conversationId).single();
    await supabase.from('crm_conversations').update({
      snoozed_until: returnDate.toISOString(),
      metadata: { ...((conv?.metadata as any) || {}), ooo_return_date: returnDate.toISOString(), ooo_detected_at: new Date().toISOString() },
    }).eq('id', input.conversationId);
  }
  return { action: 'auto_followup_after_return', queued: false, sent: false };
}

async function handleDraftForApproval(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
  config: AutopilotConfig, apiKey: string,
  state: AutopilotConversationState | null,
): Promise<ProcessAutopilotResult> {
  const draft = await generateAgentDraft(supabase, input, config, state, apiKey, input.model);
  if (!draft) return { action: 'draft_for_approval', queued: false, sent: false };
  await queueForApproval(supabase, input, config, draft, 'draft_for_approval');
  return { action: 'draft_for_approval', queued: true, sent: false };
}

// ============================================================================
// LLM Draft Generation
// ============================================================================

async function generateAgentDraft(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
  config: AutopilotConfig, state: AutopilotConversationState | null,
  apiKey: string, model?: string,
): Promise<string | null> {
  // Fetch last 10 messages for context
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('content, sender_type')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .limit(10);

  const thread = (messages || [])
    .reverse()
    // Only the contact is "them": the AI agent's own replies (ai) and campaign sends
    // (automation) are our side too, same as _shared/ai-reply-drafter.ts formatThread
    .map((m: any) => `${m.sender_type === 'contact' ? 'them' : 'you'}: ${(m.content || '').slice(0, 300)}`)
    .join('\n');

  // Fetch full contact data
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name, last_name, company, job_title, lead_score, tags, enrichment_data')
    .eq('id', input.contactId)
    .single();

  const contactName = contact?.first_name || 'there';
  const contactLastName = contact?.last_name || '';
  const company = contact?.company || '';
  const jobTitle = contact?.job_title || '';
  const leadScore = contact?.lead_score;
  const tags = (contact?.tags as string[] | null) || [];
  const enrichmentData = contact?.enrichment_data as Record<string, any> | null;

  // Build contact context block
  let contactContext = `Contact: ${contactName}${contactLastName ? ` ${contactLastName}` : ''}`;
  if (jobTitle) contactContext += `\nTitle: ${jobTitle}`;
  if (company) contactContext += `\nCompany: ${company}`;
  if (leadScore != null) contactContext += `\nLead score: ${leadScore}`;
  if (tags.length) contactContext += `\nTags: ${tags.join(', ')}`;
  if (enrichmentData) {
    const bio = enrichmentData.bio || enrichmentData.headline || enrichmentData.summary;
    if (bio) contactContext += `\nBio: ${String(bio).slice(0, 200)}`;
  }

  // Optionally load knowledge base chunks
  let kbContext = '';
  if (config.use_knowledge_base && input.messageContent) {
    try {
      let query = supabase
        .from('knowledge_base_chunks')
        .select('content')
        .eq('organization_id', input.organizationId);

      // Filter to specific documents if configured
      if (config.knowledge_document_ids?.length) {
        query = query.in('document_id', config.knowledge_document_ids);
      }

      const { data: chunks } = await query
        .textSearch('content', input.messageContent.split(/\s+/).slice(0, 5).join(' & '), { type: 'plain' })
        .limit(3);
      if (chunks?.length) {
        kbContext = '\n\nKnowledge Base:\n' + chunks.map((c: any) => c.content.slice(0, 300)).join('\n---\n');
      }
    } catch { /* non-fatal — KB retrieval is optional */ }
  }

  // Optionally load tone profile
  let toneContext = '';
  if (config.use_tone_profile && config.owner_user_id) {
    try {
      const { data: toneProfile } = await supabase
        .from('inbox_user_tone_profiles')
        .select('tone_summary, writing_samples')
        .eq('user_id', config.owner_user_id)
        .single();
      if (toneProfile?.tone_summary) {
        toneContext = `\n\nTone Profile:\n${toneProfile.tone_summary}`;
      }
    } catch { /* non-fatal — tone profile is optional */ }
  }

  // Build conversation phase context
  let phaseContext = '';
  if (state) {
    phaseContext = `\n\nConversation Phase: ${state.phase} (turn ${state.turn_count})`;
    if (state.goal_progress) phaseContext += `\nGoal Progress: ${state.goal_progress}`;
  }

  // Build the enhanced system prompt
  let systemPrompt = `You are an AI sales assistant drafting a reply in a ${input.channel} conversation.`;

  if (config.conversation_goal) {
    systemPrompt += `\n\nConversation Goal: ${config.conversation_goal}`;
  }

  if (config.system_instructions) {
    systemPrompt += `\n\nInstructions: ${config.system_instructions}`;
  }

  systemPrompt += `\n\n${contactContext}`;
  systemPrompt += phaseContext;
  systemPrompt += toneContext;
  systemPrompt += kbContext;

  systemPrompt += `\n\nConversation:\n${thread}`;

  systemPrompt += `\n\nRULES:
1. Reply to the LAST message only
2. Keep it concise (1-3 sentences)
3. Be professional and helpful
4. Do not fabricate facts or make commitments
5. NEVER agree to specific meeting times, propose time slots, confirm availability, or promise to send calendar invites. You do NOT have calendar access. If the contact wants to schedule, say you'd love to find a time and that you'll have someone follow up with booking details shortly.
6. Return ONLY the reply text — no JSON, no explanation`;

  return callLLM(apiKey, systemPrompt, 'Draft the reply.', model, 500);
}

async function generateCalendlyDraft(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
  calendlyLink: string, apiKey: string, model?: string,
): Promise<string | null> {
  const { data: messages } = await supabase
    .from('crm_messages')
    .select('content, sender_type')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .limit(3);

  const thread = (messages || [])
    .reverse()
    // Only the contact is "them" (see the agent draft thread above)
    .map((m: any) => `${m.sender_type === 'contact' ? 'them' : 'you'}: ${(m.content || '').slice(0, 200)}`)
    .join('\n');

  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('first_name')
    .eq('id', input.contactId)
    .single();

  const systemPrompt = `Draft a brief reply that naturally invites the contact to book a meeting.

Contact: ${contact?.first_name || 'there'}
Calendly link: ${calendlyLink}

Recent conversation:
${thread}

RULES:
1. Naturally reference the scheduling link
2. Keep it to 2-3 sentences
3. Be warm and professional
4. Return ONLY the reply text`;

  return callLLM(apiKey, systemPrompt, 'Draft the calendly message.', model);
}

async function callLLM(
  apiKey: string, systemPrompt: string, userPrompt: string,
  model?: string, maxTokens?: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DRAFTER_TIMEOUT_MS);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || DEFAULT_DRAFTER_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.7,
        max_tokens: maxTokens || 300,
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
// Queue Helper
// ============================================================================

async function queueForApproval(
  supabase: SupabaseClient, input: ProcessAutopilotInput,
  config: AutopilotConfig | null, draft: string, action: string,
  autoSend: boolean = false, escalationReason?: string,
): Promise<void> {
  const { error } = await supabase.from('inbox_autopilot_queue').insert({
    organization_id: input.organizationId,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    draft_message: draft,
    trigger_intent: input.intent,
    trigger_message_id: input.inboundMessageId,
    owner_user_id: config?.owner_user_id || null,
    status: 'pending',
    metadata: {
      action, channel: input.channel, auto_send: autoSend,
      sequence_id: input.sequenceId || null,
      campaign_id: input.campaignId || null,
      lead_magnet_campaign_id: input.leadMagnetCampaignId || null,
      mailbox_id: input.mailboxId || null,
      confidence: input.confidence,
      ...(action === 'escalate' && { escalated: true, escalation_reason: escalationReason }),
    },
  });
  if (error) {
    console.error('[Autopilot] Failed to queue draft:', error.message);
    throw new Error(`Failed to queue draft: ${error.message}`);
  }
}
