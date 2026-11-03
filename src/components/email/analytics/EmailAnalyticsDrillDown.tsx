import { useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, ArrowUpRight, CalendarCheck, Clock, MessageSquareReply, Send, ShieldAlert, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IntentBadge } from "@/components/inbox/IntentBadge";
import {
  useEmailReplyLeads,
  useLeadsByStatus,
  type EmailStatsFilters,
  type TimeRange,
} from "@/hooks/useEmailStats";
import { formatCount } from "@/components/email/analytics/format";
import type { OutcomeDrillDown } from "@/components/email/analytics/EmailOutcomeFunnel";

const CONFIG: Record<OutcomeDrillDown, { title: string; description: string; icon: React.ElementType }> = {
  sent: { title: "Leads emailed", description: "Most recent leads emailed in this period", icon: Send },
  replied: { title: "Replies", description: "Leads who replied, newest first", icon: MessageSquareReply },
  positive: { title: "Positive replies", description: "Replies the inbox marked interested or meeting booked", icon: Sparkles },
  meetings: { title: "Meetings booked", description: "Leads with a booked meeting", icon: CalendarCheck },
  bounced: { title: "Bounced", description: "Most recent leads whose email bounced", icon: AlertTriangle },
  blocked: {
    title: "Blocked",
    description: "Refused for the sending domain's reputation. The address was never tested, so these aren't bounces",
    icon: ShieldAlert,
  },
  auto: {
    title: "Out of office & auto-replies",
    description: "Automatic responses, kept out of reply counts and rates",
    icon: Clock,
  },
};

const SENT_STATUSES = ["sent", "delivered", "opened", "clicked", "replied", "auto_replied", "bounced", "blocked", "spam"];

interface Row {
  key: string;
  name: string;
  email: string;
  campaign: string | null;
  intent: string | null;
  at: string | null;
  detail: string | null;
  contactId: string | null;
}

interface EmailAnalyticsDrillDownProps {
  kind: OutcomeDrillDown | null;
  onClose: () => void;
  timeRange: TimeRange;
  filters: EmailStatsFilters;
  /** The headline number for this kind, so a capped list can say "x of y". */
  total?: number;
}

export function EmailAnalyticsDrillDown({ kind, onClose, timeRange, filters, total }: EmailAnalyticsDrillDownProps) {
  const navigate = useNavigate();
  const replyKind = kind === "replied" || kind === "positive" || kind === "meetings" || kind === "auto" ? kind : null;
  const statusKind = kind === "sent" || kind === "bounced" || kind === "blocked" ? kind : null;
  const failureKind = statusKind === "bounced" || statusKind === "blocked";

  const replyQuery = useEmailReplyLeads(replyKind, timeRange, filters);
  // Match the headline: "sent" is every real send; "bounced" and "blocked"
  // are separate (a reputation block never tested the address).
  const statusQuery = useLeadsByStatus(
    statusKind,
    timeRange,
    filters,
    statusKind === "sent" ? SENT_STATUSES : undefined,
  );

  const isLoading = replyKind ? replyQuery.isLoading : statusQuery.isLoading;
  const rows: Row[] = replyKind
    ? (replyQuery.data ?? []).map((r) => ({
        key: r.lead_key,
        name: r.contact_name || r.recipient_email,
        email: r.recipient_email,
        campaign: r.sequence_name,
        intent: r.lead_intent,
        at: r.replied_at,
        detail: r.subject,
        contactId: r.contact_id,
      }))
    : (statusQuery.data ?? []).map((r) => ({
        key: r.lead_id || r.recipient_email,
        name: r.lead_name || r.recipient_email,
        email: r.lead_email || r.recipient_email,
        campaign: null,
        intent: null,
        at: (statusKind === "bounced" ? r.bounced_at : r.sent_at) || r.created_at,
        detail: failureKind ? r.error_message ?? null : r.subject,
        contactId: null,
      }));

  const config = kind ? CONFIG[kind] : null;
  const Icon = config?.icon ?? Send;
  const capped = total !== undefined && rows.length < total;

  return (
    <Sheet open={!!kind} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {config && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-muted-foreground" />
                {config.title}
                {!isLoading && (
                  <Badge variant="secondary" className="ml-1 tabular-nums">
                    {formatCount(total ?? rows.length)}
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {config.description}
                {capped && !isLoading ? ` · showing the latest ${formatCount(rows.length)}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-1">
              {isLoading ? (
                [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)
              ) : rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nobody here for this period yet.</p>
              ) : (
                rows.map((row) => (
                  <div key={row.key} className="group flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
                      {row.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                        {row.intent && <IntentBadge intent={row.intent} />}
                      </div>
                      {row.name !== row.email && <p className="truncate text-xs text-muted-foreground">{row.email}</p>}
                      {(row.campaign || row.detail) && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                          {[row.campaign, row.detail].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">
                        {row.at ? formatDistanceToNowStrict(new Date(row.at), { addSuffix: true }) : ""}
                      </span>
                      {row.contactId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => navigate(`/inbox?contact=${row.contactId}`)}
                        >
                          Open in inbox
                          <ArrowUpRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
