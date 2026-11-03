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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Network, Loader2, CheckCircle2, XCircle, Info } from "lucide-react";
import { useAttachByoIp, useByoDomains, useByoJob } from "@/hooks/useByoServers";
import { DeployLogViewer } from "./DeployLogViewer";
import type { ByoServer } from "@/types/email";

interface AttachByoIpDialogProps {
  server: ByoServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const PTR_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$/;

export function AttachByoIpDialog({ server, open, onOpenChange }: AttachByoIpDialogProps) {
  const [ipAddress, setIpAddress] = useState("");
  const [ptrRecord, setPtrRecord] = useState("");
  const [domainId, setDomainId] = useState<string>("__unassigned");
  const [heloName, setHeloName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const { data: domains = [] } = useByoDomains(server.id);
  const attach = useAttachByoIp();
  const { data: job } = useByoJob(jobId);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setIpAddress("");
        setPtrRecord("");
        setDomainId("__unassigned");
        setHeloName("");
        setJobId(null);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const ipValid = IPV4_RE.test(ipAddress.trim());
  const ptrValid = !ptrRecord.trim() || PTR_RE.test(ptrRecord.trim());
  const heloValid = !heloName.trim() || PTR_RE.test(heloName.trim());
  const valid = ipValid && ptrValid && heloValid;

  const running = !!jobId && (job?.status === "pending" || job?.status === "running");
  const done = job?.status === "succeeded";
  const failed = job?.status === "failed";

  const submit = async () => {
    if (!valid) return;
    try {
      const result = await attach.mutateAsync({
        server_id: server.id,
        ip_address: ipAddress.trim(),
        ptr_record: ptrRecord.trim() || undefined,
        domain_id: domainId === "__unassigned" ? null : domainId,
        helo_name: heloName.trim() || undefined,
      });
      if (result.job_id) setJobId(result.job_id);
    } catch {
      // toast already shown
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            Attach a sending IP
          </DialogTitle>
          <DialogDescription>
            Registers an additional outbound IP on <code className="font-mono">{server.hostname}</code>.
            The IP must already be bound to the server's NIC by your hosting provider.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {!jobId && (
            <>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Provider prerequisite</AlertTitle>
                <AlertDescription>
                  Add the IP in your provider's control panel first (Hetzner: "Floating IPs" or "Additional IPv4";
                  OVH: "Additional IPs"; IONOS: "Server &rarr; IP &rarr; Add"). We probe that the IP is bound to a
                  local interface before configuring Postfix — attach will fail otherwise.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="byo-ip">IPv4 address</Label>
                  <Input
                    id="byo-ip"
                    placeholder="135.181.55.42"
                    value={ipAddress}
                    onChange={(e) => setIpAddress(e.target.value.trim())}
                    autoComplete="off"
                  />
                  {ipAddress && !ipValid && <p className="text-xs text-destructive">Must be a valid IPv4 address.</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="byo-ip-ptr">Reverse DNS (PTR record)</Label>
                  <Input
                    id="byo-ip-ptr"
                    placeholder="mail-2.acquist.io (set this at your provider)"
                    value={ptrRecord}
                    onChange={(e) => setPtrRecord(e.target.value.trim())}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional metadata. PTR is a hard deliverability requirement — set it in your provider's network panel
                    pointing to <code className="font-mono">{server.hostname}</code>.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="byo-ip-helo">HELO hostname (advanced)</Label>
                  <Input
                    id="byo-ip-helo"
                    placeholder={`135-181-55-42.${server.hostname}`}
                    value={heloName}
                    onChange={(e) => setHeloName(e.target.value.trim())}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Postfix advertises this name on outbound connections. Default is sane for most setups.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Pin to a domain (optional)</Label>
                  <Select value={domainId} onValueChange={setDomainId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned">Unassigned (any domain)</SelectItem>
                      {domains.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Cold-email best practice: one IP signs/sends from one domain to avoid cross-domain reputation bleed.
                  </p>
                </div>
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
                  {job?.status === "running" && `Configuring Postfix transport for ${ipAddress}...`}
                  {done && `${ipAddress} is now an active sending IP.`}
                  {failed && (job?.error_message || "Attach failed.")}
                </span>
              </div>
              <DeployLogViewer job={job} height="14rem" />

              {failed && job?.error_message?.includes("not bound") && (
                <Alert className="border-destructive/40 bg-destructive/5">
                  <Info className="h-4 w-4 text-destructive" />
                  <AlertTitle>IP isn't on the NIC yet</AlertTitle>
                  <AlertDescription>
                    Bind the IP at your hosting provider, or run on the server:
                    <code className="block mt-2 font-mono text-xs bg-muted/50 rounded px-2 py-1">
                      sudo ip addr add {ipAddress}/32 dev eth0
                    </code>
                    Then click "Retry" in the IP list.
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
              <Button variant="cta" onClick={submit} disabled={!valid || attach.isPending}>
                {attach.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting...</> : "Attach IP"}
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
