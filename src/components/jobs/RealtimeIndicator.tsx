import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RealtimeIndicatorProps {
  isConnected: boolean;
  className?: string;
}

export function RealtimeIndicator({ isConnected, className }: RealtimeIndicatorProps) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (isConnected) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  // When connected, show minimal dot indicator
  if (isConnected) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("flex items-center", className)}>
              <span className={cn(
                "h-2 w-2 rounded-full bg-green-500",
                pulse && "animate-pulse"
              )} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Live updates active</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // When disconnected, show more visible indicator
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", className)}>
      <WifiOff className="h-3 w-3 text-amber-500" />
      <span className="text-amber-600 dark:text-amber-400">Reconnecting...</span>
    </div>
  );
}
