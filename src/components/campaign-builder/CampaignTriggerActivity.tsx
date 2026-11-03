import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowUpRight,
  Check,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useCampaignTriggerEvents,
  type CampaignTriggerEvent,
} from "@/hooks/useCampaignTriggerEvents";
import { ENTRY_CATALOG, type CampaignEntryRule } from "@/lib/campaign-entry";
import { cn } from "@/lib/utils";

const STATUS_LABELS = {
  pending: "Queued",
  processing: "Checking",
  review: "Needs review",
  enrolled: "Enrolled",
  ignored: "Skipped",
  declined: "Declined",
  error: "Failed",
};

export function CampaignTriggerActivity({
  campaignId,
  rules,
  active,
}: {
  campaignId?: string;
  rules: CampaignEntryRule[];
  active: boolean;
}) {
  const events = useCampaignTriggerEvents(campaignId);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [confirm, setConfirm] = useState<CampaignTriggerEvent | null>(null);
  const rows = events.data ?? [];
  const reviews = rows.filter((event) => event.status === "review");
  const displayed = filter === "review" ? reviews : rows;
  const decide = async (eventId: string, action: "approve" | "ignore") => {
    try {
      await events.decision.mutateAsync({ eventId, action });
      toast.success(
        action === "approve" ? "Approved for processing" : "Event skipped",
      );
      setConfirm(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Decision could not be saved. Try again.",
      );
    }
  };
  if (!campaignId)
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <Activity className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <h3 className="font-medium">Decisions appear here after launch</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Save your campaign and set up a trigger to begin.
        </p>
      </div>
    );
  const confirmRule = rules.find((rule) => rule.id === confirm?.trigger_id);
  const accept = confirm?.event_type === "connection_request";
  return (
    <section aria-label="Trigger activity" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 rounded-lg bg-muted/60 p-1"
          aria-label="Activity filters"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={filter === "all"}
            className={cn(filter === "all" && "bg-background shadow-sm")}
            onClick={() => setFilter("all")}
          >
            All decisions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={filter === "review"}
            className={cn(filter === "review" && "bg-background shadow-sm")}
            onClick={() => setFilter("review")}
          >
            Needs review{" "}
            <span className="ml-2 tabular-nums">{reviews.length}</span>
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={events.isFetching}
          onClick={() => void events.refetch()}
        >
          <RefreshCw
            className={cn(
              "mr-2 h-3.5 w-3.5",
              events.isFetching && "animate-spin",
            )}
          />
          Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Latest 50 events. Each person enters a campaign once.{" "}
        {active ? "" : "Processing is paused until this campaign is active."}
      </p>
      {events.isLoading ? (
        <Skeleton className="h-36 w-full" />
      ) : events.error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 p-5"
        >
          <p className="text-sm">Trigger activity could not be loaded.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            If this feature was just installed, its database migration must be
            applied first.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void events.refetch()}
          >
            Retry activity
          </Button>
        </div>
      ) : !displayed.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <ShieldCheck className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <h3 className="font-medium">
            {filter === "review"
              ? "No decisions waiting for you"
              : "Waiting for the first matching event"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {filter === "review"
              ? "People with missing ICP information or a review policy appear here."
              : "Incoming events will show the qualification score, outcome, and reason here."}
          </p>
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {displayed.map((event) => {
            const rule = rules.find((item) => item.id === event.trigger_id);
            const actionable =
              active && rule?.enabled && event.status === "review" && events.canReview;
            const label =
              event.event_type === "connection_request"
                ? "Accept & enroll"
                : "Approve enrollment";
            return (
              <article
                key={event.id}
                className="flex flex-wrap items-start gap-4 p-4 sm:p-5"
              >
                <div className="min-w-0 flex-1 basis-52">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Link
                      to={`/contacts/${event.contact_id}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
                    >
                      {event.context?.name || "View contact"}
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-normal",
                        event.status === "review" &&
                          "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
                        event.status === "enrolled" &&
                          "text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {STATUS_LABELS[event.status]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rule?.name ||
                      ENTRY_CATALOG[event.event_type]?.title ||
                      "Removed trigger"}{" "}
                    ·{" "}
                    {formatDistanceToNow(new Date(event.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                  {event.event_type === "list_member_added" && event.context?.listName && (
                    <p className="mt-2 break-words text-xs text-muted-foreground">
                      Added to {event.context.listName}
                    </p>
                  )}
                  {event.context?.text && (
                    <p className="mt-3 line-clamp-2 break-words text-sm text-muted-foreground">
                      {event.context.text}
                    </p>
                  )}
                  <p className="mt-2 break-words text-xs text-muted-foreground">
                    {event.reason || "Waiting for evaluation"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    ICP fit
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {event.icp_score == null ? "—" : event.icp_score}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {event.icp_score == null ? "Not verified" : "/ 100"}
                    </span>
                  </p>
                </div>
                {actionable && (
                  <div className="flex w-full gap-2 sm:w-auto sm:flex-col">
                  {event.decision_state === "provider_unknown" ? <p className="max-w-44 text-xs leading-relaxed text-amber-700 dark:text-amber-400">Check the invitation in LinkedIn. Its previous outcome could not be confirmed.</p> : <Button
                      variant="cta"
                      size="sm"
                      disabled={events.decision.isPending}
                      onClick={() => setConfirm(event)}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      {label}
                  </Button>}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={events.decision.isPending}
                      onClick={() => void decide(event.id, "ignore")}
                    >
                      Skip event
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !events.decision.isPending) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {accept
                ? "Accept this invitation and enroll?"
                : "Approve this person for enrollment?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {accept
                ? "ACA will accept the LinkedIn request, then start the campaign for this person."
                : "This person will begin the campaign after the admission checks pass."}{" "}
              You are approving the entry decision even if ICP information is
              missing. Suppression and duplicate checks still apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={events.decision.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="cta"
              disabled={events.decision.isPending || !confirmRule?.enabled}
              onClick={() => confirm && void decide(confirm.id, "approve")}
            >
              {events.decision.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {accept ? "Accept & enroll" : "Approve enrollment"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
