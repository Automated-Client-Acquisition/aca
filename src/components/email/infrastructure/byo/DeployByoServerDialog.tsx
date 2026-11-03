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
import { CheckCircle2, XCircle, Loader2, Rocket } from "lucide-react";
import { useDeployByoServer, useByoJob } from "@/hooks/useByoServers";
import { DeployLogViewer } from "./DeployLogViewer";
import type { ByoServer } from "@/types/email";

interface DeployByoServerDialogProps {
  server: ByoServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeployByoServerDialog({ server, open, onOpenChange }: DeployByoServerDialogProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const deploy = useDeployByoServer();
  const { data: job } = useByoJob(jobId);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setJobId(null), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const start = async () => {
    try {
      const result = await deploy.mutateAsync(server.id);
      setJobId(result.job_id);
    } catch {
      // hook already toasted
    }
  };

  const running = !!jobId && (job?.status === "pending" || job?.status === "running");
  const done = job?.status === "succeeded";
  const failed = job?.status === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            Deploy mail stack — {server.name}
          </DialogTitle>
          <DialogDescription>
            Installs Postfix, OpenDKIM, Dovecot, ufw, and fail2ban on{" "}
            <code className="font-mono">{server.hostname}</code>. Runs idempotently — safe to re-run on a partial install.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
          {!jobId && (
            <div className="space-y-3">
              <ul className="text-sm space-y-1.5 text-muted-foreground">
                <li>• apt install postfix postfix-pcre opendkim opendkim-tools dovecot ufw fail2ban</li>
                <li>• Create vmail user, /var/mail/vhosts, /etc/postfix/byo/ split files</li>
                <li>• Write base main.cf / master.cf with SASL via Dovecot, milter on port 8891</li>
                <li>• Open ports 22, 25, 465, 587, 993 in ufw</li>
                <li>• Enable + start postfix, opendkim, dovecot</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Typical runtime: 3-7 minutes depending on your server's apt mirror. Live log streams below.
              </p>
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
                  {job?.status === "running" && "Installing and configuring mail stack..."}
                  {done && "Mail stack deployed. You can now provision domains."}
                  {failed && (job?.error_message || "Deployment failed.")}
                </span>
              </div>
              <DeployLogViewer job={job} height="22rem" />
            </div>
          )}
        </div>

        <DialogFooter>
          {!jobId && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="cta" onClick={start} disabled={deploy.isPending}>
                {deploy.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting...</> : <>Deploy</>}
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
