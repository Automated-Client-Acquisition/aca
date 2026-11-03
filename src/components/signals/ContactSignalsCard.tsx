import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Radar, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalTypeBadge } from "@/components/signals/SignalTypeBadge";
import { useContactSignals } from "@/hooks/useContactSignals";
import type { CrmContact } from "@/hooks/crm/useContacts";

const PREVIEW_COUNT = 3;

const formatAmount = (usd: number) => {
  if (usd >= 1e9) return `$${Number((usd / 1e9).toFixed(1))}B`;
  if (usd >= 1e6) return `$${Number((usd / 1e6).toFixed(1))}M`;
  if (usd >= 1e3) return `$${Number((usd / 1e3).toFixed(0))}K`;
  return `$${usd.toLocaleString()}`;
};

/** Source keys are slugs ("unipile_linkedin_posts") — don't show them raw */
const formatSource = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\blinkedin\b/gi, "LinkedIn")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

const relativeDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDistanceToNow(parsed, { addSuffix: true });
};

/**
 * Buying signals we logged for this contact's company. Matches the quiet
 * label/value language of the other profile cards — badge, one line, source.
 */
export function ContactSignalsCard({ contact }: { contact: CrmContact }) {
  const [expanded, setExpanded] = useState(false);
  const { data: signals, isLoading } = useContactSignals(contact);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radar className="h-4 w-4 text-muted-foreground" />
            Buying Signals
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (!signals || signals.length === 0) return null;

  const visible = expanded ? signals : signals.slice(0, PREVIEW_COUNT);
  const hiddenCount = signals.length - visible.length;

  return (
    <Card>
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Radar className="h-4 w-4 text-muted-foreground" />
          Buying Signals
          <span className="text-xs font-normal text-muted-foreground">({signals.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {visible.map((signal) => {
          const when = relativeDate(signal.signalDate || signal.createdAt);
          const amount = signal.amountUsd ? formatAmount(signal.amountUsd) : null;
          return (
            <div key={signal.id} className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <SignalTypeBadge type={signal.signalType} className="text-xs py-0 px-1.5" />
                {amount && <span className="text-xs font-medium">{amount}</span>}
                {signal.roundInfo && (
                  <span className="text-xs text-muted-foreground">{signal.roundInfo}</span>
                )}
                {when && <span className="text-xs text-muted-foreground ml-auto">{when}</span>}
              </div>
              {signal.detail && (
                <p className="text-xs text-muted-foreground line-clamp-2" title={signal.detail}>
                  {signal.detail}
                </p>
              )}
              {signal.evidenceUrl && (
                <a
                  href={signal.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {signal.sourceName ? formatSource(signal.sourceName) : "Source"}
                </a>
              )}
            </div>
          );
        })}

        {(hiddenCount > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
