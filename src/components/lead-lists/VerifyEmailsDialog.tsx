import { useEffect, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  MailCheck,
  ShieldCheck,
  Sparkles,
  Loader2,
  AlertCircle,
  Settings,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useBulkEmailFindingPreview } from "@/hooks/useBulkEmailFinding";
import {
  useMailtesterNinjaStatus,
  type VerifyProvider,
} from "@/hooks/useEmailSequences";

interface VerifyEmailsDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen provider when the user confirms. Dialog closes immediately afterwards. */
  onConfirm: (provider: VerifyProvider) => void;
}

const APIFY_PRICE_PER_EMAIL_USD = 0.001;

export function VerifyEmailsDialog({
  contactIds,
  open,
  onOpenChange,
  onConfirm,
}: VerifyEmailsDialogProps) {
  const [provider, setProvider] = useState<VerifyProvider>("lite");

  const { data: preview, isLoading: previewLoading } = useBulkEmailFindingPreview(
    open ? contactIds : [],
  );
  const { data: mailtester } = useMailtesterNinjaStatus();

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setProvider("lite"), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const totalContacts = preview?.summary.total ?? contactIds.length;
  const withEmail = preview?.summary.withEmail ?? totalContacts;
  const fullCostUsd = withEmail * APIFY_PRICE_PER_EMAIL_USD;
  const formattedCost = fullCostUsd < 1
    ? `$${fullCostUsd.toFixed(3)}`
    : `$${fullCostUsd.toFixed(2)}`;

  const mailtesterRemaining =
    mailtester && mailtester.dailyCap !== null
      ? Math.max(0, mailtester.dailyCap - mailtester.usedToday)
      : null;
  const mailtesterCapReached =
    mailtester && mailtester.dailyCap !== null && mailtester.usedToday >= mailtester.dailyCap;
  const planLabel = mailtester?.plan
    ? mailtester.plan.charAt(0).toUpperCase() + mailtester.plan.slice(1)
    : null;

  const handleConfirm = () => {
    onConfirm(provider);
    onOpenChange(false);
  };

  const confirmDisabled =
    previewLoading ||
    withEmail === 0 ||
    (provider === "mailtester_ninja" && (!mailtester?.isConnected || mailtesterCapReached));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
              <MailCheck className="h-4 w-4 text-emerald-600" />
            </div>
            Verify Emails
          </DialogTitle>
          <DialogDescription>
            Check selected addresses for deliverability before enrollment.
            Results are cached for 30 days, so re-running is free for cached
            addresses.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-5">
          {/* Step 1: preview */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                1
              </div>
              <label className="text-sm font-medium">Selection</label>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Counting eligible contacts…</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-foreground">
                      {withEmail.toLocaleString()}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {withEmail === 1 ? "contact will be verified" : "contacts will be verified"}
                    </span>
                  </div>
                  {totalContacts > withEmail && (
                    <p className="text-xs text-muted-foreground">
                      {(totalContacts - withEmail).toLocaleString()} of{" "}
                      {totalContacts.toLocaleString()} selected have no email
                      and will be skipped.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Step 2: provider */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                2
              </div>
              <label className="text-sm font-medium">Verification mode</label>
            </div>
            <RadioGroup
              value={provider}
              onValueChange={(v) => setProvider(v as VerifyProvider)}
              className="space-y-2"
            >
              <label
                htmlFor="provider-lite"
                className={`flex items-start gap-3 border rounded-lg p-4 cursor-pointer transition-colors ${
                  provider === "lite"
                    ? "border-emerald-500 bg-emerald-50/50"
                    : "border-border hover:bg-muted/30"
                }`}
              >
                <RadioGroupItem value="lite" id="provider-lite" className="mt-1" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <Label
                      htmlFor="provider-lite"
                      className="font-medium cursor-pointer"
                    >
                      Lite
                    </Label>
                    <Badge variant="secondary" className="text-xs">
                      Free
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Heuristic checks only — disposable domains, role addresses
                    (info@/sales@/…), and bad MX records. Catches obvious
                    bounces, no SMTP probe.
                  </p>
                </div>
              </label>

              <label
                htmlFor="provider-full"
                className={`flex items-start gap-3 border rounded-lg p-4 cursor-pointer transition-colors ${
                  provider === "apify_million_verifier"
                    ? "border-amber-500 bg-amber-50/50"
                    : "border-border hover:bg-muted/30"
                }`}
              >
                <RadioGroupItem
                  value="apify_million_verifier"
                  id="provider-full"
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-600" />
                    <Label
                      htmlFor="provider-full"
                      className="font-medium cursor-pointer"
                    >
                      Full
                    </Label>
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-300 text-amber-700"
                    >
                      ~{formattedCost} USD
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Million Verifier via Apify — full SMTP probe with
                    catch-all, deliverability scoring, and typo suggestions.
                    $0.001/email; cached addresses are free on re-runs.
                  </p>
                  {provider === "apify_million_verifier" && (
                    <div className="text-xs text-amber-700 bg-amber-100/70 rounded px-2 py-1.5 mt-2 flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>
                        Requires an Apify token in{" "}
                        <Link
                          to="/settings?tab=integrations"
                          className="underline font-medium inline-flex items-center gap-0.5"
                        >
                          <Settings className="h-3 w-3" />
                          Settings → Integrations
                        </Link>
                        . Runs in batches of 200; progress shows in the bottom
                        bar.
                      </span>
                    </div>
                  )}
                </div>
              </label>

              {/* Mailtester Ninja — third provider option (BYOK) */}
              {mailtester?.isConnected ? (
                <label
                  htmlFor="provider-mailtester"
                  className={`flex items-start gap-3 border rounded-lg p-4 cursor-pointer transition-colors ${
                    provider === "mailtester_ninja"
                      ? "border-violet-500 bg-violet-50/50"
                      : "border-border hover:bg-muted/30"
                  } ${mailtesterCapReached ? "opacity-60" : ""}`}
                >
                  <RadioGroupItem
                    value="mailtester_ninja"
                    id="provider-mailtester"
                    className="mt-1"
                    disabled={mailtesterCapReached}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Zap className="h-4 w-4 text-violet-600" />
                      <Label
                        htmlFor="provider-mailtester"
                        className="font-medium cursor-pointer"
                      >
                        Mailtester Ninja
                      </Label>
                      {planLabel && (
                        <Badge
                          variant="outline"
                          className="text-xs border-violet-300 text-violet-700"
                        >
                          {planLabel} plan
                        </Badge>
                      )}
                      {mailtester.dailyCap !== null && (
                        <Badge
                          variant={mailtesterCapReached ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {mailtester.usedToday.toLocaleString()} / {mailtester.dailyCap.toLocaleString()} today
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your own key, paced inside your plan's rate cap. Runs as
                      a background job — safe to close the tab; progress shows
                      in the bottom bar. Cached addresses are free on re-runs.
                      {mailtesterRemaining !== null && !mailtesterCapReached && (
                        <> {mailtesterRemaining.toLocaleString()} verifications left today.</>
                      )}
                    </p>
                    {provider === "mailtester_ninja" && mailtesterCapReached && (
                      <div className="text-xs text-red-700 bg-red-100/70 rounded px-2 py-1.5 mt-2 flex items-start gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          Daily limit reached — resets at 00:00 UTC. Pick another mode or wait.
                        </span>
                      </div>
                    )}
                  </div>
                </label>
              ) : (
                <Link
                  to="/settings?tab=integrations"
                  className="flex items-start gap-3 border border-dashed rounded-lg p-4 text-muted-foreground hover:border-violet-400 hover:text-foreground transition-colors"
                >
                  <Zap className="h-4 w-4 mt-1 text-violet-500" />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Connect Mailtester Ninja</span>
                      <Badge variant="outline" className="text-xs">From $6.99/wk</Badge>
                    </div>
                    <p className="text-sm">
                      Affordable verification with your own API key — add it in
                      Settings → Integrations to enable this option.
                    </p>
                  </div>
                </Link>
              )}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleConfirm}
            disabled={confirmDisabled}
          >
            <MailCheck className="h-4 w-4 mr-2" />
            Verify {withEmail.toLocaleString()}
            {provider === "apify_million_verifier"
              ? " (Full)"
              : provider === "mailtester_ninja"
              ? " (Mailtester)"
              : " (Lite)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
