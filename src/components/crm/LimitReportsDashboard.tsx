import { useState } from "react";
import { Droplet, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChannelLimitSlider } from "./ChannelLimitSlider";
import {
  useChannelLimitsSummary,
  useChannelDefinitions,
  useUpdateChannelLimit,
  useLimitReports,
  useCreateLimitReport,
  useDeleteLimitReport,
  useStartWarmup,
  usePauseWarmup,
  useResetWarmup,
  type CrmChannelType,
  type LimitZone,
} from "@/hooks/crm/useChannelLimits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface LimitReportsDashboardProps {
  className?: string;
}

const DATE_RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

// Default channels shown in the CRM limits report
const DEFAULT_CHANNELS: CrmChannelType[] = [
  "email",
  "linkedin_invitation",
  "linkedin_message",
  "linkedin_comment",
];

export function LimitReportsDashboard({ className }: LimitReportsDashboardProps) {
  const [dateRange, setDateRange] = useState("7");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Hooks
  const { data: limitsSummary, isLoading: isLoadingSummary, error: summaryError } = useChannelLimitsSummary(
    parseInt(dateRange)
  );
  const { data: definitions } = useChannelDefinitions();
  const { data: reports } = useLimitReports();
  const updateLimit = useUpdateChannelLimit();
  const createReport = useCreateLimitReport();
  const deleteReport = useDeleteLimitReport();
  const startWarmup = useStartWarmup();
  const pauseWarmup = usePauseWarmup();
  const resetWarmup = useResetWarmup();

  // Get selected report or use defaults
  const selectedReport = reports?.find((r) => r.id === selectedReportId);
  const activeChannels: CrmChannelType[] = selectedReport?.channels || DEFAULT_CHANNELS;

  // Filter summary to active channels and maintain order
  const filteredSummary = activeChannels
    .map(channel => limitsSummary?.find((s) => s.channel === channel))
    .filter(Boolean);

  // Get definitions for active channels (for zone limits)
  const getDefinitionForChannel = (channel: CrmChannelType) => {
    return definitions?.find((d) => d.channel === channel);
  };

  const handleZoneChange = (channel: CrmChannelType, zone: LimitZone) => {
    updateLimit.mutate({ channel, current_zone: zone, custom_daily_limit: null });
  };

  const handleCustomLimitChange = (channel: CrmChannelType, limit: number | null) => {
    updateLimit.mutate({ channel, custom_daily_limit: limit });
  };

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
            <Droplet className="h-6 w-6" />
          </div>
          <div>
            <CardTitle className="text-xl font-semibold">Your CRM</CardTitle>
            {/* Report selector - filters which channels to show */}
            <div className="flex items-center gap-2 mt-1">
              <Select
                value={selectedReportId || "default"}
                onValueChange={(value) =>
                  setSelectedReportId(value === "default" ? null : value)
                }
              >
                <SelectTrigger className="h-7 text-xs w-auto min-w-[180px] bg-muted/50 border-0 rounded-full px-3">
                  <SelectValue placeholder="CRM Limits Report" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    <span className="flex items-center gap-2">
                      CRM Limits Report
                      <Badge variant="secondary" className="text-[10px] h-4 rounded-full">
                        {DEFAULT_CHANNELS.length}
                      </Badge>
                    </span>
                  </SelectItem>
                  {reports?.map((report) => (
                    <SelectItem key={report.id} value={report.id}>
                      <span className="flex items-center gap-2">
                        {report.name}
                        <Badge variant="secondary" className="text-[10px] h-4 rounded-full">
                          {report.channels.length}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <CreateReportDialog
                  onSubmit={(name, channels) => {
                    createReport.mutate({ name, channels });
                    setIsCreateDialogOpen(false);
                  }}
                  availableChannels={definitions?.map((d) => d.channel) || []}
                />
              </Dialog>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Date range selector */}
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="h-9 w-[140px] text-sm rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* More options menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setIsCreateDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create custom report
              </DropdownMenuItem>
              {selectedReportId && (
                <DropdownMenuItem
                  onClick={() => {
                    deleteReport.mutate(selectedReportId);
                    setSelectedReportId(null);
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete this report
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {summaryError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Failed to load channel limits. Please try refreshing the page.
          </div>
        ) : isLoadingSummary ? (
          <>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </>
        ) : filteredSummary && filteredSummary.length > 0 ? (
          filteredSummary.map((summary) => {
            if (!summary) return null;
            const definition = getDefinitionForChannel(summary.channel);
            return (
              <ChannelLimitSlider
                key={summary.channel}
                channel={summary.channel}
                displayName={summary.display_name}
                description={summary.description}
                icon={summary.icon}
                currentZone={summary.current_zone}
                dailyLimit={summary.daily_limit}
                todayUsed={summary.today_used}
                usagePercent={summary.usage_percent}
                warmupStatus={summary.warmup_status}
                warmupProgress={summary.warmup_progress}
                safeDailyLimit={definition?.safe_daily_limit || 10}
                moderateDailyLimit={definition?.moderate_daily_limit || 25}
                fasterDailyLimit={definition?.faster_daily_limit || 50}
                riskyDailyLimit={definition?.risky_daily_limit || 100}
                absoluteMaxDaily={definition?.absolute_max_daily || 500}
                onZoneChange={(zone) => handleZoneChange(summary.channel, zone)}
                onCustomLimitChange={(limit) => handleCustomLimitChange(summary.channel, limit)}
              />
            );
          })
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No channel limits configured. Configure your first channel to get started.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Create Report Dialog Component
interface CreateReportDialogProps {
  onSubmit: (name: string, channels: CrmChannelType[]) => void;
  availableChannels: CrmChannelType[];
}

function CreateReportDialog({ onSubmit, availableChannels }: CreateReportDialogProps) {
  const [name, setName] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<CrmChannelType[]>(
    DEFAULT_CHANNELS
  );

  const handleChannelToggle = (channel: CrmChannelType) => {
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : [...prev, channel]
    );
  };

  const channelDisplayNames: Record<CrmChannelType, string> = {
    email: "Emails",
    linkedin_invitation: "LinkedIn Invitations",
    linkedin_message: "LinkedIn Messages",
    linkedin_comment: "LinkedIn Comments",
    instagram_dm: "Instagram DMs",
    twitter_dm: "Twitter DMs",
    sms: "SMS",
    whatsapp: "WhatsApp",
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Custom Report</DialogTitle>
        <DialogDescription>
          Create a custom report to track specific channel limits. Select which channels to include in this report view.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="report-name">Report Name</Label>
          <Input
            id="report-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., LinkedIn Outreach"
          />
        </div>
        <div className="space-y-2">
          <Label>Channels to include</Label>
          <div className="grid grid-cols-2 gap-3 pt-2">
            {availableChannels.map((channel) => (
              <div key={channel} className="flex items-center space-x-2">
                <Checkbox
                  id={`channel-${channel}`}
                  checked={selectedChannels.includes(channel)}
                  onCheckedChange={() => handleChannelToggle(channel)}
                />
                <label
                  htmlFor={`channel-${channel}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {channelDisplayNames[channel]}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit(name, selectedChannels)}
          disabled={!name.trim() || selectedChannels.length === 0}
        >
          Create Report
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export { ChannelLimitSlider } from "./ChannelLimitSlider";
