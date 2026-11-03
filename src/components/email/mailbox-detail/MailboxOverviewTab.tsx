import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MailboxHealthBadge } from "@/components/email/MailboxHealthBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useEmailDailyTrend,
  useLeadsByStatus,
  useMailboxDeliveryEvidence,
  type DrillDownStatus,
  type EmailStatsFilters,
} from "@/hooks/useEmailStats";
import {
  useMarkLeadsInvalid,
  useExcludeLeadsFromSequences,
} from "@/hooks/useBouncedLeadActions";
import { MailboxDrillDownSheet } from "./MailboxDrillDownSheet";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { EmailMailbox } from "@/types/email";

function formatLastError(error: string): string {
  // Old format: "Send failed at 2026-02-20T13:39:42.736Z" → strip useless timestamp
  // New format: actual SMTP error message → show as-is
  return error
    .replace(/^Send failed at \d{4}-\d{2}-\d{2}T[\d:.]+Z?$/, "Send failed (no details recorded)")
    .replace(/\s+at\s+\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "")
    .trim() || error;
}

/**
 * Put a plain-English headline on a raw provider error. The raw string is still
 * shown underneath — a `535 5.7.3` with a Microsoft trace id tells an operator
 * nothing about whether they need to do something.
 */
function describeSendError(error: string): string {
  const e = error.toLowerCase();
  if (e.includes("535") || e.includes("invalid login") || e.includes("authentication unsuccessful")) {
    return "The mail server rejected this mailbox's SMTP password.";
  }
  if (e.includes("econnreset") || e.includes("peer closed") || e.includes("unexpected eof")) {
    return "The mail server dropped the connection mid-send. Usually transient.";
  }
  if (e.includes("timeout") || e.includes("timed out")) {
    return "The mail server did not respond in time. Usually transient.";
  }
  if (e.includes("rate") || e.includes("throttl")) {
    return "The mail server is throttling this mailbox.";
  }
  return formatLastError(error);
}

interface MailboxOverviewTabProps {
  mailbox: EmailMailbox;
}

export function MailboxOverviewTab({ mailbox }: MailboxOverviewTabProps) {
  const filters: EmailStatsFilters = { mailboxId: mailbox.id };
  const { data: dailyTrend } = useEmailDailyTrend("7d", filters);
  const [drillStatus, setDrillStatus] = useState<DrillDownStatus | null>(null);
  const { data: drillDownLeads, isLoading: drillDownLoading } =
    useLeadsByStatus(drillStatus, "30d", filters);
  const { data: deliveryEvidence } = useMailboxDeliveryEvidence(mailbox.id);

  const markInvalid = useMarkLeadsInvalid();
  const excludeFromSequences = useExcludeLeadsFromSequences();

  const quotaPercentage =
    mailbox.daily_limit > 0
      ? Math.min((mailbox.daily_sent / mailbox.daily_limit) * 100, 100)
      : 0;

  const imapAuthError = (mailbox.metadata as any)?.imap_auth_error;

  return (
    <div className="space-y-6">
      {/* IMAP Auth Error */}
      {imapAuthError && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>IMAP Connection Failed</AlertTitle>
          <AlertDescription>
            {imapAuthError}. IMAP polling is disabled for this mailbox — inbound replies will not be detected until credentials are updated.
          </AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
        {/* Daily Sent */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setDrillStatus("sent")}
        >
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Daily Sends</p>
            <p className="text-2xl font-bold tabular-nums">
              {mailbox.daily_sent}
              <span className="text-sm font-normal text-muted-foreground">
                /{mailbox.daily_limit}
              </span>
            </p>
            <Progress
              value={quotaPercentage}
              className={cn(
                "h-1.5 mt-2",
                quotaPercentage >= 100 && "[&>div]:bg-amber-500"
              )}
            />
          </CardContent>
        </Card>

        {/* Bounce Rate */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setDrillStatus("bounced")}
        >
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Bounce Rate</p>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                mailbox.bounce_rate > 0.05 ? "text-red-500" : "text-foreground"
              )}
            >
              {(mailbox.bounce_rate * 100).toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {mailbox.bounce_rate > 0.05
                ? "Review recipient outcomes"
                : "Recipient delivery is healthy"}
            </p>
            {mailbox.bounce_rate > 0.05 && (
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                Separate from sender health
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recipient list evidence */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Recipient Evidence</p>
            <p className="text-2xl font-bold tabular-nums">
              {deliveryEvidence?.confirmedRecipientBounces ?? 0}
              <span className="text-sm font-normal text-muted-foreground">
                /{deliveryEvidence?.attempted ?? 0}
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              confirmed bounces · 30d
            </p>
            {(deliveryEvidence?.unclassifiedFailures ?? 0) > 0 && (
              <p className="text-[10px] text-amber-600 mt-0.5 leading-tight">
                {deliveryEvidence!.unclassifiedFailures} need provider diagnosis
              </p>
            )}
            {(deliveryEvidence?.senderReputationBlocks ?? 0) > 0 && (
              <p className="text-[10px] text-red-600 mt-0.5 leading-tight">
                {deliveryEvidence!.senderReputationBlocks} sender block{deliveryEvidence!.senderReputationBlocks === 1 ? "" : "s"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Reply Rate */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setDrillStatus("replied")}
        >
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Reply Rate</p>
            <p className="text-2xl font-bold tabular-nums">
              {(mailbox.reply_rate * 100).toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {mailbox.reply_rate >= 0.1 ? "Good engagement" : "Low"}
            </p>
          </CardContent>
        </Card>

        {/* Spam Rate */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setDrillStatus("spam")}
        >
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Spam Rate</p>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                mailbox.spam_rate > 0.01 ? "text-red-500" : "text-foreground"
              )}
            >
              {(mailbox.spam_rate * 100).toFixed(2)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {mailbox.spam_rate > 0.01 ? "Needs attention" : "Clean"}
            </p>
          </CardContent>
        </Card>

        {/* Health Score */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Health Score</p>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                mailbox.health_score >= 0.8
                  ? "text-green-600"
                  : mailbox.health_score >= 0.5
                  ? "text-amber-600"
                  : "text-red-600"
              )}
            >
              {Math.round(mailbox.health_score * 100)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {mailbox.health_score >= 0.8
                ? "Excellent"
                : mailbox.health_score >= 0.5
                ? "Fair"
                : "Poor"}
            </p>
          </CardContent>
        </Card>

        {/* Status */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Status</p>
            <div className="mt-1">
              <MailboxHealthBadge
                status={mailbox.status}
                imapConnected={mailbox.imap_connected}
                healthScore={mailbox.health_score}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-muted-foreground">Last Sent</p>
              <p className="text-sm font-medium">
                {mailbox.last_send_at
                  ? formatDistanceToNow(new Date(mailbox.last_send_at), {
                      addSuffix: true,
                    })
                  : "Never"}
              </p>
            </div>
            {/* A real, current failure. `last_error` now clears on the next
                successful send, so anything here is live — it used to be
                write-only, and a single 535 in August still showed as the
                mailbox's state months and thousands of good sends later. */}
            {mailbox.last_error && (
              <div>
                <p className="text-xs text-muted-foreground">Last send error</p>
                <p className="text-sm text-red-500">
                  {describeSendError(mailbox.last_error)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 break-all">
                  {formatLastError(mailbox.last_error)}
                </p>
              </div>
            )}
            {/* SMTP is only a fallback for M365 — these mailboxes send over
                Graph and their SMTP password is expected to have drifted. Show
                it as a note, not as an error on a mailbox that is sending fine. */}
            {!mailbox.last_error &&
              typeof (mailbox.metadata as Record<string, unknown> | null)?.smtp_fallback_error ===
                "string" && (
                <div>
                  <p className="text-xs text-muted-foreground">SMTP fallback</p>
                  <p className="text-sm text-muted-foreground">
                    Unavailable — this mailbox sends over Microsoft Graph, which is working. SMTP is
                    only the backup path, so this does not affect delivery.
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 break-all">
                    {formatLastError(
                      (mailbox.metadata as Record<string, string>).smtp_fallback_error
                    )}
                  </p>
                </div>
              )}
          </div>
        </CardContent>
      </Card>

      {/* 7-Day Send Volume Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Send Volume (Last 7 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyTrend && dailyTrend.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrend}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) =>
                      new Date(value + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    labelFormatter={(value) =>
                      new Date(value + "T00:00:00").toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    }
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    stroke="hsl(1, 70%, 54%)"
                    fill="hsl(1, 70%, 54%)"
                    fillOpacity={0.1}
                    strokeWidth={2}
                    name="Sent"
                  />
                  <Area
                    type="monotone"
                    dataKey="delivered"
                    stroke="hsl(142, 71%, 45%)"
                    fill="hsl(142, 71%, 45%)"
                    fillOpacity={0.1}
                    strokeWidth={2}
                    name="Delivered"
                  />
                  <Area
                    type="monotone"
                    dataKey="bounced"
                    stroke="hsl(0, 84%, 60%)"
                    fill="hsl(0, 84%, 60%)"
                    fillOpacity={0.1}
                    strokeWidth={2}
                    name="Bounced"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
              No send data available yet
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drill-Down Sheet */}
      <MailboxDrillDownSheet
        drillStatus={drillStatus}
        onClose={() => setDrillStatus(null)}
        leads={drillDownLeads}
        isLoading={drillDownLoading}
        onMarkInvalid={(ids) => markInvalid.mutate(ids)}
        onExcludeFromSequences={(ids) => excludeFromSequences.mutate(ids)}
      />
    </div>
  );
}
