import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CreateEventInput {
  calendarAccountId: string;
  calendarId: string;
  title: string;
  body?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  isAllDay?: boolean;
  conferenceProvider?: "google_meet" | "zoom" | "teams" | "none";
  attendees: Array<{ email: string; name?: string }>;
  contactId?: string;
  campaignId?: string;
  progressId?: string;
  templateId?: string;
  notify?: boolean;
}

export interface CalendarEvent {
  id: string;
  organization_id: string;
  calendar_account_id: string;
  unipile_event_id: string | null;
  unipile_calendar_id: string;
  title: string;
  body: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  is_all_day: boolean;
  conference_provider: string | null;
  conference_url: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  lead_progress_id: string | null;
  created_by: string;
  created_by_user_id: string | null;
  template_id: string | null;
  status: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
}

export function useCreateCalendarEvent() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateEventInput) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("calendar-create-event", {
        body: {
          organizationId: currentOrganization.id,
          calendarAccountId: input.calendarAccountId,
          calendarId: input.calendarId,
          title: input.title,
          body: input.body,
          location: input.location,
          startTime: input.startTime.toISOString(),
          endTime: input.endTime.toISOString(),
          timezone: input.timezone,
          isAllDay: input.isAllDay,
          conferenceProvider: input.conferenceProvider,
          attendees: input.attendees,
          contactId: input.contactId,
          campaignId: input.campaignId,
          progressId: input.progressId,
          templateId: input.templateId,
          notify: input.notify ?? true,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) throw response.error;

      const result = response.data;
      if (!result.success) throw new Error(result.error);

      return result as {
        success: boolean;
        event: CalendarEvent;
        unipileEventId: string;
        conferenceUrl: string | null;
      };
    },
    onSuccess: (data) => {
      toast.success("Meeting scheduled successfully");
      if (data.conferenceUrl) {
        toast.info("Video conference link generated", {
          description: "Link has been added to the calendar invite",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to schedule meeting");
    },
  });
}

// Hook to fetch calendar events
export function useCalendarEvents(options?: {
  contactId?: string;
  campaignId?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      let query = supabase
        .from("calendar_events")
        .select(`
          *,
          calendar_accounts:calendar_account_id (
            email,
            provider
          ),
          crm_contacts:contact_id (
            first_name,
            last_name,
            primary_email
          )
        `)
        .eq("organization_id", currentOrganization.id)
        .order("start_time", { ascending: true });

      if (options?.contactId) {
        query = query.eq("contact_id", options.contactId);
      }

      if (options?.campaignId) {
        query = query.eq("campaign_id", options.campaignId);
      }

      if (options?.startDate) {
        query = query.gte("start_time", options.startDate.toISOString());
      }

      if (options?.endDate) {
        query = query.lte("end_time", options.endDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
  });
}
