import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export interface ConversationPreference {
  id: string;
  conversation_id: string;
  user_id: string;
  is_favorite: boolean;
  labels: string[];
  is_muted: boolean;
  custom_notifications: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all conversation preferences for the current user
 */
export function useConversationPreferences() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['conversation-preferences', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('conversation_preferences')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      return data as ConversationPreference[];
    },
    enabled: !!user,
    staleTime: 30000,
  });
}

/**
 * Fetch favorite conversation IDs for the current user
 */
export function useFavoriteConversationIds() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['favorite-conversation-ids', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('conversation_preferences')
        .select('conversation_id')
        .eq('user_id', user.id)
        .eq('is_favorite', true);

      if (error) throw error;
      return new Set(data.map(p => p.conversation_id));
    },
    enabled: !!user,
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Get preference for a specific conversation
 */
export function useConversationPreference(conversationId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['conversation-preference', conversationId, user?.id],
    queryFn: async () => {
      if (!user || !conversationId) throw new Error('Not authenticated or no conversation');

      const { data, error } = await supabase
        .from('conversation_preferences')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return data as ConversationPreference | null;
    },
    enabled: !!user && !!conversationId,
    staleTime: 30000,
  });
}

/**
 * Toggle favorite status for a conversation
 */
export function useToggleFavorite() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      isFavorite,
    }: {
      conversationId: string;
      isFavorite?: boolean;
    }) => {
      if (!user) throw new Error('Not authenticated');

      // Call the database function
      const { data, error } = await supabase.rpc('toggle_conversation_favorite', {
        p_conversation_id: conversationId,
        p_is_favorite: isFavorite ?? null,
      });

      if (error) throw error;
      return { conversationId, isFavorite: data as boolean };
    },
    onMutate: async ({ conversationId, isFavorite }) => {
      // Optimistic update — cancel with full query key including user ID
      await queryClient.cancelQueries({ queryKey: ['favorite-conversation-ids', user?.id] });

      const previousFavorites = queryClient.getQueryData<Set<string>>(['favorite-conversation-ids', user?.id]);

      if (previousFavorites) {
        const newFavorites = new Set(previousFavorites);
        if (isFavorite === false) {
          newFavorites.delete(conversationId);
        } else if (isFavorite === true) {
          newFavorites.add(conversationId);
        } else {
          // Toggle
          if (newFavorites.has(conversationId)) {
            newFavorites.delete(conversationId);
          } else {
            newFavorites.add(conversationId);
          }
        }
        queryClient.setQueryData(['favorite-conversation-ids', user?.id], newFavorites);
      }

      return { previousFavorites };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousFavorites) {
        queryClient.setQueryData(['favorite-conversation-ids', user?.id], context.previousFavorites);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to update favorite');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorite-conversation-ids', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['conversation-preferences', user?.id] });
    },
  });
}

/**
 * Update labels for a conversation
 */
export function useUpdateConversationLabels() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      labels,
    }: {
      conversationId: string;
      labels: string[];
    }) => {
      if (!user) throw new Error('Not authenticated');

      // Upsert the preference
      const { data, error } = await supabase
        .from('conversation_preferences')
        .upsert(
          {
            conversation_id: conversationId,
            user_id: user.id,
            labels,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'conversation_id,user_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return data as ConversationPreference;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversation-preferences'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-preference', data.conversation_id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update labels');
    },
  });
}

/**
 * Toggle mute status for a conversation
 */
export function useToggleMute() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      isMuted,
    }: {
      conversationId: string;
      isMuted?: boolean;
    }) => {
      if (!user) throw new Error('Not authenticated');

      // Get current state
      const { data: current } = await supabase
        .from('conversation_preferences')
        .select('is_muted')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      const newMuted = isMuted ?? !current?.is_muted;

      // Upsert the preference
      const { data, error } = await supabase
        .from('conversation_preferences')
        .upsert(
          {
            conversation_id: conversationId,
            user_id: user.id,
            is_muted: newMuted,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'conversation_id,user_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return data as ConversationPreference;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversation-preferences'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-preference', data.conversation_id] });
      toast.success(data.is_muted ? 'Conversation muted' : 'Conversation unmuted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to toggle mute');
    },
  });
}
