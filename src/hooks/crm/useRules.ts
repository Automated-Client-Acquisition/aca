import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type RuleTriggerType =
  | "message_received"
  | "message_sent"
  | "lead_captured"
  | "stage_changed"
  | "tag_added"
  | "tag_removed"
  | "score_changed"
  | "enrollment_completed"
  | "handoff_requested"
  | "time_based";

export type RuleConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty"
  | "in"
  | "not_in"
  | "matches_regex";

export type RuleConditionField =
  | "message_content"
  | "message_channel"
  | "contact_stage"
  | "contact_score"
  | "contact_tags"
  | "contact_source"
  | "contact_custom_field"
  | "time_since_last_message"
  | "conversation_message_count"
  | "contact_email"
  | "contact_phone"
  | "contact_name";

export type RuleActionType =
  | "send_message"
  | "add_tag"
  | "remove_tag"
  | "change_stage"
  | "update_score"
  | "enroll_in_sequence"
  | "remove_from_sequence"
  | "assign_to_user"
  | "set_ai_handling"
  | "trigger_webhook"
  | "create_task"
  | "send_notification"
  | "wait"
  | "add_note";

export interface RuleCondition {
  id: string;
  field: RuleConditionField;
  operator: RuleConditionOperator;
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
  type: RuleActionType;
  config: Record<string, unknown>;
  delay_seconds?: number;
}

export interface CrmAutomationRule {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  trigger_type: RuleTriggerType;
  trigger_config: Record<string, unknown>;
  conditions: RuleConditionGroup;
  actions: RuleAction[];
  is_active: boolean;
  priority: number;
  max_triggers_per_contact: number | null;
  cooldown_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface RuleLog {
  id: string;
  rule_id: string;
  contact_id: string;
  trigger_data: Record<string, unknown>;
  conditions_matched: boolean;
  actions_executed: RuleAction[];
  execution_status: "success" | "partial" | "failed";
  error_message: string | null;
  created_at: string;
}

export interface CreateRuleInput {
  name: string;
  description?: string;
  trigger_type: RuleTriggerType;
  trigger_config?: Record<string, unknown>;
  conditions: RuleConditionGroup;
  actions: RuleAction[];
  is_active?: boolean;
  priority?: number;
  max_triggers_per_contact?: number;
  cooldown_hours?: number;
}

export interface UpdateRuleInput {
  name?: string;
  description?: string;
  trigger_type?: RuleTriggerType;
  trigger_config?: Record<string, unknown>;
  conditions?: RuleConditionGroup;
  actions?: RuleAction[];
  is_active?: boolean;
  priority?: number;
  max_triggers_per_contact?: number;
  cooldown_hours?: number;
}

// ============================================================================
// Query Keys
// ============================================================================

export const ruleKeys = {
  all: ["crm_rules"] as const,
  lists: () => [...ruleKeys.all, "list"] as const,
  list: (filters: { trigger_type?: RuleTriggerType; is_active?: boolean }) =>
    [...ruleKeys.lists(), filters] as const,
  details: () => [...ruleKeys.all, "detail"] as const,
  detail: (id: string) => [...ruleKeys.details(), id] as const,
  logs: (ruleId: string) => [...ruleKeys.all, "logs", ruleId] as const,
};

// ============================================================================
// Hooks - Rules CRUD
// ============================================================================

interface UseRulesOptions {
  triggerType?: RuleTriggerType;
  isActive?: boolean;
}

export function useRules(options: UseRulesOptions = {}) {
  return useQuery({
    queryKey: ruleKeys.list({ trigger_type: options.triggerType, is_active: options.isActive }),
    queryFn: async () => {
      let query = supabase
        .from("crm_automation_rules")
        .select("*")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false });

      if (options.triggerType) {
        query = query.eq("trigger_type", options.triggerType);
      }

      if (options.isActive !== undefined) {
        query = query.eq("is_active", options.isActive);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as CrmAutomationRule[];
    },
  });
}

export function useRule(ruleId: string | undefined) {
  return useQuery({
    queryKey: ruleKeys.detail(ruleId || ""),
    queryFn: async () => {
      if (!ruleId) throw new Error("Rule ID is required");

      const { data, error } = await supabase
        .from("crm_automation_rules")
        .select("*")
        .eq("id", ruleId)
        .single();

      if (error) throw error;
      return data as CrmAutomationRule;
    },
    enabled: !!ruleId,
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRuleInput) => {
      const { data, error } = await supabase
        .from("crm_automation_rules")
        .insert({
          name: input.name,
          description: input.description,
          trigger_type: input.trigger_type,
          trigger_config: input.trigger_config || {},
          conditions: input.conditions,
          actions: input.actions,
          is_active: input.is_active ?? false,
          priority: input.priority ?? 0,
          max_triggers_per_contact: input.max_triggers_per_contact,
          cooldown_hours: input.cooldown_hours,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmAutomationRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.lists() });
      toast.success("Rule created successfully");
    },
    onError: (error) => {
      console.error("Failed to create rule:", error);
      toast.error("Failed to create rule");
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ruleId,
      input,
    }: {
      ruleId: string;
      input: UpdateRuleInput;
    }) => {
      const { data, error } = await supabase
        .from("crm_automation_rules")
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ruleId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmAutomationRule;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ruleKeys.detail(data.id) });
      toast.success("Rule updated successfully");
    },
    onError: (error) => {
      console.error("Failed to update rule:", error);
      toast.error("Failed to update rule");
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from("crm_automation_rules")
        .delete()
        .eq("id", ruleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.lists() });
      toast.success("Rule deleted successfully");
    },
    onError: (error) => {
      console.error("Failed to delete rule:", error);
      toast.error("Failed to delete rule");
    },
  });
}

export function useToggleRuleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ruleId,
      isActive,
    }: {
      ruleId: string;
      isActive: boolean;
    }) => {
      const { data, error } = await supabase
        .from("crm_automation_rules")
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ruleId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmAutomationRule;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ruleKeys.detail(data.id) });
      toast.success(`Rule ${data.is_active ? "activated" : "deactivated"}`);
    },
    onError: (error) => {
      console.error("Failed to toggle rule status:", error);
      toast.error("Failed to update rule status");
    },
  });
}

export function useDuplicateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      // First fetch the original rule
      const { data: original, error: fetchError } = await supabase
        .from("crm_automation_rules")
        .select("*")
        .eq("id", ruleId)
        .single();

      if (fetchError) throw fetchError;

      // Create a duplicate with modified name
      const { data, error } = await supabase
        .from("crm_automation_rules")
        .insert({
          name: `${original.name} (Copy)`,
          description: original.description,
          trigger_type: original.trigger_type,
          trigger_config: original.trigger_config,
          conditions: original.conditions,
          actions: original.actions,
          is_active: false, // Always create duplicates as inactive
          priority: original.priority,
          max_triggers_per_contact: original.max_triggers_per_contact,
          cooldown_hours: original.cooldown_hours,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmAutomationRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.lists() });
      toast.success("Rule duplicated successfully");
    },
    onError: (error) => {
      console.error("Failed to duplicate rule:", error);
      toast.error("Failed to duplicate rule");
    },
  });
}

// ============================================================================
// Hooks - Rule Logs
// ============================================================================

interface UseRuleLogsOptions {
  ruleId: string;
  limit?: number;
}

export function useRuleLogs(options: UseRuleLogsOptions) {
  return useQuery({
    queryKey: ruleKeys.logs(options.ruleId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_rule_log")
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url)
        `)
        .eq("rule_id", options.ruleId)
        .order("created_at", { ascending: false })
        .limit(options.limit || 50);

      if (error) throw error;
      return data as (RuleLog & {
        contact: { id: string; display_name: string; avatar_url: string | null } | null;
      })[];
    },
    enabled: !!options.ruleId,
  });
}

// ============================================================================
// Hooks - Handoff Triggers
// ============================================================================

export interface HandoffTrigger {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  trigger_type: "keyword" | "sentiment" | "request" | "escalation" | "time_based" | "score_threshold";
  config: Record<string, unknown>;
  actions: Record<string, unknown>[];
  is_active: boolean;
  notify_users: string[];
  auto_assign_to: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  total_triggered: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHandoffTriggerInput {
  name: string;
  description?: string;
  trigger_type: HandoffTrigger["trigger_type"];
  config: Record<string, unknown>;
  actions?: Record<string, unknown>[];
  is_active?: boolean;
  notify_users?: string[];
  auto_assign_to?: string;
  priority?: HandoffTrigger["priority"];
}

export const handoffKeys = {
  all: ["crm_handoff_triggers"] as const,
  lists: () => [...handoffKeys.all, "list"] as const,
  detail: (id: string) => [...handoffKeys.all, "detail", id] as const,
};

export function useHandoffTriggers() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: [...handoffKeys.lists(), currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_handoff_triggers")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as HandoffTrigger[];
    },
    enabled: !!currentOrganization,
  });
}

export function useCreateHandoffTrigger() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateHandoffTriggerInput) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("crm_handoff_triggers")
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description,
          trigger_type: input.trigger_type,
          config: input.config,
          actions: input.actions || [],
          is_active: input.is_active ?? true,
          notify_users: input.notify_users || [],
          auto_assign_to: input.auto_assign_to,
          priority: input.priority || "medium",
        })
        .select()
        .single();

      if (error) throw error;
      return data as HandoffTrigger;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: handoffKeys.lists() });
      toast.success("Handoff trigger created");
    },
    onError: (error) => {
      console.error("Failed to create handoff trigger:", error);
      toast.error("Failed to create handoff trigger");
    },
  });
}

export function useUpdateHandoffTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      triggerId,
      input,
    }: {
      triggerId: string;
      input: Partial<CreateHandoffTriggerInput>;
    }) => {
      const { data, error } = await supabase
        .from("crm_handoff_triggers")
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq("id", triggerId)
        .select()
        .single();

      if (error) throw error;
      return data as HandoffTrigger;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: handoffKeys.lists() });
      queryClient.invalidateQueries({ queryKey: handoffKeys.detail(data.id) });
      toast.success("Handoff trigger updated");
    },
    onError: (error) => {
      console.error("Failed to update handoff trigger:", error);
      toast.error("Failed to update handoff trigger");
    },
  });
}

export function useDeleteHandoffTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (triggerId: string) => {
      const { error } = await supabase
        .from("crm_handoff_triggers")
        .delete()
        .eq("id", triggerId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: handoffKeys.lists() });
      toast.success("Handoff trigger deleted");
    },
    onError: (error) => {
      console.error("Failed to delete handoff trigger:", error);
      toast.error("Failed to delete handoff trigger");
    },
  });
}

// ============================================================================
// Hooks - Handoff Triggers (Extended)
// ============================================================================

export function useHandoffTrigger(triggerId: string | undefined) {
  return useQuery({
    queryKey: handoffKeys.detail(triggerId || ""),
    queryFn: async () => {
      if (!triggerId) throw new Error("Trigger ID is required");

      const { data, error } = await supabase
        .from("crm_handoff_triggers")
        .select("*")
        .eq("id", triggerId)
        .single();

      if (error) throw error;
      return data as HandoffTrigger;
    },
    enabled: !!triggerId,
  });
}

export function useToggleHandoffTriggerStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      triggerId,
      isActive,
    }: {
      triggerId: string;
      isActive: boolean;
    }) => {
      const { data, error } = await supabase
        .from("crm_handoff_triggers")
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", triggerId)
        .select()
        .single();

      if (error) throw error;
      return data as HandoffTrigger;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: handoffKeys.lists() });
      queryClient.invalidateQueries({ queryKey: handoffKeys.detail(data.id) });
      toast.success(`Handoff trigger ${data.is_active ? "activated" : "deactivated"}`);
    },
    onError: (error) => {
      console.error("Failed to toggle handoff trigger status:", error);
      toast.error("Failed to update handoff trigger status");
    },
  });
}

export function useDuplicateHandoffTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (triggerId: string) => {
      const { data: original, error: fetchError } = await supabase
        .from("crm_handoff_triggers")
        .select("*")
        .eq("id", triggerId)
        .single();

      if (fetchError) throw fetchError;

      const { data, error } = await supabase
        .from("crm_handoff_triggers")
        .insert({
          organization_id: original.organization_id,
          name: `${original.name} (Copy)`,
          description: original.description,
          trigger_type: original.trigger_type,
          config: original.config,
          actions: original.actions,
          is_active: false,
          priority: original.priority,
          notify_users: original.notify_users,
          auto_assign_to: original.auto_assign_to,
        })
        .select()
        .single();

      if (error) throw error;
      return data as HandoffTrigger;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: handoffKeys.lists() });
      toast.success("Handoff trigger duplicated");
    },
    onError: (error) => {
      console.error("Failed to duplicate handoff trigger:", error);
      toast.error("Failed to duplicate handoff trigger");
    },
  });
}

// ============================================================================
// Hooks - Handoff Logs
// ============================================================================

export interface HandoffLog {
  id: string;
  organization_id: string;
  trigger_id: string | null;
  conversation_id: string;
  contact_id: string;
  trigger_type: string;
  trigger_reason: string | null;
  trigger_data: Record<string, unknown>;
  triggering_message_id: string | null;
  actions_executed: Record<string, unknown>[];
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
  contact?: { id: string; display_name: string; avatar_url: string | null } | null;
  trigger?: { id: string; name: string } | null;
}

interface UseHandoffLogsOptions {
  triggerId?: string;
  status?: "open" | "resolved" | "all";
  limit?: number;
}

export function useHandoffLogs(options: UseHandoffLogsOptions = {}) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: [...handoffKeys.all, "logs", currentOrganization?.id, options.triggerId, options.status],
    queryFn: async () => {
      let query = supabase
        .from("crm_handoff_log")
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url),
          trigger:crm_handoff_triggers(id, name)
        `)
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false })
        .limit(options.limit || 200);

      if (options.triggerId) {
        query = query.eq("trigger_id", options.triggerId);
      }

      if (options.status === "open") {
        query = query.is("resolved_at", null);
      } else if (options.status === "resolved") {
        query = query.not("resolved_at", "is", null);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as HandoffLog[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Manual Handoff (from Inbox)
// ============================================================================

export function useManualHandoff() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      conversationId,
      contactId,
      triggerId,
    }: {
      conversationId: string;
      contactId: string;
      triggerId?: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");

      // 1. Log the manual handoff
      const { error: logError } = await supabase
        .from("crm_handoff_log")
        .insert({
          organization_id: currentOrganization.id,
          conversation_id: conversationId,
          contact_id: contactId,
          trigger_id: triggerId || null,
          trigger_type: "request",
          trigger_reason: "Manual handoff from inbox",
          trigger_data: { manual: true },
        });

      if (logError) throw logError;

      // 2. Disable AI on the conversation
      const { error: aiError } = await supabase
        .from("crm_conversations")
        .update({ ai_enabled: false })
        .eq("id", conversationId);

      if (aiError) throw aiError;

      // 3. Execute trigger delivery actions (fire-and-forget)
      if (triggerId && currentOrganization) {
        supabase.functions
          .invoke("execute-handoff-actions", {
            body: {
              triggerId,
              contactId,
              conversationId,
              organizationId: currentOrganization.id,
            },
          })
          .catch((err) =>
            console.error("Failed to execute handoff actions:", err)
          );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm_conversations"] });
      queryClient.invalidateQueries({ queryKey: handoffKeys.all });
      toast.success("Lead handed off — AI paused on this conversation");
    },
    onError: (error) => {
      console.error("Failed to handoff:", error);
      toast.error("Failed to handoff lead");
    },
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getTriggerTypeLabel(type: RuleTriggerType): string {
  const labels: Record<RuleTriggerType, string> = {
    message_received: "Message Received",
    message_sent: "Message Sent",
    lead_captured: "Lead Captured",
    stage_changed: "Stage Changed",
    tag_added: "Tag Added",
    tag_removed: "Tag Removed",
    score_changed: "Score Changed",
    enrollment_completed: "Sequence Completed",
    handoff_requested: "Handoff Requested",
    time_based: "Time-Based",
  };
  return labels[type] || type;
}

export function getActionTypeLabel(type: RuleActionType): string {
  const labels: Record<RuleActionType, string> = {
    send_message: "Send Message",
    add_tag: "Add Tag",
    remove_tag: "Remove Tag",
    change_stage: "Change Stage",
    update_score: "Update Score",
    enroll_in_sequence: "Enroll in Sequence",
    remove_from_sequence: "Remove from Sequence",
    assign_to_user: "Assign to User",
    set_ai_handling: "Set AI Handling",
    trigger_webhook: "Trigger Webhook",
    create_task: "Create Task",
    send_notification: "Send Notification",
    wait: "Wait",
    add_note: "Add Note",
  };
  return labels[type] || type;
}

export function getConditionOperatorLabel(operator: RuleConditionOperator): string {
  const labels: Record<RuleConditionOperator, string> = {
    equals: "equals",
    not_equals: "does not equal",
    contains: "contains",
    not_contains: "does not contain",
    starts_with: "starts with",
    ends_with: "ends with",
    greater_than: "is greater than",
    less_than: "is less than",
    greater_than_or_equal: "is at least",
    less_than_or_equal: "is at most",
    is_empty: "is empty",
    is_not_empty: "is not empty",
    in: "is one of",
    not_in: "is not one of",
    matches_regex: "matches pattern",
  };
  return labels[operator] || operator;
}

export function getConditionFieldLabel(field: RuleConditionField): string {
  const labels: Record<RuleConditionField, string> = {
    message_content: "Message Content",
    message_channel: "Channel",
    contact_stage: "Pipeline Stage",
    contact_score: "Lead Score",
    contact_tags: "Tags",
    contact_source: "Source",
    contact_custom_field: "Custom Field",
    time_since_last_message: "Time Since Last Message",
    conversation_message_count: "Message Count",
    contact_email: "Email",
    contact_phone: "Phone",
    contact_name: "Name",
  };
  return labels[field] || field;
}

export function getHandoffTriggerTypeLabel(type: HandoffTrigger["trigger_type"]): string {
  const labels: Record<HandoffTrigger["trigger_type"], string> = {
    keyword: "Keyword Match",
    sentiment: "Negative Sentiment",
    request: "Human Request",
    escalation: "Escalation",
    time_based: "Time-Based",
    score_threshold: "Score Threshold",
  };
  return labels[type] || type;
}

// Create a default empty condition group
export function createEmptyConditionGroup(): RuleConditionGroup {
  return {
    id: crypto.randomUUID(),
    logic: "and",
    conditions: [],
    groups: [],
  };
}

// Create a default condition
export function createEmptyCondition(): RuleCondition {
  return {
    id: crypto.randomUUID(),
    field: "message_content",
    operator: "contains",
    value: "",
  };
}

// Create a default action
export function createEmptyAction(type: RuleActionType = "send_message"): RuleAction {
  return {
    id: crypto.randomUUID(),
    type,
    config: {},
  };
}
