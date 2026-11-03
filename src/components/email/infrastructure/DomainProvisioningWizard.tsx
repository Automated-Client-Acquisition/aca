import { useState, useEffect, useRef, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  AlertCircle,
  Copy,
  Check,
  CheckCircle2,
  Clock,
  Globe,
  Shield,
  Mail,
  Link,
  FileText,
  ExternalLink,
  Cloud,
} from "lucide-react";
import {
  useProvisionM365Domain,
  useVerifyM365Domain,
  useCheckM365DomainStatus,
  useEmailSendingDomains,
} from "@/hooks/useEmailSendingDomains";
import {
  useDnsProvider,
  useCloudflareZones,
  usePushDnsToCloudflare,
} from "@/hooks/useDnsProviders";
import { CloudflareDomainPicker } from "./CloudflareDomainPicker";
import { ConnectCloudflareDialog } from "./ConnectCloudflareDialog";
import { supabase } from "@/integrations/supabase/client";
import type { M365Tenant, DnsRecord } from "@/types/email";
import type { LucideIcon } from "lucide-react";

function getDnsPurposeLabel(record: DnsRecord): { label: string; Icon: LucideIcon } {
  const name = (record.name || "").toLowerCase();
  const value = (record.value || "").toLowerCase();
  if (record.type === "MX") return { label: "MX — Mail routing", Icon: Mail };
  if (name.startsWith("_dmarc")) return { label: "DMARC — Anti-spoofing policy", Icon: Shield };
  if (name.startsWith("_domainkey") || name.includes("dkim")) return { label: "DKIM — Email signing key", Icon: Shield };
  if (value.startsWith("v=spf1")) return { label: "SPF — Authorized senders", Icon: Shield };
  if (value.startsWith("ms=")) return { label: "Ownership verification (required first)", Icon: FileText };
  if (record.type === "CNAME" && name.startsWith("autodiscover")) return { label: "Autodiscover — Email client setup", Icon: Link };
  if (record.type === "CNAME") return { label: "CNAME", Icon: Link };
  return { label: "TXT record", Icon: FileText };
}

type WizardStep = "input" | "provisioning" | "dns" | "verified";

interface DomainProvisioningWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: M365Tenant;
  onDomainProvisioned?: (domainId: string) => void;
}

export function DomainProvisioningWizard({
  open,
  onOpenChange,
  tenant,
  onDomainProvisioned,
}: DomainProvisioningWizardProps) {
  const [step, setStep] = useState<WizardStep>("input");
  const [domain, setDomain] = useState("");
  const [domainId, setDomainId] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionErrorDetails, setProvisionErrorDetails] = useState<{
    title?: string;
    message?: string;
    nextSteps?: string[];
    helpUrl?: string;
  } | null>(null);
  const [isPollingStatus, setIsPollingStatus] = useState(false);
  const [isPollingDns, setIsPollingDns] = useState(false);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dnsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const provision = useProvisionM365Domain();
  const verifyDomain = useVerifyM365Domain();
  const checkStatus = useCheckM365DomainStatus();
  const pushToCloudflare = usePushDnsToCloudflare();
  const { data: dnsProviderStatus } = useDnsProvider();
  const cloudflareConnected = !!dnsProviderStatus?.connected;
  // Fetch ALL CF domains when connected so the picker has the full list.
  // Also used downstream to detect matches when the user types in the
  // "Use a different domain" path.
  const { data: zonesData, isLoading: zonesLoading } = useCloudflareZones({
    includeUnmigratedMatches: false,
    enabled: cloudflareConnected,
  });
  // Existing ACA sending domains — filtered out of the picker so users can't
  // try to "add" something that's already added.
  const { data: existingDomains = [] } = useEmailSendingDomains();
  const existingDomainNames = useMemo(
    () => existingDomains.map((d) => d.domain.toLowerCase()),
    [existingDomains],
  );

  // Picker-first mode when CF connected. Two source modes:
  //   "picker"  → user picks from CF dropdown; `pickedDomain` is the value.
  //   "manual"  → user types a domain; `domain` (existing state) is the value.
  // When CF is not connected, we always render manual mode (no source toggle).
  const [domainSource, setDomainSource] = useState<"picker" | "manual">("picker");
  const [pickedDomain, setPickedDomain] = useState<string | null>(null);
  const [showCfConnect, setShowCfConnect] = useState(false);

  // The effective domain that will be provisioned — derived from whichever
  // source is active. Replaces direct use of `domain` in the provision call.
  const effectiveDomain = (domainSource === "picker" && cloudflareConnected
    ? pickedDomain ?? ""
    : domain).toLowerCase().trim();
  const isValidEffectiveDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(effectiveDomain);

  // Find the CF domain that matches the effective domain (for manual-mode
  // typing → auto-detect, and for picker mode → always matches).
  const matchingZone = useMemo(() => {
    if (!effectiveDomain || !zonesData?.zones) return null;
    return (
      zonesData.zones.find((z) => z.name.toLowerCase() === effectiveDomain) ??
      zonesData.zones.find((z) => effectiveDomain.endsWith(`.${z.name.toLowerCase()}`)) ??
      null
    );
  }, [effectiveDomain, zonesData?.zones]);

  const [autoPushState, setAutoPushState] = useState<
    "idle" | "pushing" | "succeeded" | "failed"
  >("idle");
  const [autoPushSummary, setAutoPushSummary] = useState<string | null>(null);
  const [autoPushError, setAutoPushError] = useState<string | null>(null);
  // Track the last-pushed record signature per domain. DKIM CNAMEs only
  // appear in dns_records AFTER M365 ownership verification (added by
  // enrichWithDkim in the verify_dns edge function). That means the record
  // set grows mid-wizard, and we need to push the new DKIM CNAMEs as soon
  // as they appear. Backend push is idempotent (skips records already in CF),
  // so re-pushing on every record-set change is safe.
  const pushedSignatures = useRef<Map<string, string>>(new Map());

  const stopStatusPoll = () => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    setIsPollingStatus(false);
  };

  const stopDnsPoll = () => {
    if (dnsPollRef.current) {
      clearInterval(dnsPollRef.current);
      dnsPollRef.current = null;
    }
    setIsPollingDns(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStatusPoll();
      stopDnsPoll();
    };
  }, []);

  // When CF gets connected mid-flow (user clicked the Tip in manual mode and
  // completed the connect dialog), promote them to picker mode automatically.
  // Without this, the wizard would still show the manual input field even
  // though CF is now usable. The CF picker query refetches once cloudflareConnected
  // flips to true, so by the time we switch, zones are available (or loading).
  useEffect(() => {
    if (cloudflareConnected && step === "input" && domainSource === "manual" && !domain) {
      setDomainSource("picker");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudflareConnected]);

  // Auto-push DNS to Cloudflare. Two scenarios trigger this:
  //   (1) Initial push: M365 just generated the ownership/SPF/MX/etc records.
  //   (2) DKIM follow-up: enrichWithDkim added 2 CNAMEs to the record set
  //       after ownership verification succeeded. We need to push those too.
  //
  // To detect "new records to push" we compute a signature from the record
  // names and re-push whenever it changes. Backend push is idempotent — records
  // already in CF are returned as "skipped", not re-written.
  useEffect(() => {
    if (!domainId) return;
    if (!cloudflareConnected || !matchingZone) return;
    if (dnsRecords.length === 0) return;

    // Signature: sorted list of (type, name, value). Captures both "DKIM was
    // just added" (record count grows) AND "Microsoft rotated the DKIM
    // partition" (value changed for an existing selector — e.g. d-v1 → e-v1).
    // The value is part of the signature because EXO can change the CNAME
    // target post-verification, and we MUST re-push when that happens or
    // mail will never sign.
    const signature = dnsRecords
      .map((r) => `${r.type}|${r.name}|${r.value}`)
      .sort()
      .join(",");
    if (pushedSignatures.current.get(domainId) === signature) return;
    pushedSignatures.current.set(domainId, signature);

    setAutoPushState("pushing");
    setAutoPushError(null);

    (async () => {
      try {
        const result = await pushToCloudflare.mutateAsync({
          domain_id: domainId,
          confirm_destructive: true,
        });
        if (result.success && !result.requires_confirmation && !result.dry_run) {
          setAutoPushSummary(result.summary ?? "Records published to Cloudflare");
          setAutoPushState("succeeded");
          // Refresh local dnsRecords so the UI immediately reflects the new
          // verified state without waiting for the next 20s poll.
          const refreshed = await fetchDomainRecords(domainId);
          if (refreshed.length > 0) setDnsRecords(refreshed);
        } else if (result.error) {
          setAutoPushError(result.error);
          setAutoPushState("failed");
        }
      } catch (err) {
        setAutoPushError(err instanceof Error ? err.message : "Auto-push failed");
        setAutoPushState("failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId, cloudflareConnected, matchingZone?.zone_id, dnsRecords]);

  const fetchDomainRecords = async (id: string): Promise<DnsRecord[]> => {
    const { data } = await supabase
      .from("email_sending_domains")
      .select("dns_records, vm_status, m365_domain_verified")
      .eq("id", id)
      .single();
    return (data?.dns_records as DnsRecord[]) || [];
  };

  const startStatusPolling = (id: string) => {
    setIsPollingStatus(true);
    const startTime = Date.now();

    statusPollRef.current = setInterval(async () => {
      if (Date.now() - startTime > 10 * 60 * 1000) {
        stopStatusPoll();
        setProvisionError("Provisioning timed out. Please check the domain status.");
        setStep("input");
        return;
      }
      try {
        const result = await checkStatus.mutateAsync(id);
        const vmStatus = result?.domain?.vm_status || result?.vm_status;
        if (vmStatus === "running") {
          stopStatusPoll();
          // Prefer edge function response (service role, bypasses RLS)
          const edgeRecords = (result?.domain?.dns_records || result?.dns_records) as DnsRecord[] | undefined;
          const records = edgeRecords && edgeRecords.length > 0
            ? edgeRecords
            : await fetchDomainRecords(id);
          setDnsRecords(records);
          setStep("dns");
          startDnsPolling(id);
        } else if (vmStatus === "error") {
          stopStatusPoll();
          setProvisionError(result?.domain?.last_error || "Provisioning failed. Please try again.");
          setStep("input");
        }
      } catch {
        // Keep polling
      }
    }, 3000);
  };

  const startDnsPolling = (id: string) => {
    setIsPollingDns(true);

    dnsPollRef.current = setInterval(async () => {
      try {
        const result = await verifyDomain.mutateAsync({ domainId: id, silent: true });
        // Prefer dns_records returned by the edge function (service role, always fresh and
        // bypasses RLS). Fall back to DB query only if the edge function didn't return them.
        const records = result.dns_records && result.dns_records.length > 0
          ? result.dns_records
          : await fetchDomainRecords(id);
        if (records.length > 0) setDnsRecords(records);

        if (result.isVerified) {
          setOwnershipVerified(true);
          // Check if DKIM records are still pending
          const hasPendingDkim = records.some(
            (r) => r.name.toLowerCase().includes("_domainkey") && !r.verified
          );
          if (!hasPendingDkim) {
            stopDnsPoll();
            setStep("verified");
          }
          // else: stay on DNS step so user can add DKIM CNAMEs
        }
      } catch {
        // Keep polling
      }
    }, 20000);
  };

  const resetWizard = () => {
    stopStatusPoll();
    stopDnsPoll();
    setStep("input");
    setDomain("");
    setDomainId(null);
    setDnsRecords([]);
    setProvisionError(null);
    setProvisionErrorDetails(null);
    setOwnershipVerified(false);
    setAutoPushState("idle");
    setAutoPushSummary(null);
    setAutoPushError(null);
    setDomainSource("picker");
    setPickedDomain(null);
    pushedSignatures.current = new Map();
    provision.reset();
    verifyDomain.reset();
    pushToCloudflare.reset();
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetWizard();
    onOpenChange(isOpen);
  };

  const handleProvision = async () => {
    setProvisionError(null);
    setProvisionErrorDetails(null);
    setStep("provisioning");
    try {
      const result = await provision.mutateAsync({
        m365_tenant_id: tenant.id,
        domain: effectiveDomain,
      });
      setDomainId(result.domain_id);
      startStatusPolling(result.domain_id);
    } catch (err) {
      const details = (err as { details?: Record<string, unknown> }).details;
      if (details && (details.error_title || details.next_steps)) {
        setProvisionErrorDetails({
          title: typeof details.error_title === "string" ? details.error_title : undefined,
          message: typeof details.error_message === "string" ? details.error_message : undefined,
          nextSteps: Array.isArray(details.next_steps) ? (details.next_steps as string[]) : undefined,
          helpUrl: typeof details.help_url === "string" ? details.help_url : undefined,
        });
        setProvisionError(null);
      } else {
        setProvisionError(err instanceof Error ? err.message : "Provisioning failed");
      }
      setStep("input");
    }
  };

  const [ownershipVerified, setOwnershipVerified] = useState(false);

  const handleManualVerify = async () => {
    if (!domainId) return;
    try {
      const result = await verifyDomain.mutateAsync(domainId);
      // Prefer edge function response (service role, always fresh). Fall back to DB query.
      const records = result.dns_records && result.dns_records.length > 0
        ? result.dns_records
        : await fetchDomainRecords(domainId);
      if (records.length > 0) setDnsRecords(records);
      if (result.isVerified) {
        setOwnershipVerified(true);
        const hasPendingDkim = records.some(
          (r) => r.name.toLowerCase().includes("_domainkey") && !r.verified
        );
        if (!hasPendingDkim) {
          stopDnsPoll();
          setStep("verified");
        }
        // else: stay on DNS step to show DKIM CNAMEs with updated verified states
      }
    } catch {
      // Error handled by mutation
    }
  };

  const handleCopy = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Domain validation: must have at least one dot and look like a valid domain
  const isValidDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain.trim()) && domain.includes(".");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Add Sending Domain
          </DialogTitle>
          <DialogDescription>
            {step === "input" && `Provision a custom sending domain on ${tenant.display_name || tenant.onmicrosoft_domain}.`}
            {step === "provisioning" && "Setting up your domain on Microsoft 365..."}
            {step === "dns" && (ownershipVerified ? "Domain verified — add DKIM records to complete setup." : "Configure DNS records to activate your domain.")}
            {step === "verified" && "Your domain is verified and ready for mailboxes."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Input */}
        {step === "input" && (
          <div className="space-y-4">
            {provisionError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{provisionError}</AlertDescription>
              </Alert>
            )}

            {provisionErrorDetails && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {provisionErrorDetails.title && (
                    <div className="font-semibold mb-1">{provisionErrorDetails.title}</div>
                  )}
                  {provisionErrorDetails.message && (
                    <p className="text-sm mb-2">{provisionErrorDetails.message}</p>
                  )}
                  {provisionErrorDetails.nextSteps && provisionErrorDetails.nextSteps.length > 0 && (
                    <>
                      <div className="text-xs font-semibold mt-2 mb-1 uppercase tracking-wide">
                        How to fix it
                      </div>
                      <ol className="list-decimal list-inside text-sm space-y-1">
                        {provisionErrorDetails.nextSteps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </>
                  )}
                  {provisionErrorDetails.helpUrl && (
                    <a
                      href={provisionErrorDetails.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium underline mt-2"
                    >
                      Microsoft docs <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Use a <strong>secondary domain</strong> for cold email (e.g. <code className="text-xs bg-muted px-1 py-0.5 rounded">acme-outreach.com</code>). Never use your primary domain — it protects your sender reputation.
              </AlertDescription>
            </Alert>

            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground">Tenant</div>
              <div className="font-medium text-sm mt-0.5">
                {tenant.display_name || tenant.onmicrosoft_domain}
              </div>
              <div className="text-xs text-muted-foreground">{tenant.onmicrosoft_domain}</div>
            </div>

            {cloudflareConnected ? (
              <div className="space-y-3">
                {/* Picker mode (default when CF connected) */}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="domain-source"
                    checked={domainSource === "picker"}
                    onChange={() => setDomainSource("picker")}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Pick from your Cloudflare domains</div>
                    <div className="text-xs text-muted-foreground">
                      ACA writes DNS automatically. No copy-paste.
                    </div>
                  </div>
                </label>
                {domainSource === "picker" && (
                  <div className="pl-6">
                    <CloudflareDomainPicker
                      domains={zonesData?.zones ?? []}
                      isLoading={zonesLoading}
                      excludeDomains={existingDomainNames}
                      value={pickedDomain}
                      onChange={setPickedDomain}
                    />
                  </div>
                )}

                {/* Manual mode */}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="domain-source"
                    checked={domainSource === "manual"}
                    onChange={() => setDomainSource("manual")}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Use a different domain</div>
                    <div className="text-xs text-muted-foreground">
                      For a domain that isn't in your Cloudflare account yet.
                    </div>
                  </div>
                </label>
                {domainSource === "manual" && (
                  <div className="pl-6 space-y-2">
                    <Input
                      id="domain"
                      placeholder="acme-outreach.com"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value.toLowerCase())}
                      autoFocus
                    />
                    {domain && matchingZone && (
                      <Alert className="border-green-500/40 bg-green-500/5 py-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <AlertDescription className="text-xs leading-relaxed">
                          <span className="font-semibold text-green-700 dark:text-green-300">
                            {matchingZone.name === domain.toLowerCase().trim()
                              ? `${matchingZone.name} is in your Cloudflare account`
                              : `${matchingZone.name} (parent) is in your Cloudflare account — subdomain records will be written there`}
                          </span>
                          <span className="block text-muted-foreground">
                            DNS records will be written to Cloudflare automatically.
                          </span>
                        </AlertDescription>
                      </Alert>
                    )}
                    {domain && !matchingZone && isValidEffectiveDomain && (
                      <Alert>
                        <AlertCircle className="w-4 h-4" />
                        <AlertDescription className="text-xs leading-relaxed">
                          <span className="font-semibold">{domain} isn't in your Cloudflare account.</span>
                          <span className="block text-muted-foreground">
                            You'll add DNS records manually after provisioning. Or
                            {" "}
                            <a
                              href="https://dash.cloudflare.com/?to=/:account/add-site"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-primary"
                            >
                              add it to Cloudflare first
                            </a>
                            {" "}
                            to skip manual DNS setup.
                          </span>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="domain">Sending Domain</Label>
                  <Input
                    id="domain"
                    placeholder="acme-outreach.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value.toLowerCase())}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use a dedicated sending domain (e.g. acme-outreach.com, acme-mail.com). Not your main business domain.
                  </p>
                </div>

                <Alert>
                  <Cloud className="w-4 h-4 text-amber-500" />
                  <AlertDescription className="text-xs leading-relaxed">
                    <span className="font-medium">Tip:</span> Connect Cloudflare and ACA handles
                    DNS for you automatically — no copy-paste needed.
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 h-7 text-xs"
                      onClick={() => setShowCfConnect(true)}
                    >
                      Connect Cloudflare
                    </Button>
                  </AlertDescription>
                </Alert>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                variant="cta"
                onClick={handleProvision}
                disabled={!isValidEffectiveDomain || provision.isPending}
              >
                {provision.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Provision Domain
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Provisioning */}
        {step === "provisioning" && (
          <div className="flex flex-col items-center py-12 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
            <p className="font-medium">Setting up Microsoft 365 domain...</p>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Adding the domain to your tenant and generating DNS records.
              This typically takes 10-30 seconds.
            </p>
            {isPollingStatus && (
              <p className="text-xs text-muted-foreground">Checking status...</p>
            )}
          </div>
        )}

        {/* Step 3: DNS Records */}
        {step === "dns" && (
          <div className="space-y-4">
            {/* Auto-push banner — only when CF was attempted */}
            {autoPushState === "pushing" && (
              <Alert className="border-amber-500/40 bg-amber-500/5 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                <AlertDescription className="text-sm">
                  Writing DNS records to Cloudflare...
                </AlertDescription>
              </Alert>
            )}
            {autoPushState === "succeeded" && (
              <Alert className="border-green-500/40 bg-green-500/5 py-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-sm">
                  <strong className="text-green-700 dark:text-green-300">DNS auto-published to Cloudflare</strong>
                  <span className="block text-xs text-muted-foreground">
                    {autoPushSummary} — verification usually completes within 60 seconds.
                  </span>
                </AlertDescription>
              </Alert>
            )}
            {autoPushState === "failed" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Auto-publish to Cloudflare failed: {autoPushError}. You can still add the
                  records manually below.
                </AlertDescription>
              </Alert>
            )}

            {ownershipVerified ? (
              <Alert className="border-green-500/30 bg-green-500/5">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-sm text-green-700 dark:text-green-400">
                  <strong>Domain ownership verified!</strong> Make sure the DKIM CNAMEs below are also added, then click "Verify DKIM".
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm space-y-1.5">
                    <p>
                      Log in to your domain registrar and add each record below.
                      {isPollingDns ? (
                        <span className="inline-flex items-center gap-1 ml-2 text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Checking verification every 20s...
                        </span>
                      ) : (
                        <span className="text-muted-foreground ml-1">DNS propagation can take up to 10 minutes.</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Open your registrar:</span>
                      <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                        Cloudflare <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      <a href="https://ap.www.namecheap.com/domains/list/" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                        Namecheap <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      <a href="https://dcc.godaddy.com/control/portfolio" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                        GoDaddy <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      <a href="https://porkbun.com/account/domains" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                        Porkbun <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </AlertDescription>
                </Alert>

                <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-xs text-amber-900 dark:text-amber-200">
                    <strong>Before adding the MX record:</strong> delete any existing MX records on this domain in your registrar. Multiple MX records will split your inbound mail and break reply detection.
                  </AlertDescription>
                </Alert>
              </>
            )}

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
              {dnsRecords.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading DNS records...
                </div>
              ) : (() => {
                const dkimRecords = dnsRecords.filter(r => r.name.toLowerCase().includes("_domainkey"));
                const otherRecords = dnsRecords.filter(r => !r.name.toLowerCase().includes("_domainkey"));

                const renderRecord = (record: DnsRecord, i: number) => {
                  const purpose = getDnsPurposeLabel(record);
                  const isVerified = record.verified;
                  const hasConflict = !!record.conflict;
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 space-y-2 text-sm ${
                        hasConflict
                          ? "border-amber-500/40 bg-amber-500/5"
                          : isVerified
                            ? "border-green-500/30 bg-green-500/5"
                            : "border-border bg-muted/10"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs font-mono px-1.5">{record.type}</Badge>
                          <span className="text-xs font-medium text-foreground/80">{purpose.label}</span>
                          {hasConflict ? (
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                          ) : isVerified ? (
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
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" title="Copy name" onClick={() => handleCopy(record.name, `name-${i}`)}>
                            {copiedKey === `name-${i}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
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
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0 mt-0.5" title="Copy value" onClick={() => handleCopy(record.value, `val-${i}`)}>
                            {copiedKey === `val-${i}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                      {record.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{record.description}</p>
                      )}
                      {hasConflict && (
                        <Alert variant="default" className="border-amber-500/40 bg-amber-500/5 py-2">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                          <AlertDescription className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed ml-1">
                            <span className="font-semibold">Conflict will break deliverability: </span>
                            {record.conflict}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {/* Ownership + Email routing records */}
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-1">
                      Domain verification &amp; email routing
                    </div>
                    {otherRecords.map((record, i) => renderRecord(record, i))}

                    {/* DKIM records — generated upfront so all records can be added in one pass */}
                    {dkimRecords.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 mt-3 mb-1">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            DKIM signing
                          </div>
                          <Badge variant="outline" className="text-xs text-muted-foreground">Required for deliverability</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          Add these two CNAME records alongside the records above. Microsoft starts signing once the domain is verified.
                        </p>
                        {dkimRecords.map((record, i) => renderRecord(record, otherRecords.length + i))}
                      </>
                    )}
                  </>
                );
              })()}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close (verify later)
              </Button>
              <Button
                variant="cta"
                onClick={handleManualVerify}
                disabled={verifyDomain.isPending}
              >
                {verifyDomain.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                {ownershipVerified ? "Verify DKIM" : "Check Verification"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Verified */}
        {step === "verified" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <div className="text-center">
                <p className="font-semibold text-lg">Domain Verified!</p>
                <p className="text-muted-foreground text-sm mt-1 font-mono">{domain}</p>
              </div>
              <Badge variant="outline" className="border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10">
                verified
              </Badge>
            </div>

            <Alert className="border-green-500/30 bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                DNS records are verified. You can now create mailboxes on this domain.
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Done
              </Button>
              <Button
                variant="cta"
                onClick={() => {
                  if (domainId) onDomainProvisioned?.(domainId);
                  handleClose(false);
                }}
              >
                Create Mailboxes &rarr;
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>

      {/* Connect Cloudflare dialog mounted as portal so it can open from
          within the wizard (CF tip button). When the user finishes, the
          wizard reactively picks up cloudflareConnected and the picker
          becomes available without closing/reopening. */}
      <ConnectCloudflareDialog open={showCfConnect} onOpenChange={setShowCfConnect} />
    </Dialog>
  );
}
