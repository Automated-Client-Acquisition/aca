import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Cloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Plus,
  RefreshCcw,
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";
import {
  usePushDnsToCloudflare,
  useCheckCloudflareNameservers,
  type DnsPushPlan,
  type DnsPushResponse,
} from "@/hooks/useDnsProviders";
import { EdgeFunctionError } from "@/lib/supabase-functions";
import type { EmailSendingDomain } from "@/types/email";

type Step = "loading" | "preview" | "ns-pending" | "pushing" | "success" | "error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Only the id and name are used, so any sending-domain shape (e.g. a
  // PostShiba domain) can reuse this preview + confirm push flow.
  domain: Pick<EmailSendingDomain, "id" | "domain">;
  onMigrated?: () => void;
  /** Dialog heading. Defaults to "Migrate <domain> to managed DNS". */
  title?: string;
}

export function MigrateDomainToCloudflareDialog({ open, onOpenChange, domain, onMigrated, title }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [diff, setDiff] = useState<DnsPushPlan | null>(null);
  const [assignedNs, setAssignedNs] = useState<string[] | null>(null);
  const [activeNs, setActiveNs] = useState<string[] | null>(null);
  const [errorState, setErrorState] = useState<{ title?: string; message: string; next_steps?: string[]; help_url?: string } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [copiedNs, setCopiedNs] = useState<string | null>(null);

  const push = usePushDnsToCloudflare();
  const checkNs = useCheckCloudflareNameservers();

  const reset = () => {
    setStep("loading");
    setDiff(null);
    setAssignedNs(null);
    setActiveNs(null);
    setErrorState(null);
    setSummary(null);
    setCopiedNs(null);
    push.reset();
    checkNs.reset();
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // Initial load: ask the push endpoint for a dry-run diff. This also resolves
  // and persists the zone_id on the domain, which is what powers NS instructions.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const result = await push.mutateAsync({ domain_id: domain.id, dry_run: true });
      if (cancelled) return;
      handlePushResponse(result);
    })().catch((err) => {
      if (!cancelled) handleNetworkError(err);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, domain.id]);

  function handlePushResponse(result: DnsPushResponse) {
    if (result.error) {
      setErrorState({
        title: result.error_title,
        message: result.error,
        next_steps: result.next_steps,
        help_url: result.help_url,
      });
      setStep("error");
      return;
    }
    if (result.nameservers_assigned) setAssignedNs(result.nameservers_assigned);

    if (result.diff) setDiff(result.diff);

    if (result.success && !result.requires_confirmation && !result.dry_run) {
      // Executed successfully
      setSummary(result.summary ?? "Records published");
      setStep("success");
      onMigrated?.();
      return;
    }

    // dry-run or requires_confirmation → show preview
    setStep("preview");
  }

  function handleNetworkError(err: unknown) {
    // Structured failures (Cloudflare not connected, domain not a Cloudflare
    // zone) come back non-2xx, so they arrive here as EdgeFunctionError with
    // the title / next steps in `details`.
    if (err instanceof EdgeFunctionError) {
      const d = err.details;
      const message = typeof d.error === "string" && d.error ? d.error : err.message;
      setErrorState({
        title: typeof d.error_title === "string" ? d.error_title : undefined,
        message,
        next_steps: Array.isArray(d.next_steps) ? (d.next_steps as string[]) : undefined,
        help_url: typeof d.help_url === "string" ? d.help_url : undefined,
      });
      setStep("error");
      return;
    }
    setErrorState({
      message: err instanceof Error ? err.message : "Unexpected error",
    });
    setStep("error");
  }

  const handlePublish = async () => {
    setStep("pushing");
    try {
      const result = await push.mutateAsync({ domain_id: domain.id, confirm_destructive: true });
      handlePushResponse(result);
    } catch (err) {
      handleNetworkError(err);
    }
  };

  const handleCheckNs = async () => {
    const result = await checkNs.mutateAsync(domain.id);
    if (result.nameservers_assigned) setAssignedNs(result.nameservers_assigned);
    if (result.nameservers_active) setActiveNs(result.nameservers_active);
    if (result.status === "active") {
      setStep("preview"); // NS now live — re-show diff so user can hit Publish
    }
  };

  const handleCopy = (ns: string) => {
    navigator.clipboard.writeText(ns).then(() => {
      setCopiedNs(ns);
      setTimeout(() => setCopiedNs(null), 1500);
    });
  };

  const totalChanges = diff ? diff.adds.length + diff.updates.length + diff.conflicts.length : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-amber-500" />
            {title ?? `Migrate ${domain.domain} to managed DNS`}
          </DialogTitle>
          <DialogDescription>
            {step === "loading" && "Checking your Cloudflare account..."}
            {step === "preview" && "Review the DNS changes ACA will make in Cloudflare."}
            {step === "ns-pending" && "Update nameservers at your registrar first."}
            {step === "pushing" && "Writing records to Cloudflare..."}
            {step === "success" && "Done — DNS for this domain is now managed by ACA."}
            {step === "error" && "Something went wrong."}
          </DialogDescription>
        </DialogHeader>

        {step === "loading" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {step === "preview" && diff && (
          <div className="space-y-4">
            {totalChanges === 0 ? (
              <Alert className="border-green-500/40 bg-green-500/5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <AlertDescription>
                  All records are already in place. Migrating will just mark this domain as
                  managed by ACA so future auto-updates work.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="text-sm space-y-3">
                {diff.conflicts.length > 0 && (
                  <DiffSection
                    title="Records to delete (conflicts)"
                    color="red"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                    items={diff.conflicts.map((c) => ({
                      label: `${c.type} ${c.name}`,
                      value: c.value,
                      meta: c.reason,
                    }))}
                  />
                )}
                {diff.updates.length > 0 && (
                  <DiffSection
                    title="Records to update"
                    color="amber"
                    icon={<RefreshCcw className="w-3.5 h-3.5" />}
                    items={diff.updates.map((u) => ({
                      label: `${u.target.type} ${u.target.name}`,
                      value: `${u.current.content} → ${u.target.value}`,
                      meta: u.reason,
                    }))}
                  />
                )}
                {diff.adds.length > 0 && (
                  <DiffSection
                    title="Records to add"
                    color="green"
                    icon={<Plus className="w-3.5 h-3.5" />}
                    items={diff.adds.map((a) => ({
                      label: `${a.type} ${a.name}`,
                      value: a.value,
                    }))}
                  />
                )}
                {diff.keeps.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {diff.keeps.length} record{diff.keeps.length === 1 ? "" : "s"} already in
                    place and won't change.
                  </p>
                )}
              </div>
            )}

            {diff.conflicts.length > 0 && (
              <Alert variant="default" className="border-amber-500/40 bg-amber-500/5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <AlertDescription className="text-xs">
                  These conflict records will be <strong>permanently deleted</strong> from this
                  domain in Cloudflare. ACA only flags records that match the patterns we manage
                  (SPF / DMARC / MX / DKIM / autodiscover). Your website's A records and other
                  CNAMEs are not touched.
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button variant="cta" onClick={handlePublish} disabled={push.isPending}>
                {totalChanges === 0
                  ? "Mark as managed"
                  : `Publish ${diff.adds.length + diff.updates.length} record${diff.adds.length + diff.updates.length === 1 ? "" : "s"}${
                      diff.conflicts.length > 0 ? ` & delete ${diff.conflicts.length} conflict${diff.conflicts.length === 1 ? "" : "s"}` : ""
                    }`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "ns-pending" && assignedNs && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-sm">
                Your domain's nameservers aren't pointing to Cloudflare yet. Update these at your
                registrar (Porkbun, TopDNS, Namecheap, etc.), then come back here.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Set nameservers to:
              </div>
              {assignedNs.map((ns) => (
                <div key={ns} className="flex items-center gap-1.5">
                  <code className="text-xs font-mono bg-muted/50 rounded px-2 py-1.5 flex-1">{ns}</code>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleCopy(ns)}>
                    {copiedNs === ns ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
              ))}
            </div>

            {activeNs && activeNs.length > 0 && (
              <div className="text-xs text-muted-foreground border-t pt-3">
                Live nameservers right now: <code>{activeNs.join(", ")}</code>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                I'll come back later
              </Button>
              <Button variant="cta" onClick={handleCheckNs} disabled={checkNs.isPending}>
                {checkNs.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  "Check nameservers"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "pushing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            <p className="text-sm text-muted-foreground">Writing records to Cloudflare...</p>
          </div>
        )}

        {step === "success" && (
          <div className="space-y-4">
            <Alert className="border-green-500/40 bg-green-500/5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <AlertDescription>
                <div className="font-semibold text-green-700 dark:text-green-300 mb-1">
                  {domain.domain} is now managed by ACA
                </div>
                <div className="text-sm text-muted-foreground">{summary}</div>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="cta" onClick={() => handleClose(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "error" && errorState && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                {errorState.title && <div className="font-semibold text-base mb-1">{errorState.title}</div>}
                <div className="text-sm text-muted-foreground leading-relaxed">{errorState.message}</div>
                {errorState.next_steps && errorState.next_steps.length > 0 && (
                  <ol className="mt-3 text-xs list-decimal list-inside space-y-1 leading-relaxed">
                    {errorState.next_steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                )}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
              {errorState.help_url && (
                <Button
                  variant="cta"
                  onClick={() => window.open(errorState.help_url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Cloudflare → Add Site
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Diff section subcomponent
// ----------------------------------------------------------------------------

interface DiffSectionProps {
  title: string;
  color: "green" | "amber" | "red";
  icon: React.ReactNode;
  items: Array<{ label: string; value: string; meta?: string }>;
}

function DiffSection({ title, color, icon, items }: DiffSectionProps) {
  const colorClasses = {
    green: "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    red: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400",
  }[color];

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${colorClasses}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        {icon}
        {title}
        <Badge variant="outline" className="text-xs">{items.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="text-xs space-y-0.5">
            <div className="font-mono font-medium">{it.label}</div>
            <div className="font-mono text-muted-foreground break-all">{it.value}</div>
            {it.meta && <div className="italic opacity-70">{it.meta}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
