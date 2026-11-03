import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SentimentStats } from "@/hooks/useEmailStats";
import type { LeadIntent } from "@/types/classification";
import { formatCount, formatRate, share } from "@/components/email/analytics/format";

type Tone = "positive" | "neutral" | "negative" | "muted";

const ROWS: { key: LeadIntent | "unclassified"; label: string; tone: Tone }[] = [
  { key: "meeting_booked", label: "Meeting booked", tone: "positive" },
  { key: "interested", label: "Interested", tone: "positive" },
  { key: "neutral", label: "Neutral / question", tone: "neutral" },
  { key: "not_interested", label: "Not interested", tone: "negative" },
  { key: "unsubscribe", label: "Unsubscribe", tone: "negative" },
  { key: "do_not_contact", label: "Do not contact", tone: "negative" },
  { key: "unclassified", label: "Not classified yet", tone: "muted" },
];

const TONE_BAR: Record<Tone, string> = {
  positive: "bg-[hsl(var(--status-success))]",
  neutral: "bg-muted-foreground/45",
  negative: "bg-[hsl(var(--status-error)/0.8)]",
  muted: "bg-muted-foreground/25",
};

interface ReplySentimentCardProps {
  stats?: SentimentStats;
  isLoading?: boolean;
  /** Opens the list of out-of-office / auto-reply leads. */
  onShowAutomatic?: () => void;
  /** Render nothing (instead of an empty state) when there are no replies. */
  hideWhenEmpty?: boolean;
  className?: string;
}

/**
 * What the replies said, per the inbox classifier. Counts unique leads that
 * replied, so the rows always sum to the Replies number.
 */
export function ReplySentimentCard({ stats, isLoading, onShowAutomatic, hideWhenEmpty, className }: ReplySentimentCardProps) {
  if (isLoading) {
    return <Skeleton className={cn("h-64", className)} />;
  }

  const total = stats?.total_replies ?? 0;
  const outOfOffice = stats?.out_of_office ?? 0;
  const autoReplied = stats?.auto_replied ?? 0;
  if (total === 0 && outOfOffice + autoReplied === 0 && hideWhenEmpty) return null;

  const count = (key: string) => stats?.by_intent[key as LeadIntent] ?? 0;
  const positive = count("interested") + count("meeting_booked");
  const negative = count("not_interested") + count("unsubscribe") + count("do_not_contact");
  const rows = ROWS.filter((row) => count(row.key) > 0);
  const largest = Math.max(1, ...rows.map((row) => count(row.key)));

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">What replies said</CardTitle>
        <CardDescription>
          {total === 0
            ? "No replies in this period yet"
            : `${formatCount(total)} ${total === 1 ? "reply" : "replies"} · ${formatRate(share(positive, total))} positive · ${formatRate(share(negative, total))} negative`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Replies show up here once the inbox classifies them.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((row) => {
              const n = count(row.key);
              return (
                <li key={row.key} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-foreground">{row.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span
                      className={cn("block h-full rounded-full", TONE_BAR[row.tone])}
                      style={{ width: `${Math.max((n / largest) * 100, 3)}%` }}
                    />
                  </span>
                  <span className="w-20 text-right tabular-nums">
                    <span className="font-medium text-foreground">{formatCount(n)}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">{formatRate(share(n, total))}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {outOfOffice + autoReplied > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kept out of replies</p>
              {onShowAutomatic && (
                <button
                  type="button"
                  onClick={onShowAutomatic}
                  className="rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View leads
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">{formatCount(outOfOffice)}</span> out of office
              </span>
              <span className="text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">{formatCount(autoReplied)}</span> other auto-replies
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
