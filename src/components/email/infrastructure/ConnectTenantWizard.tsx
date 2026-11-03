import { useState, useEffect, useRef } from "react";
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
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  TriangleAlert,
} from "lucide-react";
import {
  useInitiateM365Consent,
  useValidateM365Tenant,
  useInitiateExoConsent,
} from "@/hooks/useM365Tenants";
import { openConsentPopup } from "@/lib/open-consent-popup";

type WizardStep = "instructions" | "domain_input" | "consenting" | "confirmed";

interface ConnectTenantWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTenantConnected?: (tenantId: string) => void;
  onAddDomain?: (tenantId: string) => void;
}

export function ConnectTenantWizard({
  open,
  onOpenChange,
  onTenantConnected,
  onAddDomain,
}: ConnectTenantWizardProps) {
  const [step, setStep] = useState<WizardStep>("instructions");
  const [form, setForm] = useState({ onmicrosoft_domain: "", display_name: "", admin_email: "", admin_password: "" });
  const [domainEmailStripped, setDomainEmailStripped] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantDisplayName, setTenantDisplayName] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [securityDefaultsWarning, setSecurityDefaultsWarning] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const consentRetried = useRef(false);

  const [consentPhase, setConsentPhase] = useState<"graph" | "exo">("graph");
  const exoConsentStarted = useRef(false);

  const initiateConsent = useInitiateM365Consent();
  const validateTenant = useValidateM365Tenant();
  const initiateExoConsent = useInitiateExoConsent();

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const moveToConfirmed = (id: string, displayName?: string, secDefaults?: boolean) => {
    stopPolling();
    setTenantDisplayName(displayName || null);
    setSecurityDefaultsWarning(secDefaults === true);
    setStep("confirmed");
    onTenantConnected?.(id);
  };

  const startExoConsent = async (id: string) => {
    if (exoConsentStarted.current) return;
    exoConsentStarted.current = true;
    setConsentPhase("exo");
    setValidationError(null);
    try {
      const result = await initiateExoConsent.mutateAsync(id);
      openConsentPopup(result.consent_url);
      // Reset poll timer for EXO phase
      pollStartRef.current = Date.now();
    } catch (err) {
      setValidationError(
        `Failed to open Exchange consent: ${err instanceof Error ? err.message : "unknown error"}. Click Check Connection to retry.`
      );
    }
  };

  const startPolling = (id: string) => {
    pollStartRef.current = Date.now();

    pollIntervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed > 5 * 60 * 1000) {
        stopPolling();
        setValidationError("Connection timed out. Please try checking manually.");
        return;
      }
      try {
        const result = await validateTenant.mutateAsync(id);
        if (result.success && result.exo_consent_granted) {
          // Both Graph + Exchange consented — done
          moveToConfirmed(id, result.tenant_display_name, result.security_defaults_enabled);
        } else if (result.success && !result.exo_consent_granted) {
          // Graph works — now start EXO consent phase
          startExoConsent(id);
        } else if (result.code === "CONSENT_NOT_GRANTED" && result.consent_url && !consentRetried.current) {
          consentRetried.current = true;
          setValidationError("Consent not detected. Please accept permissions in the new popup.");
          openConsentPopup(result.consent_url);
        }
      } catch {
        // Keep polling on error
      }
    }, 8000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const resetWizard = () => {
    stopPolling();
    setStep("instructions");
    setForm({ onmicrosoft_domain: "", display_name: "", admin_email: "", admin_password: "" });
    setDomainEmailStripped(false);
    setTenantId(null);
    setTenantDisplayName(null);
    setValidationError(null);
    setSecurityDefaultsWarning(false);
    setConsentPhase("graph");
    consentRetried.current = false;
    exoConsentStarted.current = false;
    initiateConsent.reset();
    initiateExoConsent.reset();
    validateTenant.reset();
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetWizard();
    onOpenChange(isOpen);
  };

  const handleInitiateConsent = async () => {
    setValidationError(null);
    try {
      const rawDomain = form.onmicrosoft_domain.trim().toLowerCase().replace(/\.onmicrosoft\.com$/, "");
      const result = await initiateConsent.mutateAsync({
        onmicrosoft_domain: `${rawDomain}.onmicrosoft.com`,
        display_name: form.display_name.trim() || undefined,
        admin_email: form.admin_email.trim() || undefined,
        admin_password: form.admin_password.trim() || undefined,
      });
      setTenantId(result.tenant_id);
      openConsentPopup(result.consent_url);
      setStep("consenting");
      startPolling(result.tenant_id);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Failed to initiate consent");
    }
  };

  const handleManualCheck = async () => {
    if (!tenantId) return;
    setValidationError(null);
    try {
      const result = await validateTenant.mutateAsync(tenantId);
      if (result.success && result.exo_consent_granted) {
        moveToConfirmed(tenantId, result.tenant_display_name, result.security_defaults_enabled);
      } else if (result.success && !result.exo_consent_granted) {
        // Graph works, EXO not yet — trigger EXO consent
        startExoConsent(tenantId);
        startPolling(tenantId);
      } else {
        setValidationError(result.error || "Tenant not yet connected. Complete the consent flow in the Microsoft popup.");
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Check failed");
    }
  };

  const onmicrosoftDomainClean = form.onmicrosoft_domain.trim().toLowerCase().replace(/\.onmicrosoft\.com$/, "");
  const canSubmit =
    onmicrosoftDomainClean.length > 2 &&
    form.admin_email.trim().length > 0 &&
    form.admin_password.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Connect Microsoft 365 Tenant
          </DialogTitle>
          <DialogDescription>
            {step === "instructions" && "Set up a Microsoft 365 tenant for email sending infrastructure."}
            {step === "domain_input" && "Enter your Microsoft 365 tenant domain and admin credentials."}
            {step === "consenting" && "Complete the Microsoft consent flow in the popup window."}
            {step === "confirmed" && "Your Microsoft 365 tenant is connected."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Instructions */}
        {step === "instructions" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {/* Cost summary */}
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Up to 100 mailboxes per tenant</span>
                  <Badge variant="secondary" className="text-xs">~$6/mo</Badge>
                </div>
              </div>

              {/* What you need (minimal — most things are automated) */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-400">What you need before connecting</p>
                  <a href="https://automatedclientacquisition.notion.site/Microsoft-Tenant-Setup-Guide-Cold-Email-Infrastructure-3211682ec99e810aa756f0acfb9b9024?pvs=74" target="_blank" rel="noopener noreferrer" className="text-[10px] text-foreground/60 hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2">
                    Tenant setup guide <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="space-y-2.5">
                  {[
                    {
                      title: "A Microsoft 365 tenant with Business Basic license (or higher)",
                      desc: "Exchange Online is required. Free trials work for testing.",
                      link: "https://admin.microsoft.com",
                      linkLabel: "admin.microsoft.com",
                    },
                    {
                      title: "A Global Administrator account on that tenant",
                      desc: "You'll sign in with this account to grant Microsoft consent in a popup.",
                      link: "https://admin.microsoft.com/#/users",
                      linkLabel: "M365 Admin → Users",
                    },
                    {
                      title: "A licensed mailbox to use as SMTP fallback",
                      desc: "One M365 Business Basic user — you'll enter its credentials on the next screen.",
                      link: "https://admin.microsoft.com/#/catalog",
                      linkLabel: "Buy a license",
                    },
                  ].map((s, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center font-semibold text-[10px] mt-0.5">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-foreground">{s.title}</span>
                          {s.link && (
                            <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-400/80 hover:text-amber-400 inline-flex items-center gap-0.5 shrink-0">
                              {s.linkLabel} <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* What we handle automatically */}
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  We handle everything else automatically
                </p>
                <ul className="text-[11px] text-muted-foreground/80 space-y-1 ml-5 list-disc">
                  <li>Assign required Exchange + User directory roles to our app</li>
                  <li>Disable Security Defaults (so SMTP AUTH can be enabled)</li>
                  <li>Enable tenant-level SMTP AUTH (Set-TransportConfig)</li>
                  <li>Create shared mailboxes, set per-mailbox passwords, enable per-mailbox SMTP AUTH</li>
                  <li>Configure DNS records, DKIM signing, domain verification</li>
                  <li>Sync profile photos and avatars</li>
                </ul>
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed pt-1">
                  Onboarding takes 5-15 minutes after consent while Microsoft propagates role assignments.
                  You don't need to touch the Entra portal or M365 admin center.
                </p>
              </div>

              {/* MFA security warning */}
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2">
                <TriangleAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-muted-foreground/80 leading-relaxed">
                  <span className="font-semibold text-red-400">Security note:</span> we disable Security
                  Defaults on this tenant to enable SMTP AUTH. This removes blanket MFA enforcement
                  on user logins. If your organization requires MFA, set up a{" "}
                  <a href="https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade/~/Policies" target="_blank" rel="noopener noreferrer" className="underline text-red-400 hover:text-red-300">
                    Conditional Access policy
                  </a>{" "}
                  in Entra after onboarding to enforce MFA on user accounts (excluding service accounts).
                </div>
              </div>
            </div>

            <DialogFooter className="flex-shrink-0 pt-4">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button variant="cta" onClick={() => setStep("domain_input")}>
                Get Started
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Domain Input */}
        {step === "domain_input" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {validationError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{validationError}</AlertDescription>
                </Alert>
              )}

              <div>
                <Label htmlFor="onmicrosoft_domain">Tenant Domain</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id="onmicrosoft_domain"
                    placeholder="contoso"
                    value={form.onmicrosoft_domain}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const hadAt = raw.includes("@");
                      // Tenant prefix only — no protocol, no .onmicrosoft.com suffix,
                      // no email "user@" prefix, only [a-z0-9-]
                      const cleaned = (raw.toLowerCase().split("@").pop() ?? "")
                        .replace(/^https?:\/\//, "")
                        .replace(/\.onmicrosoft\.com$/, "")
                        .replace(/[^a-z0-9-]/g, "");
                      setForm({ ...form, onmicrosoft_domain: cleaned });
                      setDomainEmailStripped(hadAt);
                    }}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">.onmicrosoft.com</span>
                </div>
                {domainEmailStripped && (
                  <p className="text-xs text-amber-400 mt-1">
                    Enter only the tenant prefix, not the admin email. We removed the "{"<user>@"}" part for you.
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Found in{" "}
                  <a href="https://admin.microsoft.com/#/Domains" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                    M365 Admin &rarr; Domains <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </p>
              </div>

              <div>
                <Label htmlFor="display_name">Display Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="display_name"
                  placeholder="e.g. Agency Client Tenant"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="admin_email">Admin Email</Label>
                <Input
                  id="admin_email"
                  type="email"
                  placeholder="admin@contoso.onmicrosoft.com"
                  value={form.admin_email}
                  onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">A licensed M365 user (Business Basic). Used as SMTP fallback if shared mailbox credentials fail.</p>
              </div>

              <div>
                <Label htmlFor="admin_password">Admin Password</Label>
                <Input
                  id="admin_password"
                  type="password"
                  placeholder="Admin account password"
                  value={form.admin_password}
                  onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">Stored AES-256 encrypted.</p>
              </div>

              <Alert className="border-blue-500/30 bg-blue-500/5">
                <ExternalLink className="h-4 w-4 text-blue-400" />
                <AlertDescription className="text-xs text-muted-foreground">
                  After clicking Continue, a Microsoft popup will open. Sign in as <strong className="text-foreground">Global Admin</strong> and click <strong className="text-foreground">Accept</strong> to grant ACA permissions to manage mailboxes.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="flex-shrink-0 pt-4">
              <Button variant="outline" onClick={() => setStep("instructions")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                variant="cta"
                onClick={handleInitiateConsent}
                disabled={!canSubmit || initiateConsent.isPending}
              >
                {initiateConsent.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Continue &rarr; Open Microsoft
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Consenting (two-phase: Graph then EXO) */}
        {step === "consenting" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Progress indicator */}
              <div className="flex items-center gap-3 px-2 pt-2">
                <div className="flex items-center gap-2">
                  {consentPhase === "graph" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                  <span className={`text-xs font-medium ${consentPhase === "graph" ? "text-blue-400" : "text-green-400"}`}>
                    Graph API
                  </span>
                </div>
                <div className="h-px flex-1 bg-border" />
                <div className="flex items-center gap-2">
                  {consentPhase === "exo" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  ) : consentPhase === "graph" ? (
                    <div className="w-4 h-4 rounded-full border border-muted-foreground/30" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                  <span className={`text-xs font-medium ${consentPhase === "exo" ? "text-blue-400" : "text-muted-foreground/50"}`}>
                    Exchange Online
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center py-4 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {consentPhase === "graph"
                    ? "Waiting for Graph API consent..."
                    : "Waiting for Exchange Online consent..."}
                </span>
              </div>

              <Alert>
                <ExternalLink className="h-4 w-4" />
                <AlertDescription className="space-y-1.5">
                  <p className="font-medium text-sm">
                    {consentPhase === "graph"
                      ? "Step 1: Grant Graph API access"
                      : "Step 2: Grant Exchange Online access"}
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                    <li>Sign in with your <strong className="text-foreground">Global Admin</strong> account</li>
                    <li>Review the requested permissions</li>
                    <li>Click <strong className="text-foreground">Accept</strong></li>
                  </ol>
                  {consentPhase === "exo" && (
                    <p className="text-[11px] text-muted-foreground/60 mt-2">
                      A second popup opened for Exchange Online permissions. Accept it to complete the connection.
                    </p>
                  )}
                </AlertDescription>
              </Alert>

              {validationError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{validationError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 pt-4">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleManualCheck}
                disabled={validateTenant.isPending}
              >
                {validateTenant.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Check Connection
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Confirmed */}
        {step === "confirmed" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="flex flex-col items-center py-4 gap-3">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <div className="text-center">
                  <p className="font-semibold text-lg">Tenant Connected!</p>
                  {tenantDisplayName && (
                    <p className="text-muted-foreground text-sm mt-1">{tenantDisplayName}</p>
                  )}
                </div>
                <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10">
                  connected
                </Badge>
              </div>

              {securityDefaultsWarning ? (
                <Alert variant="destructive">
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription className="space-y-1.5">
                    <p className="font-medium">Security Defaults are enabled — action required.</p>
                    <p className="text-xs">SMTP AUTH is blocked. No mailbox will work until you fix this:</p>
                    <ol className="list-decimal list-inside text-xs space-y-1.5 text-muted-foreground">
                      <li>
                        <a href="https://entra.microsoft.com" target="_blank" rel="noopener noreferrer" className="text-red-300 underline inline-flex items-center gap-0.5">
                          Open Entra ID <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        {" "}&rarr; Overview &rarr; Properties &rarr; <strong className="text-foreground">Manage security defaults</strong> &rarr; Toggle <strong className="text-foreground">Disabled</strong> &rarr; Save
                      </li>
                      <li>
                        <a href="https://admin.exchange.microsoft.com/#/settings" target="_blank" rel="noopener noreferrer" className="text-red-300 underline inline-flex items-center gap-0.5">
                          Open Exchange Admin Center <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        {" "}&rarr; Settings &rarr; Mail flow &rarr; turn off <strong className="text-foreground">"Turn off SMTP AUTH"</strong> &rarr; Save
                      </li>
                    </ol>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-green-500/30 bg-green-500/5">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription className="text-green-400 text-sm">
                    Tenant connected. Next: add a sending domain and create mailboxes.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 pt-4">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Done
              </Button>
              <Button variant="cta" onClick={() => {
                if (tenantId && onAddDomain) {
                  onAddDomain(tenantId);
                }
                handleClose(false);
              }}>
                Add Domain &rarr;
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
