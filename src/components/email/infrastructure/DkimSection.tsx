import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Copy,
  Loader2,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  CircleHelp,
} from "lucide-react";
import type { EmailSendingDomain, DnsRecord } from "@/types/email";
import { useRepairM365Dkim } from "@/hooks/useEmailSendingDomains";

interface DkimSectionProps {
  domain: EmailSendingDomain;
}

type DnsCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "match" }
  | { status: "mismatch"; actual: string }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * DKIM configuration section.
 *
 * Microsoft 365 DKIM setup: publish two CNAMEs pointing to Microsoft's signing infra.
 * The target Microsoft uses (as of May 2025) looks like:
 *   selector1-<domain-with-dashes>._domainkey.<tenant>.<partition>-v1.dkim.mail.microsoft
 *
 * Older tenants may still be on `.onmicrosoft.com` — we always trust whatever Exchange
 * Online reports via Get-DkimSigningConfig, because Microsoft is actively migrating.
 *
 * Values shown here are pulled byte-for-byte from the stored dns_records (which were
 * populated by the edge function from EXO's Selector1CNAME / Selector2CNAME). Copy
 * buttons invoke navigator.clipboard.writeText directly on the stored value — no
 * re-encoding, no interpolation, so what users paste is exactly what Microsoft expects.
 *
 * A live DNS check runs on mount (using Google Public DNS over HTTPS) to show whether
 * what's currently at the user's registrar matches the expected target — prevents the
 * "pasted wrong value, realized 24h later" failure mode.
 */
export function DkimSection({ domain }: DkimSectionProps) {
  const repairDkim = useRepairM365Dkim();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const dkimRecords = useMemo(
    () =>
      (domain.dns_records || []).filter(
        (r) => r.type === "CNAME" && r.name.toLowerCase().includes("._domainkey."),
      ),
    [domain.dns_records],
  );

  if (domain.infra_type !== "m365" || dkimRecords.length === 0) return null;

  const allVerified = dkimRecords.every((r) => r.verified) && domain.dkim_verified;

  const copyToClipboard = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      // Silent — clipboard API may fail in non-secure contexts
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          <h3 className="text-sm font-semibold">DKIM (Email Signing)</h3>
          {allVerified ? (
            <Badge
              variant="outline"
              className="text-xs border-green-500/30 text-green-400 bg-green-500/10 flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              Signing active
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="text-xs flex items-center gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30"
            >
              <AlertTriangle className="w-3 h-3" />
              Action required
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => repairDkim.mutate(domain.id)}
          disabled={repairDkim.isPending}
          title="Ask Microsoft to re-check DNS and refresh the targets shown below"
        >
          {repairDkim.isPending ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          )}
          Re-check with Microsoft
        </Button>
      </div>

      {/* Status banner */}
      {!allVerified && (
        <div className="px-4 py-3 bg-amber-500/10 text-xs space-y-1 border-b">
          <p className="font-medium text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            DKIM is not yet signing your outbound mail
          </p>
          <p className="text-muted-foreground">
            Publish both CNAME records below at your DNS provider (same place you manage
            SPF / DMARC). After they propagate, click <strong>Re-check with Microsoft</strong>.
          </p>
          <p className="text-muted-foreground text-[11px] mt-1">
            Without DKIM, Gmail / Outlook / Yahoo will quarantine or bin your mail even when
            SPF passes.
          </p>
        </div>
      )}

      {/* Records */}
      <div className="p-4 space-y-4">
        {dkimRecords.map((record) => (
          <DkimRecordCard
            key={record.name}
            record={record}
            rootDomain={domain.domain}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
          />
        ))}
      </div>

      {/* Footer help */}
      <div className="px-4 pb-4 text-[11px] text-muted-foreground space-y-1.5">
        <p className="flex items-start gap-1.5">
          <CircleHelp className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Most providers (Cloudflare, Internet.bs, Namecheap, GoDaddy, Porkbun) want the{" "}
            <strong>short host</strong> — they append <span className="font-mono">.{domain.domain}</span>{" "}
            automatically. AWS Route 53 and a few others want the <strong>full FQDN</strong>.
            Copy whichever your provider expects.
          </span>
        </p>
        <a
          href="https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          Microsoft DKIM setup docs
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

interface DkimRecordCardProps {
  record: DnsRecord;
  rootDomain: string;
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
}

function DkimRecordCard({ record, rootDomain, copiedKey, onCopy }: DkimRecordCardProps) {
  const shortHost = stripSuffix(trimDot(record.name), rootDomain);
  const fullHost = trimDot(record.name);
  const valueClean = trimDot(record.value);
  const selectorLabel = selectorLabelFromHost(shortHost);

  const [dnsCheck, setDnsCheck] = useState<DnsCheckState>({ status: "idle" });
  const [checkVersion, setCheckVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDnsCheck({ status: "checking" });

    checkCnameViaGoogleDns(fullHost)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setDnsCheck({ status: "missing" });
        } else if (result.toLowerCase() === valueClean.toLowerCase()) {
          setDnsCheck({ status: "match" });
        } else {
          setDnsCheck({ status: "mismatch", actual: result });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDnsCheck({
          status: "error",
          message: err instanceof Error ? err.message : "DNS check failed",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fullHost, valueClean, checkVersion]);

  return (
    <div className="rounded-md border p-3 space-y-3">
      {/* Selector header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
            {record.type}
          </Badge>
          <span className="text-xs font-semibold">{selectorLabel}</span>
        </div>
        <DnsCheckBadge state={dnsCheck} onRetry={() => setCheckVersion((v) => v + 1)} />
      </div>

      {/* Host (short) */}
      <Field
        label="Host (most providers)"
        value={shortHost}
        copyKey={`${record.name}:short`}
        copiedKey={copiedKey}
        onCopy={onCopy}
        hint={`Enter this if your DNS provider auto-appends ${rootDomain}`}
      />

      {/* Host (FQDN) — only shown when different from short */}
      {fullHost !== shortHost && (
        <Field
          label="Host (full FQDN)"
          value={fullHost}
          copyKey={`${record.name}:full`}
          copiedKey={copiedKey}
          onCopy={onCopy}
          hint="Use this if your DNS provider requires the fully-qualified name"
          muted
        />
      )}

      {/* Value (CNAME target) */}
      <Field
        label="Value (points to)"
        value={valueClean}
        copyKey={`${record.name}:value`}
        copiedKey={copiedKey}
        onCopy={onCopy}
        emphasize
      />

      {/* Mismatch diagnostic — show exactly what's at DNS vs what's expected */}
      {dnsCheck.status === "mismatch" && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] space-y-1">
          <div className="font-medium text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Wrong target in your DNS
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium">Currently published:</span>
          </div>
          <div className="font-mono text-[10px] bg-muted/60 rounded px-1.5 py-1 break-all">
            {dnsCheck.actual}
          </div>
          <div className="text-muted-foreground">
            Replace it at your DNS provider with the <strong>Value</strong> above.
          </div>
        </div>
      )}

      {/* TTL */}
      <div className="text-[10px] text-muted-foreground">
        TTL: {record.ttl}s (or &ldquo;Automatic&rdquo; / default)
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
  hint?: string;
  emphasize?: boolean;
  muted?: boolean;
}

function Field({ label, value, copyKey, copiedKey, onCopy, hint, emphasize, muted }: FieldProps) {
  const copied = copiedKey === copyKey;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </label>
        {hint && <span className="text-[10px] text-muted-foreground text-right">{hint}</span>}
      </div>
      <div className="flex items-stretch gap-2">
        {/* Click-to-select the whole value so even without the button, it's easy to copy */}
        <div
          onClick={(e) => {
            const el = e.currentTarget;
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }}
          className={[
            "flex-1 text-xs font-mono rounded px-2 py-2 break-all cursor-text select-all",
            emphasize ? "bg-muted border border-foreground/10 font-medium" : "bg-muted/50",
            muted ? "opacity-75" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title="Click to select all"
        >
          {value}
        </div>
        <Button
          variant={emphasize ? "outline" : "ghost"}
          size="sm"
          className="h-auto px-2.5 shrink-0"
          onClick={() => onCopy(value, copyKey)}
          title={`Copy ${label}`}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-500 mr-1" />
              <span className="text-[11px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 mr-1" />
              <span className="text-[11px]">Copy</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function DnsCheckBadge({ state, onRetry }: { state: DnsCheckState; onRetry: () => void }) {
  if (state.status === "checking") {
    return (
      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking DNS…
      </span>
    );
  }
  if (state.status === "match") {
    return (
      <span className="text-[10px] text-green-400 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        DNS matches
      </span>
    );
  }
  if (state.status === "mismatch") {
    return (
      <span className="text-[10px] text-destructive flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        DNS mismatch
      </span>
    );
  }
  if (state.status === "missing") {
    return (
      <span className="text-[10px] text-amber-400 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Not published yet
      </span>
    );
  }
  return (
    <button
      onClick={onRetry}
      className="text-[10px] text-muted-foreground hover:underline flex items-center gap-1"
    >
      <RefreshCw className="w-3 h-3" />
      Re-check DNS
    </button>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Strip a single trailing dot from an FQDN. Defensive — EXO/DB values should never
 * contain one, but DNS responses often do, and a trailing dot in the pasted value
 * silently breaks the CNAME at the registrar.
 */
function trimDot(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}

function stripSuffix(fqdn: string, rootDomain: string): string {
  const lower = fqdn.toLowerCase();
  const rootLower = rootDomain.toLowerCase();
  if (lower === rootLower) return "@";
  const suffix = `.${rootLower}`;
  if (lower.endsWith(suffix)) return fqdn.slice(0, fqdn.length - suffix.length);
  return fqdn;
}

/**
 * Derive a user-friendly selector label from a DKIM host. Robust to future
 * selectors (selector3, selector4, etc.) rather than only matching "selector1".
 */
function selectorLabelFromHost(shortHost: string): string {
  const match = shortHost.match(/^selector(\d+)\._domainkey$/i);
  if (match) return `Selector ${match[1]}`;
  return shortHost; // fall through to raw name rather than mislabelling
}

/**
 * Client-side DNS check via Google Public DNS over HTTPS. Returns the CNAME target
 * (without trailing dot) if a CNAME is present, or null if nothing resolves / it's
 * not a CNAME. Avoids introducing a new edge function just for this UI hint.
 */
async function checkCnameViaGoogleDns(host: string): Promise<string | null> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=CNAME`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`DNS lookup failed (${resp.status})`);
  const data = (await resp.json()) as { Status: number; Answer?: { type: number; data: string }[] };
  // RCODE 0 = success. Other codes (NXDOMAIN=3, etc.) -> nothing published.
  if (data.Status !== 0) return null;
  const cname = data.Answer?.find((a) => a.type === 5); // 5 = CNAME
  if (!cname) return null;
  return trimDot(cname.data);
}
