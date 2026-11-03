import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Settings2, Video, Clock, Globe } from "lucide-react";
import {
  useCalendarPreferences,
  useUpdateCalendarPreferences,
  COMMON_TIMEZONES,
  CONFERENCE_PROVIDERS,
  DURATION_OPTIONS,
} from "@/hooks/calendar/useCalendarPreferences";
import { useCalendarAccounts } from "@/hooks/calendar/useCalendarAccounts";

export function CalendarPreferencesCard() {
  const { data: accounts } = useCalendarAccounts();
  const { data: preferences, isLoading } = useCalendarPreferences();
  const updateMutation = useUpdateCalendarPreferences();

  const hasCalendarConnected = accounts && accounts.length > 0;

  if (!hasCalendarConnected) {
    return null; // Don't show preferences if no calendar is connected
  }

  const handleDurationChange = (value: string) => {
    updateMutation.mutate({ default_duration_minutes: parseInt(value, 10) });
  };

  const handleTimezoneChange = (value: string) => {
    updateMutation.mutate({ default_timezone: value });
  };

  const handleProviderChange = (value: string) => {
    updateMutation.mutate({
      default_conference_provider: value as "google_meet" | "zoom" | "teams" | "none",
    });
  };

  const handleBufferBeforeChange = (value: string) => {
    updateMutation.mutate({ buffer_before_minutes: parseInt(value, 10) });
  };

  const handleBufferAfterChange = (value: string) => {
    updateMutation.mutate({ buffer_after_minutes: parseInt(value, 10) });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="space-y-2">
          <CardTitle className="text-xl flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            Meeting Defaults
          </CardTitle>
          <CardDescription>
            Configure default settings for meetings scheduled through the platform
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Default Duration */}
            <div className="space-y-2">
              <Label htmlFor="duration" className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Default Duration
              </Label>
              <Select
                value={String(preferences?.default_duration_minutes || 30)}
                onValueChange={handleDurationChange}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger id="duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Default Timezone */}
            <div className="space-y-2">
              <Label htmlFor="timezone" className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Timezone
              </Label>
              <Select
                value={preferences?.default_timezone || "UTC"}
                onValueChange={handleTimezoneChange}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger id="timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Conference Provider */}
            <div className="space-y-2">
              <Label htmlFor="conference" className="flex items-center gap-2">
                <Video className="h-4 w-4 text-muted-foreground" />
                Video Conferencing
              </Label>
              <Select
                value={preferences?.default_conference_provider || "google_meet"}
                onValueChange={handleProviderChange}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger id="conference">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONFERENCE_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Meeting links are auto-generated when scheduling
              </p>
            </div>

            {/* Buffer time */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">Buffer Time</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select
                    value={String(preferences?.buffer_before_minutes || 0)}
                    onValueChange={handleBufferBeforeChange}
                    disabled={updateMutation.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No buffer before</SelectItem>
                      <SelectItem value="5">5 min before</SelectItem>
                      <SelectItem value="10">10 min before</SelectItem>
                      <SelectItem value="15">15 min before</SelectItem>
                      <SelectItem value="30">30 min before</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Select
                    value={String(preferences?.buffer_after_minutes || 0)}
                    onValueChange={handleBufferAfterChange}
                    disabled={updateMutation.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No buffer after</SelectItem>
                      <SelectItem value="5">5 min after</SelectItem>
                      <SelectItem value="10">10 min after</SelectItem>
                      <SelectItem value="15">15 min after</SelectItem>
                      <SelectItem value="30">30 min after</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Add buffer time between meetings to avoid back-to-back scheduling
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
