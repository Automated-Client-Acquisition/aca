/**
 * Hook to fetch LinkedIn posts for a user via Unipile
 *
 * Fetches recent posts from a LinkedIn user including content,
 * engagement metrics, attachments, and pagination support.
 */

import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ============================================================================
// Types for LinkedIn Post Data (from Unipile API)
// ============================================================================

export interface LinkedInPostAuthor {
  public_identifier: string | null;
  id: string | null;
  name: string | null;
  is_company: boolean;
  headline?: string;
  profile_picture_url?: string;
}

export interface LinkedInPostAttachment {
  id: string;
  type: 'img' | 'video' | 'audio' | 'file' | 'linkedin_post' | 'video_meeting';
  url?: string;
  url_expires_at?: number;
  unavailable: boolean;
  mimetype?: string;
  file_size?: number;
  // Image specific
  size?: { width: number; height: number };
  sticker?: boolean;
  // Video specific
  gif?: boolean;
  // Audio specific
  duration?: number;
  voice_note?: boolean;
  // File specific
  file_name?: string;
}

export interface LinkedInPostMention {
  url: string;
  start: number;
  length: number;
}

export interface LinkedInPostPollOption {
  id: string;
  text: string;
  win: boolean;
  votes_count: number;
}

export interface LinkedInPostPoll {
  id: string;
  total_votes_count: number;
  question: string;
  is_open: boolean;
  options: LinkedInPostPollOption[];
}

export interface LinkedInPostPermissions {
  can_react: boolean;
  can_share: boolean;
  can_post_comments: boolean;
}

export interface LinkedInPostAnalytics {
  impressions?: number;
  engagements?: number;
  engagement_rate?: number;
  clicks?: number;
  clickthrough_rate?: number;
  page_viewers_from_this_post?: number;
  followers_gained_from_this_post?: number;
  members_reached?: number;
}

export interface LinkedInPost {
  object: 'Post';
  provider: 'LINKEDIN';
  id: string;
  social_id: string;
  share_url: string;
  title?: string;
  text: string;
  date: string;
  parsed_datetime: string;

  // Engagement metrics
  reaction_counter: number;
  comment_counter: number;
  repost_counter: number;
  impressions_counter: number;

  // User interaction
  user_reacted?: 'LIKE' | 'PRAISE' | 'APPRECIATION' | 'EMPATHY' | 'INTEREST' | 'ENTERTAINMENT';

  // Author info
  author: LinkedInPostAuthor;
  written_by?: {
    id: string;
    public_identifier: string;
    name: string;
  };

  // Permissions
  permissions: LinkedInPostPermissions;

  // Repost info
  is_repost: boolean;
  repost_id?: string;
  reposted_by?: LinkedInPostAuthor;
  repost_content?: {
    id: string;
    date: string;
    parsed_datetime: string;
    author: LinkedInPostAuthor;
    text: string;
  };

  // Content
  mentions: LinkedInPostMention[];
  attachments: LinkedInPostAttachment[];
  poll?: LinkedInPostPoll;

  // Group info
  group?: {
    id: string;
    name: string;
    private: boolean;
  };

  // Analytics (only for own posts)
  analytics?: LinkedInPostAnalytics;
}

export interface LinkedInPostsResponse {
  success: boolean;
  posts: LinkedInPost[];
  cursor: string | null;
  paging?: {
    page_count: number;
  };
  error?: string;
}

// ============================================================================
// Hook
// ============================================================================

interface UseLinkedInPostsOptions {
  /** LinkedIn provider_id or public_identifier */
  identifier: string | null | undefined;
  /** Unipile account ID to use for fetching */
  accountId: string | null | undefined;
  /** Enable the query */
  enabled?: boolean;
  /** Number of posts per page */
  limit?: number;
  /** Whether the identifier is a company */
  isCompany?: boolean;
}

interface UseLinkedInPostsResult {
  data: LinkedInPost[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}

export function useLinkedInPosts({
  identifier,
  accountId,
  enabled = true,
  limit = 20,
  isCompany = false,
}: UseLinkedInPostsOptions): UseLinkedInPostsResult {
  const { user } = useAuth();

  const query = useInfiniteQuery({
    queryKey: ['linkedin-posts', identifier, accountId, limit, isCompany],
    queryFn: async ({ pageParam }): Promise<LinkedInPostsResponse> => {
      if (!identifier || !accountId) {
        throw new Error('Missing identifier or accountId');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('unipile-fetch-user-posts', {
        body: {
          identifier,
          accountId,
          limit,
          cursor: pageParam,
          isCompany,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch posts');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch posts');
      }

      return response.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor || undefined,
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

  // Flatten all pages into a single array, deduplicating by post ID
  // (LinkedIn pagination can return overlapping items across pages)
  const allPosts = (() => {
    const pages = query.data?.pages;
    if (!pages) return [];
    const seen = new Set<string>();
    const result: LinkedInPost[] = [];
    for (const page of pages) {
      for (const post of page.posts) {
        if (!seen.has(post.id)) {
          seen.add(post.id);
          result.push(post);
        }
      }
    }
    return result;
  })();

  return {
    data: allPosts.length > 0 ? allPosts : undefined,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

/**
 * Simple hook for fetching a single page of posts (no pagination)
 */
export function useLinkedInPostsSimple({
  identifier,
  accountId,
  enabled = true,
  limit = 10,
  isCompany = false,
}: UseLinkedInPostsOptions) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['linkedin-posts-simple', identifier, accountId, limit, isCompany],
    queryFn: async (): Promise<LinkedInPost[]> => {
      if (!identifier || !accountId) {
        throw new Error('Missing identifier or accountId');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('unipile-fetch-user-posts', {
        body: {
          identifier,
          accountId,
          limit,
          isCompany,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch posts');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch posts');
      }

      return response.data.posts;
    },
    enabled: enabled && !!user && !!identifier && !!accountId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found') || message.includes('not authorized')) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
