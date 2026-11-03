/**
 * Hook to engage with LinkedIn posts via Unipile
 *
 * Supports adding reactions (like, celebrate, etc.) and comments
 * to warm up prospects before outreach campaigns.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type ReactionType = 'like' | 'celebrate' | 'support' | 'love' | 'insightful' | 'funny';

export interface EngagePostParams {
  /** The Unipile account ID to use */
  accountId: string;
  /** The post ID to engage with */
  postId: string;
  /** Type of engagement: 'reaction' or 'comment' */
  action: 'reaction' | 'comment';
  /** For reactions: the type of reaction */
  reactionType?: ReactionType;
  /** For comments: the comment text */
  commentText?: string;
  /** Optional: comment ID if reacting to a comment instead of the post */
  commentId?: string;
  /** Optional: contact ID to log activity */
  contactId?: string;
}

export interface EngagePostResponse {
  success: boolean;
  action: 'reaction' | 'comment';
  postId: string;
  reactionType?: ReactionType;
  data?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useEngagePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: EngagePostParams): Promise<EngagePostResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('unipile-engage-post', {
        body: params,
      });

      if (response.error) {
        let msg = 'Failed to engage with post';
        try {
          const ctx = (response.error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* ignore parse errors */ }
        throw new Error(msg);
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to engage with post');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      // Show success toast
      if (data.action === 'reaction') {
        toast.success(`Added ${getReactionLabel(data.reactionType!)} reaction to post`);
      } else {
        toast.success('Comment added successfully');
      }

      // Invalidate relevant queries
      if (variables.contactId) {
        queryClient.invalidateQueries({ queryKey: ['contact-activities', variables.contactId] });
      }
      // Optionally invalidate posts to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to engage with post');
    },
  });
}

// ============================================================================
// Quick Action Hooks
// ============================================================================

/**
 * Hook for quick like action
 */
export function useLikePost() {
  const engage = useEngagePost();

  return {
    ...engage,
    likePost: (accountId: string, postId: string, contactId?: string) =>
      engage.mutate({
        accountId,
        postId,
        action: 'reaction',
        reactionType: 'like',
        contactId,
      }),
    likePostAsync: (accountId: string, postId: string, contactId?: string) =>
      engage.mutateAsync({
        accountId,
        postId,
        action: 'reaction',
        reactionType: 'like',
        contactId,
      }),
  };
}

/**
 * Hook for quick comment action
 */
export function useCommentOnPost() {
  const engage = useEngagePost();

  return {
    ...engage,
    commentOnPost: (
      accountId: string,
      postId: string,
      commentText: string,
      contactId?: string
    ) =>
      engage.mutate({
        accountId,
        postId,
        action: 'comment',
        commentText,
        contactId,
      }),
    commentOnPostAsync: (
      accountId: string,
      postId: string,
      commentText: string,
      contactId?: string
    ) =>
      engage.mutateAsync({
        accountId,
        postId,
        action: 'comment',
        commentText,
        contactId,
      }),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get emoji for reaction type
 */
export function getReactionEmoji(type: ReactionType): string {
  const emojis: Record<ReactionType, string> = {
    like: '👍',
    celebrate: '👏',
    support: '💜',
    love: '❤️',
    insightful: '💡',
    funny: '😄',
  };
  return emojis[type] || '👍';
}

/**
 * Get label for reaction type
 */
export function getReactionLabel(type: ReactionType): string {
  const labels: Record<ReactionType, string> = {
    like: 'Like',
    celebrate: 'Celebrate',
    support: 'Support',
    love: 'Love',
    insightful: 'Insightful',
    funny: 'Funny',
  };
  return labels[type] || 'Like';
}

/**
 * All available reaction types for UI selection
 */
export const REACTION_TYPES: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'like', emoji: '👍', label: 'Like' },
  { type: 'celebrate', emoji: '👏', label: 'Celebrate' },
  { type: 'support', emoji: '💜', label: 'Support' },
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'insightful', emoji: '💡', label: 'Insightful' },
  { type: 'funny', emoji: '😄', label: 'Funny' },
];
