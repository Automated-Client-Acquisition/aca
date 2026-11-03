import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CalendarPreferences {
  id: string;
  organization_id: string;
  default_duration_minutes: number;
  default_timezone: string;
  default_conference_provider: "google_meet" | "zoom" | "teams" | "none" | null;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  working_hours: Record<string, { start: string; end: string }>;
  created_at: string;
  updated_at: string;
}

const DEFAULT_PREFERENCES: Partial<CalendarPreferences> = {
  default_duration_minutes: 30,
  default_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  default_conference_provider: "google_meet",
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  working_hours: {
    monday: { start: "09:00", end: "17:00" },
    tuesday: { start: "09:00", end: "17:00" },
    wednesday: { start: "09:00", end: "17:00" },
    thursday: { start: "09:00", end: "17:00" },
    friday: { start: "09:00", end: "17:00" },
  },
};

export function useCalendarPreferences() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["calendar-preferences", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("calendar_preferences")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();

      if (error) throw error;

      // Return existing preferences or defaults
      if (data) {
        return data as CalendarPreferences;
      }

      return {
        ...DEFAULT_PREFERENCES,
        organization_id: currentOrganization.id,
      } as CalendarPreferences;
    },
    enabled: !!user && !!currentOrganization?.id,
  });
}

export function useUpdateCalendarPreferences() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<CalendarPreferences>) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("calendar_preferences")
        .upsert(
          {
            organization_id: currentOrganization.id,
            ...updates,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        )
        .select()
        .single();

      if (error) throw error;
      return data as CalendarPreferences;
    },
    onSuccess: () => {
      toast.success("Calendar preferences updated");
      queryClient.invalidateQueries({ queryKey: ["calendar-preferences"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update preferences");
    },
  });
}

// Common timezones for the dropdown
export const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
];

// Conference provider options
export const CONFERENCE_PROVIDERS = [
  { value: "google_meet", label: "Google Meet" },
  { value: "zoom", label: "Zoom" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "none", label: "No video conferencing" },
];

// Duration options in minutes
export const DURATION_OPTIONS = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
];
