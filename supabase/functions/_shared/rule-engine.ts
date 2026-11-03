/**
 * Rule Engine - Shared utility for evaluating automation rules and handoff triggers
 *
 * Used by:
 * - evaluate-rules edge function
 * - crm-sync-inbound (via function invoke)
 * - unipile-webhook-handler (via function invoke)
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

// ============================================================================
// Types
// ============================================================================

export interface ConditionContext {
  messageContent?: string;
  messageChannel?: string;
  contactStage?: string;
  contactScore?: number;
  contactTags?: string[];
  contactSource?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  contactCustomFields?: Record<string, unknown>;
  timeSinceLastMessage?: number; // in minutes
  conversationMessageCount?: number;
}

export interface RuleCondition {
  id: string;
  field: string;
  operator: string;
  value: string | number | string[];
  custom_field_id?: string;
}

export interface RuleConditionGroup {
  id: string;
  logic: "and" | "or";
  conditions: RuleCondition[];
  groups?: RuleConditionGroup[];
}

export interface RuleAction {
  id: string;
  type: string;
  config: Record<string, unknown>;
  delay_seconds?: number;
}

export interface ActionResult {
  type: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ConditionResult {
  field: string;
  operator: string;
  expectedValue: unknown;
  actualValue: unknown;
  matched: boolean;
}

export interface ExecutionContext {
  organizationId: string;
  contactId: string;
  conversationId?: string;
  messageId?: string;
  channel?: string;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  skippedReason?: string;
  conditionResults: ConditionResult[];
  actionResults: ActionResult[];
  durationMs: number;
}

export interface HandoffEvaluationResult {
  triggered: boolean;
  triggerId?: string;
  triggerName?: string;
  reason?: string;
}

// ============================================================================
// Condition Context Builder
// ============================================================================

export async function buildConditionContext(
  supabase: SupabaseClient,
  contactId: string,
  triggerData: Record<string, unknown>
): Promise<ConditionContext> {
  // Fetch contact with pipeline stage
  const { data: contact } = await supabase
    .from("crm_contacts")
    .select(`
      id, display_name, email, phone, lead_score, source, custom_fields,
      pipeline_stage:pipeline_stage_id(id, name)
    `)
    .eq("id", contactId)
    .single();

  // Fetch contact tags
  const { data: tagRows } = await supabase
    .from("crm_contact_tags")
    .select("tag:tag_id(name)")
    .eq("contact_id", contactId);

  const tags = tagRows
    ?.map((r: { tag: { name: string } | null }) => r.tag?.name)
    .filter(Boolean) as string[] || [];

  // Fetch conversation stats if conversationId provided
  let timeSinceLastMessage: number | undefined;
  let conversationMessageCount: number | undefined;

  if (triggerData.conversationId) {
    const { data: conv } = await supabase
      .from("crm_conversations")
      .select("message_count, last_message_at")
      .eq("id", triggerData.conversationId)
      .single();

    if (conv) {
      conversationMessageCount = conv.message_count;
      if (conv.last_message_at) {
        timeSinceLastMessage =
          (Date.now() - new Date(conv.last_message_at).getTime()) / 60000;
      }
    }
  }

  return {
    messageContent: triggerData.messageContent as string | undefined,
    messageChannel: triggerData.messageChannel as string | undefined,
    contactStage: (contact?.pipeline_stage as { name: string } | null)?.name,
    contactScore: contact?.lead_score,
    contactTags: tags,
    contactSource: contact?.source,
    contactEmail: contact?.email,
    contactPhone: contact?.phone,
    contactName: contact?.display_name,
    contactCustomFields: contact?.custom_fields as Record<string, unknown> | undefined,
    timeSinceLastMessage,
    conversationMessageCount,
  };
}

// ============================================================================
// Condition Evaluation
// ============================================================================

export function evaluateConditionGroup(
  group: RuleConditionGroup,
  ctx: ConditionContext
): { matched: boolean; results: ConditionResult[] } {
  const allResults: ConditionResult[] = [];

  // Empty conditions = always match
  const hasConditions = group.conditions && group.conditions.length > 0;
  const hasGroups = group.groups && group.groups.length > 0;

  if (!hasConditions && !hasGroups) {
    return { matched: true, results: [] };
  }

  // Evaluate individual conditions
  const conditionResults = (group.conditions || []).map((c) => {
    const result = evaluateCondition(c, ctx);
    allResults.push(result);
    return result.matched;
  });

  // Evaluate nested groups recursively
  const groupResults = (group.groups || []).map((g) => {
    const result = evaluateConditionGroup(g, ctx);
    allResults.push(...result.results);
    return result.matched;
  });

  const allMatches = [...conditionResults, ...groupResults];

  const matched =
    group.logic === "and"
      ? allMatches.every((r) => r)
      : allMatches.some((r) => r);

  return { matched, results: allResults };
}

function evaluateCondition(
  condition: RuleCondition,
  ctx: ConditionContext
): ConditionResult {
  const actualValue = getFieldValue(condition.field, ctx);
  const matched = applyOperator(condition.operator, actualValue, condition.value);

  return {
    field: condition.field,
    operator: condition.operator,
    expectedValue: condition.value,
    actualValue,
    matched,
  };
}

function getFieldValue(field: string, ctx: ConditionContext): unknown {
  switch (field) {
    case "message_content":
      return ctx.messageContent;
    case "message_channel":
      return ctx.messageChannel;
    case "contact_stage":
      return ctx.contactStage;
    case "contact_score":
      return ctx.contactScore;
    case "contact_tags":
      return ctx.contactTags;
    case "contact_source":
      return ctx.contactSource;
    case "contact_email":
      return ctx.contactEmail;
    case "contact_phone":
      return ctx.contactPhone;
    case "contact_name":
      return ctx.contactName;
    case "time_since_last_message":
      return ctx.timeSinceLastMessage;
    case "conversation_message_count":
      return ctx.conversationMessageCount;
    default:
      return undefined;
  }
}

function applyOperator(
  operator: string,
  fieldValue: unknown,
  conditionValue: unknown
): boolean {
  // String operators (case-insensitive)
  if (operator === "equals")
    return String(fieldValue).toLowerCase() === String(conditionValue).toLowerCase();
  if (operator === "not_equals")
    return String(fieldValue).toLowerCase() !== String(conditionValue).toLowerCase();
  if (operator === "contains")
    return String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
  if (operator === "not_contains")
    return !String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
  if (operator === "starts_with")
    return String(fieldValue).toLowerCase().startsWith(String(conditionValue).toLowerCase());
  if (operator === "ends_with")
    return String(fieldValue).toLowerCase().endsWith(String(conditionValue).toLowerCase());

  // Numeric operators
  if (operator === "greater_than") return Number(fieldValue) > Number(conditionValue);
  if (operator === "less_than") return Number(fieldValue) < Number(conditionValue);
  if (operator === "greater_than_or_equal")
    return Number(fieldValue) >= Number(conditionValue);
  if (operator === "less_than_or_equal")
    return Number(fieldValue) <= Number(conditionValue);

  // Empty checks
  if (operator === "is_empty")
    return !fieldValue || (Array.isArray(fieldValue) && fieldValue.length === 0);
  if (operator === "is_not_empty")
    return !!fieldValue && !(Array.isArray(fieldValue) && fieldValue.length === 0);

  // Array/set operators
  if (operator === "in") {
    const values = Array.isArray(conditionValue)
      ? conditionValue
      : String(conditionValue).split(",").map((v) => v.trim());
    return values.map((v: string) => v.toLowerCase()).includes(String(fieldValue).toLowerCase());
  }
  if (operator === "not_in") {
    const values = Array.isArray(conditionValue)
      ? conditionValue
      : String(conditionValue).split(",").map((v) => v.trim());
    return !values.map((v: string) => v.toLowerCase()).includes(String(fieldValue).toLowerCase());
  }

  // Regex
  if (operator === "matches_regex") {
    try {
      return new RegExp(String(conditionValue), "i").test(String(fieldValue));
    } catch {
      return false;
    }
  }

  console.warn(`[RuleEngine] Unknown operator: ${operator}`);
  return false;
}

// ============================================================================
// Action Execution
// ============================================================================

export async function executeActions(
  supabase: SupabaseClient,
  actions: RuleAction[],
  ctx: ExecutionContext
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    const result = await executeAction(supabase, action, ctx);
    results.push(result);
  }

  return results;
}

async function executeAction(
  supabase: SupabaseClient,
  action: RuleAction,
  ctx: ExecutionContext
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "add_tag":
        return await executeAddTag(supabase, ctx, action.config);
      case "remove_tag":
        return await executeRemoveTag(supabase, ctx, action.config);
      case "change_stage":
        return await executeChangeStage(supabase, ctx, action.config);
      case "update_score":
        return await executeUpdateScore(supabase, ctx, action.config);
      case "assign_to_user":
        return await executeAssignToUser(supabase, ctx, action.config);
      case "set_ai_handling":
        return await executeSetAiHandling(supabase, ctx, action.config);
      case "send_message":
        return await executeSendMessage(supabase, ctx, action.config);
      case "enroll_in_sequence":
        return await executeEnrollInSequence(supabase, ctx, action.config);
      case "remove_from_sequence":
        return await executeRemoveFromSequence(supabase, ctx, action.config);
      case "trigger_webhook":
        return await executeTriggerWebhook(supabase, ctx, action.config);
      case "send_notification":
        return await executeSendNotification(supabase, ctx, action.config);
      case "create_task":
        return await executeCreateTask(supabase, ctx, action.config);
      case "add_note":
        return await executeAddNote(supabase, ctx, action.config);
      case "wait":
        return { type: "wait", success: true, result: { skipped: true } };
      default:
        return { type: action.type, success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (error) {
    return {
      type: action.type,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// --- Individual action handlers ---

async function executeAddTag(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const tagName = config.tag_name as string;
  if (!tagName) return { type: "add_tag", success: false, error: "No tag_name specified" };

  // Look up or create the tag
  let { data: tag } = await supabase
    .from("crm_tags")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("name", tagName)
    .single();

  if (!tag) {
    const { data: newTag, error } = await supabase
      .from("crm_tags")
      .insert({ organization_id: ctx.organizationId, name: tagName })
      .select("id")
      .single();
    if (error) return { type: "add_tag", success: false, error: error.message };
    tag = newTag;
  }

  const { error } = await supabase.from("crm_contact_tags").upsert(
    {
      organization_id: ctx.organizationId,
      contact_id: ctx.contactId,
      tag_id: tag!.id,
    },
    { onConflict: "contact_id,tag_id" }
  );

  if (error) return { type: "add_tag", success: false, error: error.message };
  return { type: "add_tag", success: true, result: { tagId: tag!.id, tagName } };
}

async function executeRemoveTag(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const tagName = config.tag_name as string;
  if (!tagName) return { type: "remove_tag", success: false, error: "No tag_name specified" };

  const { data: tag } = await supabase
    .from("crm_tags")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("name", tagName)
    .single();

  if (!tag) return { type: "remove_tag", success: true, result: { tagNotFound: true } };

  const { error } = await supabase
    .from("crm_contact_tags")
    .delete()
    .eq("contact_id", ctx.contactId)
    .eq("tag_id", tag.id);

  if (error) return { type: "remove_tag", success: false, error: error.message };
  return { type: "remove_tag", success: true, result: { tagId: tag.id, tagName } };
}

async function executeChangeStage(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const stageId = config.stage_id as string;
  if (!stageId) return { type: "change_stage", success: false, error: "No stage_id specified" };

  const { error } = await supabase
    .from("crm_contacts")
    .update({ pipeline_stage_id: stageId })
    .eq("id", ctx.contactId);

  if (error) return { type: "change_stage", success: false, error: error.message };
  return { type: "change_stage", success: true, result: { stageId } };
}

async function executeUpdateScore(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const delta = (config.score_delta as number) || 0;
  if (delta === 0) return { type: "update_score", success: true, result: { delta: 0 } };

  // Fetch current score and add delta
  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("lead_score")
    .eq("id", ctx.contactId)
    .single();

  const newScore = Math.max(0, (contact?.lead_score || 0) + delta);

  const { error } = await supabase
    .from("crm_contacts")
    .update({ lead_score: newScore })
    .eq("id", ctx.contactId);

  if (error) return { type: "update_score", success: false, error: error.message };
  return { type: "update_score", success: true, result: { delta, newScore } };
}

async function executeAssignToUser(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const userId = config.user_id as string;
  if (!userId) return { type: "assign_to_user", success: false, error: "No user_id specified" };

  const { error } = await supabase
    .from("crm_contacts")
    .update({ owner_user_id: userId })
    .eq("id", ctx.contactId);

  if (error) return { type: "assign_to_user", success: false, error: error.message };
  return { type: "assign_to_user", success: true, result: { userId } };
}

async function executeSetAiHandling(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const enabled = config.enabled !== false;

  if (!ctx.conversationId) {
    return { type: "set_ai_handling", success: false, error: "No conversationId in context" };
  }

  const { error } = await supabase
    .from("crm_conversations")
    .update({ ai_enabled: enabled })
    .eq("id", ctx.conversationId);

  if (error) return { type: "set_ai_handling", success: false, error: error.message };
  return { type: "set_ai_handling", success: true, result: { enabled } };
}

async function executeSendMessage(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const content = config.content as string;
  if (!content) return { type: "send_message", success: false, error: "No content specified" };

  // Queue the message for async sending
  const { error } = await supabase.from("crm_message_queue").insert({
    organization_id: ctx.organizationId,
    contact_id: ctx.contactId,
    conversation_id: ctx.conversationId,
    content,
    channel: (config.channel as string) || ctx.channel || "linkedin",
    source_type: "automation",
    priority: 5,
    status: "pending",
    scheduled_for: new Date().toISOString(),
  });

  if (error) return { type: "send_message", success: false, error: error.message };
  return { type: "send_message", success: true, result: { queued: true } };
}

async function executeEnrollInSequence(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const sequenceId = config.sequence_id as string;
  if (!sequenceId)
    return { type: "enroll_in_sequence", success: false, error: "No sequence_id specified" };

  // Check if already enrolled
  const { data: existing } = await supabase
    .from("crm_sequence_enrollments")
    .select("id")
    .eq("sequence_id", sequenceId)
    .eq("contact_id", ctx.contactId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { type: "enroll_in_sequence", success: true, result: { alreadyEnrolled: true } };
  }

  const { data, error } = await supabase
    .from("crm_sequence_enrollments")
    .insert({
      organization_id: ctx.organizationId,
      sequence_id: sequenceId,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId,
      status: "active",
      current_step: 0,
    })
    .select("id")
    .single();

  if (error) return { type: "enroll_in_sequence", success: false, error: error.message };
  return { type: "enroll_in_sequence", success: true, result: { enrollmentId: data.id } };
}

async function executeRemoveFromSequence(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const sequenceId = config.sequence_id as string;

  let query = supabase
    .from("crm_sequence_enrollments")
    .update({ status: "removed", completed_at: new Date().toISOString() })
    .eq("contact_id", ctx.contactId)
    .eq("status", "active");

  if (sequenceId) {
    query = query.eq("sequence_id", sequenceId);
  }

  const { error } = await query;
  if (error) return { type: "remove_from_sequence", success: false, error: error.message };
  return { type: "remove_from_sequence", success: true };
}

async function executeTriggerWebhook(
  _supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const url = config.url as string;
  if (!url) return { type: "trigger_webhook", success: false, error: "No url specified" };

  try {
    const response = await fetch(url, {
      method: (config.method as string) || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.headers as Record<string, string> || {}),
      },
      body: JSON.stringify({
        event: "rule_triggered",
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        timestamp: new Date().toISOString(),
        ...(config.payload as Record<string, unknown> || {}),
      }),
    });

    return {
      type: "trigger_webhook",
      success: response.ok,
      result: { status: response.status },
    };
  } catch (error) {
    return {
      type: "trigger_webhook",
      success: false,
      error: error instanceof Error ? error.message : "Webhook request failed",
    };
  }
}

async function executeSendNotification(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  // For now, log the notification intent - can be expanded later
  console.log(`[RuleEngine] Notification: ${config.message}`, {
    org: ctx.organizationId,
    contact: ctx.contactId,
  });
  return { type: "send_notification", success: true, result: { logged: true } };
}

async function executeCreateTask(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  // Log task creation intent - crm_tasks table may or may not exist
  console.log(`[RuleEngine] Create task: ${config.title}`, {
    org: ctx.organizationId,
    contact: ctx.contactId,
  });
  return { type: "create_task", success: true, result: { logged: true } };
}

async function executeAddNote(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  config: Record<string, unknown>
): Promise<ActionResult> {
  const content = config.content as string;
  if (!content) return { type: "add_note", success: false, error: "No content specified" };

  const { error } = await supabase.from("crm_notes").insert({
    organization_id: ctx.organizationId,
    contact_id: ctx.contactId,
    content,
    created_by_type: "automation",
  });

  if (error) return { type: "add_note", success: false, error: error.message };
  return { type: "add_note", success: true };
}

// ============================================================================
// Rule Execution Logging
// ============================================================================

export async function logRuleExecution(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    ruleId: string;
    contactId: string;
    conversationId?: string;
    messageId?: string;
    triggerType: string;
    triggerData: Record<string, unknown>;
    conditionsMet: boolean;
    conditionResults: ConditionResult[];
    actionsExecuted: ActionResult[];
    startedAt: number;
  }
): Promise<void> {
  const durationMs = Date.now() - params.startedAt;
  const allSucceeded = params.actionsExecuted.every((a) => a.success);
  const anySucceeded = params.actionsExecuted.some((a) => a.success);

  let executionStatus: string;
  if (!params.conditionsMet) {
    executionStatus = "success"; // Conditions not met is a valid outcome
  } else if (params.actionsExecuted.length === 0) {
    executionStatus = "success";
  } else if (allSucceeded) {
    executionStatus = "success";
  } else if (anySucceeded) {
    executionStatus = "partial";
  } else {
    executionStatus = "failed";
  }

  const { error } = await supabase.from("crm_rule_log").insert({
    organization_id: params.organizationId,
    rule_id: params.ruleId,
    contact_id: params.contactId,
    conversation_id: params.conversationId || null,
    message_id: params.messageId || null,
    trigger_type: params.triggerType,
    trigger_data: params.triggerData,
    conditions_met: params.conditionsMet,
    condition_results: params.conditionResults,
    actions_executed: params.actionsExecuted,
    success: params.conditionsMet ? allSucceeded : true,
    execution_status: executionStatus,
    started_at: new Date(params.startedAt).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });

  if (error) {
    console.error("[RuleEngine] Failed to log rule execution:", error);
  }

  // Update rule stats
  if (params.conditionsMet) {
    await supabase.rpc("increment_rule_stats", {
      p_rule_id: params.ruleId,
      p_succeeded: allSucceeded,
    }).catch(() => {
      // Fallback: update directly if RPC doesn't exist
      supabase
        .from("crm_automation_rules")
        .update({
          total_triggered: supabase.rpc ? undefined : undefined, // Will be handled by RPC
          last_triggered_at: new Date().toISOString(),
        })
        .eq("id", params.ruleId)
        .then(() => {});
    });
  }
}

// ============================================================================
// Handoff Trigger Evaluation
// ============================================================================

export async function evaluateHandoffTriggers(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  conversationId: string,
  messageContent: string,
  messageId: string
): Promise<HandoffEvaluationResult> {
  // Fetch active handoff triggers
  const { data: triggers, error } = await supabase
    .from("crm_handoff_triggers")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error || !triggers || triggers.length === 0) {
    return { triggered: false };
  }

  for (const trigger of triggers) {
    const config = trigger.config || {};
    let matched = false;
    let reason = "";

    switch (trigger.trigger_type) {
      case "keyword": {
        const keywords = (config.keywords as string[]) || [];
        const matchType = (config.match_type as string) || "any";
        const lowerContent = messageContent.toLowerCase();

        if (matchType === "any") {
          matched = keywords.some((k: string) => lowerContent.includes(k.toLowerCase()));
        } else {
          matched = keywords.every((k: string) => lowerContent.includes(k.toLowerCase()));
        }
        if (matched) {
          const matchedKeywords = keywords.filter((k: string) =>
            lowerContent.includes(k.toLowerCase())
          );
          reason = `Keyword match: ${matchedKeywords.join(", ")}`;
        }
        break;
      }

      case "score_threshold": {
        const { data: contact } = await supabase
          .from("crm_contacts")
          .select("lead_score")
          .eq("id", contactId)
          .single();
        const minScore = (config.min_score as number) || 0;
        matched = (contact?.lead_score || 0) >= minScore;
        if (matched) reason = `Score threshold: ${contact?.lead_score} >= ${minScore}`;
        break;
      }

      case "request": {
        const phrases = (config.phrases as string[]) || [
          "human",
          "real person",
          "agent",
          "representative",
          "speak to someone",
        ];
        const lowerContent = messageContent.toLowerCase();
        matched = phrases.some((p: string) => lowerContent.includes(p.toLowerCase()));
        if (matched) reason = "Human request detected";
        break;
      }

      case "time_based": {
        const afterMinutes = (config.after_minutes as number) || 30;
        const { data: conv } = await supabase
          .from("crm_conversations")
          .select("last_message_at")
          .eq("id", conversationId)
          .single();

        if (conv?.last_message_at) {
          const minutesSince =
            (Date.now() - new Date(conv.last_message_at).getTime()) / 60000;
          matched = minutesSince >= afterMinutes;
          if (matched)
            reason = `Time-based: ${Math.round(minutesSince)}min since last message`;
        }
        break;
      }

      case "sentiment":
      case "escalation":
        // Future: integrate with AI sentiment analysis
        break;
    }

    if (matched) {
      // Log the handoff
      await supabase.from("crm_handoff_log").insert({
        organization_id: organizationId,
        trigger_id: trigger.id,
        conversation_id: conversationId,
        contact_id: contactId,
        trigger_type: trigger.trigger_type,
        trigger_reason: reason,
        trigger_data: { messageContent: messageContent.substring(0, 500) },
        triggering_message_id: messageId,
      });

      // Update trigger stats
      await supabase
        .from("crm_handoff_triggers")
        .update({
          total_triggered: (trigger.total_triggered || 0) + 1,
          last_triggered_at: new Date().toISOString(),
        })
        .eq("id", trigger.id);

      // Pause AI on the conversation
      if (conversationId) {
        await supabase
          .from("crm_conversations")
          .update({ ai_enabled: false })
          .eq("id", conversationId);
      }

      // Execute trigger delivery actions (fire-and-forget)
      const actions = (trigger.actions || []) as Array<{ type: string; config?: Record<string, unknown> }>;
      if (actions.length > 0) {
        const fnUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/execute-handoff-actions";
        fetch(fnUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            triggerId: trigger.id,
            contactId,
            conversationId,
            organizationId,
          }),
        }).catch((err) =>
          console.error("[handoff] Failed to execute delivery actions:", err)
        );
      }

      return {
        triggered: true,
        triggerId: trigger.id,
        triggerName: trigger.name,
        reason,
      };
    }
  }

  return { triggered: false };
}
