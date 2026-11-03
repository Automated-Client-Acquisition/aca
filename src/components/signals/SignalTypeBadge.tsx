import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Soft color coding per signal type so tables scan at a glance. */
const TYPE_STYLES: Record<string, string> = {
  funding: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  just_funded: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  just_funded_saas: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  linkedin_post_engagement: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  post_engagement: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  hiring: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  hiring_demand: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  aggressive_hiring: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  executive_hire: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  new_leadership: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  acquisition: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  recent_acquisitions: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  growth: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

export function humanizeSignalType(value: string): string {
  const words = value.replaceAll("_", " ").replace(/\blinkedin\b/gi, "LinkedIn").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SignalTypeBadge({
  type,
  label,
  className,
}: {
  type: string;
  label?: string | null;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-transparent font-medium whitespace-nowrap",
        TYPE_STYLES[type] ?? "",
        className,
      )}
    >
      {label || humanizeSignalType(type)}
    </Badge>
  );
}
