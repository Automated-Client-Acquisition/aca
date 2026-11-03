import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Pause, Play, Trash2, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useSchedules } from "@/hooks/useSchedules";
import { useActiveScrapes } from "@/hooks/useActiveScrapes";
import { Skeleton } from "@/components/ui/skeleton";

interface SchedulesListProps {
  type: 'creator' | 'search_term';
  targetId: string;
}

export function SchedulesList({ type, targetId }: SchedulesListProps) {
  const { schedules, isLoading, deleteSchedule, toggleSchedule, isDeleting, isToggling } = useSchedules(type, targetId);
  const { activeScrapes } = useActiveScrapes({ targetType: type, targetId });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No schedules configured. Create one to automate scraping.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {schedules.map((schedule) => {
        const isRunningNow = activeScrapes && activeScrapes.length > 0;
        return (
          <Card key={schedule.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    {isRunningNow ? (
                      <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Running Now
                      </Badge>
                    ) : schedule.is_active ? (
                      <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <Pause className="h-3 w-3 mr-1" />
                        Paused
                      </Badge>
                    )}
                    <span className="text-sm font-medium capitalize">
                      {schedule.frequency_type}
                    </span>
                    {schedule.consecutive_failures > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        <XCircle className="h-3 w-3 mr-1" />
                        {schedule.consecutive_failures} failures
                      </Badge>
                    )}
                  </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>Next run: {format(new Date(schedule.next_run_at), 'MMM d, HH:mm')}</span>
                  </div>
                  {schedule.last_run_at && (
                    <span>
                      Last run: {formatDistanceToNow(new Date(schedule.last_run_at))} ago
                      {schedule.consecutive_failures === 0 ? ' • Success' : ' • Failed'}
                    </span>
                  )}
                </div>

                {schedule.cron_expression && (
                  <div className="text-xs text-muted-foreground font-mono">
                    Cron: {schedule.cron_expression}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSchedule(schedule.id, schedule.is_active)}
                  disabled={isToggling}
                >
                  {schedule.is_active ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteSchedule(schedule.id)}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
      })}
    </div>
  );
}
