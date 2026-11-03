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
import { Globe, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useProvisionByoDomain, useByoJob } from "@/hooks/useByoServers";
import { DeployLogViewer } from "./DeployLogViewer";
import type { ByoServer } from "@/types/email";

interface ProvisionByoDomainDialogProps {
  server: ByoServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned?: (domainId: string) => void;
}

export function ProvisionByoDomainDialog({ server, open, onOpenChange, onProvisioned }: ProvisionByoDomainDialogProps) {
  const [domain, setDomain] = useState("");
  const [selector, setSelector] = useState("aca1");
  const [dmarcEmail, setDmarcEmail] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);

  const provision = useProvisionByoDomain();
  const { data: job } = useByoJob(jobId);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setDomain("");
        setSelector("aca1");
        setDmarcEmail("");
        setJobId(null);
        setDomainId(null);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Notify parent on completion so it can expand the new domain block.
  useEffect(() => {
    if (job?.status === "succeeded" && domainId && onProvisioned) {
      onProvisioned(domainId);
    }
  }, [job?.status, domainId, onProvisioned]);

  const valid = !!domain.trim() && !!selector.trim();
  const running = !!jobId && (job?.status === "pending" || job?.status === "running");
  const done = job?.status === "succeeded";
  const failed = job?.status === "failed";

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      const result = await provision.mutateAsync({
        server_id: server.id,
        domain: domain.trim(),
        dkim_selector: selector.trim(),
        dmarc_email: dmarcEmail.trim() || undefined,
      });
      setDomainId(result.domain_id);
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
            <Globe className="w-5 h-5" />
            Add a domain
          </DialogTitle>
          <DialogDescription>
            Generates a per-domain DKIM key on <code className="font-mono">{server.hostname}</code> and registers it
            with Postfix. You'll receive DNS records to add at your registrar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {!jobId && (
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="byo-domain">Domain</Label>
                <Input
                  id="byo-domain"
                  placeholder="sales.example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value.trim())}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Bare FQDN. Use a subdomain dedicated to outbound mail (recommended) so SPF/DMARC don't affect your main domain.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="byo-selector">DKIM selector</Label>
                  <Input
                    id="byo-selector"
                    placeholder="aca1"
                    value={selector}
                    onChange={(e) => setSelector(e.target.value.trim())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="byo-dmarc">DMARC report email</Label>
                  <Input
                    id="byo-dmarc"
                    placeholder="dmarc@example.com (optional)"
                    value={dmarcEmail}
                    onChange={(e) => setDmarcEmail(e.target.value.trim())}
                    autoComplete="off"
                  />
                </div>
              </div>
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
                  {job?.status === "running" && `Provisioning ${domain}...`}
                  {done && `${domain} provisioned. DNS records ready.`}
                  {failed && (job?.error_message || "Provisioning failed.")}
                </span>
              </div>
              <DeployLogViewer job={job} height="14rem" />

              {done && (
                <Alert className="border-green-500/30 bg-green-500/5">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertTitle>Add the DNS records</AlertTitle>
                  <AlertDescription>
                    Close this dialog. The domain row below will show a "DNS" button — click it to copy SPF/DKIM/DMARC values
                    into your registrar, then click "Verify DNS".
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
                {provision.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting...</> : "Provision"}
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
