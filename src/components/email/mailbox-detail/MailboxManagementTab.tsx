import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { MailboxHealthBadge } from "@/components/email/MailboxHealthBadge";
import {
  useUpdateMailboxStatus,
  useDisconnectMailbox,
  useUpdateMailboxCredentials,
  useBulkRetestConnection,
} from "@/hooks/useEmailMailboxes";
import { cn } from "@/lib/utils";
import {
  Pause,
  Play,
  Unplug,
  AlertTriangle,
  ShieldAlert,
  XCircle,
  RefreshCw,
  Loader2,
  KeyRound,
} from "lucide-react";
import type { EmailMailbox } from "@/types/email";

interface MailboxManagementTabProps {
  mailbox: EmailMailbox;
}

export function MailboxManagementTab({ mailbox }: MailboxManagementTabProps) {
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showCredForm, setShowCredForm] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapUsername, setImapUsername] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const updateStatus = useUpdateMailboxStatus();
  const disconnectMailbox = useDisconnectMailbox();
  const updateCredentials = useUpdateMailboxCredentials();
  const retestConnection = useBulkRetestConnection();

  const quotaPercentage =
    mailbox.daily_limit > 0
      ? Math.min((mailbox.daily_sent / mailbox.daily_limit) * 100, 100)
      : 0;

  const isActive = mailbox.status === "ready";

  const handlePause = () => {
    updateStatus.mutate({ id: mailbox.id, status: "paused" });
  };

  const handleResume = () => {
    updateStatus.mutate({ id: mailbox.id, status: "ready" });
  };

  const handleDisconnect = () => {
    disconnectMailbox.mutate(mailbox.id, {
      onSuccess: () => setShowDisconnectDialog(false),
    });
  };

  return (
    <div className="space-y-6">
      {/* Health Alerts */}
      {mailbox.health_score < 0.5 && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Critical Health Score</AlertTitle>
          <AlertDescription>
            This mailbox has a health score of{" "}
            {Math.round(mailbox.health_score * 100)}%. Consider pausing sends
            and investigating deliverability issues.
          </AlertDescription>
        </Alert>
      )}
      {mailbox.bounce_rate > 0.05 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>High Bounce Rate</AlertTitle>
          <AlertDescription>
            Bounce rate is {(mailbox.bounce_rate * 100).toFixed(1)}% (threshold:
            5%). This mailbox may be auto-paused to protect sender reputation.
          </AlertDescription>
        </Alert>
      )}
      {mailbox.spam_rate > 0.01 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Spam Complaints Detected</AlertTitle>
          <AlertDescription>
            Spam complaint rate is {(mailbox.spam_rate * 100).toFixed(2)}%.
            Review recent sends and consider warming down.
          </AlertDescription>
        </Alert>
      )}

      {/* IMAP Auth Error + Credential Update */}
      {(mailbox.metadata as any)?.imap_auth_error && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-sm font-medium text-amber-600 dark:text-amber-400">
                IMAP Authentication Failed
              </CardTitle>
            </div>
            <CardDescription>
              Inbound email polling is disabled. Update your IMAP credentials below and re-test, or run a connection check to retry with existing credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => retestConnection.mutate([mailbox.id])}
                disabled={retestConnection.isPending}
              >
                {retestConnection.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Re-test Connection
              </Button>
              <Button
                variant="cta"
                size="sm"
                onClick={() => setShowCredForm(!showCredForm)}
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {showCredForm ? "Hide Form" : "Update Credentials"}
              </Button>
            </div>

            {showCredForm && (
              <div className="space-y-4 pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  Only fill in the fields you want to change. Leave blank to keep existing values.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SMTP (Outgoing)</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Host</Label>
                      <Input
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="e.g. smtp.gmail.com"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Port</Label>
                      <Input
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        placeholder="587"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Username</Label>
                      <Input
                        value={smtpUsername}
                        onChange={(e) => setSmtpUsername(e.target.value)}
                        placeholder="email@example.com"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Password</Label>
                      <Input
                        type="password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        placeholder="App password"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IMAP (Incoming)</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Host</Label>
                      <Input
                        value={imapHost}
                        onChange={(e) => setImapHost(e.target.value)}
                        placeholder="e.g. imap.gmail.com"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Port</Label>
                      <Input
                        value={imapPort}
                        onChange={(e) => setImapPort(e.target.value)}
                        placeholder="993"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Username</Label>
                      <Input
                        value={imapUsername}
                        onChange={(e) => setImapUsername(e.target.value)}
                        placeholder="email@example.com"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Password</Label>
                      <Input
                        type="password"
                        value={imapPassword}
                        onChange={(e) => setImapPassword(e.target.value)}
                        placeholder="App password"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
                <Button
                  variant="cta"
                  onClick={() => {
                    updateCredentials.mutate({
                      mailboxId: mailbox.id,
                      ...(smtpHost && { smtp_host: smtpHost }),
                      ...(smtpPort && { smtp_port: Number(smtpPort) }),
                      ...(smtpUsername && { smtp_username: smtpUsername }),
                      ...(smtpPassword && { smtp_password: smtpPassword }),
                      ...(imapHost && { imap_host: imapHost }),
                      ...(imapPort && { imap_port: Number(imapPort) }),
                      ...(imapUsername && { imap_username: imapUsername }),
                      ...(imapPassword && { imap_password: imapPassword }),
                    }, {
                      onSuccess: () => {
                        setShowCredForm(false);
                        setImapHost("");
                        setImapPort("993");
                        setImapUsername("");
                        setImapPassword("");
                        setSmtpHost("");
                        setSmtpPort("587");
                        setSmtpUsername("");
                        setSmtpPassword("");
                      },
                    });
                  }}
                  disabled={updateCredentials.isPending}
                >
                  {updateCredentials.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Test &amp; Save Credentials
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Daily Send Quota */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Daily Send Quota
          </CardTitle>
          <CardDescription>
            Current sending limits and usage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Emails sent today</span>
            <span className="text-lg font-bold tabular-nums">
              {mailbox.daily_sent}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {mailbox.daily_limit}
              </span>
            </span>
          </div>
          <Progress
            value={quotaPercentage}
            className={cn(
              "h-2",
              quotaPercentage >= 100 && "[&>div]:bg-amber-500"
            )}
          />
          <p className="text-xs text-muted-foreground">
            Resets at midnight UTC (last reset:{" "}
            {new Date(mailbox.daily_sent_reset_at).toLocaleDateString()})
          </p>
        </CardContent>
      </Card>

      {/* Status Management */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Status Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Current Status</p>
              <div className="mt-1">
                <MailboxHealthBadge
                  status={mailbox.status}
                  imapConnected={mailbox.imap_connected}
                  healthScore={mailbox.health_score}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            {isActive && (
              <Button
                variant="outline"
                onClick={handlePause}
                disabled={updateStatus.isPending}
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause Mailbox
              </Button>
            )}
            {mailbox.status === "paused" && (
              <Button
                variant="outline"
                onClick={handleResume}
                disabled={updateStatus.isPending}
              >
                <Play className="h-4 w-4 mr-2" />
                Resume Mailbox
              </Button>
            )}
            {mailbox.status !== "disconnected" && (
              <Button
                variant="destructive"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={disconnectMailbox.isPending}
              >
                <Unplug className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Last Error</CardTitle>
        </CardHeader>
        <CardContent>
          {mailbox.last_error ? (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400 font-mono">
                {mailbox.last_error}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent errors</p>
          )}
        </CardContent>
      </Card>

      {/* Disconnect Confirmation */}
      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Mailbox?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect {mailbox.email_address} from your account. The
              mailbox will no longer be used for sending emails. Active sequence
              enrollments using this mailbox will need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
