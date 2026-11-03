import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface CreateScheduleParams {
  type: 'creator' | 'search_term';
  targetId: string;
  targetName: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'custom';
  cronExpression?: string;
  maxItems?: number;
  autoPause?: boolean;
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ type, targetId, frequency, cronExpression, maxItems = 100, autoPause = true }: CreateScheduleParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (!currentOrganization?.id) throw new Error('No organization selected');
      const organizationId = currentOrganization.id;

      // Calculate next run time
      const nextRun = calculateNextRun(frequency, cronExpression);

      if (type === 'creator') {
        // Get creator platform
        const { data: creator, error: creatorError } = await supabase
          .from('research_creators')
          .select('platform')
          .eq('id', targetId)
          .eq('organization_id', organizationId)
          .single();

        if (creatorError) throw creatorError;
        if (!creator) throw new Error('Creator not found');

        const { data, error } = await supabase.from('scrape_schedules').insert({
          creator_id: targetId,
          organization_id: organizationId,
          platform: creator.platform,
          frequency_type: frequency,
          cron_expression: cronExpression || null,
          scrape_config: { maxItems },
          is_active: true,
          next_run_at: nextRun,
          auto_pause_on_failure: autoPause,
          consecutive_failures: 0
        }).select().single();

        if (error) throw error;
        return data;
      } else {
        const { data: searchTerm, error: searchTermError } = await supabase
          .from('research_search_terms')
          .select('id')
          .eq('id', targetId)
          .eq('organization_id', organizationId)
          .single();

        if (searchTermError) throw searchTermError;
        if (!searchTerm) throw new Error('Search term not found');

        const { data, error } = await supabase.from('search_schedules').insert({
          search_term_id: targetId,
          organization_id: organizationId,
          frequency_type: frequency,
          cron_expression: cronExpression || null,
          scrape_config: { maxItems },
          is_active: true,
          next_run_at: nextRun,
          auto_pause_on_failure: autoPause,
          consecutive_failures: 0
        }).select().single();

        if (error) throw error;
        return data;
      }
    },
    onSuccess: (data, variables) => {
      for (const queryKey of [
        ['schedules'],
        ['schedule-status', variables.type, variables.targetId],
        ['scrape-schedules'],
        ['creator-schedules'],
        ['search-term-schedules'],
        ['upcoming-schedules'],
      ]) {
        queryClient.invalidateQueries({ queryKey });
      }
      
      toast.success(`Schedule created for ${variables.targetName}`, {
        description: `Will run ${variables.frequency}`
      });
    },
    onError: (error: Error, variables) => {
      // Check for unique constraint violation (schedule already exists)
      if (error.message?.includes('unique_creator_schedule') || error.message?.includes('duplicate key')) {
        toast.error('Schedule already exists', {
          description: `${variables.targetName} already has a ${variables.frequency} schedule. Edit the existing schedule instead.`
        });
      } else {
        toast.error('Failed to create schedule', {
          description: error.message
        });
      }
    },
  });
}

function calculateNextRun(frequency: string, cronExpression?: string): string {
  const now = new Date();
  
  switch (frequency) {
    case 'hourly':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'custom':
      // For custom cron, default to daily (proper cron parsing would require a library)
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
}
