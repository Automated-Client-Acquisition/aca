import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CommentAiDraftInput {
  commentText: string;
  commenterName: string;
  commenterHeadline?: string;
  postUrl?: string;
  matchedKeyword?: string;
  direction?: string;
}

export interface CommentAiDraftResult {
  draft: string;
  toneUsed: string;
}

/**
 * Generate an AI reply draft for a social media comment.
 * Calls the comment-ai-draft edge function which uses commenter context
 * and the user's tone profile to produce a draft reply.
 */
export function useCommentAiDraft() {
  const { session } = useAuth();

  return useMutation({
    mutationFn: async (input: CommentAiDraftInput): Promise<CommentAiDraftResult> => {
      if (!session?.access_token) {
        throw new Error("No valid session");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment-ai-draft`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(input),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate AI draft");
      }

      return response.json() as Promise<CommentAiDraftResult>;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to generate AI draft");
    },
  });
}
