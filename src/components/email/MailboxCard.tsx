import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MailboxHealthBadge } from "./MailboxHealthBadge";
import {
  MoreHorizontal,
  Pause,
  Play,
  Unplug,
  Mail,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { EmailMailbox } from "@/types/email";

interface MailboxCardProps {
  mailbox: EmailMailbox;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDisconnect: (id: string) => void;
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

export function MailboxCard({
  mailbox,
  onPause,
  onResume,
  onDisconnect,
}: MailboxCardProps) {
  const quotaPercentage =
    mailbox.daily_limit > 0
      ? Math.min((mailbox.daily_sent / mailbox.daily_limit) * 100, 100)
      : 0;

  const provider = mailbox.provider || "smtp";
  const isActive = mailbox.status === "ready";

  return (
    <Card
      className={cn(
        "transition-all duration-200 hover:shadow-md",
        mailbox.status === "burned" && "border-red-500/30 bg-red-500/5",
        mailbox.status === "paused" && "opacity-75"
      )}
    >
      <CardContent className="p-5 space-y-4">
        {/* Header: Email + Provider + Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border text-sm font-bold",
                PROVIDER_COLORS[provider] || PROVIDER_COLORS.smtp
              )}
            >
              {PROVIDER_ICONS[provider] || "S"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {mailbox.email_address}
              </p>
              {mailbox.display_name && (
                <p className="text-xs text-muted-foreground truncate">
                  {mailbox.display_name}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <MailboxHealthBadge
              status={mailbox.status}
              imapConnected={mailbox.imap_connected}
              healthScore={mailbox.health_score}
              warmupEnabled={mailbox.warmup_enabled}
              warmupDay={mailbox.warmup_day}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {mailbox.status === "paused" && (
                  <DropdownMenuItem onClick={() => onResume(mailbox.id)}>
                    <Play className="h-4 w-4 mr-2" />
                    Resume
                  </DropdownMenuItem>
                )}
                {isActive && (
                  <DropdownMenuItem onClick={() => onPause(mailbox.id)}>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
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
          </div>
        </div>

        {/* Daily Quota */}
        {mailbox.status !== "disconnected" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Mail className="h-3 w-3" />
                Today's sends
              </span>
              <span className="font-medium tabular-nums">
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
        )}

        {/* Footer: Rates + Last Send */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
          <div className="flex items-center gap-3">
            <span>
              Bounce: <span className={cn("font-medium", mailbox.bounce_rate > 0.05 ? "text-red-500" : "text-foreground")}>{(mailbox.bounce_rate * 100).toFixed(1)}%</span>
            </span>
            <span>
              Reply: <span className="font-medium text-foreground">{(mailbox.reply_rate * 100).toFixed(1)}%</span>
            </span>
          </div>
          {mailbox.last_send_at && (
            <span>
              Last sent{" "}
              {formatDistanceToNow(new Date(mailbox.last_send_at), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>

        {/* IMAP Auth Error Banner */}
        {(mailbox.metadata as any)?.imap_auth_error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 line-clamp-2">
              {(mailbox.metadata as any).imap_auth_error}
            </p>
          </div>
        )}

        {/* Error Banner */}
        {mailbox.last_error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-600 line-clamp-2">
              {mailbox.last_error}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
