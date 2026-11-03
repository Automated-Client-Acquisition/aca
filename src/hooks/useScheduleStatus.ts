import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Schedule {
  id: string;
  is_active: boolean;
  frequency_type: string;
  next_run_at: string;
  last_run_at: string | null;
  consecutive_failures: number;
}

interface ScheduleStatus {
  hasSchedule: boolean;
  nextRun: string | null;
  isActive: boolean;
  frequency: string | null;
  lastRunStatus: 'success' | 'failed' | null;
  schedule: Schedule | null;
  isLoading: boolean;
}

export function useScheduleStatus(
  targetType: 'creator' | 'search_term',
  targetId: string
): ScheduleStatus {
  const { data: schedule, isLoading } = useQuery({
    queryKey: ['schedule-status', targetType, targetId],
    queryFn: async () => {
      if (targetType === 'creator') {
        const { data, error } = await supabase
          .from('scrape_schedules')
          .select('*')
          .eq('creator_id', targetId)
          .maybeSingle();

        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('search_schedules')
          .select('*')
          .eq('search_term_id', targetId)
          .maybeSingle();

        if (error) throw error;
        return data;
      }
    },
  });

  const typedSchedule = schedule as Schedule | null;

  return {
    hasSchedule: !!typedSchedule,
    nextRun: typedSchedule?.next_run_at || null,
    isActive: typedSchedule?.is_active || false,
    frequency: typedSchedule?.frequency_type || null,
    lastRunStatus: typedSchedule?.consecutive_failures === 0 ? 'success' : typedSchedule?.consecutive_failures ? 'failed' : null,
    schedule: typedSchedule,
    isLoading,
  };
}
