import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MailboxStatus } from "@/types/email";
import {
  getDerivedMailboxStatus,
  isStillWarming,
  WARMUP_GRADUATION_DAY,
  type DerivedMailboxStatus,
} from "@/lib/mailbox-status";

interface MailboxHealthBadgeProps {
  status: MailboxStatus;
  /**
   * Pass `mailbox.imap_connected` so a `status='ready'` mailbox with no live
   * connection renders as "Connection issue" instead of a misleading "Ready".
   * Omit it only when the connection state is genuinely unknown.
   */
  imapConnected?: boolean;
  healthScore?: number;
  /**
   * Set false to use `healthScore` for the warmup-graduation check below
   * without rendering the visible `%` pill — for callers (like the mailbox
   * table) that already show health_score in its own column and would
   * otherwise get it twice. Defaults to true.
   */
  showHealthScore?: boolean;
  /**
   * Pass `mailbox.warmup_enabled` / `mailbox.warmup_day` so a `status='ready'`
   * mailbox that's still building reputation in the warmup mesh shows a second
   * pill instead of reading as plain "Ready" — it IS fully sendable, but the
   * auto mailbox pool (mailbox-pool.ts) excludes it until it graduates. Omit
   * both to skip this check where warmup state isn't loaded.
   */
  warmupEnabled?: boolean;
  warmupDay?: number | null;
  className?: string;
}

const STATUS_CONFIG: Record<
  DerivedMailboxStatus,
  { label: string; color: string; dotColor: string }
> = {
  warming: {
    label: "Warming",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    dotColor: "bg-amber-500",
  },
  ready: {
    label: "Ready",
    color: "bg-green-500/10 text-green-600 border-green-500/20",
    dotColor: "bg-green-500",
  },
  connection_issue: {
    label: "Connection issue",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    dotColor: "bg-orange-500",
  },
  paused: {
    label: "Paused",
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    dotColor: "bg-gray-400",
  },
  burned: {
    label: "Burned",
    color: "bg-red-500/10 text-red-600 border-red-500/20",
    dotColor: "bg-red-500",
  },
  disconnected: {
    label: "Disconnected",
    color: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    dotColor: "bg-slate-400",
  },
};

export function MailboxHealthBadge({
  status,
  imapConnected,
  healthScore,
  showHealthScore = true,
  warmupEnabled,
  warmupDay,
  className,
}: MailboxHealthBadgeProps) {
  // When imapConnected is omitted, default to true so the raw status passes through.
  const derived = getDerivedMailboxStatus({
    status,
    imap_connected: imapConnected ?? true,
  });
  const config = STATUS_CONFIG[derived] ?? {
    label: derived ?? "Unknown",
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    dotColor: "bg-gray-400",
  };

  // Only worth flagging on the case that reads as all-clear: a warmup-mesh
  // mailbox stays status='ready' the entire time it's warming, so "Ready"
  // alone would hide that the auto pool is excluding it.
  const stillWarming =
    derived === "ready" &&
    warmupEnabled !== undefined &&
    isStillWarming({ warmup_enabled: warmupEnabled, warmup_day: warmupDay ?? null, health_score: healthScore ?? 0 });

  // A warming mailbox renders as ONE status, not two. It previously showed a
  // green "Ready" pill AND an amber "Warming · day 5/23" pill side by side —
  // two identically shaped pills reading as two contradictory statuses. The
  // underlying facts aren't in conflict (it can send if selected explicitly;
  // the auto pool excludes it until it graduates), but that is one state with a
  // qualifier, so it gets one badge and the nuance goes in the tooltip.
  const warmupConfig = STATUS_CONFIG.warming;
  const badge = (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium", stillWarming ? warmupConfig.color : config.color)}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full mr-1.5",
          stillWarming ? warmupConfig.dotColor : config.dotColor
        )}
      />
      {stillWarming ? `Warming · ${warmupDay ?? 0}/${WARMUP_GRADUATION_DAY}` : config.label}
    </Badge>
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {stillWarming ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent side="top" className="max-w-[16rem] text-xs leading-relaxed">
              Connected and able to send — you can select it for a campaign today. It is still
              building reputation in the warmup mesh, so auto-selected sending pools skip it until
              day {WARMUP_GRADUATION_DAY} of verified delivery with health ≥ 70%.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        badge
      )}
      {showHealthScore && healthScore !== undefined && status !== "disconnected" && (
        <span
          className={cn(
            "text-xs font-medium tabular-nums",
            healthScore >= 0.8
              ? "text-green-600"
              : healthScore >= 0.5
              ? "text-amber-600"
              : "text-red-600"
          )}
        >
          {Math.round(healthScore * 100)}%
        </span>
      )}
    </div>
  );
}
