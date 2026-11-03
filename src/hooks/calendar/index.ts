// Calendar Hooks - Index exports
export {
  useCalendarAccounts,
  useConnectCalendar,
  useDisconnectCalendar,
  type CalendarAccount,
} from "./useCalendarAccounts";

export {
  useCalendarPreferences,
  useUpdateCalendarPreferences,
  COMMON_TIMEZONES,
  CONFERENCE_PROVIDERS,
  DURATION_OPTIONS,
  type CalendarPreferences,
} from "./useCalendarPreferences";

export {
  useCreateCalendarEvent,
  useCalendarEvents,
  type CreateEventInput,
  type CalendarEvent,
} from "./useCreateCalendarEvent";

export {
  useMeetingTemplates,
  useCreateMeetingTemplate,
  useUpdateMeetingTemplate,
  useDeleteMeetingTemplate,
  applyTemplateVariables,
  type MeetingTemplate,
} from "./useMeetingTemplates";
