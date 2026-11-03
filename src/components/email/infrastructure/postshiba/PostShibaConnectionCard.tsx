import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, KeyRound, RefreshCw, Send, Unplug, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDisconnectPostShiba,
  formatPostShibaClassification,
  type PostShibaConnection,
  type PostShibaConnectionStatus,
} from "@/hooks/usePostShiba";
import { StatusPill, relativeTime, type Tone } from "./postshiba-shared";

const STATUS_DISPLAY: Record<PostShibaConnectionStatus, { label: string; tone: Tone; explanation?: string }> = {
  active: { label: "Connected", tone: "green" },
  suspended: {
    label: "Suspended",
    tone: "red",
    explanation: "PostShiba suspended this organization's tenant, so its senders can't send.",
  },
  operator_hold: {
    label: "On hold",
    tone: "red",
    explanation: "PostShiba's abuse team paused this tenant. Contact PostShiba support to lift the hold.",
  },
  team_suspended: {
    label: "Team suspended",
    tone: "red",
    explanation: "Your PostShiba team is suspended. Contact PostShiba support.",
  },
  invalid: {
    label: "Key invalid",
    tone: "red",
    explanation: "The API key stopped working (revoked or expired). Reconnect with a new key.",
  },
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

interface Props {
  connection: PostShibaConnection;
  onReconnect: () => void;
}

export function PostShibaConnectionCard({ connection, onReconnect }: Props) {
  const disconnect = useDisconnectPostShiba();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const status = STATUS_DISPLAY[connection.status] ?? { label: connection.status, tone: "neutral" as Tone };
  const isActive = connection.status === "active";
  const transactional = connection.cluster_classification === "transactional";

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cta/30 text-foreground">
              <Send className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">PostShiba</h3>
                <StatusPill tone={status.tone} icon={isActive ? CheckCircle2 : XCircle}>
                  {status.label}
                </StatusPill>
              </div>
              <p className="text-xs text-muted-foreground">
                Sending through <span className="font-medium text-foreground">{connection.cluster_name}</span>,
                up to {connection.emails_per_day.toLocaleString()} emails a day
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Manage
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={onReconnect}>
                <RefreshCw className="h-4 w-4" />
                Change cluster, tenant or API key
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmDisconnect(true)}
                className="text-destructive focus:text-destructive"
              >
                <Unplug className="h-4 w-4" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {!isActive && status.explanation && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2 text-sm">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <span>{status.explanation}</span>
            </div>
            {connection.status === "invalid" && (
              <Button variant="cta" size="sm" className="flex-shrink-0 self-start sm:self-auto" onClick={onReconnect}>
                <KeyRound className="h-3.5 w-3.5" />
                Reconnect
              </Button>
            )}
          </div>
        )}

        {isActive && connection.last_error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <span>{connection.last_error}</span>
          </div>
        )}

        {isActive && transactional && (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <span>
                This is a <span className="font-medium">Transactional</span> cluster. Cold email is
                better on a Bulk cluster, so it can't hurt the reputation of your transactional mail.
              </span>
            </div>
            <Button variant="outline" size="sm" className="flex-shrink-0 self-start bg-background sm:self-auto" onClick={onReconnect}>
              Change cluster
            </Button>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg bg-muted/30 px-4 py-3 sm:grid-cols-5">
          <Fact label="Team">
            <span className="font-mono text-xs">{connection.team_id}</span>
          </Fact>
          <Fact label="Tenant">{connection.tenant_name || connection.tenant_slug}</Fact>
          <Fact label="Cluster">
            <span className="capitalize">{connection.cluster_plan}</span> ·{" "}
            {formatPostShibaClassification(connection.cluster_classification)}
          </Fact>
          <Fact label="API key">
            <span className="font-mono text-xs">{connection.api_key_hint}</span>
          </Fact>
          <Fact label="Last checked">{relativeTime(connection.last_validated_at)}</Fact>
        </dl>
      </CardContent>

      <AlertDialog open={confirmDisconnect} onOpenChange={(open) => !disconnect.isPending && setConfirmDisconnect(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect PostShiba?</AlertDialogTitle>
            <AlertDialogDescription>
              Every PostShiba sender in this organization stops sending. Domains and inboxes stay in
              your PostShiba team, and you can reconnect later with a team id and API key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={disconnect.isPending}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await disconnect.mutateAsync();
                  setConfirmDisconnect(false);
                } catch {
                  // useDisconnectPostShiba toasts the error; keep the dialog open.
                }
              }}
            >
              {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
