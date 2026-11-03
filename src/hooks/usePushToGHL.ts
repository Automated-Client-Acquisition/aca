import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface PushToGHLParams {
  contentOutputIds: string | string[];
  platforms: string[];
  scheduleDate?: string;
  scheduleDates?: string[]; // Per-output dates (takes precedence over scheduleDate+stagger)
  staggerMinutes?: number;
  baseContent?: any;
  customizePerChannel?: boolean;
  platformOverrides?: Record<string, any>;
  jobId?: string; // For scoped cache invalidation
}

export function usePushToGHL() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (params: PushToGHLParams) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase.functions.invoke('push-to-ghl', {
        body: {
          ...params,
          organizationId: currentOrganization.id,
        },
      });

      if (error) throw error;
      // Attach scheduleDate to response so onSuccess can differentiate
      return { ...data, _scheduled: !!(params.scheduleDate || params.scheduleDates?.length) };
    },
    onSuccess: (data) => {
      const isBatch = Array.isArray(data.results) && data.results.length > 1;
      const verb = data._scheduled ? 'Scheduled' : 'Published';
      const verbLower = data._scheduled ? 'scheduled' : 'published';

      // Check if any items actually succeeded
      if (data.successful > 0) {
        if (isBatch) {
          toast.success(`${verb} ${data.successful} of ${data.totalProcessed} posts to LeadConnector`);
        } else {
          toast.success(`Content ${verbLower} to LeadConnector successfully`);
        }
      }

      // Show errors if any failed
      if (data.failed > 0) {
        if (isBatch) {
          toast.error(`${data.failed} of ${data.totalProcessed} posts failed to publish`);
        } else {
          // Show specific error for single post
          const failedResult = data.results.find((r: any) => !r.success);
          if (failedResult?.error) {
            toast.error(`Failed to publish: ${failedResult.error}`);
          } else {
            toast.error('Failed to publish to LeadConnector');
          }
        }
      }

      // Invalidate content outputs and published counts so badges update immediately
      queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      queryClient.invalidateQueries({ queryKey: ['published-counts'] });
      queryClient.invalidateQueries({ queryKey: ['job-published-counts'] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-slots'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to push to LeadConnector');
    },
  });
}
