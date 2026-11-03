import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";

interface PriorityBadgeProps {
  score: number;
  className?: string;
}

export function PriorityBadge({ score, className }: PriorityBadgeProps) {
  // Low priority: don't render
  if (score < 30) return null;

  // High priority
  if (score >= 60) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
          "bg-red-100 text-red-500 dark:bg-red-950/40 dark:text-red-400",
          className
        )}
      >
        <Flame className="h-2.5 w-2.5" />
        High
      </span>
    );
  }

  // Medium priority
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
        "bg-amber-100 text-amber-500 dark:bg-amber-950/40 dark:text-amber-400",
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
      {score}
    </span>
  );
}
