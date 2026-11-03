/**
 * Hook to fetch LinkedIn activity for a user via Unipile
 *
 * Fetches activity data including:
 * - Comments they made on other posts
 * - Reactions they gave to posts/comments
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ============================================================================
// Types for LinkedIn Activity Data (from Unipile API)
// ============================================================================

export interface LinkedInCommentAuthorDetails {
  id: string | null;
  headline: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  network_distance: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK' | null;
}

export interface LinkedInComment {
  object: 'Comment';
  id: string;
  post_id: string;
  post_urn: string;
  thread_id?: string;
  author: string | null;
  author_details: LinkedInCommentAuthorDetails;
  date: string;
  text: string;
  reaction_counter: number;
  reply_counter: number;
  impressions_counter?: number;
  user_reacted?: 'LIKE' | 'PRAISE' | 'APPRECIATION' | 'EMPATHY' | 'INTEREST' | 'ENTERTAINMENT';
}

export interface LinkedInReactionAuthor {
  id: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  name: string | null;
  headline: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  network_distance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK';
}

export interface LinkedInReaction {
  object: 'PostReaction';
  value: 'LIKE' | 'PRAISE' | 'APPRECIATION' | 'EMPATHY' | 'INTEREST' | 'ENTERTAINMENT';
  post_id: string;
  comment_id?: string;
  author: LinkedInReactionAuthor;
}

export interface LinkedInActivityResponse {
  success: boolean;
  comments: LinkedInComment[];
  reactions: LinkedInReaction[];
  errors?: string[];
}

// ============================================================================
// Hook
// ============================================================================

interface UseLinkedInActivityOptions {
  /** LinkedIn provider_id or public_identifier */
  identifier: string | null | undefined;
  /** Unipile account ID to use for fetching */
  accountId: string | null | undefined;
  /** Enable the query */
  enabled?: boolean;
  /** Number of items per type */
  limit?: number;
  /** Types of activity to fetch */
  types?: ('comments' | 'reactions')[];
}

interface UseLinkedInActivityResult {
  comments: LinkedInComment[] | undefined;
  reactions: LinkedInReaction[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  partialErrors?: string[];
}

export function useLinkedInActivity({
  identifier,
  accountId,
  enabled = true,
  limit = 20,
  types = ['comments', 'reactions'],
}: UseLinkedInActivityOptions): UseLinkedInActivityResult {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['linkedin-activity', identifier, accountId, limit, types],
    queryFn: async (): Promise<LinkedInActivityResponse> => {
      if (!identifier || !accountId) {
        throw new Error('Missing identifier or accountId');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('unipile-fetch-user-activity', {
        body: {
          identifier,
          accountId,
          limit,
          types,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch activity');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch activity');
      }

      return response.data;
    },
    enabled: enabled && !!user && !!identifier && !!accountId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: (failureCount, error) => {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found') || message.includes('not authorized')) {
        return false;
      }
      return failureCount < 2;
    },
  });

  return {
    comments: query.data?.comments,
    reactions: query.data?.reactions,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    partialErrors: query.data?.errors,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getReactionEmoji(reaction: LinkedInReaction['value']): string {
  const reactions: Record<LinkedInReaction['value'], string> = {
    LIKE: '👍',
    PRAISE: '👏',
    APPRECIATION: '❤️',
    EMPATHY: '💜',
    INTEREST: '💡',
    ENTERTAINMENT: '😄',
  };
  return reactions[reaction] || '👍';
}

export function getReactionLabel(reaction: LinkedInReaction['value']): string {
  const labels: Record<LinkedInReaction['value'], string> = {
    LIKE: 'Like',
    PRAISE: 'Celebrate',
    APPRECIATION: 'Love',
    EMPATHY: 'Support',
    INTEREST: 'Insightful',
    ENTERTAINMENT: 'Funny',
  };
  return labels[reaction] || 'Like';
}
