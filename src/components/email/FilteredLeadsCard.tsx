import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCount, formatRate, share } from "@/components/email/analytics/format";

interface FilteredLeadsCardProps {
  /** Filtered (never sent) leads keyed by the filter's reason code. */
  byReason?: Record<string, number>;
  className?: string;
}

const REASON_LABELS: Record<string, string> = {
  unlikely_to_reply: "Low reply score",
  flagged_hostile: "Flagged hostile",
  previous_spam_complaint: "Past spam complaint",
  previously_bounced: "Bounced before",
  unsubscribed: "Unsubscribed",
};

function reasonLabel(reason: string): string {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  const text = reason.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Leads the AI filters held back, so they were never emailed. Hidden when there are none. */
export function FilteredLeadsCard({ byReason, className }: FilteredLeadsCardProps) {
  const entries = Object.entries(byReason ?? {}).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return null;
  const largest = entries[0]?.[1] ?? 1;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Held back before sending</CardTitle>
        <CardDescription>
          {formatCount(total)} {total === 1 ? "lead" : "leads"} skipped by AI filters, so they were never emailed
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {entries.map(([reason, n]) => (
            <li key={reason} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-foreground" title={reason}>
                {reasonLabel(reason)}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("block h-full rounded-full bg-muted-foreground/45")}
                  style={{ width: `${Math.max((n / largest) * 100, 3)}%` }}
                />
              </span>
              <span className="w-20 text-right tabular-nums">
                <span className="font-medium text-foreground">{formatCount(n)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{formatRate(share(n, total))}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
