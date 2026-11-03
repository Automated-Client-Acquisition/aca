import { cn } from "@/lib/utils";
import { HEALTH_LABEL, type HealthStatus } from "@/lib/blueprint-health";

const STYLES: Record<HealthStatus, string> = {
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  needs_setup: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failing: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function BlueprintHealthPill({ status, label, className }: { status: HealthStatus; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        STYLES[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label ?? HEALTH_LABEL[status]}
    </span>
  );
}

export const HEALTH_MESSAGE_STYLES: Record<Exclude<HealthStatus, "ready">, string> = {
  needs_setup: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  failing: "bg-red-500/10 text-red-800 dark:text-red-300",
};
