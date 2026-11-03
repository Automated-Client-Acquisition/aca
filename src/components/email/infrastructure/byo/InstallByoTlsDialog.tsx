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
import { Lock, Loader2, CheckCircle2, XCircle, Info } from "lucide-react";
import { useByoJob, useInstallByoTls } from "@/hooks/useByoServers";
import { DeployLogViewer } from "./DeployLogViewer";
import type { ByoServer } from "@/types/email";

interface InstallByoTlsDialogProps {
  server: ByoServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default admin email — usually the logged-in user's email */
  defaultAdminEmail?: string;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function InstallByoTlsDialog({ server, open, onOpenChange, defaultAdminEmail }: InstallByoTlsDialogProps) {
  const [adminEmail, setAdminEmail] = useState(defaultAdminEmail ?? "");
  const [jobId, setJobId] = useState<string | null>(null);
  const install = useInstallByoTls();
  const { data: job } = useByoJob(jobId);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setJobId(null);
        setAdminEmail(defaultAdminEmail ?? "");
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open, defaultAdminEmail]);

  const valid = EMAIL_RE.test(adminEmail.trim());
  const running = !!jobId && (job?.status === "pending" || job?.status === "running");
  const done = job?.status === "succeeded";
  const failed = job?.status === "failed";

  const submit = async () => {
    if (!valid) return;
    try {
      const r = await install.mutateAsync({ server_id: server.id, admin_email: adminEmail.trim() });
      setJobId(r.job_id);
    } catch {
      // toast already shown
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Install TLS — {server.name}
          </DialogTitle>
          <DialogDescription>
            Issues a Let's Encrypt cert for <code className="font-mono">{server.hostname}</code> and swaps Postfix + Dovecot
            from snakeoil to the trusted cert. Required for inbound TLS reputation with Gmail / Yahoo / Outlook.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {!jobId && (
            <>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Prerequisite: A record on the HELO</AlertTitle>
                <AlertDescription>
                  <code className="font-mono">{server.hostname}</code> must already have a DNS A record pointing to one of this server's IPs.
                  We verify before running certbot — if it doesn't, the install will fail with a clear message.
                </AlertDescription>
              </Alert>

              <div className="space-y-1.5">
                <Label htmlFor="byo-tls-email">Admin email</Label>
                <Input
                  id="byo-tls-email"
                  placeholder="ops@example.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value.trim())}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Let's Encrypt sends renewal-failure notifications here (rare). Used as the certbot account email.
                </p>
              </div>

              <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3 space-y-1">
                <div>What runs:</div>
                <div>1. apt install certbot (if missing)</div>
                <div>2. Verify HELO A record points to a NIC IP</div>
                <div>3. certbot certonly --standalone (binds :80, returns in ~30s)</div>
                <div>4. Update postfix main.cf cert paths + dovecot ssl_cert</div>
                <div>5. Install renewal-hook to reload services on auto-renew</div>
                <div>6. Reload postfix + dovecot</div>
              </div>
            </>
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
                  {job?.status === "running" && `Installing TLS for ${server.hostname}...`}
                  {done && "TLS installed and active. Cert auto-renews via certbot's systemd timer."}
                  {failed && (job?.error_message || "TLS install failed.")}
                </span>
              </div>
              <DeployLogViewer job={job} height="18rem" />
            </div>
          )}
        </div>

        <DialogFooter>
          {!jobId && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="cta" onClick={submit} disabled={!valid || install.isPending}>
                {install.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting...</> : "Install TLS"}
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
