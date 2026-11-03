import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { EnrichmentData } from "@/lib/message-variables";

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (!error || typeof error !== "object") return "Failed to generate message";

  const maybeMsg = (error as any).message;
  let message = typeof maybeMsg === "string" && maybeMsg.length > 0 ? maybeMsg : "Failed to generate message";

  // supabase-js FunctionInvokeError includes the Response in `context`
  const ctx = (error as any).context;
  if (ctx && typeof ctx === "object") {
    try {
      if (typeof (ctx as any).clone === "function") {
        const cloned = (ctx as Response).clone();
        try {
          const body = await cloned.json().catch(() => null);
          if (body && typeof body === "object") {
            const bodyError = (body as any).error;
            if (typeof bodyError === "string" && bodyError.length > 0) {
              message = bodyError;
            }
          }
        } catch {
          // fall through to text parse
        }
      }

      if (typeof (ctx as any).text === "function") {
        const text = await (ctx as Response).text().catch(() => "");
        if (text) {
          try {
            const parsed = JSON.parse(text);
            const bodyError = parsed?.error;
            if (typeof bodyError === "string" && bodyError.length > 0) {
              message = bodyError;
            }
          } catch {
            // ignore non-json
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return message;
}

/**
 * Message types supported by the generator
 */
export type MessageType = "connectionRequest" | "message" | "inmail" | "email" | "emailSequence";

/**
 * Tone preferences for message generation
 */
export type TonePreference = "formal" | "casual" | "friendly" | "professional";

/**
 * Parameters for generating a campaign message
 */
export interface GenerateMessageParams {
  messageType: MessageType;
  context?: {
    userOffering?: string;
    campaignGoal?: string;
    tonePreference?: TonePreference;
  };
  sampleEnrichment?: EnrichmentData;
  existingMessage?: string;
  userPrompt?: string;
  generateVariations?: boolean;
  model?: string;
  temperature?: number;
}

/**
 * Result from message generation
 */
export interface GenerateMessageResult {
  success: boolean;
  message: string;
  variations?: string[];
  usedVariables: string[];
  characterCount: number;
  error?: string;
}

/**
 * Character limits by message type
 */
export const MESSAGE_CHARACTER_LIMITS: Record<MessageType, number> = {
  connectionRequest: 300,
  message: 8000,
  inmail: 1900,
  email: 5000,
  emailSequence: 5000,
};

/**
 * Hook to generate AI-powered campaign messages with {{variables}}
 *
 * @example
 * ```tsx
 * const { mutate: generateMessage, isPending, data } = useGenerateCampaignMessage();
 *
 * const handleGenerate = () => {
 *   generateMessage({
 *     messageType: 'connectionRequest',
 *     context: {
 *       userOffering: 'We help B2B companies get more qualified leads',
 *       tonePreference: 'professional',
 *     },
 *   });
 * };
 * ```
 */
export function useGenerateCampaignMessage() {
  return useMutation({
    mutationFn: async (params: GenerateMessageParams): Promise<GenerateMessageResult> => {
      const { data, error } = await supabase.functions.invoke("generate-campaign-message", {
        body: params,
      });

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }

      if (!data.success) {
        throw new Error(data.error || "Message generation failed");
      }

      return data as GenerateMessageResult;
    },
    onError: (error) => {
      console.error("Message generation error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to generate message"
      );
    },
  });
}

/**
 * Hook to generate message with variations (A/B testing)
 *
 * Convenience wrapper that always requests variations.
 */
export function useGenerateCampaignMessageWithVariations() {
  return useMutation({
    mutationFn: async (
      params: Omit<GenerateMessageParams, "generateVariations">
    ): Promise<GenerateMessageResult> => {
      const { data, error } = await supabase.functions.invoke("generate-campaign-message", {
        body: { ...params, generateVariations: true },
      });

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }

      if (!data.success) {
        throw new Error(data.error || "Message generation failed");
      }

      return data as GenerateMessageResult;
    },
    onError: (error) => {
      console.error("Message generation error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to generate message"
      );
    },
  });
}
