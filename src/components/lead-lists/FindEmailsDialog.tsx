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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  ArrowRight,
  Settings,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  useBulkEmailFindingPreview,
  useBulkEnrichContacts,
} from "@/hooks/useBulkEmailFinding";
import {
  useEnrichmentProviders,
  useEnrichmentSettings,
} from "@/hooks/useEnrichmentSettings";

interface FindEmailsDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

type ProviderMode = "waterfall" | "specific";

// Active enrichment providers
const ACTIVE_PROVIDERS = ["apollo", "prospeo", "moltsets", "quickenrich"] as const;

const PROVIDER_INFO: Record<string, { name: string; description: string }> = {
  apollo: {
    name: "Apollo.io",
    description: "High accuracy email + phone from LinkedIn",
  },
  prospeo: {
    name: "Prospeo",
    description: "Email discovery from LinkedIn URLs",
  },
  moltsets: {
    name: "MoltSets",
    description: "LinkedIn identity resolution, ~33% coverage on cold profiles",
  },
  quickenrich: {
    name: "QuickEnrich",
    description: "Email, phone & domain from LinkedIn URL, company, or name",
  },
};

export function FindEmailsDialog({
  contactIds,
  open,
  onOpenChange,
  onComplete,
}: FindEmailsDialogProps) {
  const [providerMode, setProviderMode] = useState<ProviderMode>("waterfall");
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>();
  const [includeWithEmail, setIncludeWithEmail] = useState(false);

  // Hooks
  const { data: preview, isLoading: previewLoading } = useBulkEmailFindingPreview(
    open ? contactIds : []
  );
  const { data: providers, isLoading: providersLoading } = useEnrichmentProviders();
  const { data: settings } = useEnrichmentSettings();
  const { run: runEnrichment } = useBulkEnrichContacts();

  // Get connected providers
  const connectedProviders = providers?.filter((p) => p.isConnected) || [];
  const hasConnectedProviders = connectedProviders.length > 0;

  // Get provider priority order from settings
  const providerPriority = settings?.providerPriority || ACTIVE_PROVIDERS;

  // Filter to only connected providers in priority order
  const waterfallOrder = providerPriority.filter((p) =>
    connectedProviders.some((cp) => cp.provider === p)
  );

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      const timeout = setTimeout(() => {
        setProviderMode("waterfall");
        setSelectedProvider(undefined);
        setIncludeWithEmail(false);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  const handleFindEmails = () => {
    if (!preview) return;

    // Fire-and-forget — enrichment runs in background with global progress bar
    runEnrichment({
      contactIds,
      preferredProvider: providerMode === "specific" ? selectedProvider : undefined,
      skipIfHasEmail: !includeWithEmail,
    });

    // Close dialog immediately
    onOpenChange(false);
    onComplete?.();
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  // Calculate how many will be processed
  const toProcessCount = includeWithEmail
    ? preview?.summary.total || 0
    : preview?.summary.withoutEmail || 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
              <Search className="h-4 w-4 text-blue-600" />
            </div>
            Find Emails
          </DialogTitle>
          <DialogDescription>
            Use enrichment providers to find email addresses for your selected
            contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-5">
          {previewLoading || providersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasConnectedProviders ? (
            // No providers connected
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2 text-amber-700">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">No enrichment providers connected</p>
                  <p className="text-sm mt-1">
                    Connect an enrichment provider like Apollo.io or Prospeo to
                    find email addresses.
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link to="/settings?tab=integrations">
                  <Settings className="h-4 w-4 mr-2" />
                  Configure Providers
                </Link>
              </Button>
            </div>
          ) : preview ? (
            <>
              {/* Step 1: Contacts Preview */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    1
                  </div>
                  <label className="text-sm font-medium">Contacts to enrich</label>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold text-foreground">
                        {toProcessCount}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        contacts will be searched
                      </span>
                    </div>
                    <Badge variant="outline" className="gap-1">
                      <Mail className="h-3 w-3" />
                      {preview.summary.withEmail} have email
                    </Badge>
                  </div>

                  {/* Breakdown */}
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>
                        {preview.summary.withoutEmail} need email enrichment
                      </span>
                    </div>
                    {preview.summary.withEmail > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        <span>
                          {preview.summary.withEmail} already have email
                          {!includeWithEmail && " (will be skipped)"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Include with email toggle */}
                  {preview.summary.withEmail > 0 && (
                    <div className="flex items-center space-x-2 pt-2 border-t">
                      <Checkbox
                        id="include-with-email"
                        checked={includeWithEmail}
                        onCheckedChange={(checked) =>
                          setIncludeWithEmail(checked === true)
                        }
                      />
                      <label
                        htmlFor="include-with-email"
                        className="text-sm leading-none cursor-pointer"
                      >
                        Include {preview.summary.withEmail} contacts that already
                        have email
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Provider Selection */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                    2
                  </div>
                  <label className="text-sm font-medium">Enrichment provider</label>
                </div>
                <div className="border rounded-lg p-4 space-y-4">
                  <RadioGroup
                    value={providerMode}
                    onValueChange={(v) => setProviderMode(v as ProviderMode)}
                    className="space-y-3"
                  >
                    {/* Waterfall option */}
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="waterfall" id="waterfall" className="mt-1" />
                      <div className="flex-1 space-y-1">
                        <Label
                          htmlFor="waterfall"
                          className="font-medium cursor-pointer"
                        >
                          Use waterfall (Recommended)
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Tries providers in order until email is found
                        </p>
                        {providerMode === "waterfall" && waterfallOrder.length > 0 && (
                          <div className="flex items-center gap-1 pt-1 flex-wrap">
                            {waterfallOrder.map((provider, idx) => (
                              <div key={provider} className="flex items-center">
                                <Badge variant="secondary" className="text-xs">
                                  {PROVIDER_INFO[provider]?.name || provider}
                                </Badge>
                                {idx < waterfallOrder.length - 1 && (
                                  <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground" />
                                )}
                              </div>
                            ))}
                            <Link
                              to="/settings?tab=enrichment"
                              className="text-xs text-muted-foreground hover:text-foreground ml-2 inline-flex items-center gap-1"
                            >
                              <Settings className="h-3 w-3" />
                              Change order
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Specific provider option */}
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="specific" id="specific" className="mt-1" />
                      <div className="flex-1 space-y-2">
                        <Label
                          htmlFor="specific"
                          className="font-medium cursor-pointer"
                        >
                          Use specific provider
                        </Label>
                        {providerMode === "specific" && (
                          <Select
                            value={selectedProvider}
                            onValueChange={setSelectedProvider}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select provider" />
                            </SelectTrigger>
                            <SelectContent>
                              {connectedProviders.map((provider) => (
                                <SelectItem
                                  key={provider.provider}
                                  value={provider.provider}
                                >
                                  <div className="flex flex-col">
                                    <span>
                                      {PROVIDER_INFO[provider.provider]?.name ||
                                        provider.provider}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  </RadioGroup>

                  {/* Connected providers badges */}
                  <div className="pt-3 border-t">
                    <div className="text-xs text-muted-foreground mb-2">
                      Connected providers:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ACTIVE_PROVIDERS.map((provider) => {
                        const isConnected = connectedProviders.some(
                          (p) => p.provider === provider
                        );
                        return (
                          <Badge
                            key={provider}
                            variant={isConnected ? "default" : "outline"}
                            className={
                              isConnected
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : "text-muted-foreground"
                            }
                          >
                            {isConnected ? (
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                            ) : (
                              <XCircle className="h-3 w-3 mr-1" />
                            )}
                            {PROVIDER_INFO[provider]?.name || provider}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleFindEmails}
            disabled={
              previewLoading ||
              providersLoading ||
              !preview ||
              !hasConnectedProviders ||
              toProcessCount === 0 ||
              (providerMode === "specific" && !selectedProvider)
            }
          >
            <Mail className="h-4 w-4 mr-2" />
            Find {toProcessCount} Email{toProcessCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
