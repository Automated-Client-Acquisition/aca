import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Schedule {
  id: string;
  creator_id: string;
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

export function useCreatorSchedules(creatorIds: string[]) {
  const { currentOrganization } = useAuth();

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['creator-schedules', currentOrganization?.id, creatorIds],
    queryFn: async () => {
      if (!currentOrganization || creatorIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('scrape_schedules')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .in('creator_id', creatorIds);

      if (error) throw error;
      return data as Schedule[];
    },
    enabled: !!currentOrganization && creatorIds.length > 0,
  });

  // Create a map for quick lookup
  const scheduleMap = new Map<string, ScheduleInfo>();
  
  schedules?.forEach(schedule => {
    // Show the earliest active cadence when a source has several schedules.
    const current = scheduleMap.get(schedule.creator_id);
    if (current?.isActive && !schedule.is_active) return;
    if (current && current.isActive === schedule.is_active && current.nextRun &&
      Date.parse(current.nextRun) <= Date.parse(schedule.next_run_at)) return;
    scheduleMap.set(schedule.creator_id, {
      hasSchedule: true,
      nextRun: schedule.next_run_at,
      isActive: schedule.is_active,
      frequency: schedule.frequency_type,
      lastRunStatus: schedule.consecutive_failures === 0 ? 'success' : schedule.consecutive_failures ? 'failed' : null,
    });
  });

  // Add default values for creators without schedules
  creatorIds.forEach(id => {
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
