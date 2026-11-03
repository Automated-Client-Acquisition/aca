import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  buildConditionContext,
  evaluateConditionGroup,
  executeActions,
  logRuleExecution,
  evaluateHandoffTriggers,
  type RuleConditionGroup,
  type RuleAction,
  type ExecutionContext,
  type RuleEvaluationResult,
} from "../_shared/rule-engine.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Evaluate Rules Edge Function
 *
 * Evaluates automation rules and handoff triggers for a given event.
 * Called by crm-sync-inbound, unipile-webhook-handler, or directly.
 *
 * Input:
 * - organizationId: string
 * - triggerType: string (message_received, stage_changed, etc.)
 * - contactId: string
 * - triggerData: { messageId?, conversationId?, messageContent?, messageChannel?, ... }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Invoked by crm-sync-inbound and unipile-webhook-handler with service-role clients.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { organizationId, triggerType, contactId, triggerData } =
      await req.json();

    if (!organizationId || !triggerType || !contactId) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: organizationId, triggerType, contactId",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[EvaluateRules] Processing ${triggerType} for contact ${contactId} in org ${organizationId}`
    );

    const results: RuleEvaluationResult[] = [];

    // =============================================
    // 1. Fetch active rules for this trigger type
    // =============================================
    const { data: rules, error: rulesError } = await supabase.rpc(
      "get_active_rules_for_trigger",
      {
        p_org_id: organizationId,
        p_trigger_type: triggerType,
      }
    );

    if (rulesError) {
      console.error("[EvaluateRules] Failed to fetch rules:", rulesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch rules", details: rulesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rules || rules.length === 0) {
      console.log(`[EvaluateRules] No active rules for trigger type: ${triggerType}`);
    } else {
      console.log(`[EvaluateRules] Found ${rules.length} active rule(s) to evaluate`);

      // =============================================
      // 2. Build condition context (once for all rules)
      // =============================================
      const conditionContext = await buildConditionContext(
        supabase,
        contactId,
        triggerData || {}
      );

      const executionContext: ExecutionContext = {
        organizationId,
        contactId,
        conversationId: triggerData?.conversationId as string | undefined,
        messageId: triggerData?.messageId as string | undefined,
        channel: triggerData?.messageChannel as string | undefined,
      };

      // =============================================
      // 3. Evaluate each rule
      // =============================================
      for (const rule of rules) {
        const startedAt = Date.now();

        // Check cooldown/max triggers
        const { data: canTrigger } = await supabase.rpc(
          "can_rule_trigger_for_contact",
          {
            p_rule_id: rule.rule_id,
            p_contact_id: contactId,
            p_cooldown_seconds: rule.cooldown_seconds || 0,
            p_max_triggers: rule.max_triggers_per_contact,
          }
        );

        if (!canTrigger) {
          console.log(
            `[EvaluateRules] Rule "${rule.name}" skipped (cooldown/max triggers)`
          );
          results.push({
            ruleId: rule.rule_id,
            ruleName: rule.name,
            triggered: false,
            skippedReason: "Rate limited (cooldown or max triggers)",
            conditionResults: [],
            actionResults: [],
            durationMs: Date.now() - startedAt,
          });
          continue;
        }

        // Evaluate conditions
        const conditions = rule.conditions as RuleConditionGroup;
        const { matched, results: conditionResults } = evaluateConditionGroup(
          conditions,
          conditionContext
        );

        if (!matched) {
          console.log(
            `[EvaluateRules] Rule "${rule.name}" conditions not met`
          );

          // Log the skip
          await logRuleExecution(supabase, {
            organizationId,
            ruleId: rule.rule_id,
            contactId,
            conversationId: triggerData?.conversationId as string | undefined,
            messageId: triggerData?.messageId as string | undefined,
            triggerType,
            triggerData: triggerData || {},
            conditionsMet: false,
            conditionResults,
            actionsExecuted: [],
            startedAt,
          });

          results.push({
            ruleId: rule.rule_id,
            ruleName: rule.name,
            triggered: false,
            conditionResults,
            actionResults: [],
            durationMs: Date.now() - startedAt,
          });
          continue;
        }

        // Execute actions
        console.log(
          `[EvaluateRules] Rule "${rule.name}" matched! Executing ${(rule.actions as RuleAction[]).length} action(s)`
        );

        const actionResults = await executeActions(
          supabase,
          rule.actions as RuleAction[],
          executionContext
        );

        // Log execution
        await logRuleExecution(supabase, {
          organizationId,
          ruleId: rule.rule_id,
          contactId,
          conversationId: triggerData?.conversationId as string | undefined,
          messageId: triggerData?.messageId as string | undefined,
          triggerType,
          triggerData: triggerData || {},
          conditionsMet: true,
          conditionResults,
          actionsExecuted: actionResults,
          startedAt,
        });

        results.push({
          ruleId: rule.rule_id,
          ruleName: rule.name,
          triggered: true,
          conditionResults,
          actionResults,
          durationMs: Date.now() - startedAt,
        });

        console.log(
          `[EvaluateRules] Rule "${rule.name}" completed: ${actionResults.filter((a) => a.success).length}/${actionResults.length} actions succeeded`
        );
      }
    }

    // =============================================
    // 4. Evaluate handoff triggers (message_received only)
    // =============================================
    let handoffResult = null;

    if (
      triggerType === "message_received" &&
      triggerData?.messageContent &&
      triggerData?.conversationId
    ) {
      try {
        handoffResult = await evaluateHandoffTriggers(
          supabase,
          organizationId,
          contactId,
          triggerData.conversationId as string,
          triggerData.messageContent as string,
          (triggerData.messageId as string) || ""
        );

        if (handoffResult.triggered) {
          console.log(
            `[EvaluateRules] Handoff triggered: "${handoffResult.triggerName}" - ${handoffResult.reason}`
          );
        }
      } catch (handoffError) {
        console.error(
          "[EvaluateRules] Handoff trigger evaluation failed:",
          handoffError
        );
      }
    }

    // =============================================
    // 5. Return summary
    // =============================================
    const summary = {
      success: true,
      rulesEvaluated: results.length,
      rulesTriggered: results.filter((r) => r.triggered).length,
      handoff: handoffResult,
      results,
    };

    console.log(
      `[EvaluateRules] Complete: ${summary.rulesTriggered}/${summary.rulesEvaluated} rules triggered${handoffResult?.triggered ? ", handoff activated" : ""}`
    );

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[EvaluateRules] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
