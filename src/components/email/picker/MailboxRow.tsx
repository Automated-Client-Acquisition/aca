import { memo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { EmailMailbox } from "@/types/email";
import type { MailboxAssignment } from "@/hooks/useMailboxAssignments";

export interface MailboxRowProps {
  mailbox: EmailMailbox;
  isSelected: boolean;
  isUnhealthy?: boolean;
  unhealthyReason?: string;
  workspaceName?: string | null;
  domain?: string | null;
  inUseBy?: MailboxAssignment[];
  mode: "single" | "multi";
  disabled?: boolean;
  onToggle: (id: string) => void;
}

function MailboxRowImpl({
  mailbox,
  isSelected,
  isUnhealthy,
  unhealthyReason,
  workspaceName,
  domain,
  inUseBy,
  mode,
  disabled,
  onToggle,
}: MailboxRowProps) {
  const limit = mailbox.daily_limit || 0;
  const sent = mailbox.daily_sent || 0;
  const utilization = limit > 0 ? Math.min(100, (sent / limit) * 100) : 0;
  const tags = mailbox.tags || [];
  const assignments = inUseBy ?? [];
  const inUse = assignments.length > 0;

  const statusColor = isUnhealthy
    ? "bg-orange-500"
    : mailbox.status === "ready"
    ? "bg-emerald-500"
    : mailbox.status === "warming"
    ? "bg-amber-500"
    : "bg-red-500";

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={isSelected}
      aria-disabled={disabled}
      onClick={() => !disabled && onToggle(mailbox.id)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(mailbox.id);
        }
      }}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 mx-2 rounded-md border transition-colors",
        disabled
          ? "border-dashed border-border/40 bg-muted/20 opacity-60 cursor-not-allowed"
          : "cursor-pointer",
        !disabled && isSelected && "border-primary/40 bg-primary/5",
        !disabled && !isSelected && "border-transparent hover:border-border hover:bg-muted/40",
        isUnhealthy && !disabled && "border-orange-500/30 bg-orange-500/5"
      )}
    >
      {mode === "multi" ? (
        <Checkbox
          checked={isSelected}
          disabled={disabled}
          onCheckedChange={() => !disabled && onToggle(mailbox.id)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
      ) : (
        <div
          className={cn(
            "shrink-0 h-4 w-4 rounded-full border flex items-center justify-center",
            isSelected ? "border-primary" : "border-muted-foreground/30"
          )}
        >
          {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
        </div>
      )}

      <span
        className={cn("shrink-0 h-2 w-2 rounded-full", statusColor)}
        aria-hidden
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium truncate">
            {mailbox.email_address}
          </p>
          {mailbox.display_name && (
            <span className="text-xs text-muted-foreground truncate">
              {mailbox.display_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          {workspaceName && (
            <span className="truncate max-w-[110px]">{workspaceName}</span>
          )}
          {workspaceName && domain && <span>·</span>}
          {domain && <span className="truncate max-w-[140px]">{domain}</span>}
          {(workspaceName || domain) && <span>·</span>}
          <span className="tabular-nums shrink-0">
            {sent}/{limit}
          </span>
          {inUse && (
            <>
              <span>·</span>
              <HoverCard openDelay={120}>
                <HoverCardTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 cursor-default shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Shared · {assignments.length}
                  </span>
                </HoverCardTrigger>
                <HoverCardContent side="top" align="start" className="w-auto max-w-[280px] p-2">
                  <p className="text-[11px] font-medium mb-1">
                    Sending for {assignments.length} active campaign{assignments.length !== 1 ? "s" : ""}
                  </p>
                  <ul className="space-y-0.5">
                    {assignments.map((a) => (
                      <li
                        key={a.sequenceId}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-500" />
                        <span className="truncate">{a.sequenceName}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Safe to reuse — its daily limit is shared across campaigns.
                  </p>
                </HoverCardContent>
              </HoverCard>
            </>
          )}
          {isUnhealthy && unhealthyReason && (
            <>
              <span>·</span>
              <span className="text-orange-600 dark:text-orange-400 truncate">
                {unhealthyReason}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="hidden md:flex flex-col items-end gap-1 w-24 shrink-0">
        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              utilization > 90
                ? "bg-orange-500"
                : utilization > 70
                ? "bg-amber-500"
                : "bg-emerald-500"
            )}
            style={{ width: `${utilization}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {Math.round(utilization)}%
        </span>
      </div>

      {tags.length > 0 && (
        <div className="hidden lg:flex items-center gap-1 shrink-0">
          {tags.slice(0, 2).map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="text-[9px] px-1 py-0 font-normal max-w-[80px] truncate"
            >
              {tag}
            </Badge>
          ))}
          {tags.length > 2 && (
            <HoverCard openDelay={120}>
              <HoverCardTrigger asChild>
                <span
                  className="text-[10px] text-muted-foreground tabular-nums cursor-default"
                  onClick={(e) => e.stopPropagation()}
                >
                  +{tags.length - 2}
                </span>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="end"
                className="w-auto max-w-[260px] p-2"
              >
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[10px] px-1 py-0 font-normal"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
          )}
        </div>
      )}
    </div>
  );
}

export const MailboxRow = memo(MailboxRowImpl);
