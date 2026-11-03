import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChannelIndicator, getChannelLabel } from "@/components/inbox/ChannelIndicator";
import {
  useResponseTimeStats,
  useResetResponseTimeStats,
  type ResponseTimeStats,
} from "@/hooks/crm/useResponseTimeStats";
import type { ConversationChannel } from "@/hooks/crm/useConversations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Clock, RotateCcw, Timer } from "lucide-react";

interface SLAWidgetProps {
  className?: string;
}

function formatResponseTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function SLAWidget({ className }: SLAWidgetProps) {
  const { data: stats, isLoading } = useResponseTimeStats();
  const resetMutation = useResetResponseTimeStats();

  // Compute overall stats from the array
  const overallAvgMs = stats && stats.length > 0
    ? Math.round(
        stats.reduce((sum, s) => sum + s.avg_ms * s.total_convs, 0) /
        stats.reduce((sum, s) => sum + s.total_convs, 0)
      )
    : null;

  const totalConversations = stats
    ? stats.reduce((sum, s) => sum + s.total_convs, 0)
    : 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 text-xs gap-1.5 px-2", className)}
          aria-label="View response times"
          title="Response times"
        >
          <Timer className="h-3.5 w-3.5 text-muted-foreground" />
          {isLoading ? (
            <Skeleton className="h-3 w-8" />
          ) : overallAvgMs ? (
            <span className="text-muted-foreground">
              {formatResponseTime(overallAvgMs)}
            </span>
          ) : (
            <span className="text-muted-foreground">--</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0" align="end">
        {/* Header */}
        <div className="px-4 py-3 border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-sm">Response Times</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">(last 30 days)</span>
              {stats && stats.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title="Reset response time data"
                      aria-label="Reset response time data"
                    >
                      <RotateCcw className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset Response Times</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will clear all response time data and SLA statuses for your
                        organization. New response times will be computed from future
                        conversations. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => resetMutation.mutate()}
                        disabled={resetMutation.isPending}
                      >
                        {resetMutation.isPending ? "Resetting..." : "Reset"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="max-h-[min(400px,60dvh)]">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-6 w-6 rounded" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : stats && stats.length > 0 ? (
            <div className="divide-y">
              {/* Per-channel rows */}
              {stats.map((channelStats) => (
                <ChannelStatsRow
                  key={channelStats.channel}
                  stats={channelStats}
                />
              ))}

              {/* Overall footer */}
              <div className="px-4 py-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Overall</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {overallAvgMs ? formatResponseTime(overallAvgMs) : "--"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {totalConversations} conversations
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Timer className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                No response data yet
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Response times will appear once conversations have replies
              </p>
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function ChannelStatsRow({ stats }: { stats: ResponseTimeStats }) {
  return (
    <div className="px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ChannelIndicator
            channel={stats.channel as ConversationChannel}
            className="h-5 w-5 rounded"
          />
          <div>
            <p className="text-sm font-medium">
              {getChannelLabel(stats.channel as ConversationChannel)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {stats.total_convs} conversation{stats.total_convs !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="text-right space-y-0.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Avg</span>
            <span className="font-medium min-w-[48px] text-right">
              {formatResponseTime(stats.avg_ms)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Med</span>
            <span className="font-medium min-w-[48px] text-right">
              {formatResponseTime(stats.median_ms)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
