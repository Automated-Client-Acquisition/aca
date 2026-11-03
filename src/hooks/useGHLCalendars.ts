import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GHLCalendarCacheItem {
  id: string;
  organization_id: string;
  location_id: string;
  calendar_id: string;
  calendar_name: string;
  calendar_description: string | null;
  calendar_type: string | null;
  group_id: string | null;
  is_active: boolean;
  raw_data: Record<string, unknown>;
  last_synced_at: string;
}

export function useGHLCalendars(options?: { enabled?: boolean }) {
  const { currentOrganization } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<GHLCalendarCacheItem[]>({
    queryKey: ["ghl-calendars", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase.functions.invoke("ghl-list-calendars", {
        body: { organizationId: currentOrganization.id },
      });

      if (error) throw error;
      if (data && !data.success && data.needsReauth) {
        // Token expired — return empty instead of throwing to avoid console errors
        return [];
      }
      return data?.calendars || [];
    },
    enabled: !!currentOrganization && externalEnabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRefreshGHLCalendars() {
  const { currentOrganization } = useAuth();

  return async () => {
    if (!currentOrganization) return [];

    const { data, error } = await supabase.functions.invoke("ghl-list-calendars", {
      body: { organizationId: currentOrganization.id, force: true },
    });

    if (error) throw error;
    return data?.calendars || [];
  };
}
