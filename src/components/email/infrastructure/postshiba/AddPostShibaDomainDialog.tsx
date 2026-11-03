import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Check, CheckCircle2, ChevronDown, Cloud, FileText, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAddPostShibaDomain,
  usePostShibaDomainCandidates,
  getPostShibaProvisionError,
  type PostShibaCandidateExclusion,
  type PostShibaDomain,
  type PostShibaProvisionErrorCode,
} from "@/hooks/usePostShibaDomains";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cloudflareConnected: boolean;
  /** Cloudflare zone names, or null while they load. */
  zoneNames: string[] | null;
  onAdded: (domain: PostShibaDomain) => void;
}

const ERROR_TITLES: Partial<Record<PostShibaProvisionErrorCode, string>> = {
  invalid_domain: "That doesn't look like a domain",
  domain_in_use: "Domain already in use",
  domain_has_mx: "This domain already receives email",
  not_connected: "Not connected",
  connection_inactive: "Connection inactive",
  rate_limited: "Too many requests",
  rejected: "PostShiba refused the domain",
  feature_disabled: "PostShiba is not enabled",
};

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://www.Acme-Mail.com/" -> "acme-mail.com" */
function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

const EXCLUSION_LABELS: Record<PostShibaCandidateExclusion, { one: string; many: string }> = {
  in_aca: { one: "already set up in ACA", many: "already set up in ACA" },
  receives_mail: { one: "already receives email", many: "already receive email" },
  has_mailboxes: { one: "has mailboxes in ACA", many: "have mailboxes in ACA" },
  zone_not_active: { one: "not active in Cloudflare yet", many: "not active in Cloudflare yet" },
};

/** "10 already set up in ACA, 2 already receive email" */
function exclusionSummary(excluded: Array<{ reason: PostShibaCandidateExclusion }>): string {
  const counts = new Map<PostShibaCandidateExclusion, number>();
  for (const e of excluded) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${n === 1 ? EXCLUSION_LABELS[reason].one : EXCLUSION_LABELS[reason].many}`)
    .join(", ");
}

const REQUIREMENTS = [
  "Used only for cold email, never for your team's own mailboxes",
  "No Google Workspace or Microsoft 365 mailboxes on it",
  "The root domain, like acme-mail.com, not a subdomain",
];

export function AddPostShibaDomainDialog({ open, onOpenChange, cloudflareConnected, zoneNames, onAdded }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<{ message: string; code?: PostShibaProvisionErrorCode } | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const add = useAddPostShibaDomain();
  const candidates = usePostShibaDomainCandidates(open && cloudflareConnected);

  const domain = normalizeDomain(value);
  const valid = DOMAIN_RE.test(domain);
  const changed = valid && domain !== value.trim();
  const inCloudflare = useMemo(() => {
    if (!valid || !cloudflareConnected || zoneNames === null) return null;
    return zoneNames.some((z) => domain === z || domain.endsWith(`.${z}`));
  }, [valid, cloudflareConnected, zoneNames, domain]);

  const handleOpenChange = (next: boolean) => {
    if (add.isPending) return;
    if (!next) {
      setValue("");
      setError(null);
      setShowExcluded(false);
      add.reset();
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!valid || add.isPending) return;
    setError(null);
    try {
      const created = await add.mutateAsync(domain);
      toast.success(`${created.domain} added`, {
        description: inCloudflare !== false && cloudflareConnected
          ? "Publishing its DNS records to Cloudflare."
          : "Add its DNS records to finish setting it up.",
      });
      handleOpenChange(false);
      onAdded(created);
    } catch (err) {
      setError(getPostShibaProvisionError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Add a sending domain
          </DialogTitle>
          <DialogDescription>
            ACA creates it in PostShiba with a catch-all inbox, so every reply comes back to ACA.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {cloudflareConnected && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5 text-amber-500" />
                From your Cloudflare account
              </Label>
              {candidates.isLoading ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-8 w-36 rounded-full" />
                    <Skeleton className="h-8 w-28 rounded-full" />
                    <Skeleton className="h-8 w-32 rounded-full" />
                  </div>
                  <p className="text-xs text-muted-foreground">Checking which of your domains can be used...</p>
                </div>
              ) : candidates.error ? (
                <p className="text-xs text-muted-foreground">
                  Couldn't check your Cloudflare domains. Type one below instead.
                </p>
              ) : (
                <div className="space-y-2">
                  {candidates.data && candidates.data.candidates.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {candidates.data.candidates.map((d) => {
                        const selected = domain === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={add.isPending}
                            onClick={() => {
                              setValue(d);
                              setError(null);
                              submitRef.current?.focus();
                            }}
                            aria-pressed={selected}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                              selected
                                ? "border-foreground bg-foreground text-background"
                                : "bg-background hover:border-foreground/40 hover:bg-muted/50",
                            )}
                          >
                            {selected ? <Check className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      None of your Cloudflare domains can be used right now. Add a new domain to
                      Cloudflare and it shows up here.
                    </p>
                  )}
                  {candidates.data && candidates.data.excluded.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => setShowExcluded((v) => !v)}
                        className="flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
                        aria-expanded={showExcluded}
                      >
                        {candidates.data.excluded.length} other{candidates.data.excluded.length === 1 ? "" : "s"} can't be used:{" "}
                        {exclusionSummary(candidates.data.excluded)}
                        <ChevronDown className={cn("h-3 w-3 transition-transform", showExcluded && "rotate-180")} />
                      </button>
                      {showExcluded && (
                        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-2">
                          {candidates.data.excluded.map((e) => (
                            <li key={e.domain} className="flex justify-between gap-3">
                              <span className="truncate font-mono">{e.domain}</span>
                              <span className="flex-shrink-0">{EXCLUSION_LABELS[e.reason].one}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="postshiba-domain">
              {cloudflareConnected ? "Or type a domain" : "Domain"}
            </Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="postshiba-domain"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="acme-mail.com"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={add.isPending}
                className={cn("pl-9", error && "border-destructive")}
              />
            </div>
            <div className="min-h-[20px] space-y-1 text-xs">
              {changed && (
                <div className="text-muted-foreground">
                  ACA will add <span className="font-mono text-foreground">{domain}</span>
                </div>
              )}
              {valid && inCloudflare === true && (
                <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                  <Cloud className="h-3.5 w-3.5" />
                  In your Cloudflare account. ACA publishes the DNS records for you.
                </div>
              )}
              {valid && inCloudflare === false && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Not in your Cloudflare account, so you'll add 3 DNS records yourself.
                </div>
              )}
              {valid && !cloudflareConnected && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  You'll add 3 DNS records at your DNS provider.
                </div>
              )}
            </div>
          </div>

          <ul className="space-y-2 rounded-lg bg-muted/40 p-3">
            {REQUIREMENTS.map((r) => (
              <li key={r} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-green-500" />
                {r}
              </li>
            ))}
          </ul>

          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <div className="text-sm">
                {error.code && ERROR_TITLES[error.code] && (
                  <div className="font-semibold text-destructive">{ERROR_TITLES[error.code]}</div>
                )}
                <div className="text-foreground/80">{error.message}</div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={add.isPending}>
              Cancel
            </Button>
            <Button ref={submitRef} type="submit" variant="cta" disabled={!valid || add.isPending}>
              {add.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : valid ? (
                `Add ${domain}`
              ) : (
                "Add domain"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
