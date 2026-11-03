import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDomainDeliveryMonitoring, useSetSendingDomainPaused } from "@/hooks/useEmailSendingDomains";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Pause, Play, RefreshCw } from "lucide-react";
import type { EmailSendingDomain } from "@/types/email";

const providerNames: Record<string, string> = {
  gmail: "Google / Gmail", google: "Google", outlook: "Microsoft", microsoft: "Microsoft", yahoo: "Yahoo", other_consumer: "Other consumer", unknown: "Unknown",
};
const dateLabel = (value: string) => new Date(value).toLocaleString();
const percent = (value: number | null) => value === null ? "No data" : `${(value * 100).toFixed(2)}%`;

function isDomainTechnicallyUnusable(domain: EmailSendingDomain) {
  return !!domain.replaced_by_id || String(domain.metadata?.unusable) === "true" || /^UNUSABLE/i.test(domain.last_550_reason || "") || ["unusable", "replaced", "retired"].includes(String(domain.metadata?.operational_status || ""));
}

export function DomainSendingBadge({ domain }: { domain: EmailSendingDomain }) {
  if (isDomainTechnicallyUnusable(domain)) return <Badge variant="outline" className="text-[11px] whitespace-nowrap">Unavailable</Badge>;
  return <Badge variant="outline" className="text-[11px] whitespace-nowrap">{domain.sending_paused_at === undefined ? "Sending status unavailable" : domain.sending_paused_at ? "Sending paused" : "Sending active"}</Badge>;
}

export function DomainMonitoringPanel({ domain }: { domain: EmailSendingDomain }) {
  const { userRole, isSuperAdmin } = useAuth();
  const [reason, setReason] = useState("");
  const monitoring = useDomainDeliveryMonitoring(domain.id, true);
  const setPaused = useSetSendingDomainPaused();
  const data = monitoring.data;
  const pausedAt = data ? data.sending_paused_at : domain.sending_paused_at;
  const pauseReason = data ? data.sending_pause_reason : domain.sending_pause_reason;
  const unusable = isDomainTechnicallyUnusable(domain) || data?.technically_unusable;
  const canManage = isSuperAdmin || userRole === "owner" || userRole === "admin";
  const paused = !!pausedAt;
  const sendingStatus = unusable ? "Unavailable" : pausedAt === undefined ? "Sending status unavailable" : paused ? "Sending paused" : "Sending active";

  return (
    <div className="space-y-4 pt-3 pb-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2"><h4 className="text-sm font-medium">Domain monitoring</h4><Badge variant="outline">{sendingStatus}</Badge></div>
          <p className="text-xs text-muted-foreground">Reputation observations inform your decision. Pause and resume sending here.</p>
          {pausedAt && <p className="text-xs text-muted-foreground">Paused {dateLabel(pausedAt)}{pauseReason ? ` · ${pauseReason}` : ""}</p>}
          {pauseReason === "Previously paused automatically; review and resume" && <p className="text-xs text-amber-500">Previous automatic hold preserved for your review. Resume sending when ready.</p>}
          {unusable && <p className="text-xs text-muted-foreground">This domain is replaced or technically unusable. Repair the infrastructure before resuming.</p>}
          {!canManage && <p className="text-xs text-muted-foreground">An organization owner or admin can change sending status.</p>}
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={() => monitoring.refetch()} disabled={monitoring.isFetching} aria-label="Refresh domain monitoring">
            <RefreshCw className={`w-3.5 h-3.5 ${monitoring.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant={paused ? "cta" : "outline"}
            size="sm"
            disabled={!canManage || setPaused.isPending || !!unusable || monitoring.isLoading || monitoring.isError}
            onClick={() => setPaused.mutate({ domainId: domain.id, paused: !paused, reason })}
          >
            {setPaused.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : paused ? <Play className="w-3.5 h-3.5 mr-1" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
            {paused ? "Resume sending" : "Pause sending"}
          </Button>
        </div>
      </div>
      {!paused && canManage && !unusable && <div className="max-w-md space-y-1">
        <Label htmlFor={`domain-pause-reason-${domain.id}`} className="text-xs">Pause reason (optional)</Label>
        <Input id={`domain-pause-reason-${domain.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason to keep with this domain" className="h-8 text-xs" />
      </div>}
      {monitoring.isLoading && <p className="text-xs text-muted-foreground">Loading delivery evidence…</p>}
      {monitoring.isError && <p className="text-xs text-destructive">{
        /function.*(schema cache|does not exist)|could not find.*function/i.test(monitoring.error.message)
          ? "Domain monitoring is not available yet. The monitoring database update must be applied before these controls can be used."
          : `Could not load monitoring: ${monitoring.error.message}`
      }</p>}
      {data && <>
        <div className="space-y-2">
          <h5 className="text-xs font-medium">Recipient delivery · last {data.days} days</h5>
          {data.recipient_providers.length ? <Table className="min-w-[850px]">
            <TableHeader><TableRow>
              <TableHead>Recipient provider</TableHead><TableHead>Attempted</TableHead><TableHead>Delivered confirmed</TableHead><TableHead>Reputation rejected</TableHead><TableHead>Recipient bounces</TableHead><TableHead>Other failure / spam</TableHead><TableHead>Pending / unconfirmed</TableHead>
            </TableRow></TableHeader>
            <TableBody>{data.recipient_providers.map((row) => {
              const confirmed = row.delivered + row.reputation_rejected + row.recipient_bounced;
              return <TableRow key={row.provider}>
                <TableCell>{providerNames[row.provider] || row.provider}</TableCell><TableCell>{row.attempted}</TableCell><TableCell>{row.delivered}</TableCell>
                <TableCell>{row.reputation_rejected} / {confirmed}{confirmed > 0 ? ` (${(row.reputation_rejected / confirmed * 100).toFixed(1)}%)` : " · No evidence"}</TableCell>
                <TableCell>{row.recipient_bounced}</TableCell><TableCell>{row.send_failed ?? 0}</TableCell><TableCell>{row.unconfirmed}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table> : <p className="text-xs text-muted-foreground">No recipient delivery evidence in this window.</p>}
          <p className="text-xs text-muted-foreground">Attempts include failed sends. Reputation rejection rates use confirmed receiver outcomes (delivered + reputation rejected + recipient bounces); pending handoffs and other failures are excluded. Google / Gmail covers Gmail addresses and custom domains with verified Google MX. Custom recipient domains remain Unknown until their mail provider is verified.</p>
        </div>
        <div className="space-y-2">
          <h5 className="text-xs font-medium">Synthetic probes · separate seed mailbox sample</h5>
          {data.probes.length ? <Table className="min-w-[700px]">
            <TableHeader><TableRow><TableHead>Seed provider</TableHead><TableHead>Attempts</TableHead><TableHead>Delivered</TableHead><TableHead>Reputation rejected</TableHead><TableHead>Spam</TableHead><TableHead>Send failed</TableHead><TableHead>Unconfirmed</TableHead></TableRow></TableHeader>
            <TableBody>{data.probes.map((row) => <TableRow key={row.seed_provider}><TableCell>{providerNames[row.seed_provider] || row.seed_provider}</TableCell><TableCell>{row.attempted}</TableCell><TableCell>{row.delivered}</TableCell><TableCell>{row.reputation_rejected}</TableCell><TableCell>{row.spam}</TableCell><TableCell>{row.send_failed}</TableCell><TableCell>{row.unconfirmed}</TableCell></TableRow>)}</TableBody>
          </Table> : <p className="text-xs text-muted-foreground">No probe evidence in this window.</p>}
          <p className="text-xs text-muted-foreground">Probes measure delivery to configured seeds, not all recipient mailboxes. Gmail seed results describe that Gmail sample only.</p>
        </div>
        <div className="space-y-1 text-xs">
          <h5 className="font-medium">Google Postmaster · Gmail-only aggregate</h5>
          {data.gmail_postmaster ? <>
            <p className="text-muted-foreground">Recorded for {dateLabel(data.gmail_postmaster.recorded_for)} · Domain reputation: {data.gmail_postmaster.domain_reputation || "No data"} · IP reputation: {data.gmail_postmaster.ip_reputation || "No data"} · Spam rate: {percent(data.gmail_postmaster.spam_rate)}</p>
            <p className="text-muted-foreground">Authentication success · DKIM {percent(data.gmail_postmaster.dkim_success_ratio)} · SPF {percent(data.gmail_postmaster.spf_success_ratio)} · DMARC {percent(data.gmail_postmaster.dmarc_success_ratio)}</p>
          </> : <p className="text-muted-foreground">No Google Postmaster data available.</p>}
          <p className="text-muted-foreground">Postmaster covers Gmail traffic and may require sufficient volume. It does not represent Microsoft, Yahoo, or every mailbox.</p>
        </div>
      </>}
    </div>
  );
}


export function DomainMonitoringDialog({ domain, open, onOpenChange }: {
  domain: EmailSendingDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-6xl max-h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="break-words">Domain monitoring · {domain.domain}</DialogTitle>
          <DialogDescription>Review delivery evidence and control sending for this domain.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          {open && <DomainMonitoringPanel domain={domain} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DomainReputationBadge({ domain }: { domain: EmailSendingDomain }) {
  const health = domain.health_status;
  const warning = health === "burned" || (!health && domain.domain_health === "burned");
  const label = warning ? "Reputation warning" : health === "healthy" ? "Healthy observation" : health === "degrading" ? "Degrading" : health === "recovering" ? "Recovering" : "No health evidence";
  return <Badge variant="outline" className={`text-[11px] whitespace-nowrap ${warning ? "border-destructive/40 text-destructive bg-destructive/10" : ""}`}>{label}</Badge>;
}
