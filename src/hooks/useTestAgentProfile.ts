import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface TestMessage {
  role: "lead" | "agent";
  content: string;
  /** The message the campaign sent first (our side, not an agent reply) */
  kind?: "campaign";
}

interface TestAgentInput {
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

export interface TestAgentResult {
  classification: {
    intent: string;
    confidence: number;
    reasoning: string;
  };
  matchedRule: { intent: string; action: string } | null;
  escalation: { escalate: boolean; reason: string } | null;
  reply: string | null;
  action: string;
  phase: string;
  /** What production would do with the reply */
  delivery: "auto_send" | "draft" | "escalated" | "stopped" | "snoozed" | "no_action";
  explanation: string;
  agent: {
    enabled: boolean;
    require_approval: boolean;
    max_auto_replies: number;
    replies_so_far: number;
    goal: string | null;
    tone_profile_not_simulated: boolean;
  };
}

export function useTestAgentProfile() {
  return useMutation({
    mutationFn: async (input: TestAgentInput): Promise<TestAgentResult> => {
      const { data, error } = await supabase.functions.invoke("test-agent-profile", {
        body: input,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as TestAgentResult;
    },
    // The chat shows the error inline with a retry, so no toast here
  });
}
