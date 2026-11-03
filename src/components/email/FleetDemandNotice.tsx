import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEmailFleetDemand } from "@/hooks/useEmailFleetDemand";
import {
  summarizeFleet,
  summarizePool,
  type FleetDemandLine,
  type FleetDemandSummary,
} from "@/lib/fleet-demand";
import { cn } from "@/lib/utils";
import type { MailboxSelectionConfig } from "@/types/email";

const fmt = (n: number) => n.toLocaleString();
/** Longer competitor lists collapse behind "Show all". */
const VISIBLE_LINES = 6;

type Variant = "inline" | "banner";

/**
 * Fleet capacity vs demand for one auto-mode sequence: its own pool (by tag
 * rule), its own live daily limit, and the active sequences sharing those
 * mailboxes.
 */
export function SequenceFleetNotice({
  sequenceId,
  selection,
  ownLimit,
  variant,
  className,
}: {
  sequenceId?: string | null;
  selection: MailboxSelectionConfig;
  /** Live daily limit. null = no limit. */
  ownLimit: number | null;
  variant: Variant;
  className?: string;
}) {
  const tags = (selection.tags ?? []).filter(Boolean);
  const { data } = useEmailFleetDemand({
    tags,
    tagMatch: selection.tag_match,
    sequenceId,
    enabled: selection.mode === "auto",
  });
  if (selection.mode !== "auto" || !data) return null;

  return (
    <FleetDemandView
      summary={summarizePool(data, ownLimit)}
      scope={tags.length > 0 ? "tagged" : "fleet"}
      variant={variant}
      className={className}
    />
  );
}

/** Org-wide: the whole fleet against every active auto sequence. */
export function OrgFleetNotice({ className }: { className?: string }) {
  const { data } = useEmailFleetDemand();
  if (!data || data.sequences.length === 0) return null;

  return (
    <FleetDemandView
      summary={summarizeFleet(data)}
      scope="org"
      variant="banner"
      className={className}
    />
  );
}

export function FleetDemandView({
  summary,
  scope,
  variant,
  className,
}: {
  summary: FleetDemandSummary;
  scope: "fleet" | "tagged" | "org";
  variant: Variant;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const over = summary.oversubscribed;
  const poolLabel = scope === "tagged" ? "Tagged pool" : "Fleet";
  const askLabel =
    scope === "tagged"
      ? "Active sequences on it ask for"
      : "Active sequences ask for";

  const headline = (
    <p className="text-sm tabular-nums">
      <span className="font-medium">
        {poolLabel}: {fmt(summary.capacity)}/day
      </span>
      <span className="text-muted-foreground"> · </span>
      <span className={cn(over && "font-medium")}>
        {askLabel} {fmt(summary.asked)}/day
      </span>
    </p>
  );

  const sentLine = (
    <p className="text-xs text-muted-foreground tabular-nums">
      {fmt(summary.sentToday)} sent from these mailboxes since 00:00 UTC, when
      mailbox daily limits reset.
    </p>
  );

  if (!over) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border px-4 py-3",
          variant === "banner" ? "bg-muted/30" : "bg-background/40",
          className,
        )}
      >
        <Inbox
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-0.5">
          {headline}
          {sentLine}
        </div>
      </div>
    );
  }

  const lines = expanded
    ? summary.lines
    : summary.lines.slice(0, VISIBLE_LINES);
  const hidden = summary.lines.length - lines.length;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3",
        className,
      )}
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          {headline}
          <p className="text-sm leading-relaxed text-muted-foreground">
            The {scope === "tagged" ? "pool" : "fleet"} is over capacity by{" "}
            <span className="font-medium text-foreground tabular-nums">
              {fmt(summary.overBy)}/day
            </span>
            . These sequences share the same mailboxes. Once every mailbox
            reaches its daily limit, the remaining leads stay queued, show as
            skipped (no mailbox available), and retry automatically.
            {scope === "org"
              ? " "
              : " This is a capacity limit, not a problem with this sequence. "}
            To send more, add mailboxes or lower{" "}
            {scope === "org" ? "some sequences'" : "other sequences'"} daily
            limits.
          </p>
        </div>

        <ul
          className="divide-y rounded-md border bg-background/60 text-sm"
          aria-label="Sequences drawing on these mailboxes"
        >
          {lines.map((line) => (
            <DemandRow key={line.id ?? "self"} line={line} />
          ))}
        </ul>
        {hidden > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setExpanded(true)}
          >
            Show {hidden} more
          </Button>
        )}
        {sentLine}
      </div>
    </div>
  );
}

function DemandRow({ line }: { line: FleetDemandLine }) {
  const note =
    line.due !== null
      ? `${fmt(line.due)} due${line.limit !== null ? ` of ${fmt(line.limit)} limit` : ""}`
      : line.limit === null
        ? "no daily limit"
        : null;

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        {line.id ? (
          <Link
            to={`/email/sequences/${line.id}`}
            className="block truncate underline-offset-4 hover:underline"
          >
            {line.name}
          </Link>
        ) : (
          <span className="block truncate font-medium">{line.name}</span>
        )}
        {note && (
          <span className="block text-xs text-muted-foreground tabular-nums">
            {note}
          </span>
        )}
      </div>
      <span className="shrink-0 text-right tabular-nums">
        {fmt(line.asks)}/day
      </span>
    </li>
  );
}
