import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Schedule {
  id: string;
  search_term_id: string;
  is_active: boolean;
  frequency_type: string;
  next_run_at: string;
  last_run_at: string | null;
  consecutive_failures: number;
}

interface ScheduleInfo {
  hasSchedule: boolean;
  nextRun: string | null;
  isActive: boolean;
  frequency: string | null;
  lastRunStatus: 'success' | 'failed' | null;
}

export function useSearchTermSchedules(searchTermIds: string[]) {
  const { currentOrganization } = useAuth();
  const { data: schedules, isLoading } = useQuery({
    queryKey: ['search-term-schedules', currentOrganization?.id, searchTermIds],
    queryFn: async () => {
      if (!currentOrganization || searchTermIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('search_schedules')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .in('search_term_id', searchTermIds);

      if (error) throw error;
      return data as Schedule[];
    },
    enabled: !!currentOrganization && searchTermIds.length > 0,
  });

  // Create a map for quick lookup
  const scheduleMap = new Map<string, ScheduleInfo>();
  
  schedules?.forEach(schedule => {
    // Show the earliest active cadence when a source has several schedules.
    const current = scheduleMap.get(schedule.search_term_id);
    if (current?.isActive && !schedule.is_active) return;
    if (current && current.isActive === schedule.is_active && current.nextRun &&
      Date.parse(current.nextRun) <= Date.parse(schedule.next_run_at)) return;
    scheduleMap.set(schedule.search_term_id, {
      hasSchedule: true,
      nextRun: schedule.next_run_at,
      isActive: schedule.is_active,
      frequency: schedule.frequency_type,
      lastRunStatus: schedule.consecutive_failures === 0 ? 'success' : schedule.consecutive_failures ? 'failed' : null,
    });
  });

  // Add default values for search terms without schedules
  searchTermIds.forEach(id => {
    if (!scheduleMap.has(id)) {
      scheduleMap.set(id, {
        hasSchedule: false,
        nextRun: null,
        isActive: false,
        frequency: null,
        lastRunStatus: null,
      });
    }
  });

  return { scheduleMap, isLoading };
}
