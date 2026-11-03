import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export interface ResponseTimeStats {
  channel: string;
  avg_ms: number;
  median_ms: number;
  total_convs: number;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch aggregate response time statistics per channel via the
 * get_response_time_stats RPC. Defaults to the last 30 days.
 */
export function useResponseTimeStats(days?: number) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['response-time-stats', currentOrganization?.id, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_response_time_stats', {
        p_org_id: currentOrganization!.id,
        p_days: days || 30,
      });

      if (error) throw error;
      return (data || []) as ResponseTimeStats[];
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Reset all response time stats for the current organization.
 * Clears avg_response_time_ms and resets sla_status to 'ok'.
 */
export function useResetResponseTimeStats() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('reset_response_time_stats', {
        p_org_id: currentOrganization!.id,
      });

      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['response-time-stats'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      toast.success(`Reset response times for ${count} conversations`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reset response times');
    },
  });
}
