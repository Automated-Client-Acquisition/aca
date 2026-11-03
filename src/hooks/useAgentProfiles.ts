import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { AutopilotConfig } from "@/types/email";

export interface AgentProfile {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  config: AutopilotConfig;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeAgentConfig(raw: unknown): AutopilotConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const config: AutopilotConfig = {
    enabled: typeof r.enabled === "boolean" ? r.enabled : true,
    rules: Array.isArray(r.rules) ? (r.rules as AutopilotConfig["rules"]) : [],
    require_approval: typeof r.require_approval === "boolean" ? r.require_approval : true,
    max_auto_replies: typeof r.max_auto_replies === "number" ? r.max_auto_replies : 10,
    max_conversation_turns:
      typeof r.max_conversation_turns === "number" ? r.max_conversation_turns : 10,
    conversation_goal:
      typeof r.conversation_goal === "string" && r.conversation_goal ? r.conversation_goal : undefined,
    // Playbook-generated profiles store the prompt under `system_prompt`; the engine + UI read `system_instructions`.
    system_instructions:
      typeof r.system_instructions === "string" && r.system_instructions
        ? r.system_instructions
        : typeof r.system_prompt === "string" && r.system_prompt
          ? (r.system_prompt as string)
          : undefined,
    use_knowledge_base:
      typeof r.use_knowledge_base === "boolean" ? r.use_knowledge_base : undefined,
    knowledge_document_ids: Array.isArray(r.knowledge_document_ids)
      ? (r.knowledge_document_ids as string[])
      : undefined,
    use_tone_profile: typeof r.use_tone_profile === "boolean" ? r.use_tone_profile : undefined,
    owner_user_id: typeof r.owner_user_id === "string" ? r.owner_user_id : undefined,
    escalation_rules: Array.isArray(r.escalation_rules)
      ? (r.escalation_rules as AutopilotConfig["escalation_rules"])
      : undefined,
    booking_timezone: typeof r.booking_timezone === "string" ? r.booking_timezone : undefined,
    ghl_calendar_id: typeof r.ghl_calendar_id === "string" ? r.ghl_calendar_id : undefined,
  };

  // Map playbook `escalation_triggers` (string[]) → structured escalation_rules.
  if (
    (!config.escalation_rules || config.escalation_rules.length === 0) &&
    Array.isArray(r.escalation_triggers) &&
    r.escalation_triggers.length > 0
  ) {
    config.escalation_rules = [
      { condition: "explicit_request" },
      { condition: "max_turns" },
      { condition: "custom_keyword", keywords: ["cancel", "refund", "lawsuit", "legal", "complaint"] },
    ];
  }

  // Synthesize a default rule set for a profiled agent (has a system prompt / tone
  // profile) that has no rules — otherwise the engine returns noAction and the agent
  // never acts. `auto_reply` honors require_approval (default true) → drafts for review.
  const isProfiledAgent = !!(config.system_instructions || r.system_prompt || config.use_tone_profile);
  if (config.rules.length === 0 && isProfiledAgent) {
    config.rules = [
      { intent: "interested", action: "auto_reply" },
      { intent: "neutral", action: "auto_reply" },
      { intent: "not_interested", action: "auto_reply" },
      { intent: "out_of_office", action: "auto_followup_after_return" },
      {
        intent: "meeting_booked",
        action: config.ghl_calendar_id ? "book_ghl_appointment" : "auto_reply",
        ...(config.ghl_calendar_id ? { ghl_calendar_id: config.ghl_calendar_id } : {}),
      },
    ];
  }

  return config;
}

function normalizeProfile(row: AgentProfile): AgentProfile {
  return { ...row, config: normalizeAgentConfig(row.config) };
}

export function useAgentProfiles() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["agent-profiles", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agent_profiles")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("is_default", { ascending: false })
        .order("name");

      if (error) throw error;
      return (data || []).map((row) => normalizeProfile(row as AgentProfile));
    },
    enabled: !!currentOrganization,
  });
}

export function useCreateAgentProfile() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      config,
      isDefault,
    }: {
      name: string;
      description?: string;
      config: AutopilotConfig;
      isDefault?: boolean;
    }) => {
      // If setting as default, clear existing default first
      if (isDefault) {
        await supabase
          .from("ai_agent_profiles")
          .update({ is_default: false })
          .eq("organization_id", currentOrganization!.id)
          .eq("is_default", true);
      }

      const { data, error } = await supabase
        .from("ai_agent_profiles")
        .insert({
          organization_id: currentOrganization!.id,
          name,
          description: description || null,
          config: config as unknown as Record<string, unknown>,
          is_default: isDefault || false,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return normalizeProfile(data as AgentProfile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-profiles"] });
      toast.success("Agent profile created");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create profile");
    },
  });
}

export function useUpdateAgentProfile() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      description,
      config,
    }: {
      id: string;
      name?: string;
      description?: string;
      config?: AutopilotConfig;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (config !== undefined) updates.config = config as unknown as Record<string, unknown>;

      const { data, error } = await supabase
        .from("ai_agent_profiles")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return normalizeProfile(data as AgentProfile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-profiles"] });
      toast.success("Agent profile updated");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update profile");
    },
  });
}

export function useDeleteAgentProfile() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("ai_agent_profiles")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-profiles"] });
      toast.success("Agent profile deleted");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete profile");
    },
  });
}

export function useSetDefaultAgentProfile() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profileId: string) => {
      // Clear existing default
      await supabase
        .from("ai_agent_profiles")
        .update({ is_default: false })
        .eq("organization_id", currentOrganization!.id)
        .eq("is_default", true);

      // Set new default
      const { data, error } = await supabase
        .from("ai_agent_profiles")
        .update({ is_default: true })
        .eq("id", profileId)
        .select()
        .single();

      if (error) throw error;
      return normalizeProfile(data as AgentProfile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-profiles"] });
      toast.success("Default profile updated");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to set default");
    },
  });
}
