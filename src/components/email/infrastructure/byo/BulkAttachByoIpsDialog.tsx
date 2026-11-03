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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Network, CheckCircle2, AlertCircle } from "lucide-react";
import { useBulkAttachByoIp } from "@/hooks/useByoServers";
import type { ByoServer, EmailSendingDomain } from "@/types/email";

interface BulkAttachByoIpsDialogProps {
  server: ByoServer;
  domains: EmailSendingDomain[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

function previewCount(cidr: string): number | null {
  const m = CIDR_RE.exec(cidr.trim());
  if (!m) return null;
  const prefix = parseInt(m[5], 10);
  if (prefix < 22 || prefix > 32) return null;
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return Math.pow(2, 32 - prefix) - 2;
}

export function BulkAttachByoIpsDialog({ server, domains, open, onOpenChange }: BulkAttachByoIpsDialogProps) {
  const [cidr, setCidr] = useState("");
  const [domainId, setDomainId] = useState<string | "none">("none");
  const [excludeRaw, setExcludeRaw] = useState("");
  const [heloName, setHeloName] = useState("");
  const [result, setResult] = useState<{
    enqueued: number;
    failed: number;
    skipped: number;
    expanded: number;
  } | null>(null);

  const bulkAttach = useBulkAttachByoIp();

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setCidr("");
        setDomainId("none");
        setExcludeRaw("");
        setHeloName("");
        setResult(null);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const count = previewCount(cidr);
  const valid = count !== null && count > 0;

  const handleSubmit = async () => {
    if (!valid) return;
    const exclude = excludeRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s));
    try {
      const r = await bulkAttach.mutateAsync({
        server_id: server.id,
        cidr: cidr.trim(),
        domain_id: domainId === "none" ? null : domainId,
        helo_name: heloName.trim() || undefined,
        exclude,
      });
      setResult({
        enqueued: r.enqueued_count,
        failed: r.failed_count,
        skipped: r.skipped_existing_count,
        expanded: r.expanded_count,
      });
    } catch {
      // toast already shown
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            Bulk attach IPs from CIDR
          </DialogTitle>
          <DialogDescription>
            Expand a CIDR block (e.g. your IPXO /24) into individual IPs and attach all of them to{" "}
            <code className="font-mono">{server.hostname}</code>. Network and broadcast addresses are skipped.
            Each IP enters warmup independently.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-cidr">CIDR block</Label>
              <Input
                id="bulk-cidr"
                placeholder="5.6.7.0/24"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                className="font-mono"
                autoComplete="off"
              />
              {cidr && count !== null && (
                <p className="text-xs text-muted-foreground">
                  Will register <strong>{count}</strong> IP{count === 1 ? "" : "s"} in the pool.
                  The deployer attaches them sequentially; expect 5-15 minutes for a /24.
                </p>
              )}
              {cidr && count === null && (
                <p className="text-xs text-destructive">
                  Invalid CIDR. Use IPv4 with prefix /22 to /32.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-domain">Pin every IP to a domain (optional)</Label>
              <select
                id="bulk-domain"
                value={domainId}
                onChange={(e) => setDomainId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="none">Leave unassigned (any domain on this server can use them)</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>{d.domain}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Best practice for cold email: pin one /24 per sending domain.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-exclude">Exclude IPs (optional)</Label>
              <Textarea
                id="bulk-exclude"
                placeholder="5.6.7.1, 5.6.7.2"
                value={excludeRaw}
                onChange={(e) => setExcludeRaw(e.target.value)}
                rows={2}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Comma- or space-separated. Useful for skipping the gateway (.1) or IPs already used by other services.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-helo">HELO/EHLO override (optional)</Label>
              <Input
                id="bulk-helo"
                placeholder="mail.example.com"
                value={heloName}
                onChange={(e) => setHeloName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Apply this HELO name to every IP in the batch. Leave blank to use each IP's PTR record.
              </p>
            </div>

            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Hosting provider must already route these IPs to the server.</AlertTitle>
              <AlertDescription>
                We don't provision IPs at the cloud provider — that's the user's responsibility (Hetzner Robot,
                IPXO control panel, etc.). This dialog only registers IPs that the server already has on its NIC.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {result && (
          <div className="space-y-3 py-2">
            <Alert className={result.failed > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}>
              {result.failed > 0 ? <AlertCircle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
              <AlertTitle>
                {result.enqueued} IP{result.enqueued === 1 ? "" : "s"} queued for attach
              </AlertTitle>
              <AlertDescription>
                <div className="text-xs space-y-1 mt-1">
                  <div>CIDR expanded to {result.expanded} usable hosts.</div>
                  {result.skipped > 0 && <div>{result.skipped} already attached or active — skipped.</div>}
                  {result.failed > 0 && <div className="text-destructive">{result.failed} failed to enqueue. Retry the failed IPs individually.</div>}
                </div>
              </AlertDescription>
            </Alert>
            <p className="text-xs text-muted-foreground">
              Watch the IP table on the server card to see each IP transition <code>pending → active</code>.
              The DNSBL cron will sweep them within 4 hours.
            </p>
          </div>
        )}

        <DialogFooter>
          {!result && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulkAttach.isPending}>
                Cancel
              </Button>
              <Button variant="cta" onClick={handleSubmit} disabled={!valid || bulkAttach.isPending}>
                {bulkAttach.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Attaching...</>
                ) : (
                  `Attach ${count ?? 0} IP${count === 1 ? "" : "s"}`
                )}
              </Button>
            </>
          )}
          {result && (
            <Button variant="cta" onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
