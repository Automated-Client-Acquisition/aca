import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Activity timeline item interface
export interface ActivityTimelineItem {
  id: string;
  campaign_id: string;
  progress_id: string;
  contact_id: string;
  node_id: string;
  node_type: string;
  action_type: string;
  channel: string | null;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  message_content: string | null;
  error_message: string | null;
  external_id: string | null;
  executed_at: string | null;
  created_at: string;
  // Joined data
  campaign?: {
    name: string;
  } | null;
}

/**
 * Hook to fetch activity timeline for a specific lead/contact
 * Returns all campaign actions taken for this contact in chronological order
 */
export function useLeadActivityTimeline(contactId: string | undefined, limit = 50) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["lead-activity-timeline", contactId, limit],
    queryFn: async () => {
      if (!contactId) throw new Error("Contact ID is required");

      const { data, error } = await supabase
        .from("campaign_action_log")
        .select(`
          id,
          campaign_id,
          progress_id,
          contact_id,
          node_id,
          node_type,
          action_type,
          channel,
          status,
          message_content,
          error_message,
          external_id,
          executed_at,
          created_at,
          campaign:linkedin_campaigns(name)
        `)
        .eq("contact_id", contactId)
        .order("executed_at", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) throw error;

      return (data || []) as ActivityTimelineItem[];
    },
    enabled: !!user && !!contactId,
  });
}

/**
 * Get human-readable label for action type
 */
export function getActionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    connection_request: 'Connection Request Sent',
    connectionRequest: 'Connection Request Sent',
    message: 'Message Sent',
    inmail: 'InMail Sent',
    email: 'Email Sent',
    whatsapp: 'WhatsApp Message',
    whatsappMessage: 'WhatsApp Message',
    instagram_dm: 'Instagram DM',
    instagramDm: 'Instagram DM',
    telegram: 'Telegram Message',
    telegramMessage: 'Telegram Message',
    sms: 'SMS Sent',
    smsMessage: 'SMS Sent',
    view_profile: 'Profile Viewed',
    viewProfile: 'Profile Viewed',
    follow: 'Followed',
    like_post: 'Post Liked',
    likePost: 'Post Liked',
    reply_detected: 'Reply Received',
    system_reply_detected: 'Reply Detected',
  };

  return labels[actionType] || actionType.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Get color class for action type
 */
export function getActionColor(actionType: string): string {
  const colors: Record<string, string> = {
    connection_request: 'bg-blue-100 text-blue-600',
    connectionRequest: 'bg-blue-100 text-blue-600',
    message: 'bg-green-100 text-green-600',
    inmail: 'bg-primary/10 text-primary',
    email: 'bg-cta/10 text-cta',
    whatsapp: 'bg-emerald-100 text-emerald-600',
    whatsappMessage: 'bg-emerald-100 text-emerald-600',
    instagram_dm: 'bg-pink-100 text-pink-600',
    instagramDm: 'bg-pink-100 text-pink-600',
    telegram: 'bg-sky-100 text-sky-600',
    telegramMessage: 'bg-sky-100 text-sky-600',
    sms: 'bg-primary/10 text-primary',
    smsMessage: 'bg-primary/10 text-primary',
    view_profile: 'bg-gray-100 text-gray-600',
    viewProfile: 'bg-gray-100 text-gray-600',
    follow: 'bg-blue-100 text-blue-600',
    like_post: 'bg-pink-100 text-pink-600',
    likePost: 'bg-pink-100 text-pink-600',
    reply_detected: 'bg-emerald-100 text-emerald-600',
    system_reply_detected: 'bg-emerald-100 text-emerald-600',
  };

  return colors[actionType] || 'bg-gray-100 text-gray-600';
}
