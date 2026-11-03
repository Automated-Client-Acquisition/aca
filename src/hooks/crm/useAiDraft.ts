import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export interface AiDraftInput {
  conversationId: string;
  contactId: string;
  channel: string;
  direction?: string;
}

export interface AiDraftResult {
  draft: string;
  toneUsed: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Generate an AI reply draft for a conversation.
 * Calls the inbox-ai-draft edge function which uses conversation context,
 * contact data, and the user's tone profile to produce a draft.
 */
export function useAiDraft() {
  const { session } = useAuth();

  return useMutation({
    mutationFn: async (input: AiDraftInput): Promise<AiDraftResult> => {
      if (!session?.access_token) {
        throw new Error('No valid session');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-ai-draft`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(input),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate AI draft');
      }

      return response.json() as Promise<AiDraftResult>;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to generate AI draft');
    },
  });
}
