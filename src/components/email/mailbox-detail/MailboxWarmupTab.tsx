import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Inbox, ShieldAlert, Reply, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { EmailMailbox } from "@/types/email";
import { useMailboxWarmup, useToggleMailboxWarmup } from "@/hooks/useMailboxWarmup";
import { isStillWarming, WARMUP_GRADUATION_DAY, WARMUP_GRADUATION_HEALTH_SCORE } from "@/lib/mailbox-status";

interface MailboxWarmupTabProps {
  mailbox: EmailMailbox;
}

/** A mailbox flagged for warmup with no send in this long is stalled. */
const STALL_HOURS = 48;

export function MailboxWarmupTab({ mailbox }: MailboxWarmupTabProps) {
  const { data, isLoading } = useMailboxWarmup(mailbox.id);
  const toggleWarmup = useToggleMailboxWarmup();

  const enabled = mailbox.warmup_enabled;
  const warmupDay = mailbox.warmup_day ?? 0;
  const lastSendAt = (mailbox as unknown as { warmup_last_send_at?: string | null })
    .warmup_last_send_at ?? null;

  const stats = data?.stats;
  const stalled =
    enabled &&
    (!lastSendAt || Date.now() - new Date(lastSendAt).getTime() > STALL_HOURS * 3600_000);
  const stillWarming = enabled && isStillWarming(mailbox);
  const graduationProgress = Math.min(100, Math.round((warmupDay / WARMUP_GRADUATION_DAY) * 100));

  return (
    <div className="space-y-6">
      {/* Enrolment */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-amber-500" />
                <CardTitle className="text-base">Email Warmup</CardTitle>
                {enabled ? (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Off
                  </Badge>
                )}
                {enabled && (
                  stillWarming ? (
                    <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                      Not yet in auto pool
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                      Graduated · in auto pool
                    </Badge>
                  )
                )}
              </div>
              <CardDescription className="mt-1.5">
                Exchanges genuine mail with other mailboxes in the estate, then rescues anything
                that lands in spam and replies to a share of it. Warmup runs independently of
                campaign sending — this mailbox keeps its normal daily limit either way.
              </CardDescription>
              {enabled && stillWarming && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Excluded from auto-selected sending pools (mode: auto) until day{" "}
                  {WARMUP_GRADUATION_DAY} of verified delivery with health ≥{" "}
                  {Math.round(WARMUP_GRADUATION_HEALTH_SCORE * 100)}% — currently day {warmupDay},{" "}
                  {Math.round(mailbox.health_score * 100)}% health. Manually-picked sequences can
                  still send from it.
                </p>
              )}
            </div>
            <Switch
              checked={enabled}
              disabled={toggleWarmup.isPending}
              onCheckedChange={(checked) =>
                toggleWarmup.mutate({ mailboxId: mailbox.id, enabled: checked })
              }
              aria-label="Toggle warmup"
            />
          </div>
        </CardHeader>

        {stalled && (
          <CardContent className="pt-0">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="text-xs">
                <p className="font-medium">Warmup is enabled but nothing has sent</p>
                <p className="text-muted-foreground">
                  {lastSendAt
                    ? `Last warmup send was ${formatDistanceToNow(new Date(lastSendAt), { addSuffix: true })}.`
                    : "This mailbox has never completed a warmup send."}{" "}
                  Usually a transport problem — check the mailbox connection and its tenant's
                  Microsoft Graph consent.
                </p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Placement — the number that actually matters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Inbox Placement</CardTitle>
          <CardDescription className="text-xs">
            Where warmup mail from this mailbox actually landed. Verified by reading the recipient
            mailbox, not inferred from a send count.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !stats || stats.delivered === 0 ? (
            <p className="text-sm text-muted-foreground">
              No verified deliveries yet.{" "}
              {enabled
                ? "Placement appears once the first warmup send is confirmed in a recipient mailbox."
                : "Enable warmup to start measuring placement."}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span
                  className={
                    "text-3xl font-bold tabular-nums " +
                    (stats.inboxRate === null
                      ? ""
                      : stats.inboxRate >= 0.9
                        ? "text-emerald-600"
                        : stats.inboxRate >= 0.7
                          ? "text-amber-600"
                          : "text-destructive")
                  }
                >
                  {stats.inboxRate === null ? "—" : `${Math.round(stats.inboxRate * 100)}%`}
                </span>
                <span className="text-xs text-muted-foreground">
                  reached the inbox ({stats.inbox} of {stats.inbox + stats.junk} verified)
                </span>
              </div>

              {/* Inbox vs junk split */}
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-emerald-500"
                  style={{
                    width: `${(stats.inbox / Math.max(1, stats.inbox + stats.junk)) * 100}%`,
                  }}
                />
                <div
                  className="bg-destructive"
                  style={{
                    width: `${(stats.junk / Math.max(1, stats.inbox + stats.junk)) * 100}%`,
                  }}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <Metric icon={<Inbox className="h-3.5 w-3.5" />} label="Inbox" value={stats.inbox} />
                <Metric
                  icon={<ShieldAlert className="h-3.5 w-3.5" />}
                  label="Spam"
                  value={stats.junk}
                  hint={stats.rescued > 0 ? `${stats.rescued} rescued` : undefined}
                />
                <Metric
                  icon={<Reply className="h-3.5 w-3.5" />}
                  label="Replies received"
                  value={stats.repliesReceived}
                />
                <Metric
                  icon={<Flame className="h-3.5 w-3.5" />}
                  label="Warmup day"
                  value={warmupDay}
                  hint={
                    stillWarming
                      ? `${graduationProgress}% to auto-pool graduation (day ${WARMUP_GRADUATION_DAY})`
                      : "days with verified delivery"
                  }
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Warmup Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !data?.recent.length ? (
            <p className="text-sm text-muted-foreground">No warmup activity yet.</p>
          ) : (
            <div className="divide-y">
              {data.recent.slice(0, 12).map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <PlacementDot placement={s.placement} status={s.status} />
                  <span className="min-w-0 flex-1 truncate">
                    {s.is_reply && (
                      <span className="mr-1.5 text-xs text-muted-foreground">reply</span>
                    )}
                    {s.subject}
                  </span>
                  {s.rescued_at && (
                    <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                      rescued
                    </Badge>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {s.sent_at
                      ? formatDistanceToNow(new Date(s.sent_at), { addSuffix: true })
                      : "pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PlacementDot({ placement, status }: { placement: string | null; status: string }) {
  const { color, title } =
    status === "failed"
      ? { color: "bg-destructive", title: "Send failed" }
      : placement === "inbox"
        ? { color: "bg-emerald-500", title: "Landed in inbox" }
        : placement === "junk"
          ? { color: "bg-destructive", title: "Landed in spam" }
          : placement === "missing"
            ? { color: "bg-muted-foreground", title: "Not found in recipient mailbox" }
            : { color: "bg-amber-500", title: "Awaiting placement check" };

  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={title} />;
}
