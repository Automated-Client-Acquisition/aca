import { useEffect, useState } from "react";
import { formatDistanceToNow, format, isTomorrow, isToday, addDays } from "date-fns";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface NextScrapeIndicatorProps {
  nextRunAt: string;
  frequency?: string;
  className?: string;
  showIcon?: boolean;
}

export function NextScrapeIndicator({ 
  nextRunAt, 
  frequency, 
  className,
  showIcon = true 
}: NextScrapeIndicatorProps) {
  const [timeText, setTimeText] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const date = new Date(nextRunAt);
      const now = new Date();
      
      if (date < now) {
        setTimeText("Overdue");
        return;
      }

      if (isToday(date)) {
        setTimeText(`Today at ${format(date, 'HH:mm')}`);
      } else if (isTomorrow(date)) {
        setTimeText(`Tomorrow at ${format(date, 'HH:mm')}`);
      } else if (date < addDays(now, 7)) {
        setTimeText(`${format(date, 'EEEE')} at ${format(date, 'HH:mm')}`);
      } else {
        setTimeText(`in ${formatDistanceToNow(date)}`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [nextRunAt]);

  return (
    <div className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
      {showIcon && <Clock className="h-3.5 w-3.5" />}
      <span>Next: {timeText}</span>
    </div>
  );
}
