/**
 * Hook to fetch LinkedIn invitations (sent and received) via Unipile
 *
 * Retrieves pending connection requests to track outreach campaigns
 * and see who has requested to connect.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types for LinkedIn Invitation Data (from Unipile API)
// ============================================================================

export interface InvitationSent {
  object: 'InvitationSent';
  id: string;
  invited_user: string | null;
  invited_user_id: string | null;
  invited_user_public_id: string | null;
  invited_user_description: string | null;
  date: string;
  parsed_datetime: string | null;
  invitation_text: string | null;
  inviter?: {
    inviter_name: string;
    inviter_id: string;
    inviter_public_identifier: string;
    inviter_description: string | null;
  };
}

export interface InvitationReceived {
  object: 'InvitationReceived';
  id: string;
  inviter_name: string | null;
  inviter_id: string | null;
  inviter_public_id: string | null;
  inviter_description: string | null;
  inviter_avatar_url: string | null;
  date: string;
  parsed_datetime: string | null;
  invitation_text: string | null;
}

export interface LinkedInInvitationsResponse {
  success: boolean;
  sent: InvitationSent[];
  received: InvitationReceived[];
  sentCursor: string | null;
  receivedCursor: string | null;
  errors?: string[];
}

// ============================================================================
// Hook
// ============================================================================

interface UseLinkedInInvitationsOptions {
  /** Unipile account ID to use for fetching */
  accountId: string | null | undefined;
  /** Type of invitations to fetch */
  type?: 'sent' | 'received' | 'both';
  /** Enable the query */
  enabled?: boolean;
  /** Number of items per type */
  limit?: number;
}

interface UseLinkedInInvitationsResult {
  sent: InvitationSent[] | undefined;
  received: InvitationReceived[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  partialErrors?: string[];
}

export function useLinkedInInvitations({
  accountId,
  type = 'both',
  enabled = true,
  limit = 50,
}: UseLinkedInInvitationsOptions): UseLinkedInInvitationsResult {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['linkedin-invitations', accountId, type, limit],
    queryFn: async (): Promise<LinkedInInvitationsResponse> => {
      if (!accountId) {
        throw new Error('Missing accountId');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('unipile-fetch-invitations', {
        body: {
          accountId,
          type,
          limit,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch invitations');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch invitations');
      }

      return response.data;
    },
    enabled: enabled && !!user && !!accountId,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes (invitations change more frequently)
    gcTime: 15 * 60 * 1000, // Keep in cache for 15 minutes
    retry: (failureCount, error) => {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found') || message.includes('not authorized')) {
        return false;
      }
      return failureCount < 2;
    },
  });

  return {
    sent: query.data?.sent,
    received: query.data?.received,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    partialErrors: query.data?.errors,
  };
}

// ============================================================================
// Hook to check if a specific contact has a pending invitation
// ============================================================================

interface UseContactInvitationStatusOptions {
  /** LinkedIn provider_id or public_identifier of the contact */
  contactLinkedInId: string | null | undefined;
  /** Unipile account ID */
  accountId: string | null | undefined;
  /** Enable the query */
  enabled?: boolean;
}

interface ContactInvitationStatus {
  hasPendingInvite: boolean;
  inviteSentAt: string | null;
  inviteText: string | null;
  hasReceivedInvite: boolean;
  receivedInviteAt: string | null;
  receivedInviteText: string | null;
}

export function useContactInvitationStatus({
  contactLinkedInId,
  accountId,
  enabled = true,
}: UseContactInvitationStatusOptions): {
  status: ContactInvitationStatus | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { sent, received, isLoading, error } = useLinkedInInvitations({
    accountId,
    type: 'both',
    enabled: enabled && !!contactLinkedInId && !!accountId,
    limit: 100, // Fetch more to increase chance of finding the contact
  });

  // Find if this contact has a pending invitation
  const sentInvite = sent?.find(
    (inv) =>
      inv.invited_user_id === contactLinkedInId ||
      inv.invited_user_public_id === contactLinkedInId
  );

  const receivedInvite = received?.find(
    (inv) =>
      inv.inviter_id === contactLinkedInId ||
      inv.inviter_public_id === contactLinkedInId
  );

  const status: ContactInvitationStatus | null =
    sent !== undefined && received !== undefined
      ? {
          hasPendingInvite: !!sentInvite,
          inviteSentAt: sentInvite?.date || null,
          inviteText: sentInvite?.invitation_text || null,
          hasReceivedInvite: !!receivedInvite,
          receivedInviteAt: receivedInvite?.date || null,
          receivedInviteText: receivedInvite?.invitation_text || null,
        }
      : null;

  return {
    status,
    isLoading,
    error,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format invitation date for display
 */
export function formatInvitationDate(dateString: string | null): string {
  if (!dateString) return 'Unknown date';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Get profile URL from invitation
 */
export function getInvitationProfileUrl(
  invitation: InvitationSent | InvitationReceived
): string | null {
  if (invitation.object === 'InvitationSent') {
    const inv = invitation as InvitationSent;
    if (inv.invited_user_public_id) {
      return `https://www.linkedin.com/in/${inv.invited_user_public_id}`;
    }
  } else {
    const inv = invitation as InvitationReceived;
    if (inv.inviter_public_id) {
      return `https://www.linkedin.com/in/${inv.inviter_public_id}`;
    }
  }
  return null;
}

// ============================================================================
// Send Connection Request
// ============================================================================

export interface SendConnectionRequestInput {
  /** The internal account ID (from unipile_accounts table) */
  accountId: string;
  /** The LinkedIn provider_id of the recipient */
  recipientId: string;
  /** Optional personal message (max 300 characters) */
  message?: string;
  /** Optional contact ID to log activity */
  contactId?: string;
}

export interface SendConnectionRequestResult {
  success: boolean;
  invitationId?: string;
  error?: string;
}

/**
 * Hook to send a LinkedIn connection request
 */
export function useSendConnectionRequest() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SendConnectionRequestInput): Promise<SendConnectionRequestResult> => {
      if (!user) throw new Error('Not authenticated');

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('No valid session');
      }

      const response = await supabase.functions.invoke('unipile-send-invitation', {
        body: {
          accountId: input.accountId,
          recipientId: input.recipientId,
          message: input.message,
          contactId: input.contactId,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to send connection request');
      }

      if (!response.data?.success) {
        return {
          success: false,
          error: response.data?.error || 'Failed to send connection request',
        };
      }

      return {
        success: true,
        invitationId: response.data.invitationId,
      };
    },
    onSuccess: (result, input) => {
      if (result.success) {
        // Invalidate invitations cache to show the new sent invitation
        queryClient.invalidateQueries({ queryKey: ['linkedin-invitations'] });
        // Invalidate contact data if we have a contactId
        if (input.contactId) {
          queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
          queryClient.invalidateQueries({ queryKey: ['crm-activities', input.contactId] });
        }
        toast.success('Connection request sent!');
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to send connection request');
    },
  });
}
