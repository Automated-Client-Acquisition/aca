import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Mail, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useByoJob, useProvisionByoMailbox } from "@/hooks/useByoServers";
import { DeployLogViewer } from "./DeployLogViewer";
import type { EmailSendingDomain } from "@/types/email";

interface AddByoMailboxDialogProps {
  domain: EmailSendingDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned?: (mailboxId: string) => void;
}

export function AddByoMailboxDialog({ domain, open, onOpenChange, onProvisioned }: AddByoMailboxDialogProps) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [dailyLimit, setDailyLimit] = useState("5");
  const [jobId, setJobId] = useState<string | null>(null);
  const [mailboxId, setMailboxId] = useState<string | null>(null);

  const provision = useProvisionByoMailbox();
  const { data: job } = useByoJob(jobId);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setUsername("");
        setDisplayName("");
        setDailyLimit("5");
        setJobId(null);
        setMailboxId(null);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (job?.status === "succeeded" && mailboxId && onProvisioned) {
      onProvisioned(mailboxId);
    }
  }, [job?.status, mailboxId, onProvisioned]);

  const limitInt = parseInt(dailyLimit, 10);
  const valid =
    !!username.trim() &&
    !!displayName.trim() &&
    /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(username.trim().toLowerCase()) &&
    Number.isInteger(limitInt) && limitInt >= 1 && limitInt <= 200;

  const running = !!jobId && (job?.status === "pending" || job?.status === "running");
  const done = job?.status === "succeeded";
  const failed = job?.status === "failed";

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      const result = await provision.mutateAsync({
        domain_id: domain.id,
        username: username.trim().toLowerCase(),
        display_name: displayName.trim(),
        daily_limit: limitInt,
      });
      setMailboxId(result.mailbox_id);
      setJobId(result.job_id);
    } catch {
      // toast already shown
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Add a mailbox
          </DialogTitle>
          <DialogDescription>
            Creates a virtual mailbox at <code className="font-mono">@{domain.domain}</code>.
            Plugs into the same unified inbox, sequences, and warmup pipeline used by all other mailboxes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {!jobId && (
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="byo-mbx-user">Username (local part)</Label>
                <div className="flex items-center gap-1">
                  <Input
                    id="byo-mbx-user"
                    placeholder="cedric"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.trim().toLowerCase())}
                    autoComplete="off"
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground font-mono whitespace-nowrap">
                    @{domain.domain}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Lowercase alphanumeric (with . _ -). Becomes both the SASL username and the From address.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="byo-mbx-name">Display name</Label>
                <Input
                  id="byo-mbx-name"
                  placeholder="Cedric Seguela"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Shown in the From: header. Most cold-email best practices: use a real human name.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="byo-mbx-limit">Initial daily limit</Label>
                <Input
                  id="byo-mbx-limit"
                  type="number"
                  min={1}
                  max={200}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  Conservative for cold email: 5/day on day 1, ramping ~5/day per the global warmup config until it stabilizes.
                </p>
              </div>
              {!domain.dkim_verified && (
                <Alert className="border-amber-500/40 bg-amber-500/5">
                  <AlertTitle>DNS not fully verified</AlertTitle>
                  <AlertDescription>
                    SPF or DKIM hasn't propagated yet for <code className="font-mono">{domain.domain}</code>. You can still
                    create the mailbox and warm it up, but deliverability will be poor until DNS is live. Click "Verify DNS"
                    on the domain row to recheck.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {jobId && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                {done ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                 failed ? <XCircle className="w-4 h-4 text-destructive" /> :
                 <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {!job && "Queuing job..."}
                  {job?.status === "pending" && "Waiting for deployer..."}
                  {job?.status === "running" && `Provisioning ${username}@${domain.domain}...`}
                  {done && `${username}@${domain.domain} created and connected.`}
                  {failed && (job?.error_message || "Provisioning failed.")}
                </span>
              </div>
              <DeployLogViewer job={job} height="14rem" />

              {done && (
                <Alert className="border-green-500/30 bg-green-500/5">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertTitle>Mailbox is in the warmup pool</AlertTitle>
                  <AlertDescription>
                    The mailbox now flows through the existing send and IMAP pipeline. It will appear in the unified inbox,
                    can be enrolled in sequences, and will warm up automatically per your warmup config.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {!jobId && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="cta" onClick={handleSubmit} disabled={!valid || provision.isPending}>
                {provision.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting...</> : "Create"}
              </Button>
            </>
          )}
          {jobId && (
            <Button variant={done ? "cta" : "outline"} onClick={() => onOpenChange(false)} disabled={running}>
              {done ? "Done" : failed ? "Close" : "Hide (still running)"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
