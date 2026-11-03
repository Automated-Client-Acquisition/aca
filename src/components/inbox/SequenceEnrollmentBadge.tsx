import { Link } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleCheck, Clock3, Mail, Megaphone, PauseCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useContactSequenceEnrollments,
  type ContactEnrollment,
  type EnrollmentSource,
} from "@/hooks/useContactSequenceEnrollments";

function detailPath(e: ContactEnrollment): string {
  return e.source === "email"
    ? `/email/sequences/${e.sequence_id}`
    : `/campaigns/${e.sequence_id}`;
}

function sourceLabel(source: EnrollmentSource): string {
  return source === "email" ? "Email sequence" : "LinkedIn campaign";
}

function nextActionLabel(enrollment: ContactEnrollment): string | null {
  if (!enrollment.next_action_at) return null;

  const nextAction = new Date(enrollment.next_action_at);
  if (Number.isNaN(nextAction.getTime())) return null;

  const distance = formatDistanceToNowStrict(nextAction, { addSuffix: true });
  return enrollment.enrollment_status === "paused"
    ? `Resumes ${distance}`
    : `Next email ${distance}`;
}

function stateLabel(enrollment: ContactEnrollment): string {
  if (enrollment.is_followup) {
    if (enrollment.enrollment_status === "paused") return "Follow-up paused";
    if (enrollment.enrollment_status === "sender_disconnected") return "Follow-up blocked";
    if (enrollment.is_active) return "Follow-up active";
    return "Follow-up ended";
  }

  return enrollment.is_active ? "Enrolled" : "Enrollment ended";
}

interface SequenceEnrollmentBadgeProps {
  contactId: string | null | undefined;
  className?: string;
}

/**
 * Persistent Inbox status showing which campaign / sequence the lead is in.
 * Lead-magnet recovery enrollments are prioritized and named explicitly so the
 * operator can confirm that delivery actually armed the promised follow-up.
 */
export function SequenceEnrollmentBadge({
  contactId,
  className,
}: SequenceEnrollmentBadgeProps) {
  const { data: enrollments } = useContactSequenceEnrollments(contactId);

  if (!enrollments || enrollments.length === 0) {
    return null;
  }

  // The RPC returns recovery-first, but keep the UI resilient to cached v1 rows
  // during a rolling deployment.
  const primary =
    enrollments.find(
      (enrollment) => enrollment.is_followup && enrollment.enrollment_status === "active"
    ) ||
    enrollments.find((enrollment) => enrollment.is_followup && enrollment.is_active) ||
    enrollments.find((enrollment) => enrollment.is_followup) ||
    enrollments.find((enrollment) => enrollment.is_active) ||
    enrollments[0];
  const extra = enrollments.length - 1;
  const isPaused = primary.enrollment_status === "paused";
  const isBlocked = primary.enrollment_status === "sender_disconnected";
  const Icon = primary.is_followup
    ? isPaused
      ? PauseCircle
      : isBlocked
        ? Clock3
        : CircleCheck
    : primary.source === "email"
      ? Mail
      : Megaphone;
  const primaryStateLabel = stateLabel(primary);
  const timingLabel = nextActionLabel(primary);

  const badge = (
    <Badge
      variant="outline"
      aria-label={`${primaryStateLabel}: ${primary.sequence_name}`}
      className={cn(
        "h-5 max-w-[280px] gap-1.5 px-2 text-[10px] font-medium cursor-pointer transition-colors",
        primary.is_followup && primary.is_active && !isPaused && !isBlocked
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
          : isPaused
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
            : isBlocked
              ? "border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300"
              : primary.is_active
                ? "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:text-sky-300"
                : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/60",
        className
      )}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="flex-shrink-0">{primaryStateLabel}</span>
      <span aria-hidden="true" className="opacity-50">·</span>
      <span className="truncate font-normal">{primary.sequence_name}</span>
      {extra > 0 && <span className="flex-shrink-0 opacity-70">+{extra}</span>}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={detailPath(primary)}>{badge}</Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-xs font-medium">{primaryStateLabel}</p>
        <p className="mt-0.5 max-w-[260px] truncate text-[11px]">
          {primary.sequence_name}
        </p>
        {timingLabel && (
          <p className="mt-1 text-[10px] text-muted-foreground">{timingLabel}</p>
        )}
        {enrollments.length > 1 && (
          <p className="mb-1 mt-2 border-t pt-2 text-[10px] font-medium text-muted-foreground">
            All enrollments
          </p>
        )}
        <div className={cn("space-y-1", enrollments.length === 1 && "hidden")}>
          {enrollments.map((e) => (
            <div
              key={e.enrollment_id || `${e.source}-${e.sequence_id}`}
              className="flex items-center gap-1.5 text-[11px]"
            >
              {e.source === "email" ? (
                <Mail className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              ) : (
                <Megaphone className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              )}
              <span className="max-w-[180px] truncate">{e.sequence_name}</span>
              <span
                className={cn(
                  "ml-auto pl-2 capitalize flex-shrink-0",
                  e.is_active ? "text-green-600" : "text-muted-foreground"
                )}
              >
                {e.enrollment_status.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {sourceLabel(primary.source)} · click to open
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
