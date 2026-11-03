import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Globe,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  FileText,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useDeprovisionByo, useVerifyByoDomain } from "@/hooks/useByoServers";
import { ByoMailboxList } from "./ByoMailboxList";
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
import type { DnsRecord, EmailSendingDomain } from "@/types/email";
import { DomainMonitoringDialog, DomainReputationBadge, DomainSendingBadge } from "@/components/email/infrastructure/DomainMonitoringPanel";

interface ByoDomainBlockProps {
  domain: EmailSendingDomain;
}

export function ByoDomainBlock({ domain }: ByoDomainBlockProps) {
  const [showDns, setShowDns] = useState(false);
  const [showMonitoring, setShowMonitoring] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [deleteKeys, setDeleteKeys] = useState(false);
  const verify = useVerifyByoDomain();
  const deprovision = useDeprovisionByo();

  const records = (domain.dns_records as DnsRecord[] | null) ?? [];
  const recordsReady = records.length > 0;
  // Domains provisioned before MX generation existed have no MX row to publish.
  // They send fine and drop every reply, so the fix is a re-provision, not a
  // DNS edit the operator can make from what is listed here.
  const mxMissing = recordsReady && !records.some((r) => r.type === "MX");
  const fullyVerified = domain.dns_status === "verified";
  const dkimPending = domain.dns_status === "dkim_pending";

  return (
    <div className="rounded-md border bg-card/40 p-3 space-y-3">
      <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
      <div className="space-y-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-medium text-sm truncate">{domain.domain}</span>
          {fullyVerified ? (
            <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 text-xs flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Verified
            </Badge>
          ) : recordsReady ? (
            <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {dkimPending ? "DKIM pending" : "DNS required"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Provisioning
            </Badge>
          )}
          <DomainReputationBadge domain={domain} />
          <DomainSendingBadge domain={domain} />
        </div>
        <div className="text-xs text-muted-foreground">
          DKIM selector: <code className="font-mono">{domain.dkim_selector || "aca1"}</code>
          {" · "}
          {records.filter((r) => r.verified).length}/{records.length} records verified
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowMonitoring(true)}>Monitor</Button>
        {recordsReady && !fullyVerified && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => verify.mutate(domain.id)}
            disabled={verify.isPending}
          >
            {verify.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
            Verify DNS
          </Button>
        )}
        {recordsReady && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowDns(true)}>
            <FileText className="w-3 h-3 mr-1" />
            DNS
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setShowRemove(true)} title="Remove domain">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      </div>

      {recordsReady && (
        <div className="border-t pt-3">
          <ByoMailboxList domain={domain} />
        </div>
      )}

      <DomainMonitoringDialog domain={domain} open={showMonitoring} onOpenChange={setShowMonitoring} />

      <DnsRecordsDialog open={showDns} onOpenChange={setShowDns} domain={domain.domain} records={records} />

      <AlertDialog open={showRemove} onOpenChange={setShowRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {domain.domain}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Removes the domain from Postfix (virtual_domains), OpenDKIM signing tables, and unbinds all attached mailboxes (they're marked disconnected). The DB rows are deleted.
              </span>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteKeys}
                  onChange={(e) => setDeleteKeys(e.target.checked)}
                />
                Also delete DKIM keypair + Maildirs on the server (irreversible).
              </label>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deprovision.mutate({
                  target_kind: "domain",
                  domain_id: domain.id,
                  delete_keys: deleteKeys,
                });
                setShowRemove(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DnsRecordsDialog({
  open,
  onOpenChange,
  domain,
  records,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: string;
  records: DnsRecord[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const mxMissing = records.length > 0 && !records.some((record) => record.type === "MX");
  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            DNS records — {domain}
          </DialogTitle>
          <DialogDescription>
            Add these records at your registrar. Then click "Verify DNS" on the domain row.
          </DialogDescription>
        </DialogHeader>

        {mxMissing && (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-xs leading-relaxed">
              This domain has no MX record, so it can send but never receive — replies and DMARC
              reports bounce at the sender. Re-provision the domain to generate one.
            </AlertDescription>
          </Alert>
        )}
        {records.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>No records yet. Provisioning may still be running.</AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-y-auto pr-1 space-y-2">
            {records.map((r, i) => (
              <div
                key={i}
                className={`rounded-md border p-3 space-y-2 text-sm ${r.verified ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/10"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">{r.type}</Badge>
                    <span className="text-xs font-medium">
                      {r.type === "MX" ? "MX — inbound" :
                       r.value.startsWith("v=spf1") ? "SPF" :
                       r.value.startsWith("v=DKIM1") || r.name.includes("._domainkey.") ? "DKIM" :
                       r.value.startsWith("v=DMARC1") || r.name.startsWith("_dmarc") ? "DMARC" :
                       r.type}
                    </span>
                    {r.verified ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Host</div>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 text-xs font-mono bg-muted/50 rounded px-2 py-1 break-all">{r.name}</code>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copy(`name-${i}`, r.name)}>
                      {copied === `name-${i}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Value</div>
                  <div className="flex items-start gap-1.5">
                    <code className="flex-1 text-xs font-mono bg-muted/50 rounded px-2 py-1.5 break-all leading-relaxed">{r.value}</code>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 mt-0.5" onClick={() => copy(`value-${i}`, r.value)}>
                      {copied === `value-${i}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
                {r.priority !== undefined && (
                  <div className="space-y-0.5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Priority</div>
                    <code className="text-xs font-mono bg-muted/50 rounded px-2 py-1 block w-fit">{r.priority}</code>
                  </div>
                )}
                {r.description && <p className="text-xs text-muted-foreground leading-relaxed">{r.description}</p>}
                {r.conflict && (
                  <p className="text-xs text-amber-400 leading-relaxed">{r.conflict}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
