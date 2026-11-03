import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { openConsentPopup } from "@/lib/open-consent-popup";
import { useSearchParams, Link as RouterLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  RefreshCw,
  Globe,
  Trash2,
  Building2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Upload,
  FileText,
  Shield,
  Mail,
  Link,
  Copy,
  Check,
  KeyRound,
  AlertTriangle,
  Activity,
  TrendingDown,
  CreditCard,
} from "lucide-react";
import {
  useM365Tenants,
  useRefreshM365Tenant,
  useDisconnectM365Tenant,
  useValidateM365Tenant,
  useInitiateExoConsent,
} from "@/hooks/useM365Tenants";
import { TenantPrerequisitesChecklist } from "@/components/email/infrastructure/TenantPrerequisitesChecklist";
import {
  useEmailSendingDomains,
  useDeleteDomain,
  useVerifyM365Domain,
} from "@/hooks/useEmailSendingDomains";
import { ConnectTenantWizard } from "./ConnectTenantWizard";
import { DomainProvisioningWizard } from "./DomainProvisioningWizard";
import { MailboxProvisioningPanel } from "./MailboxProvisioningPanel";
import { BulkImportTenantsDialog } from "./BulkImportTenantsDialog";
import { DnsProvidersSettings } from "./DnsProvidersSettings";
import type { M365Tenant, EmailSendingDomain } from "@/types/email";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ByoInfrastructureSettings } from "./byo/ByoInfrastructureSettings";
import { PostShibaSettings } from "./postshiba/PostShibaSettings";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { DomainMonitoringDialog, DomainSendingBadge } from "@/components/email/infrastructure/DomainMonitoringPanel";
import { toast } from "sonner";
import type { DnsRecord } from "@/types/email";
import type { LucideIcon } from "lucide-react";

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "connected" || status === "verified") {
    return (
      <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        {status}
      </Badge>
    );
  }
  if (status === "dkim_pending") {
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        DKIM pending
      </Badge>
    );
  }
  if (status === "records_generated") {
    return (
      <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        DNS required
      </Badge>
    );
  }
  const variants: Record<string, "secondary" | "destructive" | "outline"> = {
    pending: "secondary",
    consent_pending: "secondary",
    provisioning: "secondary",
    error: "destructive",
    disconnected: "outline",
  };
  return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EmailInfrastructureSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasFeature } = useFeatureAccess();
  const showPostShiba = hasFeature("postshiba");
  const [showTenantWizard, setShowTenantWizard] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [domainWizardTenant, setDomainWizardTenant] = useState<M365Tenant | null>(null);
  const [pendingDomainTenantId, setPendingDomainTenantId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "tenant" | "domain"; id: string; name: string } | null>(null);
  const [expandedTenants, setExpandedTenants] = useState<Set<string>>(new Set());
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  const { data: tenants = [], isLoading: tenantsLoading } = useM365Tenants();
  const { data: domains = [] } = useEmailSendingDomains();

  const refreshTenant = useRefreshM365Tenant();
  const disconnectTenant = useDisconnectM365Tenant();
  const validateTenant = useValidateM365Tenant();
  const deleteDomain = useDeleteDomain();
  const verifyDomain = useVerifyM365Domain();
  const initiateExoConsent = useInitiateExoConsent();
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null);

  // Filter to M365 domains only
  const m365Domains = domains.filter((d) => d.infra_type === "m365");

  // Handle consent callback URL params
  useEffect(() => {
    const consent = searchParams.get("consent");
    const tenantId = searchParams.get("m365_tenant_id");
    const consentType = searchParams.get("consent_type");
    if (consent === "granted" && tenantId) {
      // Clear params first
      setSearchParams({}, { replace: true });
      if (consentType === "exo") {
        // EXO consent just granted — validate to confirm
        toast.info("Verifying Exchange Online access...");
        validateTenant.mutate(tenantId, {
          onSuccess: (data) => {
            if (data.success) {
              toast.success("Exchange Online access granted! You can now create mailboxes.");
            } else {
              toast.error(data.error || "Exchange consent validation failed");
            }
          },
        });
      } else {
        // Graph consent — original flow
        toast.info("Verifying M365 tenant connection...");
        validateTenant.mutate(tenantId, {
          onSuccess: (data) => {
            if (data.success) {
              toast.success("M365 tenant connected successfully!");
            } else {
              toast.error(data.error || "Tenant validation failed");
            }
          },
        });
      }
    }
  }, []);

  // Auto-validate any tenant stuck at consent_pending with consent_granted=true.
  // The Microsoft callback marks rows as consent_pending after successful consent;
  // they only flip to "connected" once a Graph token is successfully minted. Azure
  // can take 30-60s to propagate consent, so the wizard's polling sometimes misses
  // the window. Retry on every mount to recover stranded rows.
  const autoValidatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    tenants.forEach((t) => {
      if (
        t.status === "consent_pending" &&
        t.consent_granted &&
        !autoValidatedRef.current.has(t.id)
      ) {
        autoValidatedRef.current.add(t.id);
        validateTenant.mutate(t.id);
      }
    });
  }, [tenants, validateTenant]);

  // Listen for postMessage from the consent callback popup so we can validate
  // immediately after consent, instead of waiting on poll intervals.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin && !event.origin.includes("supabase.co")) return;
      const data = event.data;
      if (data && data.type === "m365_consent_complete" && data.rowId) {
        validateTenant.mutate(data.rowId);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [validateTenant]);

  // Auto-expand all tenants on first load
  useEffect(() => {
    if (tenants.length > 0 && expandedTenants.size === 0) {
      setExpandedTenants(new Set(tenants.map((t) => t.id)));
    }
  }, [tenants.length]);

  // Open domain wizard after tenant wizard completes
  useEffect(() => {
    if (pendingDomainTenantId && tenants.length > 0) {
      const tenant = tenants.find((t) => t.id === pendingDomainTenantId);
      if (tenant) {
        setPendingDomainTenantId(null);
        setDomainWizardTenant(tenant);
      }
    }
  }, [pendingDomainTenantId, tenants]);

  const toggleTenant = (id: string) => {
    setExpandedTenants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDomain = (id: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "tenant") {
      disconnectTenant.mutate(deleteTarget.id);
    } else {
      deleteDomain.mutate(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const getDomainsForTenant = (tenantId: string) =>
    m365Domains.filter((d) => d.m365_tenant_id === tenantId);

  // Stats
  const totalMailboxes = m365Domains.reduce((sum, d) => sum + (d.mailbox_count || 0), 0);
  const activeDomains = m365Domains.filter((d) => d.m365_domain_verified).length;
  const EMAILS_PER_MAILBOX_PER_DAY = 5;
  const dailyCapacity = totalMailboxes * EMAILS_PER_MAILBOX_PER_DAY;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Domains &amp; servers</h2>
          <p className="text-muted-foreground">
            Connect Microsoft 365 tenants or bring your own server. Mailboxes from either path flow
            through the same unified inbox, sequences, and warmup pipeline.
          </p>
        </div>
      </div>

      <Tabs defaultValue="m365" className="space-y-6">
        <TabsList>
          <TabsTrigger value="m365">Microsoft 365</TabsTrigger>
          <TabsTrigger value="byo">Bring Your Own Server</TabsTrigger>
          {showPostShiba && <TabsTrigger value="postshiba">PostShiba</TabsTrigger>}
        </TabsList>

        <TabsContent value="m365" className="space-y-6 mt-0">

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{tenants.length}</div>
            <div className="text-sm text-muted-foreground">M365 Tenants</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{activeDomains}</div>
            <div className="text-sm text-muted-foreground">Active Domains</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{totalMailboxes}</div>
            <div className="text-sm text-muted-foreground">Total Mailboxes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{dailyCapacity.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Daily Capacity</div>
          </CardContent>
        </Card>
      </div>

      <DnsProvidersSettings />

      {/* Tenants Section */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            M365 Tenants
          </h3>
          <p className="text-sm text-muted-foreground">
            Connect Microsoft 365 tenants, then add sending domains under each one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <RouterLink to="/m365-tenants">
              <CreditCard className="w-4 h-4 mr-2" />
              Buy / manage tenants
            </RouterLink>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Bulk Import
          </Button>
          <Button variant="cta" size="sm" onClick={() => setShowTenantWizard(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Connect Tenant
          </Button>
        </div>
      </div>

      {tenantsLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : tenants.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No M365 tenants connected.</p>
              <p className="text-sm">Connect a Microsoft 365 tenant to get started with email infrastructure.</p>
              <Button variant="cta" size="sm" className="mt-4" onClick={() => setShowTenantWizard(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Connect Tenant
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tenants.map((tenant) => {
            const tenantDomains = getDomainsForTenant(tenant.id);
            const isExpanded = expandedTenants.has(tenant.id);

            return (
              <Card key={tenant.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleTenant(tenant.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </button>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">
                            {tenant.display_name || tenant.onmicrosoft_domain}
                          </CardTitle>
                          <StatusBadge status={tenant.status} />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {tenant.onmicrosoft_domain}
                          {tenant.admin_email && <> &middot; {tenant.admin_email}</>}
                          &nbsp;&middot;&nbsp;{tenantDomains.length} domain{tenantDomains.length !== 1 ? "s" : ""}
                        </div>
                        {tenant.last_validated_at && (
                          <div className="text-xs text-muted-foreground">
                            Last validated: {new Date(tenant.last_validated_at).toLocaleDateString()}
                          </div>
                        )}
                        {tenant.last_error && (
                          <div className="text-xs text-destructive">{tenant.last_error}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {tenant.status === "connected" && (
                        <Button
                          variant="cta"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setDomainWizardTenant(tenant)}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Add Domain
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const result = await initiateExoConsent.mutateAsync(tenant.id);
                            openConsentPopup(result.consent_url);
                            toast.info("Approve permissions in the popup, then refresh the tenant.");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed to start consent flow");
                          }
                        }}
                        disabled={initiateExoConsent.isPending}
                        title="Re-grant Microsoft permissions (use after we add new app permissions)"
                      >
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refreshTenant.mutate(tenant.id)}
                        disabled={refreshTenant.isPending}
                        title="Refresh tenant"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTarget({
                          type: "tenant",
                          id: tenant.id,
                          name: tenant.display_name || tenant.onmicrosoft_domain,
                        })}
                        title="Disconnect tenant"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  {tenant.status === "connected" && (
                    <div className="mt-3">
                      <TenantPrerequisitesChecklist tenant={tenant} />
                    </div>
                  )}
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5" />
                          Sending Domains
                        </span>
                        <DomainHealthRollup domains={tenantDomains} />
                      </div>

                      {tenantDomains.length === 0 ? (
                        <div className="text-center py-6 rounded-lg border border-dashed text-muted-foreground">
                          <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No domains under this tenant.</p>
                          {tenant.status === "connected" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => setDomainWizardTenant(tenant)}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Add Domain
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {tenantDomains.map((domain) => (
                            <DomainBlock
                              key={domain.id}
                              domain={domain}
                              tenant={tenant}
                              isExpanded={expandedDomains.has(domain.id)}
                              onToggle={() => toggleDomain(domain.id)}
                              onDelete={() => setDeleteTarget({ type: "domain", id: domain.id, name: domain.domain })}
                              onVerify={() => {
                                setVerifyingDomainId(domain.id);
                                verifyDomain.mutate(domain.id, {
                                  onSettled: () => setVerifyingDomainId(null),
                                });
                              }}
                              verifyPending={verifyingDomainId === domain.id && verifyDomain.isPending}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

        </TabsContent>

        <TabsContent value="byo" className="mt-0">
          <ByoInfrastructureSettings />
        </TabsContent>

        {showPostShiba && (
          <TabsContent value="postshiba" className="mt-0">
            <PostShibaSettings />
          </TabsContent>
        )}
      </Tabs>

      {/* Wizards */}
      <BulkImportTenantsDialog
        open={showBulkImport}
        onOpenChange={setShowBulkImport}
      />

      <ConnectTenantWizard
        open={showTenantWizard}
        onOpenChange={(open) => {
          setShowTenantWizard(open);
        }}
        onAddDomain={(tenantId) => {
          setShowTenantWizard(false);
          setPendingDomainTenantId(tenantId);
        }}
      />

      {domainWizardTenant && (
        <DomainProvisioningWizard
          open={!!domainWizardTenant}
          onOpenChange={(open) => { if (!open) setDomainWizardTenant(null); }}
          tenant={domainWizardTenant}
          onDomainProvisioned={(domainId) => {
            setDomainWizardTenant(null);
            setExpandedDomains((prev) => new Set(prev).add(domainId));
          }}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "tenant" ? "Disconnect Tenant" : "Delete Domain"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "tenant"
                ? `This will disconnect "${deleteTarget.name}" and remove all associated domains and mailboxes.`
                : `This will permanently delete "${deleteTarget?.name}" and all its mailboxes. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTarget?.type === "tenant" ? "Disconnect" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── DNS helpers ──────────────────────────────────────────────────────────────

function getDnsPurposeLabel(record: DnsRecord): { label: string; Icon: LucideIcon } {
  const name = (record.name || "").toLowerCase();
  const value = (record.value || "").toLowerCase();
  if (record.type === "MX") return { label: "MX — Mail routing", Icon: Mail };
  if (name.startsWith("_dmarc")) return { label: "DMARC — Anti-spoofing policy", Icon: Shield };
  if (name.startsWith("_domainkey") || name.includes("dkim")) return { label: "DKIM — Email signing key", Icon: Shield };
  if (value.startsWith("v=spf1")) return { label: "SPF — Authorized senders", Icon: Shield };
  if (value.startsWith("ms=")) return { label: "Ownership verification", Icon: FileText };
  if (record.type === "CNAME" && name.startsWith("autodiscover")) return { label: "Autodiscover — Email client setup", Icon: Link };
  if (record.type === "CNAME") return { label: "CNAME", Icon: Link };
  return { label: "TXT record", Icon: FileText };
}

// ── DNS Records Dialog ───────────────────────────────────────────────────────

function DnsRecordsDialog({
  open,
  onOpenChange,
  domain,
  dnsRecords,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: string;
  dnsRecords: DnsRecord[];
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const verifiedCount = dnsRecords.filter((r) => r.verified).length;
  const totalCount = dnsRecords.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            DNS Settings — {domain}
          </DialogTitle>
          <DialogDescription>
            {verifiedCount}/{totalCount} records verified
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 overflow-y-auto pr-1 flex-1">
          {dnsRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No DNS records found for this domain.
            </div>
          ) : (
            dnsRecords.map((record, i) => {
              const purpose = getDnsPurposeLabel(record);
              const isVerified = record.verified;
              return (
                <div
                  key={i}
                  className={`rounded-lg border p-3 space-y-2 text-sm ${
                    isVerified
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border bg-muted/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono px-1.5">{record.type}</Badge>
                      <span className="text-xs font-medium text-foreground/80">{purpose.label}</span>
                      {isVerified ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <purpose.Icon className="w-3.5 h-3.5 text-muted-foreground/50" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Name / Host</div>
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono bg-muted/50 rounded px-2 py-1 flex-1 break-all">{record.name}</code>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" title="Copy name" onClick={() => handleCopy(record.name, `dns-name-${i}`)}>
                        {copiedKey === `dns-name-${i}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                  {record.priority !== undefined && (
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Priority</div>
                      <code className="text-xs font-mono bg-muted/50 rounded px-2 py-1 block">{record.priority}</code>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Value / Points to</div>
                    <div className="flex items-start gap-1.5">
                      <code className="text-xs font-mono bg-muted/50 rounded px-2 py-1.5 flex-1 break-all leading-relaxed">{record.value}</code>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0 mt-0.5" title="Copy value" onClick={() => handleCopy(record.value, `dns-val-${i}`)}>
                        {copiedKey === `dns-val-${i}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                  {record.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{record.description}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Domain Block ──────────────────────────────────────────────────────────────

function DomainHealthRollup({ domains }: { domains: EmailSendingDomain[] }) {
  if (!domains.length) return null;

  const burned = domains.filter((d) => d.health_status === "burned").length;
  const recovering = domains.filter((d) => d.health_status === "recovering").length;
  const degrading = domains.filter((d) => d.health_status === "degrading").length;
  const healthy = domains.filter((d) => d.health_status === "healthy").length;
  const paused = domains.filter((d) => !!d.sending_paused_at).length;

  // Counts as coloured dots + numbers rather than a row of pills. The pill
  // version competed with the per-domain badges directly below it for the same
  // attention, which is why the header read as noise.
  const parts: Array<{ n: number; label: string; dot: string; text?: string }> = [
    { n: burned, label: "reputation warnings", dot: "bg-destructive", text: "text-destructive" },
    { n: recovering, label: "recovering", dot: "bg-sky-400" },
    { n: degrading, label: "degrading", dot: "bg-amber-400" },
    { n: healthy, label: "healthy observations", dot: "bg-green-400" },
    { n: paused, label: "sending paused", dot: "bg-muted-foreground" },
  ].filter((p) => p.n > 0);

  if (!parts.length) return null;

  return (
    <div className="flex items-center gap-3 text-xs normal-case tracking-normal">
      {parts.map((p) => (
        <span key={p.label} className={cn("flex items-center gap-1.5", p.text ?? "text-muted-foreground")}>
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", p.dot)} />
          {p.n} {p.label}
        </span>
      ))}
    </div>
  );
}

/** Observed reputation health, independent of operator sending controls. */
function DomainHealthBadge({ domain }: { domain: EmailSendingDomain }) {
  // whitespace-nowrap + shrink-0 are load-bearing: without them these badges
  // wrap mid-label inside the flex row ("Not yet / checked") and shove the
  // action buttons out of alignment.
  const base = "text-[11px] h-5 px-1.5 font-medium whitespace-nowrap shrink-0 flex items-center gap-1";

  switch (domain.health_status) {
    case "burned":
      return (
        <Badge variant="outline" className={cn(base, "border-destructive/40 text-destructive bg-destructive/10")}>
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Reputation warning
        </Badge>
      );
    case "recovering":
      return (
        <Badge variant="outline" className={cn(base, "border-sky-500/30 text-sky-400 bg-sky-500/10")}>
          <Activity className="w-3 h-3 shrink-0" />
          Recovering
        </Badge>
      );
    case "degrading":
      return (
        <Badge variant="outline" className={cn(base, "border-amber-500/30 text-amber-400 bg-amber-500/10")}>
          <TrendingDown className="w-3 h-3 shrink-0" />
          Degrading
        </Badge>
      );
    case "healthy":
      return (
        <Badge variant="outline" className={cn(base, "border-green-500/30 text-green-400 bg-green-500/10")}>
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          Healthy observation
        </Badge>
      );
    default:
      // 'unknown' / null — provisioned but never probed and with no reconciled
      // traffic to judge it by. Still sendable; just not yet evidenced.
      return (
        <Badge variant="outline" className={cn(base, "text-muted-foreground border-border")}>
          <Clock className="w-3 h-3 shrink-0" />
          No health evidence
        </Badge>
      );
  }
}

/**
 * Trim a raw SMTP rejection to the part a human acts on.
 *
 * EXO appends routing telemetry (OutboundProxyTargetIP / TargetHostName) and
 * Google appends a support URL. Neither changes what you'd do about it, and at
 * full length the blob was four monospace lines — the loudest thing on the card
 * for the one domain you can do the least about right now.
 */
function summarizeRejection(raw: string): string {
  return raw
    .replace(/\s*OutboundProxyTarget\w*:.*$/gis, "")
    .replace(/\s*For more information,? go to.*$/is, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deliverability facts for a domain, as ONE dot-separated meta line plus the
 * remote server's verbatim words behind a disclosure.
 *
 * Earlier this rendered a red paragraph and a four-line monospace dump, which
 * made the burned domains — the ones you can act on least — the loudest thing in
 * the list. The state is already carried by the badge and the card's left edge;
 * this only has to supply the numbers, and keep the raw evidence one click away
 * for when someone needs to see exactly what the receiver said.
 */
function DomainHealthDetail({
  domain,
  mailboxCount,
}: {
  domain: EmailSendingDomain;
  mailboxCount: number;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const status = domain.health_status;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const facts: string[] = [`${mailboxCount} mailbox${mailboxCount !== 1 ? "es" : ""}`];

  if (status === "burned" && (domain.consecutive_550 ?? 0) > 1) {
    facts.push(`${domain.consecutive_550} reputation refusals`);
  }
  if (status === "recovering") {
    facts.push(`${domain.clean_probe_streak ?? 0}/3 clean probes`);
  }
  if (domain.last_probe_at) {
    facts.push(`probed ${fmt(domain.last_probe_at)}`);
  }
  if (domain.next_probe_at) {
    facts.push(`next ${fmt(domain.next_probe_at)}`);
  }

  const rejection = domain.last_550_reason ? summarizeRejection(domain.last_550_reason) : null;
  const showRejection = !!rejection && status !== "healthy";

  if (!facts.length && !showRejection) return null;

  return (
    <div className="text-xs text-muted-foreground mt-0.5 space-y-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{facts.join(" · ")}</span>
        {showRejection && (
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="underline underline-offset-2 hover:text-foreground transition-colors shrink-0"
          >
            {showRaw ? "hide rejection" : "why?"}
          </button>
        )}
      </div>

      {showRaw && rejection && (
        <div className="rounded border border-destructive/25 bg-destructive/5 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground break-words max-w-2xl">
          {rejection}
        </div>
      )}
    </div>
  );
}

interface DomainBlockProps {
  domain: EmailSendingDomain;
  tenant: M365Tenant;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onVerify: () => void;
  verifyPending: boolean;
}

function DomainBlock({
  domain,
  tenant,
  isExpanded,
  onToggle,
  onDelete,
  onVerify,
  verifyPending,
}: DomainBlockProps) {
  const [showDnsDialog, setShowDnsDialog] = useState(false);
  const [showMonitoring, setShowMonitoring] = useState(false);
  const isVerified = !!domain.m365_domain_verified;
  const isRunning = domain.vm_status === "running";
  const isDkimPending = domain.dns_status === "dkim_pending";
  const isFullyVerified = isVerified && domain.dns_status === "verified";
  const needsDns = !isVerified && isRunning;

  // Uniform badge shape. whitespace-nowrap is what stops "Domain verified" and
  // "DKIM pending" breaking across two lines in a crowded row.
  const infraBadge = "text-[11px] h-5 px-1.5 font-medium whitespace-nowrap shrink-0 flex items-center gap-1";

  // A colour on the card's edge carries the state without a paragraph of red
  // text doing it — the list stays scannable when several domains are unhappy.
  const accent =
    domain.health_status === "burned"
      ? "border-l-destructive/60"
      : domain.health_status === "degrading"
      ? "border-l-amber-500/60"
      : domain.health_status === "recovering"
      ? "border-l-sky-500/60"
      : "border-l-transparent";

  return (
    <div className={cn("rounded-lg border border-l-2 bg-card/50", accent)}>
      <div className="flex items-start justify-between p-3 gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <button
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-sm mr-0.5">{domain.domain}</span>
              {isFullyVerified ? (
                <Badge variant="outline" className={cn(infraBadge, "border-green-500/30 text-green-400 bg-green-500/10")}>
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  Verified
                </Badge>
              ) : isVerified && isDkimPending ? (
                <>
                  <Badge variant="outline" className={cn(infraBadge, "border-green-500/30 text-green-400 bg-green-500/10")}>
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    Verified
                  </Badge>
                  <Badge variant="outline" className={cn(infraBadge, "border-amber-500/30 text-amber-400 bg-amber-500/10")}>
                    <Clock className="w-3 h-3 shrink-0" />
                    DKIM pending
                  </Badge>
                </>
              ) : (
                <StatusBadge status={domain.dns_status || "pending"} />
              )}
              <DomainHealthBadge domain={domain} />
              <DomainSendingBadge domain={domain} />
            </div>
            <DomainHealthDetail domain={domain} mailboxCount={domain.mailbox_count || 0} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowMonitoring(true)}>
            Monitor
          </Button>
          {needsDns && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onVerify}
              disabled={verifyPending}
            >
              {verifyPending ? (
                <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Checking...</>
              ) : (
                <><CheckCircle2 className="w-3 h-3 mr-1" /> Verify DNS</>
              )}
            </Button>
          )}
          {isDkimPending && isVerified && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onVerify}
              disabled={verifyPending}
            >
              {verifyPending ? (
                <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Checking...</>
              ) : (
                <><CheckCircle2 className="w-3 h-3 mr-1" /> Verify DKIM</>
              )}
            </Button>
          )}
          {!isVerified && !isRunning && (
            <Badge variant="secondary" className="text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Provisioning
            </Badge>
          )}
          {domain.dns_records && domain.dns_records.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowDnsDialog(true)}
              title="View DNS settings"
            >
              <FileText className="w-3 h-3 mr-1" />
              DNS
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t px-3 pb-3">
          {!isVerified && needsDns && (
            <Alert className="mt-3 mb-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Add the DNS records below to your registrar, then click "Verify DNS" to confirm ownership.
              </AlertDescription>
            </Alert>
          )}
          {isVerified && isDkimPending && (
            <Alert className="mt-3 mb-2 border-amber-500/30">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-sm">
                Domain ownership verified! Add the DKIM CNAME records to your registrar for email signing, then click "Verify DKIM".
              </AlertDescription>
            </Alert>
          )}
          <MailboxProvisioningPanel domain={domain} tenant={tenant} />
        </div>
      )}

      <DomainMonitoringDialog domain={domain} open={showMonitoring} onOpenChange={setShowMonitoring} />

      <DnsRecordsDialog
        open={showDnsDialog}
        onOpenChange={setShowDnsDialog}
        domain={domain.domain}
        dnsRecords={domain.dns_records || []}
      />
    </div>
  );
}
