import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield,
  Mail,
  RefreshCw,
  Trash2,
  Settings2,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Replace,
  TrendingDown,
  Activity,
  Download,
  Cloud,
} from "lucide-react";
import type { EmailSendingDomain } from "@/types/email";
import { useCheckDomainStatus, useVerifyDns, useReplaceBurnedDomain } from "@/hooks/useEmailSendingDomains";
import { useDnsProvider } from "@/hooks/useDnsProviders";
import { DomainConfigPanel } from "./DomainConfigPanel";
import { ProvisionMailboxesDialog } from "./ProvisionMailboxesDialog";
import { CredentialExportDialog } from "./CredentialExportDialog";
import { MigrateDomainToCloudflareDialog } from "./MigrateDomainToCloudflareDialog";

interface SendingDomainCardProps {
  domain: EmailSendingDomain;
  onDelete: (id: string, name: string) => void;
}

function VMStatusBadge({ status, infraType }: { status: EmailSendingDomain["vm_status"]; infraType?: string }) {
  const isAcs = infraType === "acs";
  const config: Record<string, { variant: "secondary" | "destructive" | "outline"; label: string; className?: string }> = {
    running: { variant: "outline", label: isAcs ? "ACS Active" : "Running", className: "border-green-500/30 text-green-400 bg-green-500/10" },
    provisioning: { variant: "secondary", label: "Provisioning" },
    pending: { variant: "secondary", label: "Pending" },
    stopped: { variant: "outline", label: "Stopped" },
    error: { variant: "destructive", label: "Error" },
    deleting: { variant: "destructive", label: "Deleting..." },
  };
  const c = config[status] || { variant: "outline" as const, label: status };
  return (
    <Badge variant={c.variant} className={cn("flex items-center gap-1", c.className)}>
      {(status === "deleting" || status === "provisioning") && (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      {c.label}
    </Badge>
  );
}

function DnsStatusBadge({ status }: { status: EmailSendingDomain["dns_status"] }) {
  if (status === "verified") {
    return <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10">DNS Verified</Badge>;
  }
  const config: Record<string, { variant: "secondary" | "destructive" | "outline"; label: string }> = {
    records_generated: { variant: "secondary", label: "DNS Pending" },
    pending: { variant: "outline", label: "DNS Pending" },
    error: { variant: "destructive", label: "DNS Error" },
  };
  const c = config[status] || { variant: "outline" as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

/** Observed reputation health; sending is controlled separately at domain level. */
function DomainHealthBadge({ domain }: { domain: EmailSendingDomain }) {
  if (!domain) return null;

  const status = domain.health_status;

  if (status === "burned") {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Reputation warning
      </Badge>
    );
  }
  if (status === "recovering") {
    return (
      <Badge variant="secondary" className="flex items-center gap-1 bg-sky-500/20 text-sky-400 border-sky-500/30">
        <Activity className="w-3 h-3" />
        Recovering
      </Badge>
    );
  }
  if (status === "degrading") {
    return (
      <Badge variant="secondary" className="flex items-center gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
        <TrendingDown className="w-3 h-3" />
        Degrading
      </Badge>
    );
  }

  const health = domain.domain_health;
  if (!health || health === "no_data") {
    if (status === "healthy") {
      return (
        <Badge variant="outline" className="flex items-center gap-1 text-green-400 border-green-500/30">
          <CheckCircle2 className="w-3 h-3" />
          Healthy
        </Badge>
      );
    }
    return null;
  }

  if (health === "burned") {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Reputation warning
      </Badge>
    );
  }
  if (health === "warning") {
    return (
      <Badge variant="secondary" className="flex items-center gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
        <TrendingDown className="w-3 h-3" />
        Warning
      </Badge>
    );
  }
  if (health === "resting") {
    return (
      <Badge variant="secondary" className="flex items-center gap-1">
        <Activity className="w-3 h-3" />
        Historical hold
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="flex items-center gap-1 text-green-400 border-green-500/30">
      <CheckCircle2 className="w-3 h-3" />
      Healthy
    </Badge>
  );
}

function ConnectionIndicator({ metadata }: { metadata: Record<string, unknown> }) {
  const healthCheck = metadata?.last_health_check as Record<string, unknown> | undefined;
  if (!healthCheck) return null;

  const smtpOk = healthCheck.smtp_connected as boolean;
  const imapOk = healthCheck.imap_connected as boolean;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1">
        {smtpOk ? (
          <CheckCircle2 className="w-3 h-3 text-green-400" />
        ) : (
          <XCircle className="w-3 h-3 text-destructive" />
        )}
        SMTP
      </span>
      <span className="flex items-center gap-1">
        {imapOk ? (
          <CheckCircle2 className="w-3 h-3 text-green-400" />
        ) : (
          <XCircle className="w-3 h-3 text-destructive" />
        )}
        IMAP
      </span>
    </div>
  );
}

function IpRotationCountdown({ ipAssignedAt }: { ipAssignedAt: string | null }) {
  if (!ipAssignedAt) return null;
  const assigned = new Date(ipAssignedAt);
  const nextRotation = new Date(assigned.getTime() + 14 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(0, Math.round((nextRotation.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return (
    <span className="text-xs text-muted-foreground">
      IP rotation in {daysLeft}d
    </span>
  );
}

export function SendingDomainCard({ domain, onDelete }: SendingDomainCardProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);
  const { data: dnsProviderStatus } = useDnsProvider();
  const cloudflareConnected = !!dnsProviderStatus?.connected;
  const [showMailboxes, setShowMailboxes] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const checkStatus = useCheckDomainStatus();
  const verifyDns = useVerifyDns();
  const replaceDomain = useReplaceBurnedDomain();

  const healthCheck = domain.metadata?.last_health_check as Record<string, unknown> | undefined;
  const blacklisted = healthCheck?.blacklisted as boolean | undefined;
  const isBurned = domain.domain_health === "burned";
  const isReplaced = !!domain.replaced_by_id;
  const bouncePercent = domain.bounce_rate ? Math.round(domain.bounce_rate * 10000) / 100 : 0;
  const spamPercent = domain.spam_rate ? Math.round(domain.spam_rate * 10000) / 100 : 0;
  const dkimPending = !domain.dkim_verified && (domain.dns_records || []).some(
    (r) =>
      r.name.includes("._domainkey.") &&
      r.value.includes("will be available after")
  );
  // Surface duplicate-policy / extra-MX conflicts the verifier persists on each
  // record. These break deliverability silently even when the expected record
  // is present, so we always show a destructive badge when any exist.
  const conflictRecords = (domain.dns_records || []).filter((r) => !!r.conflict);
  const conflictCount = conflictRecords.length;

  const handleReplace = () => {
    if (!newDomain.trim()) return;
    replaceDomain.mutate(
      { burned_domain_id: domain.id, new_domain: newDomain.trim().toLowerCase() },
      {
        onSuccess: () => {
          setShowReplace(false);
          setNewDomain("");
        },
      }
    );
  };

  return (
    <>
      <div className={cn(
        "p-4 rounded-lg border bg-card space-y-3",
        domain.vm_status === "deleting" && "opacity-50 pointer-events-none",
        isBurned && "border-destructive/50",
        isBurned && isReplaced && "opacity-60",
      )}>
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-base">{domain.domain}</span>
            <VMStatusBadge status={domain.vm_status} infraType={domain.infra_type} />
            <DnsStatusBadge status={domain.dns_status} />
            <DomainHealthBadge domain={domain} />
            {isReplaced && (
              <Badge variant="secondary" className="text-xs">Replaced</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Replace button for burned domains */}
            {isBurned && !isReplaced && (
              <Button
                variant="cta"
                size="sm"
                onClick={() => setShowReplace(true)}
                title="Replace Domain"
              >
                <Replace className="w-4 h-4 mr-1" />
                Replace
              </Button>
            )}
            {domain.vm_status === "running" && !isBurned && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMailboxes(true)}
                  title={domain.infra_type === "acs" ? "Create Sender Addresses" : "Provision Mailboxes"}
                >
                  <Users className="w-4 h-4" />
                </Button>
                {domain.infra_type === "acs" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExport(true)}
                    title="Export SMTP Credentials"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfig(true)}
                  title="Domain Settings"
                >
                  <Settings2 className="w-4 h-4" />
                </Button>
                {cloudflareConnected && !domain.dns_managed && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowMigrate(true)}
                    title="Migrate DNS to Cloudflare"
                  >
                    <Cloud className="w-4 h-4 text-amber-500" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => verifyDns.mutate(domain.id)}
                  disabled={verifyDns.isPending}
                  title="Verify DNS"
                >
                  {verifyDns.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Shield className="w-4 h-4" />
                  )}
                </Button>
              </>
            )}
            {domain.vm_status === "provisioning" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkStatus.mutate(domain.id)}
                disabled={checkStatus.isPending}
                title="Check Status"
              >
                {checkStatus.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDelete(domain.id, domain.domain)}
              title="Delete Domain"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Burned domain alert */}
        {isBurned && (
          <div className="text-sm bg-destructive/10 rounded-md p-3 space-y-1">
            <div className="flex items-center gap-2 text-destructive font-medium">
              <AlertTriangle className="w-4 h-4" />
              Reputation warning{domain.burned_at ? ` on ${new Date(domain.burned_at).toLocaleDateString()}` : ""}
            </div>
            <p className="text-muted-foreground text-xs">
              Bounce rate {bouncePercent}%{spamPercent > 0 ? `, spam rate ${spamPercent}%` : ""}
              {blacklisted ? ", IP blacklisted" : ""}.
              Review domain monitoring to pause or resume sending.
              {!isReplaced && " Click Replace to provision a new domain and migrate mailbox identities."}
            </p>
          </div>
        )}

        {/* Deliverability state — the evidence behind the badge. Shown whenever a
            domain is out of service or on its way back, so "why is this domain
            not sending?" is answerable without opening the database. */}
        {(domain.health_status === "burned" ||
          domain.health_status === "recovering" ||
          domain.health_status === "degrading") && (
          <div
            className={cn(
              "text-sm rounded-md p-3 space-y-1",
              domain.health_status === "burned" ? "bg-destructive/10" : "bg-muted/50"
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 font-medium",
                domain.health_status === "burned" ? "text-destructive" : "text-foreground"
              )}
            >
              {domain.health_status === "burned" ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <Activity className="w-4 h-4" />
              )}
              {domain.health_status === "burned" && "Receiver reputation warning"}
              {domain.health_status === "recovering" &&
                `Recovering — ${domain.clean_probe_streak ?? 0}/3 clean probes`}
              {domain.health_status === "degrading" && "Degrading — probes landing in spam"}
            </div>

            {domain.last_550_reason && (
              <p className="text-muted-foreground text-xs font-mono break-words">
                {domain.last_550_reason}
              </p>
            )}

            <p className="text-muted-foreground text-xs">
              {domain.health_status === "burned" && domain.rest_until && (
                <>
                  Historical hold until {new Date(domain.rest_until).toLocaleDateString()}.
                  Review sending controls in domain monitoring.{" "}
                </>
              )}
              {domain.consecutive_550 ? `${domain.consecutive_550} reputation refusal(s) recorded. ` : ""}
              {domain.last_probe_at
                ? `Last probe ${new Date(domain.last_probe_at).toLocaleDateString()}: ${
                    domain.last_probe_result ?? "unknown"
                  }.`
                : "Not probed yet."}
              {domain.next_probe_at
                ? ` Next ${new Date(domain.next_probe_at).toLocaleDateString()}.`
                : ""}
            </p>
          </div>
        )}

        {/* Error details */}
        {domain.vm_status === "error" && domain.metadata?.provisioning_error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
            <span className="font-medium">Provisioning failed: </span>
            {String(domain.metadata.provisioning_error).includes("MissingSubscriptionRegistration")
              ? "Azure resource providers not registered. Go to your Subscription → Resource providers and register Microsoft.Communication and Microsoft.EventGrid."
              : String(domain.metadata.provisioning_error)}
          </div>
        )}

        {/* Info row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          {domain.infra_type !== "acs" && domain.public_ip && (
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {domain.public_ip}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Mail className="w-3 h-3" />
            {domain.mailbox_count}/{domain.max_mailboxes} {domain.infra_type === "acs" ? "senders" : "mailboxes"}
          </span>
          {domain.health_score != null && (
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Health: {Math.round(domain.health_score * 100)}%
            </span>
          )}
          {domain.infra_type !== "acs" && <IpRotationCountdown ipAssignedAt={domain.ip_assigned_at} />}
          {domain.infra_type !== "acs" && <ConnectionIndicator metadata={domain.metadata} />}
          {domain.infra_type === "acs" && domain.acs_domain_verification_status && (
            <Badge variant={domain.acs_domain_verification_status === "verified" ? "outline" : "secondary"} className={domain.acs_domain_verification_status === "verified" ? "border-green-500/30 text-green-400" : ""}>
              ACS: {domain.acs_domain_verification_status}
            </Badge>
          )}
        </div>

        {/* Auth badges + stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            {domain.spf_verified && <Badge variant="outline" className="text-xs">SPF</Badge>}
            {domain.dkim_verified ? (
              <Badge variant="outline" className="text-xs">DKIM</Badge>
            ) : dkimPending ? (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                DKIM key generating
              </Badge>
            ) : null}
            {domain.dmarc_verified && <Badge variant="outline" className="text-xs">DMARC</Badge>}
            {conflictCount > 0 && (
              <Badge
                variant="destructive"
                className="text-xs flex items-center gap-1"
                title={conflictRecords.map((r) => `${r.name}: ${r.conflict}`).join("\n\n")}
              >
                <AlertTriangle className="w-3 h-3" />
                {conflictCount} DNS conflict{conflictCount > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {bouncePercent > 0 && (
              <span className={bouncePercent > 5 ? "text-destructive" : bouncePercent > 2 ? "text-amber-400" : ""}>
                Bounce: {bouncePercent}%
              </span>
            )}
            {spamPercent > 0 && (
              <span className={spamPercent > 1 ? "text-destructive" : "text-amber-400"}>
                Spam: {spamPercent}%
              </span>
            )}
            {blacklisted && (
              <span className="text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Blacklisted
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Config Panel */}
      <DomainConfigPanel
        domain={domain}
        open={showConfig}
        onOpenChange={setShowConfig}
      />

      <MigrateDomainToCloudflareDialog
        open={showMigrate}
        onOpenChange={setShowMigrate}
        domain={domain}
      />

      {/* Mailbox Provisioning */}
      <ProvisionMailboxesDialog
        domain={domain}
        open={showMailboxes}
        onOpenChange={setShowMailboxes}
      />

      {/* Credential Export (ACS only) */}
      {domain.infra_type === "acs" && (
        <CredentialExportDialog
          domain={domain}
          open={showExport}
          onOpenChange={setShowExport}
        />
      )}

      {/* Replace Domain Dialog */}
      <Dialog open={showReplace} onOpenChange={setShowReplace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace Domain</DialogTitle>
            <DialogDescription>
              Provision a new domain to replace <strong>{domain.domain}</strong>.
              Mailbox identities ({domain.mailbox_count}) will be migrated to the new domain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="new-domain">New Domain</Label>
              <Input
                id="new-domain"
                placeholder="e.g. newdomain.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                A new domain will be provisioned via ACS on the same Azure subscription.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReplace(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleReplace}
              disabled={!newDomain.trim() || replaceDomain.isPending}
            >
              {replaceDomain.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Replace className="w-4 h-4 mr-1" />
              )}
              Replace Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
