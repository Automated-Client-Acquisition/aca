import { Users, MessageSquare, TrendingUp, Clock, LinkIcon, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type LeadStats } from "@/hooks/leads/useLeadsSync";

interface LeadsHeaderProps {
  stats: LeadStats | undefined;
  isLoading: boolean;
}

export function LeadsHeader({ stats, isLoading }: LeadsHeaderProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 flex-wrap flex-1">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border bg-card">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-6 w-8" />
          </div>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      label: "Total Leads",
      value: stats?.total_leads ?? 0,
      icon: Users,
      color: "text-blue-500 dark:text-blue-400",
      iconBg: "bg-blue-500/10 dark:bg-blue-400/10",
    },
    {
      label: "CRM synced",
      value: stats?.synced_count ?? 0,
      icon: LinkIcon,
      color: "text-green-500 dark:text-green-400",
      iconBg: "bg-green-500/10 dark:bg-green-400/10",
    },
    {
      label: "Awaiting",
      value: stats?.by_status?.awaiting_connection ?? 0,
      icon: Clock,
      color: "text-amber-500 dark:text-amber-400",
      iconBg: "bg-amber-500/10 dark:bg-amber-400/10",
    },
    {
      label: "DM Sent",
      value: stats?.by_status?.dm_sent ?? 0,
      icon: MessageSquare,
      color: "text-emerald-500 dark:text-emerald-400",
      iconBg: "bg-emerald-500/10 dark:bg-emerald-400/10",
    },
    {
      label: "Failed",
      value: stats?.by_status?.dm_failed ?? 0,
      icon: AlertTriangle,
      color: "text-red-500 dark:text-red-400",
      iconBg: "bg-red-500/10 dark:bg-red-400/10",
    },
    {
      label: "Replied",
      value: stats?.by_status?.replied ?? 0,
      icon: TrendingUp,
      color: "text-violet-500 dark:text-violet-400",
      iconBg: "bg-violet-500/10 dark:bg-violet-400/10",
    },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap flex-1">
      {statCards.map((stat) => (
        <div
          key={stat.label}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border bg-card hover:bg-accent/40 transition-colors"
        >
          <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", stat.iconBg)}>
            <stat.icon className={cn("h-3.5 w-3.5", stat.color)} />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {stat.label}
            </span>
            <span className={cn("text-lg font-bold leading-none", stat.color)}>
              {stat.value.toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
