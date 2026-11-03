import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Schedule {
  id: string;
  creator_id?: string;
  search_term_id?: string;
  organization_id: string;
  frequency_type: string;
  cron_expression: string | null;
  scrape_config: any;
  is_active: boolean;
  next_run_at: string;
  last_run_at: string | null;
  consecutive_failures: number;
  auto_pause_on_failure: boolean;
  created_at: string;
  updated_at: string;
}

export function useSchedules(type: 'creator' | 'search_term', targetId: string) {
  const queryClient = useQueryClient();

  const tableName = type === 'creator' ? 'scrape_schedules' : 'search_schedules';
  const idField = type === 'creator' ? 'creator_id' : 'search_term_id';

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['schedules', type, targetId],
    queryFn: async () => {
      if (type === 'creator') {
        const { data, error } = await supabase
          .from('scrape_schedules')
          .select('*')
          .eq('creator_id', targetId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        return data as Schedule[];
      } else {
        const { data, error } = await supabase
          .from('search_schedules')
          .select('*')
          .eq('search_term_id', targetId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        return data as Schedule[];
      }
    },
  });

  const deleteSchedule = useMutation({
    mutationFn: async (scheduleId: string) => {
      if (type === 'creator') {
        const { error } = await supabase
          .from('scrape_schedules')
          .delete()
          .eq('id', scheduleId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('search_schedules')
          .delete()
          .eq('id', scheduleId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', type, targetId] });
      toast.success('Schedule deleted');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete schedule', {
        description: error.message
      });
    },
  });

  const toggleSchedule = useMutation({
    mutationFn: async ({ scheduleId, isActive }: { scheduleId: string; isActive: boolean }) => {
      if (type === 'creator') {
        const { error } = await supabase
          .from('scrape_schedules')
          .update({ is_active: !isActive })
          .eq('id', scheduleId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('search_schedules')
          .update({ is_active: !isActive })
          .eq('id', scheduleId);
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedules', type, targetId] });
      toast.success(variables.isActive ? 'Schedule paused' : 'Schedule resumed');
    },
    onError: (error: Error) => {
      toast.error('Failed to update schedule', {
        description: error.message
      });
    },
  });

  return {
    schedules: schedules || [],
    isLoading,
    deleteSchedule: (id: string) => deleteSchedule.mutate(id),
    toggleSchedule: (id: string, isActive: boolean) => toggleSchedule.mutate({ scheduleId: id, isActive }),
    isDeleting: deleteSchedule.isPending,
    isToggling: toggleSchedule.isPending,
  };
}
