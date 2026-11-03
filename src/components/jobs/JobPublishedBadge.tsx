import { useJobPublishedCounts } from "@/hooks/usePublishedCounts";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobPublishedBadgeProps {
  jobId: string;
}

export function JobPublishedBadge({ jobId }: JobPublishedBadgeProps) {
  const { data } = useJobPublishedCounts(jobId);

  if (!data || (data.totalPublished === 0 && data.totalScheduled === 0)) {
    return null;
  }

  const { publishedOutputs, totalPublished, totalScheduled } = data;
  const total = totalPublished + totalScheduled;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "gap-1 font-normal text-xs px-2 py-0.5",
              totalPublished > 0 && totalScheduled === 0
                ? "bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400"
                : totalScheduled > 0 && totalPublished === 0
                ? "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400"
                : "bg-primary/10 text-primary border-primary/30"
            )}
          >
            {totalPublished > 0 && totalScheduled === 0 ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : totalScheduled > 0 && totalPublished === 0 ? (
              <Clock className="h-3 w-3" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            <span>
              {publishedOutputs} published
            </span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>{publishedOutputs} content piece{publishedOutputs !== 1 ? 's' : ''} pushed to social media</p>
          {totalPublished > 0 && <p className="text-muted-foreground">{totalPublished} live post{totalPublished !== 1 ? 's' : ''}</p>}
          {totalScheduled > 0 && <p className="text-muted-foreground">{totalScheduled} scheduled post{totalScheduled !== 1 ? 's' : ''}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
