import { useId } from "react";
import { ArrowUpRight, CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingsField,
  SettingsGroup,
  SettingsToggle,
} from "@/components/email/SequenceSettingsLayout";
import { cn } from "@/lib/utils";
import type { EmailSequenceSettings, EmailMailbox } from "@/types/email";

interface SendingPatternConfigProps {
  settings: EmailSequenceSettings;
  onChange: (update: Partial<EmailSequenceSettings>) => void;
  /** Auto-sized pools get their sending target from Accounts. */
  volumeSetInAccounts?: boolean;
  onOpenAccounts?: () => void;
  mailboxCount?: number;
  selectedMailboxes?: EmailMailbox[];
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SendingPatternConfig({
  settings,
  onChange,
  volumeSetInAccounts = false,
  onOpenAccounts,
  mailboxCount = 0,
  selectedMailboxes = [],
}: SendingPatternConfigProps) {
  const id = useId();
  const dailyLimit = settings.daily_limit;
  const capacityKnown =
    mailboxCount > 0 && selectedMailboxes.length === mailboxCount;
  const totalMailboxCapacity = selectedMailboxes.reduce(
    (sum, mailbox) => sum + mailbox.daily_limit,
    0,
  );
  const exceedsCapacity =
    capacityKnown && dailyLimit !== null && dailyLimit > totalMailboxCapacity;
  const timezones = TIMEZONES.includes(settings.timezone)
    ? TIMEZONES
    : [settings.timezone, ...TIMEZONES];
  const invalidWindow =
    !!settings.send_window.start &&
    !!settings.send_window.end &&
    settings.send_window.start >= settings.send_window.end;
  const maxGap =
    settings.min_time_gap_minutes + settings.random_additional_minutes;

  return (
    <div className="space-y-7">
      <SettingsGroup
        title="Sending schedule"
        description="Choose when this sequence can send emails. Times follow the timezone below."
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400">
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {settings.skip_weekends ? "Monday – Friday" : "Every day"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {settings.send_window.start} – {settings.send_window.end}
              </p>
            </div>
          </div>
          <div
            className="grid grid-cols-7 gap-1.5"
            aria-label={
              settings.skip_weekends
                ? "Sending days: Monday through Friday"
                : "Sending days: every day"
            }
          >
            {WEEKDAYS.map((day, index) => (
              <span
                key={day}
                aria-hidden="true"
                className={cn(
                  "flex h-9 min-w-0 items-center justify-center rounded-lg border text-xs font-medium sm:w-9",
                  index < 5 || !settings.skip_weekends
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-transparent bg-muted text-muted-foreground/60",
                )}
              >
                {day}
              </span>
            ))}
          </div>
        </div>
        <SettingsField
          label="Timezone"
          htmlFor={`${id}-timezone`}
          description="Use the timezone where your audience works."
        >
          <Select
            value={settings.timezone}
            onValueChange={(value) => onChange({ timezone: value })}
          >
            <SelectTrigger id={`${id}-timezone`} className="w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((timezone) => (
                <SelectItem key={timezone} value={timezone}>
                  {timezone.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-start`} className="text-sm">
                Start time
              </Label>
              <Input
                id={`${id}-start`}
                type="time"
                value={settings.send_window.start}
                aria-invalid={invalidWindow || undefined}
                aria-describedby={
                  invalidWindow ? `${id}-window-help` : undefined
                }
                onChange={(event) =>
                  onChange({
                    send_window: {
                      ...settings.send_window,
                      start: event.target.value,
                    },
                  })
                }
                className="w-full text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-end`} className="text-sm">
                End time
              </Label>
              <Input
                id={`${id}-end`}
                type="time"
                value={settings.send_window.end}
                aria-invalid={invalidWindow || undefined}
                aria-describedby={
                  invalidWindow ? `${id}-window-help` : undefined
                }
                onChange={(event) =>
                  onChange({
                    send_window: {
                      ...settings.send_window,
                      end: event.target.value,
                    },
                  })
                }
                className="w-full text-sm"
              />
            </div>
          </div>
          {invalidWindow && (
            <p
              id={`${id}-window-help`}
              role="status"
              className="mt-3 text-sm text-amber-700 dark:text-amber-300"
            >
              End time must be later than start time. Overnight sending windows
              are not supported.
            </p>
          )}
        </div>
        <SettingsToggle
          label="Skip weekends"
          description="Send Monday through Friday. Emails due on a weekend wait until the next sending day."
          checked={settings.skip_weekends}
          onChange={(checked) => onChange({ skip_weekends: checked })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Daily sending volume"
        description="Set the sequence's total daily allowance across its sending accounts."
      >
        {volumeSetInAccounts ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                Daily send limit{" "}
                <span className="ml-2 rounded-md bg-muted px-2 py-1 text-xs font-normal text-muted-foreground">
                  Managed in Senders
                </span>
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {dailyLimit !== null
                  ? dailyLimit.toLocaleString()
                  : "Unlimited"}
                {dailyLimit !== null && (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    emails / day
                  </span>
                )}
              </p>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                The Emails per day target in Senders sets this limit and sizes
                your automatic inbox pool.
              </p>
            </div>
            {onOpenAccounts && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                onClick={onOpenAccounts}
              >
                Edit in Senders{" "}
                <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ) : (
          <SettingsField
            label="Daily send limit"
            htmlFor={`${id}-daily-limit`}
            description="Includes first emails and follow-ups. Leave empty to use available mailbox capacity without a sequence cap."
          >
            <div className="relative">
              <Input
                id={`${id}-daily-limit`}
                type="number"
                min={1}
                step={1}
                value={dailyLimit ?? ""}
                placeholder="Unlimited"
                className="pr-20 text-sm"
                onChange={(event) => {
                  if (event.target.value === "") {
                    onChange({ daily_limit: null });
                    return;
                  }
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 1)
                    onChange({ daily_limit: value });
                }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                / day
              </span>
            </div>
          </SettingsField>
        )}
        {!volumeSetInAccounts && mailboxCount > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {mailboxCount} sending account{mailboxCount !== 1 ? "s" : ""}
              {capacityKnown && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {totalMailboxCapacity.toLocaleString()} emails / day
                  combined capacity
                </span>
              )}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Mailbox daily limits are shared across every active sequence that
              uses them. Other sequences may reduce the capacity available here.
            </p>
            {exceedsCapacity && (
              <p
                role="status"
                className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-sm leading-relaxed text-amber-700 dark:text-amber-300"
              >
                Your sequence limit exceeds the{" "}
                {totalMailboxCapacity.toLocaleString()} emails / day account
                capacity. Each mailbox's daily limit still applies.
              </p>
            )}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Lead priority"
        description="Decide how first emails and follow-ups share your daily allowance."
      >
        <SettingsField
          label="New leads per day"
          htmlFor={`${id}-new-leads`}
          description="Limit how many fresh leads receive their first email each day. Leave empty for no limit; set 0 to send only follow-ups."
        >
          <Input
            id={`${id}-new-leads`}
            type="number"
            min={0}
            step={1}
            value={settings.max_new_leads_per_day ?? ""}
            placeholder="Unlimited"
            className="text-sm"
            onChange={(event) => {
              if (event.target.value === "") {
                onChange({ max_new_leads_per_day: null });
                return;
              }
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 0)
                onChange({ max_new_leads_per_day: value });
            }}
          />
        </SettingsField>
        <SettingsToggle
          label="Prioritize new leads"
          description="When the daily allowance is limited, send first emails before follow-ups."
          checked={settings.prioritize_new_leads}
          onChange={(checked) => onChange({ prioritize_new_leads: checked })}
        />
      </SettingsGroup>

      <details className="group rounded-xl border bg-background/40">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:px-5 [&::-webkit-details-marker]:hidden">
          <Clock3
            className="h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Advanced pacing</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {settings.min_time_gap_minutes === maxGap
                ? `${maxGap} minutes`
                : `${settings.min_time_gap_minutes}–${maxGap} minutes`}{" "}
              between sends
            </p>
          </div>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-5 border-t px-4 py-5 sm:px-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Space out emails and add a random delay to vary the sending rhythm.
          </p>
          <SettingsField
            label="Minimum gap"
            htmlFor={`${id}-minimum-gap`}
            description="Wait at least this many minutes between sends."
          >
            <div className="relative">
              <Input
                id={`${id}-minimum-gap`}
                type="number"
                min={1}
                step={1}
                value={settings.min_time_gap_minutes}
                className="pr-20 text-sm"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 1)
                    onChange({ min_time_gap_minutes: value });
                }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                minutes
              </span>
            </div>
          </SettingsField>
          <SettingsField
            label="Additional random delay"
            htmlFor={`${id}-random-delay`}
            description="Add a random delay from 0 up to this many minutes after the minimum gap."
          >
            <div className="relative">
              <Input
                id={`${id}-random-delay`}
                type="number"
                min={0}
                step={1}
                value={settings.random_additional_minutes}
                className="pr-20 text-sm"
                onChange={(event) => {
                  if (!event.target.value) return;
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 0)
                    onChange({ random_additional_minutes: value });
                }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                minutes
              </span>
            </div>
          </SettingsField>
        </div>
      </details>
    </div>
  );
}
