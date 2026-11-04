import { useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight, KeyRound, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openConsentPopup } from "@/lib/open-consent-popup";
import { useInitiateExoConsent, useRefreshM365Tenant } from "@/hooks/useM365Tenants";
import { toast } from "sonner";
import type { M365Tenant, PrerequisiteCheck, PrerequisiteKey } from "@/types/email";

const CHECK_LABELS: Record<PrerequisiteKey, string> = {
  consent: "Microsoft admin consent (Graph + Exchange Online)",
  license: "Microsoft 365 license with Exchange Online",
  directory_roles: "Required Exchange + User directory roles",
  security_defaults: "Security Defaults disabled",
  smtp_auth: "Tenant-level SMTP AUTH enabled",
  mail_send: "Mail.Send permission granted to the ACA app",
};

const CHECK_ORDER: PrerequisiteKey[] = [
  "license",
  "consent",
  "directory_roles",
  "smtp_auth",
  "security_defaults",
  "mail_send",
];

interface Props {
  tenant: M365Tenant;
}

export function TenantPrerequisitesChecklist({ tenant }: Props) {
  const checks = tenant.prerequisites_status || {};
  const initiateExoConsent = useInitiateExoConsent();
  const refreshTenant = useRefreshM365Tenant();

  // mail_send was added after tenants were validated; until a tenant is
  // refreshed it has no result, which must not read as a failing prerequisite.
  const allChecks: Array<{ key: PrerequisiteKey; check: PrerequisiteCheck | null }> = CHECK_ORDER
    .map((key) => ({ key, check: checks[key] || null }))
    .filter(({ key, check }) => key !== "mail_send" || check !== null);

  const totalCount = allChecks.length;
  const okCount = allChecks.filter((c) => c.check?.ok).length;
  const errorCount = allChecks.filter((c) => c.check && !c.check.ok && c.check.status === "error").length;
  const pendingCount = allChecks.filter((c) => c.check && !c.check.ok && c.check.status === "pending").length;
  const allGreen = okCount === totalCount;

  // Default expanded if anything needs attention or unknown
  const [expanded, setExpanded] = useState(!allGreen);

  const handleReGrantConsent = async () => {
    try {
      const result = await initiateExoConsent.mutateAsync(tenant.id);
      openConsentPopup(result.consent_url);
      toast.info("Approve permissions in the popup, then click Refresh.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start consent flow");
    }
  };

  if (allGreen) {
    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
        <span className="text-emerald-400 font-medium">All prerequisites met. Ready to send.</span>
      </div>
    );
  }

  const headerColor = errorCount > 0 ? "text-red-400" : "text-amber-400";
  const headerBg = errorCount > 0 ? "border-red-500/20 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5";
  const headerIcon = errorCount > 0 ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />;
  const headerLabel = errorCount > 0
    ? `${errorCount} prerequisite${errorCount !== 1 ? "s" : ""} need${errorCount === 1 ? "s" : ""} your attention`
    : `Setting up tenant — ${pendingCount} step${pendingCount !== 1 ? "s" : ""} auto-fixing`;

  return (
    <div className={`rounded-md border ${headerBg} text-xs`}>
      <button
        type="button"
        className={`w-full px-3 py-2 flex items-center justify-between gap-2 ${headerColor} font-medium`}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        <div className="flex items-center gap-2">
          {headerIcon}
          <span>{headerLabel}</span>
          <span className="text-muted-foreground font-normal">
            ({okCount}/{totalCount} ready)
          </span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          {allChecks.map(({ key, check }) => (
            <CheckRow
              key={key}
              checkKey={key}
              label={CHECK_LABELS[key]}
              check={check}
              onReGrantConsent={key === "consent" || key === "directory_roles" || key === "security_defaults" || key === "mail_send" ? handleReGrantConsent : undefined}
              consentPending={initiateExoConsent.isPending}
            />
          ))}

          <div className="flex items-center gap-2 pt-2 border-t border-white/5 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                refreshTenant.mutate(tenant.id);
              }}
              disabled={refreshTenant.isPending}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshTenant.isPending ? "animate-spin" : ""}`} />
              Refresh status
            </Button>
            {(errorCount > 0 || pendingCount > 0) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReGrantConsent();
                }}
                disabled={initiateExoConsent.isPending}
              >
                <KeyRound className="w-3 h-3 mr-1" />
                Re-grant Microsoft permissions
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CheckRowProps {
  checkKey: PrerequisiteKey;
  label: string;
  check: PrerequisiteCheck | null;
  onReGrantConsent?: () => void;
  consentPending?: boolean;
}

function CheckRow({ checkKey, label, check, onReGrantConsent, consentPending }: CheckRowProps) {
  let icon: React.ReactNode;
  let textColor: string;

  if (!check) {
    icon = <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40" />;
    textColor = "text-muted-foreground";
  } else if (check.ok) {
    icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
    textColor = "text-emerald-400";
  } else if (check.status === "pending") {
    icon = <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin flex-shrink-0" />;
    textColor = "text-amber-400";
  } else {
    icon = <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    textColor = "text-red-400";
  }

  const isSecurityDefaultsError = checkKey === "security_defaults" && check && !check.ok;

  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className={`${textColor} font-medium`}>{label}</div>
        {isSecurityDefaultsError && (
          <div className="text-muted-foreground mt-1 space-y-1.5">
            <p>
              Auto-disable needs the <code className="text-foreground">Policy.ReadWrite.ConditionalAccess</code> permission.
              If you recently added it to the app, click <strong className="text-foreground">Re-grant Microsoft permissions</strong> below.
              Otherwise disable Security Defaults manually:
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                <a href="https://entra.microsoft.com" target="_blank" rel="noopener noreferrer" className="text-red-300 underline inline-flex items-center gap-0.5">
                  Open Entra ID <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </li>
              <li><strong className="text-foreground">Entra ID</strong> (left sidebar) &rarr; <strong className="text-foreground">Overview</strong> &rarr; <strong className="text-foreground">Properties</strong></li>
              <li>Scroll to bottom &rarr; <strong className="text-foreground">Manage security defaults</strong></li>
              <li>Set to <strong className="text-foreground">Disabled</strong> &rarr; Save</li>
            </ol>
            <p>Then click <strong className="text-foreground">Refresh status</strong> below.</p>
          </div>
        )}
        {!isSecurityDefaultsError && check?.message && (
          <div className="text-muted-foreground mt-0.5 leading-relaxed">{check.message}</div>
        )}
        {!check && (
          <div className="text-muted-foreground mt-0.5">Not yet checked. Click Refresh status.</div>
        )}
      </div>
    </div>
  );
}
