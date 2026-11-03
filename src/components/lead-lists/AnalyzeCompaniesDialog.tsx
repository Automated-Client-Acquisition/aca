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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Sparkles, Globe, Linkedin, AlertCircle, Loader2, Brain, Search, Package, AlertTriangle, ExternalLink, Target, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { useAnalyzePreview } from "@/hooks/useAnalyzeCompanies";
import { useStartCompanyAnalysis, useWatchJobCompletion } from "@/hooks/useCompanyAnalysisJobs";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { LlmModelSelect } from "@/components/shared/LlmModelSelect";
import { DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { useProducts } from "@/hooks/useProducts";
import { useICPs } from "@/hooks/useICPs";

const MAX_SELECTED_ICPS = 5;
import { toast } from "sonner";

interface AnalyzeCompaniesDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function AnalyzeCompaniesDialog({
  contactIds,
  open,
  onOpenChange,
  onComplete,
}: AnalyzeCompaniesDialogProps) {
  const [selectedUnipileAccount, setSelectedUnipileAccount] = useState<string | undefined>();
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_LLM_MODEL);
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>();
  const [selectedIcpIds, setSelectedIcpIds] = useState<string[]>([]);
  const [includeAlreadyAnalyzed, setIncludeAlreadyAnalyzed] = useState(false);
  // Track the active job ID to watch for completion
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: preview, isLoading: previewLoading } = useAnalyzePreview(open ? contactIds : []);
  const { data: unipileData } = useUnipileAccounts();
  const { hasOpenRouterKey } = useOpenRouterModels();
  const { hasOllamaKey } = useOllamaModels();
  const { products, isLoading: isLoadingProducts } = useProducts();
  const { icps, isLoading: isLoadingIcps } = useICPs();
  const startAnalysisMutation = useStartCompanyAnalysis();

  // Watch for job completion and show toast
  useWatchJobCompletion(activeJobId);

  const linkedinAccounts = unipileData?.linkedinAccounts || [];
  const hasLinkedInAccount = linkedinAccounts.length > 0;
  const hasProducts = products && products.length > 0;

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      // Small delay to allow dialog close animation
      const timeout = setTimeout(() => {
        setSelectedUnipileAccount(undefined);
        setSelectedModel(DEFAULT_LLM_MODEL);
        setSelectedProductId(undefined);
        setSelectedIcpIds([]);
        setIncludeAlreadyAnalyzed(false);
        // Don't clear activeJobId - we want to keep watching it
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  const handleAnalyze = async () => {
    if (!preview) return;

    // Get contact IDs to analyze
    const contactIdsToAnalyze = preview.contacts
      .filter(c => c.canAnalyze && (includeAlreadyAnalyzed || !c.isAlreadyAnalyzed))
      .map(c => c.id);

    if (contactIdsToAnalyze.length === 0) {
      toast.warning('No contacts to analyze');
      return;
    }

    // Build product context if a product is selected
    const selectedProduct = selectedProductId ? products.find(p => p.id === selectedProductId) : null;

    const productContext = selectedProduct ? {
      name: selectedProduct.name,
      description: selectedProduct.description || undefined,
      benefits: selectedProduct.key_benefits || selectedProduct.features || undefined,
    } : undefined;

    try {
      const job = await startAnalysisMutation.mutateAsync({
        contactIds: contactIdsToAnalyze,
        model: selectedModel,
        unipileAccountId: selectedUnipileAccount,
        productContext,
        productId: selectedProductId,
        icpIds: selectedIcpIds.length ? selectedIcpIds : undefined,
        includeAlreadyAnalyzed,
      });

      // Set the job ID to watch for completion
      setActiveJobId(job.id);

      // Show success toast and close dialog
      toast.success(
        `Company analysis started for ${contactIdsToAnalyze.length} contacts`,
        { description: 'You can close this page - we\'ll notify you when it\'s done.' }
      );

      onOpenChange(false);
      onComplete?.();
    } catch (error) {
      toast.error(`Failed to start analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const analysisCount = preview
    ? (includeAlreadyAnalyzed ? preview.summary.canAnalyze : preview.summary.needsAnalysis)
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            Analyze Companies
          </DialogTitle>
          <DialogDescription>
            Scrape company websites and fetch LinkedIn posts to extract personalization data for outreach.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          <div className="py-4 space-y-5">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : preview ? (
              <>
                {/* STEP 1: Contacts Summary - Compact */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">1</div>
                    <label className="text-sm font-medium">Contacts to analyze</label>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 space-y-3">
                    {/* Summary row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-foreground">
                          {analysisCount}
                        </span>
                        <span className="text-sm text-muted-foreground">contacts will be analyzed</span>
                      </div>
                      <div className="flex gap-1.5">
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Globe className="h-3 w-3" />
                          {preview.summary.withWebsite}
                        </Badge>
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Linkedin className="h-3 w-3" />
                          {preview.summary.withLinkedIn}
                        </Badge>
                      </div>
                    </div>

                    {/* Re-analyze toggle */}
                    {preview.summary.alreadyAnalyzed > 0 && (
                      <div className="flex items-center space-x-2 pt-2 border-t">
                        <Checkbox
                          id="include-analyzed"
                          checked={includeAlreadyAnalyzed}
                          onCheckedChange={(checked) => setIncludeAlreadyAnalyzed(checked === true)}
                        />
                        <label
                          htmlFor="include-analyzed"
                          className="text-sm leading-none cursor-pointer flex-1"
                        >
                          Include {preview.summary.alreadyAnalyzed} already analyzed
                        </label>
                      </div>
                    )}

                    {/* Skip warning */}
                    {preview.summary.willSkip > 0 && (
                      <div className="flex items-center gap-2 text-xs text-yellow-700 pt-2 border-t">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{preview.summary.willSkip} will be skipped (no website or LinkedIn)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* STEP 2: Settings - Grouped together */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">2</div>
                    <label className="text-sm font-medium">Analysis settings</label>
                  </div>

                  <div className="border rounded-lg divide-y">
                    {/* AI Model */}
                    <div className="p-3 space-y-2">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Brain className="h-3.5 w-3.5" />
                        AI Model
                      </label>
                      <LlmModelSelect value={selectedModel} onValueChange={setSelectedModel} />
                    </div>

                    {/* Product Context (Optional) */}
                    <div className="p-3 space-y-2">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5" />
                        Product Context
                        <span className="text-muted-foreground/60">(optional)</span>
                      </label>
                      {isLoadingProducts ? (
                        <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : !hasProducts ? (
                        <p className="text-xs text-muted-foreground">No products in library</p>
                      ) : (
                        <Select
                          value={selectedProductId || "_none"}
                          onValueChange={(v) => setSelectedProductId(v === "_none" ? undefined : v)}
                        >
                          <SelectTrigger className="h-9 focus:ring-inset">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">
                              <span className="text-muted-foreground">None</span>
                            </SelectItem>
                            {products.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    {/* ICP Context (recommended) — decoupled from product */}
                    <div className="p-3 space-y-2">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Target className="h-3.5 w-3.5" />
                        ICP Context
                        <span className="text-muted-foreground/60">(recommended)</span>
                      </label>
                      {isLoadingIcps ? (
                        <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : !icps || icps.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No ICPs in library</p>
                      ) : (
                        <>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                className="w-full h-9 justify-between font-normal"
                              >
                                {selectedIcpIds.length
                                  ? icps
                                      .filter((icp) => selectedIcpIds.includes(icp.id))
                                      .map((icp) => icp.name)
                                      .join(", ")
                                  : "Select ICPs..."}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search ICPs..." />
                                <CommandList>
                                  <CommandEmpty>No ICPs found</CommandEmpty>
                                  <CommandGroup>
                                    {icps.map((icp) => {
                                      const checked = selectedIcpIds.includes(icp.id);
                                      const atCap = !checked && selectedIcpIds.length >= MAX_SELECTED_ICPS;
                                      return (
                                        <CommandItem
                                          key={icp.id}
                                          disabled={atCap}
                                          onSelect={() => {
                                            setSelectedIcpIds((prev) =>
                                              prev.includes(icp.id)
                                                ? prev.filter((id) => id !== icp.id)
                                                : prev.length >= MAX_SELECTED_ICPS
                                                  ? prev
                                                  : [...prev, icp.id]
                                            );
                                          }}
                                        >
                                          <Checkbox checked={checked} className="mr-2" />
                                          <div className="min-w-0">
                                            <div className="truncate">{icp.name}</div>
                                            {icp.summary && (
                                              <div className="text-xs text-muted-foreground truncate">{icp.summary}</div>
                                            )}
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <p className="text-xs text-muted-foreground">
                            Score companies against these ICPs (max {MAX_SELECTED_ICPS}). If none selected, the
                            product's linked ICPs are used. With neither, the score is general B2B fit — not an ICP match.
                          </p>
                        </>
                      )}
                    </div>

                    {/* LinkedIn Account */}
                    {preview.summary.withLinkedIn > 0 && (
                      <div className="p-3 space-y-2">
                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                          <Linkedin className="h-3.5 w-3.5" />
                          LinkedIn Account
                          <span className="text-muted-foreground/60">(recommended)</span>
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Selecting a LinkedIn account dramatically improves analysis accuracy — it provides verified employee count, company size, industry, funding data, and recent posts.
                        </p>
                        {hasLinkedInAccount ? (
                          <Select
                            value={selectedUnipileAccount || "_none"}
                            onValueChange={(v) => setSelectedUnipileAccount(v === "_none" ? undefined : v)}
                          >
                            <SelectTrigger className="h-9 focus:ring-inset">
                              <SelectValue placeholder="None (website only)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">
                                <span className="text-muted-foreground">None (website only)</span>
                              </SelectItem>
                              {linkedinAccounts.map((account) => (
                                <SelectItem key={account.id} value={account.unipile_account_id}>
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={account.avatar_url || undefined} referrerPolicy="no-referrer" />
                                      <AvatarFallback className="text-[9px] bg-primary/10">
                                        {(account.display_name || account.username)?.charAt(0) || '?'}
                                      </AvatarFallback>
                                    </Avatar>
                                    {account.display_name || account.username || 'LinkedIn Account'}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                            No LinkedIn connected. <Link to="/settings?tab=accounts" className="text-primary underline font-medium">Connect one</Link> for much better analysis — without it, company size and ICP scoring rely on website guesses only.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Credit usage & async info */}
                <div className="space-y-2">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
                    <p className="font-medium">This will use your API credits:</p>
                    <ul className="list-disc ml-4 space-y-0.5">
                      <li><span className="font-medium">OpenRouter</span> — AI analysis per contact (uses your selected model)</li>
                      <li><span className="font-medium">Apify</span> — fallback website scraping when direct access is blocked (only if you have an Apify key configured)</li>
                    </ul>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                    <p>
                      Analysis runs in the background. You can close this dialog and navigate away — we'll notify you when it's complete.
                    </p>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleAnalyze}
            disabled={
              previewLoading ||
              !preview ||
              !(hasOpenRouterKey || hasOllamaKey) ||
              analysisCount === 0 ||
              startAnalysisMutation.isPending
            }
          >
            {startAnalysisMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>Analyze {analysisCount} Companies</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
