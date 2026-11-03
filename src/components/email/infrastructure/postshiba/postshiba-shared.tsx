import { useState, type ReactNode } from "react";
import { Check, CheckCircle2, Circle, Clock, Copy, Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PostShibaDnsRecord, PostShibaDomain } from "@/hooks/usePostShibaDomains";

// ============================================================================
// Domain stage: one answer to "where is this domain in setup?" that drives the
// status pill, the next-step callout and the primary button, so they never
// disagree.
// ============================================================================

export type DomainStage = "records" | "verifying" | "inbox" | "mx" | "ready";

export function getDomainStage(d: PostShibaDomain): DomainStage {
  if (d.sending_allowed && d.mx_verified) return "ready";
  if (d.inbox_created) return "mx";
  if (d.sending_allowed) return "inbox";
  // Records ACA pushed, or ones PostShiba already sees, are waiting on its check.
  const anyRecordSeen = d.dkim_verified || d.return_path_verified || d.dmarc_verified;
  return d.dns_managed || anyRecordSeen ? "verifying" : "records";
}

export type Tone = "green" | "amber" | "blue" | "neutral" | "red";

export const TONE_CLASSES: Record<Tone, string> = {
  green: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  neutral: "border-border bg-muted/50 text-muted-foreground",
  red: "border-destructive/30 bg-destructive/10 text-destructive",
};

export const STAGE_META: Record<DomainStage, { label: string; tone: Tone; icon: LucideIcon }> = {
  records: { label: "DNS needed", tone: "amber", icon: Clock },
  verifying: { label: "Verifying", tone: "blue", icon: Loader2 },
  inbox: { label: "Setting up replies", tone: "blue", icon: Loader2 },
  mx: { label: "MX needed", tone: "amber", icon: Clock },
  ready: { label: "Ready", tone: "green", icon: CheckCircle2 },
};

/** The four setup steps shown on every domain, in order. */
export function domainSteps(d: PostShibaDomain): Array<{ label: string; done: boolean }> {
  return [
    { label: "DNS records", done: d.dkim_verified && d.return_path_verified },
    { label: "PostShiba approval", done: d.sending_allowed },
    { label: "Reply inbox", done: d.inbox_created },
    { label: "Reply MX", done: d.mx_verified },
  ];
}

// ============================================================================
// DNS records
// ============================================================================

export type RecordKind = "dkim" | "return_path" | "dmarc" | "mx";

export function recordKind(r: PostShibaDnsRecord): RecordKind {
  if (r.type === "MX") return "mx";
  if (r.type === "TXT") return "dmarc";
  return r.name.toLowerCase().includes("._domainkey.") ? "dkim" : "return_path";
}

export const RECORD_PURPOSE: Record<RecordKind, string> = {
  dkim: "DKIM signature",
  return_path: "Return path",
  dmarc: "DMARC policy",
  mx: "Reply routing",
};

export function recordVerified(d: PostShibaDomain, r: PostShibaDnsRecord): boolean {
  switch (recordKind(r)) {
    case "dkim":
      return d.dkim_verified;
    case "return_path":
      return d.return_path_verified;
    case "dmarc":
      return d.dmarc_verified;
    case "mx":
      return d.mx_verified;
  }
}

/** BIND zone-file lines, which most DNS providers can import as-is. */
export function recordsAsZoneFile(records: PostShibaDnsRecord[]): string {
  return records
    .map((r) => {
      const name = r.name.endsWith(".") ? r.name : `${r.name}.`;
      if (r.type === "TXT") return `${name}\t${r.ttl}\tIN\tTXT\t"${r.value}"`;
      const value = r.value.endsWith(".") ? r.value : `${r.value}.`;
      if (r.type === "MX") return `${name}\t${r.ttl}\tIN\tMX\t${r.priority ?? 10} ${value}`;
      return `${name}\t${r.ttl}\tIN\t${r.type}\t${value}`;
    })
    .join("\n");
}

// ============================================================================
// Small pieces
// ============================================================================

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = (value: string, key: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    });
  };
  return { copiedKey, copy };
}

export function StatusPill({
  tone,
  icon: Icon,
  spin,
  children,
  className,
}: {
  tone: Tone;
  icon?: LucideIcon;
  spin?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 whitespace-nowrap font-medium text-xs", TONE_CLASSES[tone], className)}
    >
      {Icon && <Icon className={cn("h-3 w-3", spin && "animate-spin")} />}
      {children}
    </Badge>
  );
}

export function StagePill({ stage }: { stage: DomainStage }) {
  const meta = STAGE_META[stage];
  const spinning = stage === "verifying" || stage === "inbox";
  return (
    <StatusPill tone={meta.tone} icon={meta.icon} spin={spinning}>
      {meta.label}
    </StatusPill>
  );
}

/** A value in a mono chip with a copy button. Long DNS names wrap instead of overflowing. */
export function CopyValue({ value, label, className }: { value: string; label: string; className?: string }) {
  const { copiedKey, copy } = useCopy();
  const copied = copiedKey === "v";
  return (
    <div className={cn("group flex min-w-0 items-start gap-1", className)}>
      <code className="min-w-0 flex-1 break-all rounded-md border border-border/60 bg-background/70 px-2 py-1 font-mono text-xs leading-relaxed text-foreground">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => copy(value, "v")}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** Numbered steps joined by a line. A vertical list below desktop width, where the settings column is narrow. */
export function StepTrack({ steps, className }: { steps: Array<{ label: string; done: boolean }>; className?: string }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className={cn("flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-0", className)}>
      {steps.map((s, i) => {
        const isCurrent = i === current;
        return (
          <li key={s.label} className="flex items-center xl:flex-1 xl:last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                  s.done && "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500",
                  isCurrent && "border-foreground/70 text-foreground",
                  !s.done && !isCurrent && "border-border text-muted-foreground",
                )}
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs",
                  s.done ? "text-foreground" : isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn("mx-3 hidden h-px flex-1 xl:block", s.done ? "bg-green-600/50" : "bg-border")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function RecordStatusIcon({ verified }: { verified: boolean }) {
  return verified ? (
    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-500" aria-label="Verified" />
  ) : (
    <Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" aria-label="Not verified yet" />
  );
}

export function SectionLabel({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {children}
      </div>
      {action}
    </div>
  );
}
