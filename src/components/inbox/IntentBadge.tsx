import { cn } from "@/lib/utils";
import {
  ThumbsUp,
  ThumbsDown,
  Calendar,
  Clock,
  Bot,
  Ban,
  Minus,
  UserMinus,
} from "lucide-react";
import type { LeadIntent } from "@/types/classification";

const intentConfig: Record<
  LeadIntent,
  { label: string; className: string; icon: React.ElementType }
> = {
  interested: {
    label: "Interested",
    className: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
    icon: ThumbsUp,
  },
  meeting_booked: {
    label: "Meeting",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    icon: Calendar,
  },
  not_interested: {
    label: "Not Interested",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
    icon: ThumbsDown,
  },
  out_of_office: {
    label: "OOO",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
    icon: Clock,
  },
  auto_reply: {
    label: "Auto",
    className: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
    icon: Bot,
  },
  do_not_contact: {
    label: "DNC",
    className: "bg-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-300",
    icon: Ban,
  },
  neutral: {
    label: "Neutral",
    className: "bg-gray-50 text-gray-500 dark:bg-gray-800/30 dark:text-gray-500",
    icon: Minus,
  },
  unsubscribe: {
    label: "Unsub",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
    icon: UserMinus,
  },
};

interface IntentBadgeProps {
  intent: string;
  className?: string;
  showIcon?: boolean;
}

export function IntentBadge({
  intent,
  className,
  showIcon = true,
}: IntentBadgeProps) {
  const config = intentConfig[intent as LeadIntent];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
        config.className,
        className
      )}
    >
      {showIcon && <Icon className="h-2.5 w-2.5" />}
      {config.label}
    </span>
  );
}
