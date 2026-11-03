import { Link } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSendingHealth } from "@/hooks/useSendingHealth";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// One-line heads-up at the top of Automations / Sequences when the accounts
// they send from need attention. Senders and Mailboxes live in Settings now,
// so this is where a broken one gets noticed before a campaign quietly stalls.
export function SendingHealthAlert({ channel }: { channel: "social" | "email" }) {
  const { data: health } = useSendingHealth();
  if (!health) return null;

  if (channel === "social") {
    if (health.brokenSenders === 0) return null;
    return (
      <AlertRow
        tone="warning"
        message={`${plural(health.brokenSenders, "LinkedIn or social account needs", "LinkedIn or social accounts need")} reconnecting and can't send until then.`}
        cta="Reconnect"
        to="/settings?tab=senders"
      />
    );
  }

  if (health.disconnectedMailboxes > 0) {
    const alsoPaused = health.autoPausedMailboxes > 0
      ? ` ${plural(health.autoPausedMailboxes, "more is", "more are")} paused automatically.`
      : "";
    return (
      <AlertRow
        tone="warning"
        message={`${plural(health.disconnectedMailboxes, "mailbox is", "mailboxes are")} disconnected and can't send.${alsoPaused}`}
        cta="Review mailboxes"
        to="/settings?tab=mailboxes&status=disconnected"
      />
    );
  }

  if (health.autoPausedMailboxes > 0) {
    return (
      <AlertRow
        tone="info"
        message={`${plural(health.autoPausedMailboxes, "mailbox is", "mailboxes are")} paused automatically (resting domain, tenant or bounce issue). Sequences send from the rest.`}
        cta="View mailboxes"
        to="/settings?tab=mailboxes&status=paused"
      />
    );
  }

  return null;
}

function AlertRow({
  tone,
  message,
  cta,
  to,
}: {
  tone: "warning" | "info";
  message: string;
  cta: string;
  to: string;
}) {
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={
        tone === "warning"
          ? "flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5"
          : "flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5"
      }
    >
      <Icon
        className={tone === "warning" ? "h-4 w-4 shrink-0 text-amber-500" : "h-4 w-4 shrink-0 text-muted-foreground"}
      />
      <p className={tone === "warning" ? "flex-1 min-w-0 text-sm" : "flex-1 min-w-0 text-sm text-muted-foreground"}>
        {message}
      </p>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link to={to}>{cta}</Link>
      </Button>
    </div>
  );
}
