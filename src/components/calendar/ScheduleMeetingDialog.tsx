import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, addMinutes, setHours, setMinutes } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CalendarIcon, Clock, Loader2, Video, MapPin, Users } from "lucide-react";
import { useCalendarAccounts } from "@/hooks/calendar/useCalendarAccounts";
import { useCalendarPreferences, COMMON_TIMEZONES, CONFERENCE_PROVIDERS, DURATION_OPTIONS } from "@/hooks/calendar/useCalendarPreferences";
import { useCreateCalendarEvent } from "@/hooks/calendar/useCreateCalendarEvent";
import { useMeetingTemplates, applyTemplateVariables } from "@/hooks/calendar/useMeetingTemplates";

const formSchema = z.object({
  calendarAccountId: z.string().min(1, "Select a calendar"),
  calendarId: z.string().min(1, "Calendar ID is required"),
  title: z.string().min(1, "Title is required"),
  body: z.string().optional(),
  location: z.string().optional(),
  date: z.date({ required_error: "Date is required" }),
  startTime: z.string().min(1, "Start time is required"),
  duration: z.number().min(15).max(480),
  timezone: z.string().min(1, "Timezone is required"),
  conferenceProvider: z.enum(["google_meet", "zoom", "teams", "none"]).optional(),
  attendeeEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  attendeeName: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ScheduleMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pre-fill with contact info
  contact?: {
    id: string;
    first_name?: string;
    last_name?: string;
    primary_email?: string;
  };
  // For campaign automation
  campaignId?: string;
  progressId?: string;
}

// Generate time options in 15-minute increments
function generateTimeOptions() {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hour = h.toString().padStart(2, "0");
      const minute = m.toString().padStart(2, "0");
      const value = `${hour}:${minute}`;
      const label = format(setMinutes(setHours(new Date(), h), m), "h:mm a");
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  contact,
  campaignId,
  progressId,
}: ScheduleMeetingDialogProps) {
  const { data: accounts, isLoading: accountsLoading } = useCalendarAccounts();
  const { data: preferences } = useCalendarPreferences();
  const { data: templates } = useMeetingTemplates();
  const createEvent = useCreateCalendarEvent();

  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  // Find first connected account and its primary calendar
  const firstAccount = accounts?.[0];

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      calendarAccountId: "",
      calendarId: "primary", // Most providers have a "primary" calendar
      title: "",
      body: "",
      location: "",
      date: new Date(),
      startTime: "09:00",
      duration: preferences?.default_duration_minutes || 30,
      timezone: preferences?.default_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      conferenceProvider: preferences?.default_conference_provider || "google_meet",
      attendeeEmail: contact?.primary_email || "",
      attendeeName: contact ? `${contact.first_name || ""} ${contact.last_name || ""}`.trim() : "",
    },
  });

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      form.setValue("duration", preferences.default_duration_minutes);
      form.setValue("timezone", preferences.default_timezone);
      if (preferences.default_conference_provider) {
        form.setValue("conferenceProvider", preferences.default_conference_provider);
      }
    }
  }, [preferences, form]);

  // Update form when accounts load
  useEffect(() => {
    if (firstAccount) {
      form.setValue("calendarAccountId", firstAccount.id);
    }
  }, [firstAccount, form]);

  // Apply template when selected
  useEffect(() => {
    if (selectedTemplate && templates) {
      const template = templates.find((t) => t.id === selectedTemplate);
      if (template) {
        const variables = {
          contact_name: contact ? `${contact.first_name || ""} ${contact.last_name || ""}`.trim() : "",
          contact_first_name: contact?.first_name || "",
          contact_last_name: contact?.last_name || "",
        };

        form.setValue("title", applyTemplateVariables(template.title_template, variables));
        if (template.body_template) {
          form.setValue("body", applyTemplateVariables(template.body_template, variables));
        }
        form.setValue("duration", template.duration_minutes);
        if (template.conference_provider) {
          form.setValue("conferenceProvider", template.conference_provider);
        }
        if (template.location) {
          form.setValue("location", template.location);
        }
      }
    }
  }, [selectedTemplate, templates, contact, form]);

  const onSubmit = async (values: FormValues) => {
    // Parse start time
    const [hours, minutes] = values.startTime.split(":").map(Number);
    const startTime = new Date(values.date);
    startTime.setHours(hours, minutes, 0, 0);

    // Calculate end time based on duration
    const endTime = addMinutes(startTime, values.duration);

    // Build attendees list
    const attendees: Array<{ email: string; name?: string }> = [];
    if (values.attendeeEmail) {
      attendees.push({
        email: values.attendeeEmail,
        name: values.attendeeName || undefined,
      });
    }

    await createEvent.mutateAsync({
      calendarAccountId: values.calendarAccountId,
      calendarId: values.calendarId,
      title: values.title,
      body: values.body,
      location: values.location,
      startTime,
      endTime,
      timezone: values.timezone,
      conferenceProvider: values.conferenceProvider,
      attendees,
      contactId: contact?.id,
      campaignId,
      progressId,
      templateId: selectedTemplate || undefined,
    });

    onOpenChange(false);
    form.reset();
    setSelectedTemplate("");
  };

  const hasCalendarConnected = accounts && accounts.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Meeting</DialogTitle>
          <DialogDescription>
            {contact
              ? `Schedule a meeting with ${contact.first_name || ""} ${contact.last_name || ""}`.trim()
              : "Create a new calendar event"}
          </DialogDescription>
        </DialogHeader>

        {accountsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !hasCalendarConnected ? (
          <div className="py-8 text-center text-muted-foreground">
            <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No calendar connected</p>
            <p className="text-sm mt-2">
              Connect a calendar in Settings to schedule meetings
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Template selector */}
              {templates && templates.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template</label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a template (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No template</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} {t.is_default && "(Default)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Calendar Account */}
              <FormField
                control={form.control}
                name="calendarAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Calendar</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select calendar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accounts?.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.email} ({account.provider})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Title */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meeting Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Intro Call" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Date and Time */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <Clock className="h-4 w-4 mr-2 opacity-50" />
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[200px]">
                          {TIME_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Duration and Timezone */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v, 10))}
                        value={String(field.value)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DURATION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COMMON_TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Video Conference */}
              <FormField
                control={form.control}
                name="conferenceProvider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Video className="h-4 w-4" />
                      Video Conference
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CONFERENCE_PROVIDERS.map((provider) => (
                          <SelectItem key={provider.value} value={provider.value}>
                            {provider.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Meeting link will be auto-generated
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Attendee */}
              <div className="space-y-2">
                <FormLabel className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Attendee
                </FormLabel>
                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    control={form.control}
                    name="attendeeEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Email address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="attendeeName"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Name (optional)" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Location */}
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Location (optional)
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Conference Room A" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add meeting agenda or notes..."
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button variant="cta" type="submit" disabled={createEvent.isPending}>
                  {createEvent.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Schedule Meeting
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
