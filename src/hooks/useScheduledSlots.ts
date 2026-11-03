import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Fetches existing scheduled/published post times for the given GHL account IDs.
 * Used by smart scheduling to avoid double-booking time slots.
 * Returns an array of ISO date strings representing occupied slots.
 */
export function useScheduledSlots(accountIds: string[]) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['scheduled-slots', currentOrganization?.id, accountIds],
    queryFn: async () => {
      if (!currentOrganization?.id || accountIds.length === 0) return [];

      const now = new Date().toISOString();

      // Query both ghl_published_posts (manual) and publish_queue (autopilot)
      // for future scheduled items on the selected accounts
      const [ghlResult, queueResult] = await Promise.all([
        supabase
          .from('ghl_published_posts')
          .select('scheduled_for, platform_account_id')
          .eq('organization_id', currentOrganization.id)
          .in('platform_account_id', accountIds)
          .in('status', ['scheduled', 'published'])
          .gte('scheduled_for', now)
          .order('scheduled_for', { ascending: true }),
        supabase
          .from('publish_queue')
          .select('scheduled_for, account_id')
          .in('account_id', accountIds)
          .in('status', ['pending', 'publishing'])
          .gte('scheduled_for', now)
          .order('scheduled_for', { ascending: true }),
      ]);

      const slots: Date[] = [];

      ghlResult.data?.forEach(row => {
        if (row.scheduled_for) slots.push(new Date(row.scheduled_for));
      });

      queueResult.data?.forEach(row => {
        if (row.scheduled_for) slots.push(new Date(row.scheduled_for));
      });

      // Sort chronologically
      slots.sort((a, b) => a.getTime() - b.getTime());
      return slots;
    },
    enabled: !!currentOrganization?.id && accountIds.length > 0,
  });
}
