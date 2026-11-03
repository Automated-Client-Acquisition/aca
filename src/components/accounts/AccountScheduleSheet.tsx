import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { AccountWithLimits } from "@/hooks/useAccountsWithLimits";
import { useUpdateAccountSchedule } from "@/hooks/useAccountsWithLimits";

interface AccountScheduleSheetProps {
  account: AccountWithLimits | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenLimits: () => void;
}

interface DaySchedule {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

const DAYS = [
  { key: 1, label: "Monday" },
  { key: 2, label: "Tuesday" },
  { key: 3, label: "Wednesday" },
  { key: 4, label: "Thursday" },
  { key: 5, label: "Friday" },
  { key: 6, label: "Saturday" },
  { key: 0, label: "Sunday" },
];

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London (GMT+0)" },
  { value: "Europe/Paris", label: "Paris (GMT+1)" },
  { value: "Europe/Athens", label: "Cairo, Athens (GMT+2)" },
  { value: "America/New_York", label: "New York (EST)" },
  { value: "America/Chicago", label: "Chicago (CST)" },
  { value: "America/Denver", label: "Denver (MST)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

// Convert time string (HH:MM) to hour number
function timeToHour(time: string): number {
  const [hours] = time.split(":").map(Number);
  return hours;
}

// Convert hour number to time string
function hourToTime(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

// Format time range for display
function formatTimeRange(startHour: number, endHour: number): string {
  return `${hourToTime(startHour)} - ${hourToTime(endHour)}`;
}

export function AccountScheduleSheet({
  account,
  open,
  onOpenChange,
  onOpenLimits,
}: AccountScheduleSheetProps) {
  const [timezone, setTimezone] = useState("UTC");
  const [daySchedules, setDaySchedules] = useState<Record<number, DaySchedule>>({
    1: { enabled: true, startHour: 9, endHour: 19 },
    2: { enabled: true, startHour: 9, endHour: 19 },
    3: { enabled: true, startHour: 9, endHour: 19 },
    4: { enabled: true, startHour: 9, endHour: 19 },
    5: { enabled: true, startHour: 9, endHour: 19 },
    6: { enabled: false, startHour: 9, endHour: 19 },
    0: { enabled: false, startHour: 9, endHour: 19 },
  });

  const updateSchedule = useUpdateAccountSchedule();

  // Sync schedule when account changes
  useEffect(() => {
    if (account) {
      setTimezone(account.schedule.timezone);

      const startHour = timeToHour(account.schedule.business_hours_start);
      const endHour = timeToHour(account.schedule.business_hours_end);

      const newSchedules: Record<number, DaySchedule> = {};
      DAYS.forEach((day) => {
        newSchedules[day.key] = {
          enabled: account.schedule.active_days.includes(day.key),
          startHour,
          endHour,
        };
      });
      setDaySchedules(newSchedules);
    }
  }, [account]);

  const handleDayToggle = (dayKey: number, enabled: boolean) => {
    setDaySchedules((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], enabled },
    }));
  };

  const handleTimeChange = (dayKey: number, values: number[]) => {
    setDaySchedules((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        startHour: values[0],
        endHour: values[1],
      },
    }));
  };

  const handleSave = async () => {
    if (!account) return;

    // Get active days
    const activeDays = Object.entries(daySchedules)
      .filter(([, schedule]) => schedule.enabled)
      .map(([key]) => parseInt(key));

    // Get hours from first enabled day (they should all be the same for now)
    const firstEnabled = Object.values(daySchedules).find((s) => s.enabled);
    const startHour = firstEnabled?.startHour ?? 9;
    const endHour = firstEnabled?.endHour ?? 19;

    await updateSchedule.mutateAsync({
      accountId: account.id,
      schedule: {
        timezone,
        active_days: activeDays,
        business_hours_start: hourToTime(startHour),
        business_hours_end: hourToTime(endHour),
      },
    });

    onOpenChange(false);
  };

  const getInitials = (name: string | null) => {
    if (!name) return "??";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!account) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle>Setup sender schedule</SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenLimits();
              }}
            >
              Go to sender limits
            </Button>
          </div>
        </SheetHeader>

        {/* Account info */}
        <div className="flex items-center gap-3 pb-6 border-b">
          <Avatar className="h-12 w-12">
            <AvatarImage
              src={account.avatar_url || undefined}
              referrerPolicy="no-referrer"
            />
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
              {getInitials(account.display_name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">
              {account.display_name || account.username || "Unknown"}
            </div>
          </div>
        </div>

        {/* Timezone selector */}
        <div className="py-6 border-b">
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Day schedules */}
        <div className="space-y-4 py-6">
          {DAYS.map((day) => {
            const schedule = daySchedules[day.key];
            return (
              <div key={day.key} className="space-y-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={schedule.enabled}
                    onCheckedChange={(checked) =>
                      handleDayToggle(day.key, checked as boolean)
                    }
                  />
                  <span className="text-sm font-medium w-24">{day.label} Schedule</span>
                </div>

                {schedule.enabled && (
                  <div className="flex items-center gap-4 pl-7">
                    {/* Time range slider */}
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>12 AM</span>
                        <span>6 AM</span>
                        <span>12 PM</span>
                        <span>6 PM</span>
                        <span>12 AM</span>
                      </div>
                      <Slider
                        value={[schedule.startHour, schedule.endHour]}
                        onValueChange={(values) => handleTimeChange(day.key, values)}
                        min={0}
                        max={24}
                        step={1}
                        className="w-full"
                      />
                    </div>

                    {/* Time display */}
                    <Input
                      value={formatTimeRange(schedule.startHour, schedule.endHour)}
                      readOnly
                      className="w-28 text-center text-sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Save button */}
        <div className="flex justify-end gap-3 pt-6 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={updateSchedule.isPending}>
            {updateSchedule.isPending ? "Saving..." : "Save schedule"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
