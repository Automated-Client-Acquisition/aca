import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isPast } from "date-fns";

interface PublishedBadgeProps {
  published: number;
  scheduled: number;
  platforms?: string[];
  accountNames?: string[];
  size?: "sm" | "md";
  showDetails?: boolean;
  nextScheduledAt?: string;
  autopilotName?: string;
}

const PLATFORM_ICONS: Record<string, string> = {
  facebook: "FB",
  instagram: "IG",
  linkedin: "LI",
  youtube: "YT",
  tiktok: "TT",
  twitter: "X",
};

export function PublishedBadge({
  published,
  scheduled,
  platforms = [],
  accountNames = [],
  size = "sm",
  showDetails = false,
  nextScheduledAt,
  autopilotName,
}: PublishedBadgeProps) {
  const total = published + scheduled;

  if (total === 0) return null;

  const platformLabels = platforms.map(p => PLATFORM_ICONS[p.toLowerCase()] || p).join(", ");

  const content = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        size === "sm" ? "text-[10px] px-1.5 py-0 h-5" : "text-xs px-2 py-0.5",
        published > 0 && scheduled === 0
          ? "bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400"
          : scheduled > 0 && published === 0
          ? "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400"
          : "bg-primary/10 text-primary border-primary/30 dark:text-primary"
      )}
    >
      {published > 0 && scheduled === 0 ? (
        <CheckCircle2 className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      ) : scheduled > 0 && published === 0 ? (
        <Clock className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      ) : (
        <Send className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      )}
      {showDetails ? (
        <>
          {published > 0 && `${published} published`}
          {published > 0 && scheduled > 0 && ", "}
          {scheduled > 0 && `${scheduled} scheduled`}
        </>
      ) : (
        <span>
          {published > 0 && scheduled > 0
            ? `${published}/${total}`
            : published > 0
            ? published
            : scheduled}
        </span>
      )}
    </Badge>
  );

  // Always show tooltip when there's scheduling info, platforms, or account names
  const hasTooltipContent = platforms.length > 0 || accountNames.length > 0 || nextScheduledAt;

  if (!hasTooltipContent) return content;

  // Format the scheduled time
  const getScheduledTimeDisplay = () => {
    if (!nextScheduledAt) return null;
    const scheduledDate = new Date(nextScheduledAt);
    const isOverdue = isPast(scheduledDate);
    const timeAgo = formatDistanceToNow(scheduledDate, { addSuffix: true });
    const exactTime = format(scheduledDate, "MMM d, h:mm a");

    return {
      timeAgo,
      exactTime,
      isOverdue,
    };
  };

  const scheduledTimeInfo = getScheduledTimeDisplay();

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-xs">
          <p>
            {published > 0 && `${published} published`}
            {published > 0 && scheduled > 0 && ", "}
            {scheduled > 0 && `${scheduled} scheduled`}
          </p>
          {accountNames.length > 0
            ? <p className="text-muted-foreground">{accountNames.join(", ")}</p>
            : platformLabels && <p className="text-muted-foreground">Platforms: {platformLabels}</p>
          }
          {scheduledTimeInfo && (
            <div className="mt-1 pt-1 border-t border-border/50">
              <p className={scheduledTimeInfo.isOverdue ? "text-amber-500" : "text-blue-500"}>
                {scheduledTimeInfo.isOverdue ? "Publishing " : "Scheduled "}
                {scheduledTimeInfo.timeAgo}
              </p>
              <p className="text-muted-foreground">{scheduledTimeInfo.exactTime}</p>
              {autopilotName && (
                <p className="text-muted-foreground">via {autopilotName}</p>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
