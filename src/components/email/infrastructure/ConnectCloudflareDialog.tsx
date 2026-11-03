import { useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Cloud,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { useConnectCloudflare, useCloudflareZones, type UnmigratedMatch } from "@/hooks/useDnsProviders";

type Step = "intro" | "token-creation" | "paste" | "success";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Cloudflare's token-creation UI doesn't accept deep-link query params for
// pre-filled permissions, so we drop the user on the API tokens page and walk
// them through the "Edit zone DNS" template manually.
const CLOUDFLARE_TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

export function ConnectCloudflareDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [token, setToken] = useState("");
  const [structuredError, setStructuredError] = useState<{
    title?: string;
    message: string;
    next_steps?: string[];
  } | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ accountName: string; zoneCount: number } | null>(null);

  const connect = useConnectCloudflare();

  const reset = () => {
    setStep("intro");
    setToken("");
    setStructuredError(null);
    setSuccessInfo(null);
    connect.reset();
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleConnect = async () => {
    setStructuredError(null);
    const result = await connect.mutateAsync({ api_token: token });
    if (result.success && result.provider) {
      setSuccessInfo({
        accountName: result.provider.account_name,
        zoneCount: result.provider.zone_count ?? 0,
      });
      setStep("success");
    } else if (result.error) {
      setStructuredError({
        title: result.error_title,
        message: result.error,
        next_steps: result.next_steps,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-amber-500" />
            Connect Cloudflare
          </DialogTitle>
          <DialogDescription>
            {step === "intro" && "Let ACA write DNS records for you so you never copy-paste again."}
            {step === "token-creation" && "Create an API token in Cloudflare."}
            {step === "paste" && "Paste the token you just copied."}
            {step === "success" && "All set."}
          </DialogDescription>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
              <div>
                <div className="font-medium mb-1">What ACA will do</div>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Read the list of domains in your Cloudflare account</li>
                  <li>Write or update DNS records on domains you add as sending domains</li>
                  <li>Detect duplicate SPF / DMARC / MX records and offer to clean them up</li>
                  <li>Never touch other domains, A records, CNAMEs, or your website's DNS</li>
                </ul>
              </div>
              <div className="text-xs text-muted-foreground border-t pt-3">
                Cloudflare doesn't support OAuth for self-serve accounts, so we use a scoped API
                token instead. You can revoke it at any time from Cloudflare's dashboard.
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button variant="cta" onClick={() => setStep("token-creation")}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "token-creation" && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border p-4 space-y-3 text-sm">
              <div className="font-medium">In Cloudflare:</div>
              <ol className="text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
                <li>Click <strong>Create Token</strong> on the API Tokens page</li>
                <li>Find the <strong>"Edit zone DNS"</strong> template and click <strong>Use template</strong> (Cloudflare's labels — "zone" means a domain in your account)</li>
                <li>
                  Set <strong>Zone Resources</strong> to <em>"All zones"</em>
                  <span className="block text-xs ml-5 text-muted-foreground/80">
                    (or pick specific domains if you'd rather scope it)
                  </span>
                </li>
                <li>Click <strong>Continue to summary</strong> → <strong>Create Token</strong></li>
                <li>
                  Copy the token <strong>immediately</strong>
                  <span className="block text-xs ml-5 text-amber-700 dark:text-amber-400">
                    Cloudflare only shows it once — copy before closing the page
                  </span>
                </li>
              </ol>
              <Button
                variant="cta"
                className="w-full"
                onClick={() => window.open(CLOUDFLARE_TOKEN_URL, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open Cloudflare → Create Token
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("intro")}>
                Back
              </Button>
              <Button variant="cta" onClick={() => setStep("paste")}>
                I have my token
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "paste" && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cf-token">Cloudflare API Token</Label>
              <Input
                id="cf-token"
                type="password"
                placeholder="e.g. AaBbCc1234... (40+ characters)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && token.length >= 20 && !connect.isPending) handleConnect();
                }}
                disabled={connect.isPending}
                autoFocus
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted. ACA only uses it to read your Cloudflare domains and write
                DNS records for sending domains you set up in ACA.
              </p>
            </div>

            {structuredError && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  {structuredError.title && (
                    <div className="font-semibold mb-1">{structuredError.title}</div>
                  )}
                  <div className="text-sm">{structuredError.message}</div>
                  {structuredError.next_steps && structuredError.next_steps.length > 0 && (
                    <ol className="mt-2 text-xs list-decimal list-inside space-y-0.5">
                      {structuredError.next_steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("token-creation")} disabled={connect.isPending}>
                Back
              </Button>
              <Button
                variant="cta"
                onClick={handleConnect}
                disabled={token.length < 20 || connect.isPending}
              >
                {connect.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Validating...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "success" && successInfo && (
          <SuccessStep
            accountName={successInfo.accountName}
            zoneCount={successInfo.zoneCount}
            onClose={() => handleClose(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Success step: cross-references the user's CF zones against their existing
// ACA sending domains. If there are matches, it surfaces a concrete CTA
// ("we can migrate these N domains now"). Otherwise it explains what happens
// next time they provision a new domain.
// ----------------------------------------------------------------------------

interface SuccessStepProps {
  accountName: string;
  zoneCount: number;
  onClose: () => void;
}

function SuccessStep({ accountName, zoneCount, onClose }: SuccessStepProps) {
  // Pull zones + unmigrated matches in one server call.
  const { data, isLoading } = useCloudflareZones({ includeUnmigratedMatches: true });
  const matches: UnmigratedMatch[] = data?.unmigrated_matches ?? [];

  return (
    <div className="space-y-4 py-2">
      <Alert className="border-green-500/40 bg-green-500/5">
        <CheckCircle2 className="w-4 h-4 text-green-500" />
        <AlertDescription className="ml-1">
          <div className="font-semibold text-green-700 dark:text-green-300 mb-0.5">
            Cloudflare connected
          </div>
          <div className="text-sm text-muted-foreground">
            {accountName} — {zoneCount} {zoneCount === 1 ? "domain" : "domains"} available
          </div>
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        <div className="text-sm font-semibold">What's next</div>

        {/* Matches branch — concrete CTA */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking your existing domains...
          </div>
        ) : matches.length > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
            <div className="text-sm">
              <strong>{matches.length} of your existing ACA {matches.length === 1 ? "domain" : "domains"}</strong>{" "}
              {matches.length === 1 ? "is" : "are"} ready to migrate to managed DNS:
            </div>
            <ul className="text-xs space-y-1">
              {matches.slice(0, 6).map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <ArrowRight className="w-3 h-3 text-amber-500" />
                  <code className="font-mono">{m.domain}</code>
                </li>
              ))}
              {matches.length > 6 && (
                <li className="text-muted-foreground italic">…and {matches.length - 6} more</li>
              )}
            </ul>
            <div className="text-xs text-muted-foreground border-t border-amber-500/20 pt-2 leading-relaxed">
              Close this dialog and click the <Cloud className="w-3 h-3 inline-block mx-0.5 text-amber-500" />
              icon on any domain card to migrate. We'll show you the exact DNS changes (including
              any duplicate SPF/DMARC/MX records we'll clean up) before applying anything.
            </div>
          </div>
        ) : (
          <NoMatchesGuide />
        )}
      </div>

      <DialogFooter>
        <Button variant="cta" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

// ----------------------------------------------------------------------------
// NoMatchesGuide — shown when the user has just connected Cloudflare but
// none of their ACA sending domains match a domain in their Cloudflare account.
// Lists the Cloudflare domains we can see (so the user knows what's there)
// and offers two clear actions: add an existing domain or buy a new one.
// ----------------------------------------------------------------------------

function NoMatchesGuide() {
  const { data } = useCloudflareZones({ enabled: true });
  const domains = data?.zones ?? [];

  return (
    <div className="space-y-3">
      {domains.length > 0 && (
        <div className="rounded-lg border p-3 text-xs space-y-2">
          <div className="font-semibold text-foreground text-sm">
            Domains in your Cloudflare account
          </div>
          <ul className="space-y-1">
            {domains.map((d) => (
              <li key={d.zone_id} className="flex items-center gap-2 font-mono">
                <Cloud className="w-3 h-3 text-amber-500 flex-shrink-0" />
                <code>{d.name}</code>
                <span className="text-muted-foreground text-[10px]">
                  {d.status === "active" ? "active" : d.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground border-t pt-2 leading-relaxed">
            None of these are set up as ACA sending domains yet. To use one for sending,
            add it as a sending domain in Settings → Domains &amp; servers — we'll auto-publish
            all DNS records.
          </p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <a
          href="https://dash.cloudflare.com/?to=/:account/add-site"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border p-3 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold">I already own the domain</div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            Add it to Cloudflare for free (Add a Site). Cloudflare will give you 2 nameservers
            to set at your current registrar — once they propagate, the domain is live and you can
            set it up here.
          </div>
        </a>

        <a
          href="https://dash.cloudflare.com/?to=/:account/domains/register"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border p-3 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold">I want to buy a new domain</div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            Buy directly from Cloudflare Registrar at wholesale (no markup — .com is ~$9.77/yr).
            New domains are auto-added to your Cloudflare account, so they're ready for ACA
            the moment they're registered.
          </div>
        </a>
      </div>

      <div className="text-xs text-muted-foreground leading-relaxed border-t pt-3">
        <strong className="text-foreground">After your domain is in Cloudflare:</strong> add it
        as a sending domain in ACA — we'll detect it automatically and publish all DNS records
        for you. Or click the <Cloud className="w-3 h-3 inline-block mx-0.5 text-amber-500" />
        icon on an existing ACA domain card to switch it to managed DNS.
      </div>
    </div>
  );
}
