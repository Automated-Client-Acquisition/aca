import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Send,
  MessageSquare,
  AlertTriangle,
  ShieldAlert,
  Ban,
  UserX,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrillDownStatus, LeadStatusEntry } from "@/hooks/useEmailStats";

const DRILL_DOWN_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; description: string }
> = {
  sent: {
    label: "Sent",
    icon: Send,
    color: "text-blue-500",
    description: "Leads who were sent emails in the last 30 days",
  },
  bounced: {
    label: "Bounced",
    icon: AlertTriangle,
    color: "text-red-600",
    description: "Leads whose emails bounced — consider excluding them",
  },
  replied: {
    label: "Replied",
    icon: MessageSquare,
    color: "text-green-600",
    description: "Leads who replied to emails in the last 30 days",
  },
  spam: {
    label: "Spam",
    icon: ShieldAlert,
    color: "text-red-600",
    description: "Leads who marked emails as spam",
  },
};

interface MailboxDrillDownSheetProps {
  drillStatus: DrillDownStatus | null;
  onClose: () => void;
  leads: LeadStatusEntry[] | undefined;
  isLoading: boolean;
  onMarkInvalid?: (leadIds: string[]) => void;
  onExcludeFromSequences?: (leadIds: string[]) => void;
}

export function MailboxDrillDownSheet({
  drillStatus,
  onClose,
  leads,
  isLoading,
  onMarkInvalid,
  onExcludeFromSequences,
}: MailboxDrillDownSheetProps) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const cfg = drillStatus ? DRILL_DOWN_CONFIG[drillStatus] : null;
  const Icon = cfg?.icon ?? Send;
  const showBulkActions = drillStatus === "bounced" || drillStatus === "spam";
  const selectableLeads = leads?.filter((l) => l.lead_id) ?? [];

  const allSelected =
    selectableLeads.length > 0 &&
    selectableLeads.every((l) => selectedIds.has(l.lead_id!));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableLeads.map((l) => l.lead_id!)));
    }
  }

  function toggleOne(leadId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function handleClose() {
    setSelectedIds(new Set());
    onClose();
  }

  function getTimestamp(lead: LeadStatusEntry): string | null {
    if (!drillStatus) return lead.created_at;
    if (drillStatus === "replied") return lead.replied_at;
    if (drillStatus === "bounced") return lead.bounced_at;
    return lead.sent_at || lead.created_at;
  }

  function formatBounceCategory(category: string | null | undefined): {
    label: string;
    variant: "destructive" | "secondary";
  } {
    if (category === "hard_bounce")
      return { label: "Hard bounce", variant: "destructive" };
    if (category === "soft_bounce")
      return { label: "Soft bounce", variant: "secondary" };
    if (category === "ndr_bounce")
      return { label: "NDR detected", variant: "destructive" };
    if (!category || category === "unknown")
      return { label: "Reason unavailable", variant: "secondary" };
    if (category === "reputation_block")
      return { label: "Sender reputation", variant: "destructive" };
    return { label: category, variant: "secondary" };
  }

  const bounceReasonCounts = (leads || []).reduce<Record<string, number>>(
    (counts, lead) => {
      const category = lead.error_category || "unknown";
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    },
    {}
  );
  const unknownBounceCount = bounceReasonCounts.unknown || 0;
  const reputationBlockCount = bounceReasonCounts.reputation_block || 0;

  return (
    <Sheet
      open={!!drillStatus}
      onOpenChange={(open) => !open && handleClose()}
    >
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        {drillStatus && cfg && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Icon className={cn("w-5 h-5", cfg.color)} />
                {cfg.label} Leads
                {leads && (
                  <Badge variant="secondary" className="ml-1">
                    {leads.length}
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>{cfg.description}</SheetDescription>
            </SheetHeader>

            {drillStatus === "bounced" && !isLoading && leads && leads.length > 0 && (
              <Alert className="mt-4 border-amber-500/40 bg-amber-500/5 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {unknownBounceCount > 0
                    ? "Some bounce reasons are unavailable"
                    : reputationBlockCount > 0
                    ? "Sender reputation blocks detected"
                    : "Review recipient delivery outcomes"}
                </AlertTitle>
                <AlertDescription>
                  {unknownBounceCount > 0
                    ? `${unknownBounceCount} of ${leads.length} bounced ${leads.length === 1 ? "recipient has" : "recipients have"} no provider diagnostic. Do not mark those recipients invalid from the rate alone.`
                    : reputationBlockCount > 0
                    ? `${reputationBlockCount} delivery failure${reputationBlockCount === 1 ? "" : "s"} was caused by sender reputation. Keep those recipients eligible and investigate the sending domain.`
                    : "Use the reason on each recipient to decide whether to clean the list or investigate sender deliverability."}
                </AlertDescription>
              </Alert>
            )}

            {/* Select All (only for bounce/spam) */}
            {showBulkActions && selectableLeads.length > 0 && (
              <div className="flex items-center gap-2 mt-4 px-1">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  id="select-all"
                />
                <label
                  htmlFor="select-all"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  Select all ({selectableLeads.length})
                </label>
              </div>
            )}

            {/* Lead List */}
            <div className="mt-3 space-y-1">
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : leads && leads.length > 0 ? (
                leads.map((lead) => {
                  const displayName =
                    lead.lead_name || lead.recipient_email;
                  const displayEmail =
                    lead.lead_email || lead.recipient_email;
                  const timestamp = getTimestamp(lead);
                  const key = lead.lead_id || lead.recipient_email;
                  const isSelected = lead.lead_id
                    ? selectedIds.has(lead.lead_id)
                    : false;

                  const canNavigate = !!lead.lead_id;

                  return (
                    <div
                      key={key}
                      className={cn(
                        "flex items-start gap-2 p-3 rounded-lg hover:bg-muted/50 transition-colors group",
                        isSelected && "bg-muted/50",
                        canNavigate && "cursor-pointer"
                      )}
                      onClick={() => {
                        if (canNavigate) {
                          navigate(`/inbox?contact=${lead.lead_id}`);
                        }
                      }}
                    >
                      {showBulkActions && lead.lead_id && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(lead.lead_id!)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {displayName}
                        </p>
                        {lead.lead_name && (
                          <p className="text-xs text-muted-foreground truncate">
                            {displayEmail}
                          </p>
                        )}
                        {lead.subject && (
                          <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                            {lead.subject}
                          </p>
                        )}
                        {/* Bounce/spam error details */}
                        {(drillStatus === "bounced" ||
                          drillStatus === "spam") && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Badge
                              variant={
                                formatBounceCategory(lead.error_category)
                                  .variant
                              }
                              className="text-[10px] px-1.5 py-0"
                            >
                              {
                                formatBounceCategory(lead.error_category)
                                  .label
                              }
                            </Badge>
                            {lead.error_message && (
                              <span className="text-[11px] text-muted-foreground truncate">
                                {lead.error_message}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {timestamp
                            ? new Date(timestamp).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })
                            : "—"}
                        </span>
                        {canNavigate && (
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No leads found for this status in the last 30 days.
                </div>
              )}
            </div>

            {/* Bulk Actions Footer */}
            {showBulkActions && selectedIds.size > 0 && (
              <div className="sticky bottom-0 mt-4 pt-3 pb-1 border-t bg-background flex items-center gap-2">
                <span className="text-xs text-muted-foreground mr-auto">
                  {selectedIds.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onMarkInvalid?.(Array.from(selectedIds));
                    setSelectedIds(new Set());
                  }}
                >
                  <Ban className="w-3.5 h-3.5 mr-1.5" />
                  Mark Invalid
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onExcludeFromSequences?.(Array.from(selectedIds));
                    setSelectedIds(new Set());
                  }}
                >
                  <UserX className="w-3.5 h-3.5 mr-1.5" />
                  Exclude from Sequences
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
