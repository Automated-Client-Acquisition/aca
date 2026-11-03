import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface JobProgressBarProps {
  completed: number;
  total: number;
  failed: number;
  className?: string;
}

export function JobProgressBar({ completed, total, failed, className }: JobProgressBarProps) {
  const processed = completed + failed;
  const percentage = total > 0 ? (processed / total) * 100 : 0;
  const hasFailed = failed > 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress
        value={percentage}
        className={cn(
          "h-2 flex-1",
          hasFailed && "[&>div]:bg-destructive"
        )}
      />
      <span className={cn(
        "text-xs font-medium min-w-[3ch]",
        hasFailed ? "text-destructive" : "text-muted-foreground"
      )}>
        {percentage.toFixed(0)}%
      </span>
      {hasFailed && (
        <span className="text-xs text-destructive">
          ({failed} failed)
        </span>
      )}
    </div>
  );
}
