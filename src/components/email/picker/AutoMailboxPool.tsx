import { useId, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  AlertTriangle,
  Zap,
  Hand,
  Search,
  Info,
} from "lucide-react";
import { useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { useEmailFleetDemand } from "@/hooks/useEmailFleetDemand";
import { FleetDemandView } from "@/components/email/FleetDemandNotice";
import { summarizePool } from "@/lib/fleet-demand";
import {
  isStillWarming,
  MIN_POOL_HEALTH_SCORE,
  WARMUP_GRADUATION_DAY,
} from "@/lib/mailbox-status";
import { cn } from "@/lib/utils";
import type { MailboxSelectionConfig, EmailMailbox } from "@/types/email";

interface AutoMailboxPoolProps {
  config: MailboxSelectionConfig;
  onChange: (config: MailboxSelectionConfig) => void;
  /** Left out of the competing sequences; omit for a sequence not yet created. */
  sequenceId?: string;
}

const TARGET_PRESETS = [250, 500, 1000, 2500];
/** Above this many distinct tags the chip list gets a filter box. */
const TAG_SEARCH_THRESHOLD = 12;

const fmt = (n: number) => n.toLocaleString();

/**
 * Auto pool rule editor + live eligibility preview.
 *
 * The preview runs the same filter as the sender (mailbox-pool.ts): ready,
 * healthy, connected, sendable domain, graduated from warmup, tag-matched. The number shown
 * here is the number of inboxes rotation will actually receive — never an
 * optimistic count that quietly shrinks at send time.
 */
export function AutoMailboxPool({
  config,
  onChange,
  sequenceId,
}: AutoMailboxPoolProps) {
  const {
    data: mailboxes = [],
    isPending,
    isError,
    refetch,
  } = useEmailMailboxes();
  // Pools are shared: other active sequences draw on the same inboxes, so this
  // sequence's own capacity says nothing about whether the fleet is full.
  const { data: fleetDemand } = useEmailFleetDemand({
    tags: config.tags,
    tagMatch: config.tag_match,
    sequenceId,
    enabled: config.mode === "auto",
  });
  const targetId = useId();
  const tagSearchId = useId();
  const [tagQuery, setTagQuery] = useState("");

  const set = (patch: Partial<MailboxSelectionConfig>) =>
    onChange({ ...config, ...patch });

  // fetchEligibleMailboxes in mailbox-pool.ts: ready, connected, above the
  // health floor, and not on a domain the sender has stopped using. Until the
  // blocked list loads this fails open, as the sender does.
  const blockedDomains = useMemo(
    () => new Set(fleetDemand?.blocked_domain_ids ?? []),
    [fleetDemand],
  );
  const connected = useMemo(
    () =>
      mailboxes.filter(
        (m) =>
          m.status === "ready" &&
          m.imap_connected &&
          (m.health_score ?? 0) >= MIN_POOL_HEALTH_SCORE,
      ),
    [mailboxes],
  );
  const blockedCount = useMemo(
    () =>
      connected.filter(
        (m) => m.sending_domain_id && blockedDomains.has(m.sending_domain_id),
      ).length,
    [connected, blockedDomains],
  );
  const healthy = useMemo(
    () =>
      connected.filter(
        (m) => !m.sending_domain_id || !blockedDomains.has(m.sending_domain_id),
      ),
    [connected, blockedDomains],
  );
  const warmingCount = useMemo(
    () => healthy.filter((m) => isStillWarming(m)).length,
    [healthy],
  );
  const sendable = useMemo(
    () => healthy.filter((m) => !isStillWarming(m)),
    [healthy],
  );

  // Every tag in use, with how many sendable inboxes carry it.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of sendable)
      for (const tag of m.tags ?? [])
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [sendable]);

  // Memoised so the `?? []` fallback doesn't mint a new array each render and
  // re-run every downstream useMemo.
  const selectedTags = useMemo(() => config.tags ?? [], [config.tags]);

  const eligible = useMemo(() => {
    if (selectedTags.length === 0) return sendable;
    return sendable.filter((m) => {
      const tags = m.tags ?? [];
      return config.tag_match === "all"
        ? selectedTags.every((t) => tags.includes(t))
        : selectedTags.some((t) => tags.includes(t));
    });
  }, [sendable, selectedTags, config.tag_match]);

  const capacityOf = (list: EmailMailbox[]) =>
    list.reduce((sum, m) => sum + (m.daily_limit || 0), 0);
  const eligibleCapacity = capacityOf(eligible);
  const target =
    config.daily_target && config.daily_target > 0 ? config.daily_target : null;

  // What the worker would actually take, healthiest first.
  const allocated = useMemo(() => {
    if (target === null) return eligible;
    const sorted = [...eligible].sort(
      (a, b) => (b.health_score || 0) - (a.health_score || 0),
    );
    const taken: EmailMailbox[] = [];
    let running = 0;
    for (const m of sorted) {
      if (running >= target) break;
      taken.push(m);
      running += m.daily_limit || 0;
    }
    return taken;
  }, [eligible, target]);

  const allocatedCapacity = capacityOf(allocated);
  const shortfall =
    target !== null && allocatedCapacity < target
      ? target - allocatedCapacity
      : 0;
  const spare = eligibleCapacity - allocatedCapacity;
  const empty = eligible.length === 0;
  const fleetSummary = fleetDemand
    ? summarizePool(fleetDemand, target)
    : null;

  const visibleTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return tagCounts;
    return tagCounts.filter(([tag]) => tag.toLowerCase().includes(q));
  }, [tagCounts, tagQuery]);

  const toggleTag = (tag: string) =>
    set({
      tags: selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag],
    });

  return (
    <div className="space-y-4">
      <ModeSwitch mode={config.mode} onSelect={(mode) => set({ mode })} />

      {config.mode === "auto" &&
        (isPending ? (
          <div
            role="status"
            aria-label="Loading automatic mailbox pool"
            className="space-y-4 rounded-xl border p-5"
          >
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError ? (
          <div role="alert" className="space-y-3 rounded-xl border p-5">
            <p className="text-sm font-medium">Couldn’t load your mailboxes</p>
            <p className="text-sm text-muted-foreground">
              Try again to see eligible senders and their capacity.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-6 rounded-xl border bg-background/40 p-4 sm:p-5">
            <section className="space-y-3">
              <div>
                <Label htmlFor={targetId} className="text-sm font-medium">
                  Automatic pool daily target
                </Label>
                <p
                  id={`${targetId}-help`}
                  className="mt-1 text-sm leading-relaxed text-muted-foreground"
                >
                  We select enough eligible mailboxes to cover this volume,
                  starting with the healthiest. Actual sends also respect the
                  sequence’s daily sending limit and each mailbox’s remaining
                  capacity.
                </p>
              </div>
              <div className="relative max-w-sm">
                <Input
                  id={targetId}
                  aria-describedby={`${targetId}-help`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="Use all eligible mailboxes"
                  value={config.daily_target ?? ""}
                  onChange={(e) =>
                    set({
                      daily_target:
                        e.target.value === ""
                          ? null
                          : Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="h-10 pr-24 tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  emails / day
                </span>
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Automatic pool target presets"
              >
                {TARGET_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={config.daily_target === preset}
                    className={cn(
                      "h-8 px-3 text-xs tabular-nums",
                      config.daily_target === preset &&
                        "border-amber-500/50 bg-amber-500/10",
                    )}
                    onClick={() => set({ daily_target: preset })}
                  >
                    {fmt(preset)}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={!config.daily_target}
                  className={cn(
                    "h-8 px-3 text-xs",
                    !config.daily_target &&
                      "border-amber-500/50 bg-amber-500/10",
                  )}
                  onClick={() => set({ daily_target: null })}
                >
                  Use all
                </Button>
              </div>
            </section>

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h5 className="text-sm font-medium">Mailbox tags</h5>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Keep offers on separate senders. Leave tags empty to include
                    every eligible mailbox.
                  </p>
                </div>
                {selectedTags.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => set({ tags: [] })}
                  >
                    Clear tags
                  </Button>
                )}
              </div>
              {tagCounts.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm leading-relaxed text-muted-foreground">
                  No eligible mailboxes have tags. Manage tags in Settings →
                  Mailboxes.
                </p>
              ) : (
                <>
                  {tagCounts.length > TAG_SEARCH_THRESHOLD && (
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id={tagSearchId}
                        aria-label="Filter automatic pool mailbox tags"
                        value={tagQuery}
                        onChange={(e) => setTagQuery(e.target.value)}
                        placeholder={`Filter ${tagCounts.length} tags`}
                        className="h-9 pl-9"
                      />
                    </div>
                  )}
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Mailbox tag restrictions"
                  >
                    {visibleTags.map(([tag, count]) => {
                      const on = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${tag}, ${count} eligible mailboxes`}
                          onClick={() => toggleTag(tag)}
                          className={cn(
                            "inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on
                              ? "border-amber-500/50 bg-amber-500/10"
                              : "hover:bg-muted/60",
                          )}
                        >
                          {on && (
                            <CheckCircle2
                              className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                              aria-hidden="true"
                            />
                          )}
                          <span className="break-all text-left">{tag}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                    {visibleTags.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No tags match “{tagQuery}”.
                      </p>
                    )}
                  </div>
                  {selectedTags.length > 1 && (
                    <div
                      className="flex flex-wrap items-center gap-2"
                      role="group"
                      aria-label="Mailbox tag matching"
                    >
                      <span className="text-xs text-muted-foreground">
                        Include mailboxes matching
                      </span>
                      {(["any", "all"] as const).map((mode) => (
                        <Button
                          key={mode}
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-pressed={config.tag_match === mode}
                          className={cn(
                            "h-8 px-3 text-xs",
                            config.tag_match === mode &&
                              "border-amber-500/50 bg-amber-500/10",
                          )}
                          onClick={() => set({ tag_match: mode })}
                        >
                          {mode === "any"
                            ? "Any selected tag"
                            : "All selected tags"}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            <section
              className="space-y-3 border-t pt-5"
              aria-label="Automatic pool preview"
            >
              <h5 className="text-sm font-medium">Current sender pool</h5>
              {empty ? (
                <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">No eligible mailboxes</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      Widen your tag selection or review mailbox connections and
                      warmup. Sending needs at least one eligible mailbox.
                    </p>
                  </div>
                </div>
              ) : (
                <CapacityMeter
                  allocatedCount={allocated.length}
                  eligibleCount={eligible.length}
                  allocatedCapacity={allocatedCapacity}
                  eligibleCapacity={eligibleCapacity}
                  target={target}
                  shortfall={shortfall}
                  spare={spare}
                  fleetOversubscribed={fleetSummary?.oversubscribed ?? false}
                />
              )}
              {!empty && fleetSummary && (
                <FleetDemandView
                  summary={fleetSummary}
                  scope={selectedTags.length > 0 ? "tagged" : "fleet"}
                  variant="inline"
                />
              )}
              {warmingCount > 0 && (
                <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <p>
                    {fmt(warmingCount)} healthy mailbox
                    {warmingCount === 1 ? " is" : "es are"} still warming and
                    excluded until day {WARMUP_GRADUATION_DAY} with sufficient
                    delivery health. Review progress in Settings → Mailboxes.
                  </p>
                </div>
              )}
              {blockedCount > 0 && (
                <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <p>
                    {fmt(blockedCount)} connected mailbox
                    {blockedCount === 1 ? " is" : "es are"} on sending domains
                    that are paused or can’t send right now, and excluded until
                    the domain can send again. Review them in domain monitoring.
                  </p>
                </div>
              )}
            </section>
          </div>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function CapacityMeter({
  allocatedCount,
  eligibleCount,
  allocatedCapacity,
  eligibleCapacity,
  target,
  shortfall,
  spare,
  fleetOversubscribed,
}: {
  allocatedCount: number;
  eligibleCount: number;
  allocatedCapacity: number;
  eligibleCapacity: number;
  target: number | null;
  shortfall: number;
  spare: number;
  /** Active sequences together ask for more than these inboxes can send. */
  fleetOversubscribed: boolean;
}) {
  const short = shortfall > 0;
  const shared = fleetOversubscribed;
  // With a target the bar reads as progress toward it; without one the pool is
  // everything eligible, so it is full by definition.
  const denominator = target ?? eligibleCapacity;
  const pct =
    denominator > 0
      ? Math.min(100, (allocatedCapacity / denominator) * 100)
      : 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        short || shared
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-emerald-500/25 bg-emerald-500/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <span className="block text-2xl font-semibold leading-none tabular-nums">
            {fmt(allocatedCapacity)}
          </span>
          <span className="text-xs text-muted-foreground">
            Pool capacity / day{target !== null && ` · target ${fmt(target)}`}
          </span>
        </div>
        {short ? (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs"
          >
            Short {fmt(shortfall)}/day
          </Badge>
        ) : shared ? (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs"
          >
            Shared with other sequences
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-green-500/30 bg-green-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-xs"
          >
            <CheckCircle2 className="h-3 w-3" />
            {target === null ? "Pool available" : "Target covered"}
          </Badge>
        )}
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Automatic pool capacity coverage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            short ? "bg-amber-400" : "bg-green-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">
          {fmt(allocatedCount)} of {fmt(eligibleCount)} inbox
          {eligibleCount === 1 ? "" : "es"}
        </span>{" "}
        allocated
        {short ? (
          <>
            {" "}
            — every eligible inbox is already in. Tag more inboxes, or raise
            their daily limits.
          </>
        ) : shared ? (
          <> · other active sequences send from these same inboxes.</>
        ) : spare > 0 ? (
          <> · {fmt(spare)}/day spare capacity held in reserve.</>
        ) : (
          <> · using the full eligible pool.</>
        )}
        <br />
        Capacity is an estimate, not a send count. The pool is refreshed every
        send cycle.
      </p>
    </div>
  );
}

function ModeSwitch({
  mode,
  onSelect,
}: {
  mode: MailboxSelectionConfig["mode"];
  onSelect: (mode: "manual" | "auto") => void;
}) {
  const options = [
    {
      value: "auto" as const,
      icon: Zap,
      title: "Automatic selection",
      description:
        "Choose healthy senders for your target. The pool adapts as mailboxes recover.",
    },
    {
      value: "manual" as const,
      icon: Hand,
      title: "Manual selection",
      description:
        "Choose specific mailboxes and saved pools. You control which senders are included.",
    },
  ];

  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      role="group"
      aria-label="Sender selection mode"
    >
      {options.map(({ value, icon: Icon, title, description }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            aria-pressed={active}
            aria-label={title}
            className={cn(
              "group min-w-0 rounded-xl border p-4 text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-amber-500/50 bg-amber-500/5 shadow-sm"
                : "border-border hover:border-border/80 hover:bg-muted/40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Icon
                className={cn(
                  "h-3.5 w-3.5 transition-colors",
                  active
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              />
              <span className="flex-1 text-sm font-medium">{title}</span>
              {active && (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
