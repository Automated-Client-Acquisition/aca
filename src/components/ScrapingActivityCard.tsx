import { Card } from "@/components/ui/card";
import { Activity, Calendar, CheckCircle2, Loader2 } from "lucide-react";
import { useScrapingActivity } from "@/hooks/useScrapingActivity";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ScrapingActivityCardProps {
  onClick?: () => void;
  compact?: boolean;
}

export function ScrapingActivityCard({ onClick, compact = false }: ScrapingActivityCardProps) {
  const { activeScrapes, activeSchedulesCount, nextScheduledRun, recentCompletions, isLoading } = useScrapingActivity();

  if (isLoading) {
    return <Skeleton className={compact ? "h-9 w-36 rounded-md" : "h-24 w-64"} />;
  }

  const hasActivity = (activeScrapes || 0) > 0 || (activeSchedulesCount || 0) > 0;

  if (compact) {
    const isActive = (activeScrapes || 0) > 0;
    const status = isActive
      ? `${activeScrapes} collecting`
      : (activeSchedulesCount || 0) > 0
        ? `${activeSchedulesCount} scheduled`
        : "Collection activity";
    const details = [
      `${activeScrapes || 0} active scrapes`,
      `${activeSchedulesCount || 0} scheduled`,
      nextScheduledRun ? `Next in ${formatDistanceToNow(new Date(nextScheduledRun))}` : null,
      `${recentCompletions || 0} completed in the last 24 hours`,
    ].filter(Boolean).join(" · ");

    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        title={details}
        aria-label={`View collection activity: ${details}`}
        className="h-9 shrink-0 gap-2 text-xs font-medium"
      >
        {isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
        ) : (
          <Activity className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{status}</span>
        <span className="sm:hidden">{isActive ? activeScrapes : activeSchedulesCount || 0}</span>
      </Button>
    );
  }

  return (
    <Card 
      className={cn(
        "p-4 transition-all hover:shadow-md border-border/50",
        onClick && "cursor-pointer hover:border-foreground/20"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
          <Activity className={cn("w-5 h-5", (activeScrapes || 0) > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground")} />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            Scraping
            {(activeScrapes || 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Live
              </span>
            )}
          </h3>
          
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {(activeScrapes || 0) > 0 ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 text-blue-600 dark:text-blue-400 animate-spin" />
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  {activeScrapes} active scrape{activeScrapes !== 1 ? 's' : ''}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span>No active scrapes</span>
              </div>
            )}
            
            {(activeSchedulesCount || 0) > 0 && nextScheduledRun && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                <span>
                  {activeSchedulesCount} scheduled • Next in {formatDistanceToNow(new Date(nextScheduledRun))}
                </span>
              </div>
            )}
            
            {(recentCompletions || 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                <span>{recentCompletions} completed (24h)</span>
              </div>
            )}
            
            {!hasActivity && (recentCompletions || 0) === 0 && (
              <div className="text-muted-foreground">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
