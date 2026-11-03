import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Mail, AlertTriangle, Settings2, ExternalLink } from "lucide-react";
import { useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { useMailboxAssignments } from "@/hooks/useMailboxAssignments";
import { useMailboxSets, type MailboxSet } from "@/hooks/useMailboxSets";
import { MailboxPickerSheet } from "@/components/email/picker/MailboxPickerSheet";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { isMailboxUnhealthy } from "@/lib/mailbox-status";

interface MailboxPoolSummaryProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Sequence being edited — excluded from "in use by another sequence". */
  excludeSequenceId?: string;
}

const isUnhealthy = isMailboxUnhealthy;

export function MailboxPoolSummary({
  selectedIds,
  onChange,
  excludeSequenceId,
}: MailboxPoolSummaryProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const {
    data: mailboxes = [],
    isPending,
    isError,
    refetch,
  } = useEmailMailboxes();
  const {
    data: assignmentMap,
    isPending: assignmentsPending,
    isError: assignmentsError,
    refetch: refetchAssignments,
  } = useMailboxAssignments();
  const { data: sets = [] } = useMailboxSets();

  // Healthy mailboxes not yet in this pool and not sending for another ACTIVE
  // campaign — i.e. idle capacity this sequence could claim in one click.
  const availableMailboxes = useMemo(
    () =>
      mailboxes.filter((m) => {
        if (
          !assignmentMap ||
          assignmentsError ||
          assignmentsPending ||
          isUnhealthy(m)
        )
          return false;
        if (selectedIds.includes(m.id)) return false;
        const assignments = assignmentMap?.get(m.id) ?? [];
        return !assignments.some(
          (a) => a.status === "active" && a.sequenceId !== excludeSequenceId,
        );
      }),
    [
      mailboxes,
      selectedIds,
      assignmentMap,
      assignmentsError,
      assignmentsPending,
      excludeSequenceId,
    ],
  );
  const availableCapacity = availableMailboxes.reduce(
    (s, m) => s + (m.daily_limit || 0),
    0,
  );
  const addAllAvailable = () =>
    onChange(
      Array.from(
        new Set([...selectedIds, ...availableMailboxes.map((m) => m.id)]),
      ),
    );

  const selected = useMemo(
    () => mailboxes.filter((m) => selectedIds.includes(m.id)),
    [mailboxes, selectedIds],
  );

  const totalCapacity = selected.reduce((s, m) => s + (m.daily_limit || 0), 0);
  const totalSent = selected.reduce((s, m) => s + (m.daily_sent || 0), 0);
  const utilization =
    totalCapacity > 0 ? Math.min(100, (totalSent / totalCapacity) * 100) : 0;

  const unhealthy = selected.filter(isUnhealthy);
  const workspaces = new Set(
    selected
      .map(
        (m) =>
          (m.metadata as Record<string, unknown> | null)
            ?.zapmail_workspace_name as string | undefined,
      )
      .filter(Boolean),
  );
  const domains = new Set(
    selected.map((m) => m.email_address.split("@")[1]).filter(Boolean),
  );

  const matchingPreset = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const sortedSelected = [...selectedIds].sort().join(",");
    return (
      sets.find(
        (s: MailboxSet) =>
          s.mailbox_ids.length === selectedIds.length &&
          [...s.mailbox_ids].sort().join(",") === sortedSelected,
      ) ?? null
    );
  }, [sets, selectedIds]);

  if (isPending) {
    return (
      <div
        role="status"
        aria-label="Loading manual mailbox pool"
        className="space-y-4 rounded-xl border p-5"
      >
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-32" />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="space-y-3 rounded-xl border p-5">
        <p className="text-sm font-medium">Couldn’t load your mailboxes</p>
        <p className="text-sm text-muted-foreground">
          Try again to choose senders for this sequence.
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
    );
  }

  if (mailboxes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
        <Mail
          className="mx-auto h-6 w-6 text-muted-foreground"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium">Connect your first mailbox</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a sending account to build your sequence’s sender pool.
          </p>
        </div>
        <Button asChild variant="cta" size="sm">
          <Link to="/settings?tab=mailboxes">
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            Connect mailboxes
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-xl border p-4 sm:p-5 space-y-4",
          selectedIds.length === 0
            ? "border-dashed bg-background/40"
            : "bg-background/40",
        )}
      >
        {selectedIds.length === 0 ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-muted p-2.5">
                <Mail
                  className="h-5 w-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div>
                <p className="text-sm font-medium">
                  Choose your sending mailboxes
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {assignmentsPending
                    ? "Checking which mailboxes are available…"
                    : availableMailboxes.length > 0
                      ? `${availableMailboxes.length} available · ${availableCapacity.toLocaleString()} emails/day of configured capacity.`
                      : `Choose from ${mailboxes.length} connected mailbox${mailboxes.length === 1 ? "" : "es"}.`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {availableMailboxes.length > 0 && (
                <Button
                  type="button"
                  variant="cta"
                  size="sm"
                  onClick={addAllAvailable}
                >
                  Use all {availableMailboxes.length} available
                </Button>
              )}
              <Button
                type="button"
                variant={availableMailboxes.length > 0 ? "outline" : "cta"}
                size="sm"
                onClick={() => setPickerOpen(true)}
              >
                Select mailboxes
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {selectedIds.length}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    mailbox{selectedIds.length !== 1 ? "es" : ""} selected
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{selected.length - unhealthy.length} healthy</span>
                  <span>
                    {domains.size} domain{domains.size !== 1 ? "s" : ""}
                  </span>
                  {workspaces.size > 0 && (
                    <span>
                      {workspaces.size} workspace
                      {workspaces.size !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {matchingPreset && (
                  <Badge
                    variant="secondary"
                    className="max-w-full whitespace-normal break-all text-xs font-normal"
                  >
                    Preset: {matchingPreset.name}
                  </Badge>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
                className="gap-2"
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                Edit sender pool
              </Button>
            </div>

            <div className="space-y-3 rounded-lg bg-muted/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Selected mailboxes’ configured capacity
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {totalCapacity.toLocaleString()}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      emails / day
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Mailbox sends today
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {totalSent.toLocaleString()}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({Math.round(utilization)}%)
                    </span>
                  </p>
                </div>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Selected mailbox daily capacity used across sequences"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(utilization)}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    utilization > 90
                      ? "bg-orange-500"
                      : utilization > 70
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                  style={{ width: `${utilization}%` }}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Mailbox usage is shared across all sequences in your
                organization. Actual sends also respect this sequence’s daily
                sending limit and mailbox availability.
              </p>
            </div>

            {availableMailboxes.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {availableMailboxes.length} more available
                  </span>{" "}
                  · +{availableCapacity.toLocaleString()} emails/day configured
                  capacity
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAllAvailable}
                >
                  Add all available
                </Button>
              </div>
            )}
            {unhealthy.length > 0 && (
              <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {unhealthy.length} selected mailbox
                    {unhealthy.length !== 1 ? "es" : ""} will be skipped
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Disconnected, paused, or unhealthy. Review their status
                    before sending.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                >
                  Review mailboxes
                </Button>
              </div>
            )}
          </>
        )}
        {assignmentsError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
          >
            <p className="text-xs text-muted-foreground">
              Couldn’t check mailbox assignments. You can still choose senders
              manually.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchAssignments()}
            >
              Retry assignments
            </Button>
          </div>
        )}
      </div>
      <MailboxPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="multi"
        selectedIds={selectedIds}
        onChange={onChange}
        title="Select sender pool"
        description="Emails rotate across these mailboxes, subject to sequence and mailbox sending limits."
        excludeSequenceId={excludeSequenceId}
      />
    </div>
  );
}
