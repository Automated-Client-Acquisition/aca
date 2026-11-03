import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { describePauseReason } from "@/lib/mailbox-status";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MailboxHealthBadge } from "./MailboxHealthBadge";
import { Badge } from "@/components/ui/badge";
import {
  MoreHorizontal,
  Pause,
  Play,
  Unplug,
  Settings2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { AccountOwnerPicker } from "@/components/accounts/AccountOwnerPicker";
import type { EmailMailbox } from "@/types/email";
import type { ConnectionTestStatus } from "@/hooks/useEmailMailboxes";

interface MailboxTableProps {
  mailboxes: EmailMailbox[];
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onEditSettings?: (mailbox: EmailMailbox) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDisconnect: (id: string) => void;
  /** Retest + reconnect a disconnected mailbox (mailbox-connect connection_retest). */
  onReconnect?: (id: string) => void;
  onOwnerChange?: (mailboxId: string, userId: string | null) => void;
  connectionTestStatuses?: Map<string, ConnectionTestStatus>;
  domainMap?: Map<string, string>;
  /** Why a domain is blocked, so a paused row can name it instead of just saying "Domain blocked". */
  domainBlockMap?: Map<string, { domain: string; pausedAt: string | null; reason: string | null }>;
  totalFilteredCount?: number;
  onSelectAllFiltered?: () => void;
}

const PROVIDER_ICONS: Record<string, string> = {
  gmail: "G",
  outlook: "O",
  smtp: "S",
};

const PROVIDER_COLORS: Record<string, string> = {
  gmail: "bg-red-500/10 text-red-600 border-red-500/20",
  outlook: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  smtp: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

export function MailboxTable({
  mailboxes,
  selectedIds = new Set(),
  onSelectionChange,
  onEditSettings,
  onPause,
  onResume,
  onDisconnect,
  onReconnect,
  onOwnerChange,
  connectionTestStatuses,
  domainMap,
  domainBlockMap,
  totalFilteredCount,
  onSelectAllFiltered,
}: MailboxTableProps) {
  const navigate = useNavigate();
  const allSelected =
    mailboxes.length > 0 && mailboxes.every((m) => selectedIds.has(m.id));
  const someSelected =
    mailboxes.some((m) => selectedIds.has(m.id)) && !allSelected;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(mailboxes.map((m) => m.id)));
    }
  };

  // "Select all across pages" banner logic — mirrors the Contacts table pattern.
  const total = totalFilteredCount ?? mailboxes.length;
  const hasMorePages = total > mailboxes.length;
  const allPagesAlreadySelected =
    total > 0 && selectedIds.size === total && hasMorePages;
  const showSelectAllBanner =
    allSelected && hasMorePages && !allPagesAlreadySelected && !!onSelectAllFiltered;

  const handleSelectOne = (id: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div className="border rounded-lg">
      {showSelectAllBanner && (
        <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm flex items-center justify-center gap-2 flex-wrap">
          <span>All {mailboxes.length} mailboxes on this page are selected.</span>
          <button
            className="text-primary font-medium hover:underline"
            onClick={onSelectAllFiltered}
          >
            Select all {total.toLocaleString()}
          </button>
        </div>
      )}
      {allPagesAlreadySelected && (
        <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm">
          All {total.toLocaleString()} mailboxes are selected.{" "}
          <button
            className="text-primary font-medium hover:underline"
            onClick={() => onSelectionChange?.(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}
      <Table className="min-w-[1280px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={handleSelectAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead className="w-[260px]">Mailbox</TableHead>
            <TableHead className="w-[180px]">Owner</TableHead>
            <TableHead className="w-[150px]">Tags</TableHead>
            <TableHead className="w-[140px]">Domain</TableHead>
            <TableHead className="w-[110px]">Status</TableHead>
            <TableHead className="w-[160px]">Daily Sends</TableHead>
            <TableHead className="w-[80px] text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-end gap-1 cursor-help">
                    Bounce <Info className="h-3 w-3" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-left">
                  Recipient delivery failures for this mailbox. Review the bounce
                  reason before treating a recipient as invalid; this is separate
                  from inbox connection and sender health.
                </TooltipContent>
              </Tooltip>
            </TableHead>
            <TableHead className="w-[80px] text-right">Reply</TableHead>
            <TableHead className="w-[80px] text-right">Health</TableHead>
            <TableHead className="w-[120px]">Last Sent</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {mailboxes.map((mailbox) => {
            const provider = mailbox.provider || "smtp";
            const isActive = mailbox.status === "ready";
            const quotaPercentage =
              mailbox.daily_limit > 0
                ? Math.min(
                    (mailbox.daily_sent / mailbox.daily_limit) * 100,
                    100
                  )
                : 0;

            return (
              <TableRow
                key={mailbox.id}
                className={cn(
                  "cursor-pointer hover:bg-muted/50 transition-colors",
                  mailbox.status === "burned" && "bg-red-500/5",
                  mailbox.status === "paused" && "opacity-75",
                  selectedIds.has(mailbox.id) && "bg-accent/50"
                )}
                onClick={() => navigate(`/email/mailboxes/${mailbox.id}`)}
              >
                {/* Checkbox */}
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(mailbox.id)}
                    onCheckedChange={() => handleSelectOne(mailbox.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${mailbox.email_address}`}
                  />
                </TableCell>

                {/* Mailbox */}
                <TableCell>
                  <button
                    className="flex items-center gap-3 min-w-0 text-left hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/email/mailboxes/${mailbox.id}`);
                    }}
                  >
                    {(mailbox.metadata as any)?.avatar_url ? (
                      <img
                        src={(mailbox.metadata as any).avatar_url}
                        alt=""
                        className="flex-shrink-0 w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className={cn(
                          "flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center border text-xs font-bold",
                          PROVIDER_COLORS[provider] || PROVIDER_COLORS.smtp
                        )}
                      >
                        {PROVIDER_ICONS[provider] || "S"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {mailbox.email_address}
                      </p>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-xs text-muted-foreground truncate">
                          {mailbox.display_name ? `${mailbox.display_name} · ` : ""}
                          {mailbox.connection_type === "smtp" ? "SMTP" : mailbox.connection_type === "zapmail" ? "ZapMail" : mailbox.connection_type === "postal" ? "Azure Infra" : mailbox.connection_type || "SMTP"}
                        </p>
                        {(mailbox.metadata as any)?.zapmail_workspace_name && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground shrink-0">
                            {(mailbox.metadata as any).zapmail_workspace_name}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                </TableCell>

                {/* Owner */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <AccountOwnerPicker
                    value={mailbox.owner_user_id}
                    onChange={(userId) => onOwnerChange?.(mailbox.id, userId)}
                    disabled={!onOwnerChange}
                  />
                </TableCell>

                {/* Tags */}
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[150px]">
                    {mailbox.tags && mailbox.tags.length > 0 ? (
                      <>
                        {mailbox.tags.slice(0, 2).map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 font-normal"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {mailbox.tags.length > 2 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
                          >
                            +{mailbox.tags.length - 2}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </TableCell>

                {/* Domain */}
                <TableCell>
                  {mailbox.sending_domain_id && domainMap?.get(mailbox.sending_domain_id) ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                      {domainMap.get(mailbox.sending_domain_id)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Manual</span>
                  )}
                </TableCell>

                {/* Status */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <MailboxHealthBadge
                      status={mailbox.status}
                      imapConnected={mailbox.imap_connected}
                      healthScore={mailbox.health_score}
                      showHealthScore={false}
                      warmupEnabled={mailbox.warmup_enabled}
                      warmupDay={mailbox.warmup_day}
                    />
                    {connectionTestStatuses?.get(mailbox.id) === "testing" && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    )}
                    {connectionTestStatuses?.get(mailbox.id) === "passed" && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    )}
                    {connectionTestStatuses?.get(mailbox.id) === "failed" && (
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    )}
                    {(mailbox.metadata as any)?.imap_auth_error && mailbox.connection_type !== "m365" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">{(mailbox.metadata as any).imap_auth_error}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {(mailbox.metadata as any)?.graph_auth_error && mailbox.connection_type === "m365" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertTriangle
                            className="w-3.5 h-3.5 text-amber-500 cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); navigate("/email/settings"); }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">{(mailbox.metadata as any).graph_auth_error}</p>
                          <p className="text-xs text-muted-foreground mt-1">Click to re-authorize tenant</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {/* Why is this row not sending? Covers every unhealthy status,
                        not just `disconnected` — this used to be disconnected-only,
                        so a paused mailbox rendered as a bare grey pill even when
                        the reason was sitting right there in metadata. */}
                    {(() => {
                      if (
                        (mailbox.metadata as any)?.imap_auth_error ||
                        ((mailbox.metadata as any)?.graph_auth_error &&
                          mailbox.connection_type === "m365")
                      ) {
                        return null; // already covered by the tooltips above
                      }

                      const meta = mailbox.metadata as any;
                      const isPaused =
                        mailbox.status === "paused" || mailbox.status === "burned";
                      const detail = isPaused
                        ? describePauseReason(meta?.paused_reason)
                        : meta?.disconnected_error || mailbox.last_error;
                      if (!detail) return null;

                      // Name the domain, the reason and the date. "The domain is
                      // what's blocked" was true and useless — it left the
                      // operator with no idea which domain, why, or for how long.
                      let hint: string | null = null;
                      if (mailbox.status === "disconnected") {
                        hint = "Use “Reconnect” to retry once the provider login is restored.";
                      } else if (meta?.paused_reason === "manual") {
                        hint = "Resume it whenever you're ready — nothing automatic will.";
                      } else if (["domain_not_sendable", "domain_paused"].includes(meta?.paused_reason)) {
                        const block = mailbox.sending_domain_id
                          ? domainBlockMap?.get(mailbox.sending_domain_id)
                          : undefined;
                        hint = [
                          block?.domain
                            ? `${block.domain} has a domain sending hold.`
                            : "This mailbox's domain has a sending hold.",
                          block?.pausedAt ? `Paused ${new Date(block.pausedAt).toLocaleDateString()}.` : null,
                          block?.reason ?? null,
                          // Cause-neutral on purpose: the reason line above says why
                          // (a 550 refusal, or a manual call on seed placement), and
                          // this used to claim "providers refused mail" for both.
                          "Review the evidence and pause or resume the domain in Settings → Domains & servers → Monitor. Domain controls apply to all its mailboxes; reputation warnings alone do not pause sending.",
                        ]
                          .filter(Boolean)
                          .join(" ");
                      } else if (isPaused) {
                        hint = "Released automatically once the cause clears.";
                      }

                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">{detail}</p>
                            {isPaused && mailbox.last_error && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {mailbox.last_error}
                              </p>
                            )}
                            {hint && (
                              <p className="text-xs text-muted-foreground mt-1">{hint}</p>
                            )}
                            {["domain_not_sendable", "domain_paused"].includes(meta?.paused_reason) && (
                              <Link to="/settings?tab=email-infra" className="block text-xs underline mt-1">Open domain monitoring</Link>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </div>
                </TableCell>

                {/* Daily Sends */}
                <TableCell>
                  {mailbox.status !== "disconnected" ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="tabular-nums font-medium">
                          {mailbox.daily_sent}/{mailbox.daily_limit}
                        </span>
                      </div>
                      <Progress
                        value={quotaPercentage}
                        className={cn(
                          "h-1.5",
                          quotaPercentage >= 100 && "[&>div]:bg-amber-500"
                        )}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* Bounce Rate */}
                <TableCell className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "text-sm tabular-nums font-medium",
                          mailbox.bounce_rate > 0.05
                            ? "text-red-500"
                            : "text-foreground"
                        )}
                      >
                        {(mailbox.bounce_rate * 100).toFixed(1)}%
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64 text-left">
                      {mailbox.bounce_rate > 0.05
                        ? "Open this mailbox to review affected recipients and their delivery reasons."
                        : "Recipient delivery failures are currently within the review threshold."}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>

                {/* Reply Rate */}
                <TableCell className="text-right">
                  <span className="text-sm tabular-nums font-medium">
                    {(mailbox.reply_rate * 100).toFixed(1)}%
                  </span>
                </TableCell>

                {/* Health Score */}
                <TableCell className="text-right">
                  <span
                    className={cn(
                      "text-sm tabular-nums font-medium",
                      mailbox.health_score >= 0.8
                        ? "text-green-600"
                        : mailbox.health_score >= 0.5
                        ? "text-amber-600"
                        : "text-red-600"
                    )}
                  >
                    {Math.round(mailbox.health_score * 100)}%
                  </span>
                </TableCell>

                {/* Last Sent */}
                <TableCell>
                  {mailbox.last_send_at ? (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(mailbox.last_send_at), {
                        addSuffix: true,
                      })}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never</span>
                  )}
                </TableCell>

                {/* Actions */}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditSettings?.(mailbox)}>
                        <Settings2 className="h-4 w-4 mr-2" />
                        Edit Settings
                      </DropdownMenuItem>
                      {mailbox.status === "paused" && (
                        <DropdownMenuItem
                          onClick={() => onResume(mailbox.id)}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Resume
                        </DropdownMenuItem>
                      )}
                      {isActive && (
                        <DropdownMenuItem
                          onClick={() => onPause(mailbox.id)}
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          Pause
                        </DropdownMenuItem>
                      )}
                      {mailbox.status === "disconnected" && onReconnect && (
                        <DropdownMenuItem
                          onClick={() => onReconnect(mailbox.id)}
                          disabled={connectionTestStatuses?.get(mailbox.id) === "testing"}
                        >
                          <RefreshCw
                            className={cn(
                              "h-4 w-4 mr-2",
                              connectionTestStatuses?.get(mailbox.id) === "testing" && "animate-spin"
                            )}
                          />
                          Reconnect
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDisconnect(mailbox.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Unplug className="h-4 w-4 mr-2" />
                        Disconnect
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
