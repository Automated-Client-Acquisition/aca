import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number | React.ReactNode;
  icon: LucideIcon;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, className }: StatCardProps) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-lg border border-border bg-card p-6 hover:shadow-md transition-all duration-200",
      className
    )}>
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
