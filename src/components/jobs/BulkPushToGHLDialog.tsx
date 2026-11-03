import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CalendarIcon, Send, Loader2, Clock, CalendarDays, TrendingUp, Zap } from "lucide-react";
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { usePushToGHL } from "@/hooks/usePushToGHL";
import { useGHLAccounts, type GHLAccount } from "@/hooks/useGHLAccounts";
import { useTwitterAccounts } from "@/hooks/useTwitterAccounts";
import { useScheduledSlots } from "@/hooks/useScheduledSlots";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";

interface BulkPushToGHLDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputIds: string[];
  outputCount: number;
  allHaveImages?: boolean;
  allHaveVideos?: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google_business: 'Google Business',
  gmb: 'Google Business',
  twitter: 'Twitter/X',
  x: 'Twitter/X',
};

type ScheduleMode = 'now' | 'manual' | 'spread_today' | 'spread_week' | 'peak_times' | 'rush';

/** Minimum gap (ms) between two posts to consider the slot "free" */
const MIN_GAP_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Compute gap-aware schedule dates for smart modes.
 * Returns one Date per output, avoiding busy slots (existing scheduled posts).
 */
function computeGapAwareSchedule(
  mode: ScheduleMode,
  postCount: number,
  busySlots: Date[],
): Date[] | null {
  if (mode === 'now' || mode === 'manual' || postCount === 0) return null;

  const now = new Date();
  const busyMs = busySlots.map(d => d.getTime());

  // Check if a candidate time conflicts with any busy slot
  const isSlotBusy = (candidate: Date): boolean => {
    const t = candidate.getTime();
    return busyMs.some(b => Math.abs(t - b) < MIN_GAP_MS);
  };

  // Find the next available slot at or after `candidate`, nudging forward if busy
  const findAvailableSlot = (candidate: Date, incrementMs: number): Date => {
    let attempts = 0;
    let slot = new Date(candidate);
    while (isSlotBusy(slot) && attempts < 100) {
      slot = new Date(slot.getTime() + incrementMs);
      attempts++;
    }
    return slot;
  };

  switch (mode) {
    case 'spread_today': {
      const startHour = Math.min(now.getHours() + 1, 20);
      const endHour = 21;
      const availableMinutes = (endHour - startHour) * 60;
      const idealStagger = Math.max(Math.floor(availableMinutes / Math.max(postCount, 1)), 5);
      const staggerMs = idealStagger * 60 * 1000;

      const base = new Date(now);
      base.setHours(startHour, 0, 0, 0);

      const dates: Date[] = [];
      let cursor = new Date(base);
      for (let i = 0; i < postCount; i++) {
        const slot = findAvailableSlot(cursor, MIN_GAP_MS);
        dates.push(slot);
        cursor = new Date(slot.getTime() + staggerMs);
      }
      return dates;
    }

    case 'spread_week': {
      const base = new Date(now);
      if (now.getHours() >= 10) {
        base.setDate(base.getDate() + 1);
      }
      base.setHours(10, 0, 0, 0);

      const dayMs = 24 * 60 * 60 * 1000;
      const dates: Date[] = [];
      let cursor = new Date(base);
      for (let i = 0; i < postCount; i++) {
        const slot = findAvailableSlot(cursor, 60 * 60 * 1000); // nudge by 1hr if busy
        dates.push(slot);
        cursor = new Date(slot.getTime() + dayMs);
      }
      return dates;
    }

    case 'peak_times': {
      const peakHours = [9, 12, 17, 19];
      const base = new Date(now);
      let startIdx = peakHours.findIndex(h => h > now.getHours());
      if (startIdx === -1) {
        base.setDate(base.getDate() + 1);
        startIdx = 0;
      }

      const dates: Date[] = [];
      let dayOffset = 0;
      let peakIdx = startIdx;
      for (let i = 0; i < postCount; i++) {
        const candidate = new Date(base);
        candidate.setDate(base.getDate() + dayOffset);
        candidate.setHours(peakHours[peakIdx], 0, 0, 0);
        const slot = findAvailableSlot(candidate, MIN_GAP_MS);
        dates.push(slot);
        peakIdx++;
        if (peakIdx >= peakHours.length) {
          peakIdx = 0;
          dayOffset++;
        }
      }
      return dates;
    }

    case 'rush': {
      const base = new Date(now.getTime() + 15 * 60 * 1000);
      const staggerMs = 30 * 60 * 1000;

      const dates: Date[] = [];
      let cursor = new Date(base);
      for (let i = 0; i < postCount; i++) {
        const slot = findAvailableSlot(cursor, MIN_GAP_MS);
        dates.push(slot);
        cursor = new Date(slot.getTime() + staggerMs);
      }
      return dates;
    }

    default:
      return null;
  }
}

const SCHEDULE_MODES: { value: ScheduleMode; label: string; icon: any; description: string }[] = [
  { value: 'now', label: 'Post Now', icon: Send, description: 'Publish immediately' },
  { value: 'manual', label: 'Manual', icon: CalendarIcon, description: 'Pick date, time & interval' },
  { value: 'spread_today', label: 'Spread Today', icon: Clock, description: 'Evenly space through today' },
  { value: 'spread_week', label: 'Spread Week', icon: CalendarDays, description: '1 post/day at 10am' },
  { value: 'peak_times', label: 'Peak Times', icon: TrendingUp, description: '9am, 12pm, 5pm, 7pm cycle' },
  { value: 'rush', label: 'Rush (30 min)', icon: Zap, description: 'Every 30 min starting soon' },
];

export function BulkPushToGHLDialog({
  open,
  onOpenChange,
  outputIds,
  outputCount,
  allHaveImages = false,
  allHaveVideos = false,
}: BulkPushToGHLDialogProps) {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [scheduleDate, setScheduleDate] = useState<Date>();
  const [scheduleTime, setScheduleTime] = useState<string>("12:00");
  const [staggerMinutes, setStaggerMinutes] = useState<number>(30);
  const pushToGHL = usePushToGHL();
  const { data: accountsData, isLoading: loadingGHL, error: accountsError } = useGHLAccounts();
  const { data: twitterAccounts, isLoading: loadingTwitter } = useTwitterAccounts();
  const [twitterPublishing, setTwitterPublishing] = useState(false);

  const loadingAccounts = loadingGHL || loadingTwitter;

  // Transform Twitter accounts to GHLAccount shape
  const twitterAsGHL: GHLAccount[] = (twitterAccounts || [])
    .filter(a => a.is_active && a.is_valid)
    .map(a => ({
      id: a.id,
      type: 'twitter',
      name: a.name,
      username: a.twitter_handle || undefined,
      profileImage: a.profile_image_url || undefined,
      isActive: true,
    }));

  const twitterAccountIds = new Set(twitterAsGHL.map(a => a.id));

  // Fetch existing scheduled slots for selected accounts to avoid double-booking
  const { data: busySlots = [] } = useScheduledSlots(selectedAccounts);

  // Validate that manual schedule date/time is in the future
  const isManualScheduleInPast = useMemo(() => {
    if (scheduleMode !== 'manual' || !scheduleDate || !scheduleTime) return false;
    const [h, m] = scheduleTime.split(':');
    const combined = new Date(scheduleDate);
    combined.setHours(parseInt(h), parseInt(m), 0, 0);
    return combined <= new Date();
  }, [scheduleMode, scheduleDate, scheduleTime]);

  // Compute gap-aware smart schedule dates
  const smartScheduleDates = useMemo(() => {
    if (scheduleMode === 'now' || scheduleMode === 'manual') return null;
    return computeGapAwareSchedule(scheduleMode, outputCount, busySlots);
  }, [scheduleMode, outputCount, busySlots]);

  const handleAccountToggle = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const handlePush = async () => {
    if (selectedAccounts.length === 0) return;

    let scheduleDateISO: string | undefined;
    let scheduleDatesISO: string[] | undefined;
    let computedStagger: number | undefined;

    if (scheduleMode === 'manual') {
      if (scheduleDate && scheduleTime) {
        const [hours, minutes] = scheduleTime.split(':');
        const combined = new Date(scheduleDate);
        combined.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        scheduleDateISO = combined.toISOString();
        computedStagger = staggerMinutes;
      }
    } else if (scheduleMode !== 'now') {
      // Smart modes — use per-output dates
      const dates = computeGapAwareSchedule(scheduleMode, outputIds.length, busySlots);
      if (dates) {
        scheduleDatesISO = dates.map(d => d.toISOString());
      }
    }

    // Split accounts: GHL vs Twitter
    const ghlAccountIds = selectedAccounts.filter(id => !twitterAccountIds.has(id));
    const twitterIds = selectedAccounts.filter(id => twitterAccountIds.has(id));

    // Publish to GHL accounts
    if (ghlAccountIds.length > 0) {
      await pushToGHL.mutateAsync({
        contentOutputIds: outputIds,
        platforms: ghlAccountIds,
        scheduleDate: scheduleDateISO,
        scheduleDates: scheduleDatesISO,
        staggerMinutes: scheduleDateISO ? (computedStagger ?? staggerMinutes) : undefined,
      });
    }

    // Publish to Twitter accounts - pass output_id so edge function fetches content
    if (twitterIds.length > 0) {
      setTwitterPublishing(true);
      try {
        for (const outputId of outputIds) {
          for (const accountId of twitterIds) {
            await supabase.functions.invoke('publish-to-twitter', {
              body: {
                account_id: accountId,
                output_id: outputId,
              },
            });
          }
        }
      } finally {
        setTwitterPublishing(false);
      }
    }

    onOpenChange(false);
    setSelectedAccounts([]);
    setScheduleDate(undefined);
    setScheduleMode('now');
  };

  const accounts = [...(accountsData?.accounts || []), ...twitterAsGHL];
  const activeAccounts = accounts.filter(a => a.isActive);

  // Group accounts by platform type
  const groupedAccounts = activeAccounts.reduce((acc, account) => {
    const platform = account.type.toLowerCase();
    if (!acc[platform]) acc[platform] = [];
    acc[platform].push(account);
    return acc;
  }, {} as Record<string, typeof accounts>);

  // Check if Instagram is selected
  const selectedInstagramAccounts = selectedAccounts.filter(accountId => {
    const account = activeAccounts.find(a => a.id === accountId);
    return account?.type.toLowerCase() === 'instagram';
  });

  const hasInstagramWithoutImage = selectedInstagramAccounts.length > 0 && !allHaveImages;

  // Check if YouTube is selected
  const selectedYoutubeAccounts = selectedAccounts.filter(accountId => {
    const account = activeAccounts.find(a => a.id === accountId);
    return account?.type.toLowerCase() === 'youtube';
  });

  const hasYoutubeWithoutVideo = selectedYoutubeAccounts.length > 0 && !allHaveVideos;

  const formatStaggerLabel = (mins: number) => {
    if (mins >= 1440) return `${Math.floor(mins / 1440)} day${mins >= 2880 ? 's' : ''}`;
    if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}m` : ''}`;
    return `${mins} min`;
  };

  // Compute interval description from smart dates
  const smartIntervalLabel = useMemo(() => {
    if (!smartScheduleDates || smartScheduleDates.length < 2) return null;
    const avgMs = (smartScheduleDates[smartScheduleDates.length - 1].getTime() - smartScheduleDates[0].getTime()) / (smartScheduleDates.length - 1);
    const avgMinutes = Math.round(avgMs / 60000);
    return formatStaggerLabel(avgMinutes);
  }, [smartScheduleDates]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col h-[85vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Bulk Push to LeadConnector</DialogTitle>
          <DialogDescription>
            Publish {outputCount} posts to your connected social media accounts
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 py-4">
            {/* Connected Accounts Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Select Social Accounts</Label>

              {loadingAccounts ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : accountsError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    Failed to load connected accounts. Please check your GHL connection.
                  </AlertDescription>
                </Alert>
              ) : accountsData?.needsOAuth || accountsData?.needsReconnect ? (
                <Alert>
                  <AlertDescription className="space-y-3">
                    <p>
                      {accountsData.needsReconnect
                        ? "Your LeadConnector connection needs to be refreshed."
                        : "LeadConnector is not connected."}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.href = '/settings?tab=integrations'}
                    >
                      {accountsData.needsReconnect ? 'Reconnect' : 'Connect'} in Settings
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : activeAccounts.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    No social accounts connected in LeadConnector. Please connect accounts in your GHL dashboard first.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedAccounts).map(([platform, platformAccounts]) => (
                    <div key={platform} className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">
                        {PLATFORM_LABELS[platform] || platform}
                      </div>
                      {platformAccounts.map(account => (
                        <div key={account.id} className="flex items-center space-x-3 pl-4">
                          <Checkbox
                            id={account.id}
                            checked={selectedAccounts.includes(account.id)}
                            onCheckedChange={() => handleAccountToggle(account.id)}
                          />
                          <Label
                            htmlFor={account.id}
                            className="flex items-center gap-2 text-sm font-normal cursor-pointer flex-1"
                          >
                            {account.profileImage && (
                              <img
                                src={account.profileImage}
                                alt={account.name}
                                className="w-6 h-6 rounded-full object-cover"
                              />
                            )}
                            <div className="flex flex-col">
                              <span>{account.name}</span>
                              {account.username && (
                                <span className="text-xs text-muted-foreground">
                                  @{account.username}
                                </span>
                              )}
                            </div>
                          </Label>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Schedule Mode Selector */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Schedule</Label>
              <div className="grid grid-cols-3 gap-2">
                {SCHEDULE_MODES.map(({ value, label, icon: Icon, description }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScheduleMode(value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      scheduleMode === value
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", scheduleMode === value ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-sm font-medium", scheduleMode === value ? "text-primary" : "")}>{label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>

              {/* Manual picker */}
              {scheduleMode === 'manual' && (
                <div className="space-y-3 pt-2">
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "flex-1 justify-start text-left font-normal",
                            !scheduleDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {scheduleDate ? format(scheduleDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={scheduleDate}
                          onSelect={setScheduleDate}
                          disabled={(date) => date < startOfDay(new Date())}
                        />
                      </PopoverContent>
                    </Popover>
                    <Input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  {isManualScheduleInPast && (
                    <p className="text-xs text-destructive">
                      Selected time is in the past. Please choose a future time.
                    </p>
                  )}
                  {scheduleDate && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="stagger" className="text-sm">
                          Stagger posts by (minutes)
                        </Label>
                        <Input
                          id="stagger"
                          type="number"
                          min="5"
                          max="1440"
                          value={staggerMinutes}
                          onChange={(e) => setStaggerMinutes(parseInt(e.target.value))}
                          className="w-32"
                        />
                        <p className="text-xs text-muted-foreground">
                          Posts will be scheduled {staggerMinutes} minutes apart
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setScheduleDate(undefined)}
                        className="text-xs"
                      >
                        Clear Schedule
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Smart schedule preview */}
              {smartScheduleDates && smartScheduleDates.length > 0 && (
                <div className="rounded-md bg-muted/50 border p-3 text-sm space-y-1">
                  <p className="font-medium">Schedule Preview</p>
                  <p className="text-muted-foreground">
                    First post: {format(smartScheduleDates[0], "PPP 'at' h:mm a")}
                  </p>
                  {smartScheduleDates.length > 1 && (
                    <>
                      <p className="text-muted-foreground">
                        Last post: {format(smartScheduleDates[smartScheduleDates.length - 1], "PPP 'at' h:mm a")}
                      </p>
                      {smartIntervalLabel && (
                        <p className="text-muted-foreground">
                          Avg interval: ~{smartIntervalLabel} apart
                        </p>
                      )}
                    </>
                  )}
                  {busySlots.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {busySlots.length} existing post{busySlots.length !== 1 ? 's' : ''} detected — schedule adjusted to avoid conflicts
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Instagram Image Requirement Warning */}
            {hasInstagramWithoutImage && (
              <Alert variant="destructive">
                <AlertDescription>
                  <strong>Instagram requires images.</strong> Some selected content has no images.
                  These posts will fail when publishing to Instagram. Please add images first or deselect Instagram.
                </AlertDescription>
              </Alert>
            )}

            {/* YouTube Video Requirement Warning */}
            {hasYoutubeWithoutVideo && (
              <Alert variant="destructive">
                <AlertDescription>
                  <strong>YouTube requires videos.</strong> Some selected content has no videos.
                  These posts will fail when publishing to YouTube. Please add videos first or deselect YouTube.
                </AlertDescription>
              </Alert>
            )}

            {/* Preview */}
            {selectedAccounts.length > 0 && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-medium mb-1">Ready to publish:</p>
                <ul className="text-muted-foreground space-y-1">
                  <li>{outputCount} posts to {selectedAccounts.length} account{selectedAccounts.length !== 1 ? 's' : ''}</li>
                  {scheduleMode === 'now' && <li>Publishing immediately</li>}
                  {scheduleMode === 'manual' && scheduleDate && (
                    <li>Starting: {format(scheduleDate, "PPP")} at {scheduleTime}, every {staggerMinutes} min</li>
                  )}
                  {smartScheduleDates && smartScheduleDates.length > 0 && (
                    <li>
                      {format(smartScheduleDates[0], "PPP 'at' h:mm a")}
                      {smartScheduleDates.length > 1 && smartIntervalLabel && ` — ~${smartIntervalLabel} apart`}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 shrink-0 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handlePush}
            disabled={
              selectedAccounts.length === 0 ||
              pushToGHL.isPending ||
              twitterPublishing ||
              loadingAccounts ||
              hasInstagramWithoutImage ||
              hasYoutubeWithoutVideo ||
              isManualScheduleInPast
            }
          >
            {(pushToGHL.isPending || twitterPublishing) ? (
              "Publishing..."
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {scheduleMode === 'now' ? 'Publish All Now' : 'Schedule All'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
