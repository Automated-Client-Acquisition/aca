import { useState } from "react";
import { Link } from "react-router-dom";
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
import { Input } from "@/components/ui/input";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Loader2, Brain, Search, Package, Linkedin, Globe, CheckCircle2, AlertTriangle, ExternalLink, Plus, Target, ChevronsUpDown } from "lucide-react";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { LlmModelSelect } from "@/components/shared/LlmModelSelect";
import { DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { useProducts } from "@/hooks/useProducts";
import { useICPs } from "@/hooks/useICPs";

const MAX_SELECTED_ICPS = 5;
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface RegenerateAnalysisDialogProps {
  contact: {
    id: string;
    display_name: string;
    company_website?: string | null;
    primary_linkedin_url?: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AnalysisState = 'idle' | 'analyzing' | 'complete';

export function RegenerateAnalysisDialog({
  contact,
  open,
  onOpenChange,
}: RegenerateAnalysisDialogProps) {
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_LLM_MODEL);
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>();
  const [selectedIcpIds, setSelectedIcpIds] = useState<string[]>([]);
  const [selectedUnipileAccount, setSelectedUnipileAccount] = useState<string | undefined>();
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');

  const queryClient = useQueryClient();
  const { hasOpenRouterKey } = useOpenRouterModels();
  const { hasOllamaKey } = useOllamaModels();
  const { products, isLoading: isLoadingProducts } = useProducts();
  const { icps, isLoading: isLoadingIcps } = useICPs();
  const { data: unipileData } = useUnipileAccounts();

  const linkedinAccounts = unipileData?.linkedinAccounts || [];
  const hasLinkedInAccount = linkedinAccounts.length > 0;
  const hasWebsite = !!contact.company_website;
  const hasLinkedIn = !!contact.primary_linkedin_url;
  const hasProducts = products && products.length > 0;
  const selectedProductQuestionCount = selectedProductId
    ? (products?.find(p => p.id === selectedProductId)?.analysis_questions?.filter(q => q?.trim()).length ?? 0)
    : 0;

  const handleRegenerate = async () => {
    setAnalysisState('analyzing');

    // Build product context if a product is selected
    const selectedProduct = selectedProductId ? products.find(p => p.id === selectedProductId) : null;
    const productContext = selectedProduct ? {
      name: selectedProduct.name,
      description: selectedProduct.description || undefined,
      benefits: selectedProduct.key_benefits || selectedProduct.features || undefined,
    } : undefined;

    try {
      const { data, error } = await supabase.functions.invoke('analyze-company', {
        body: {
          contactId: contact.id,
          companyWebsite: contact.company_website,
          linkedinUrl: contact.primary_linkedin_url,
          unipileAccountId: selectedUnipileAccount,
          model: selectedModel,
          productContext,
          productId: selectedProductId,
          icpIds: selectedIcpIds.length ? selectedIcpIds : undefined,
        },
      });

      if (error) {
        toast.error(`Analysis failed: ${error.message}`);
        setAnalysisState('idle');
        return;
      }

      if (!data.success) {
        toast.error(data.error || 'Analysis failed');
        setAnalysisState('idle');
        return;
      }

      // Success
      setAnalysisState('complete');

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });

      toast.success('Company analysis regenerated successfully');

      // Close dialog after brief delay to show success state
      setTimeout(() => {
        onOpenChange(false);
        // Reset state for next time
        setAnalysisState('idle');
        setSelectedModel(DEFAULT_LLM_MODEL);
        setSelectedProductId(undefined);
        setSelectedIcpIds([]);
        setSelectedUnipileAccount(undefined);
        setModelSearchQuery('');
      }, 1000);

    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
      setAnalysisState('idle');
    }
  };

  const handleClose = () => {
    if (analysisState === 'analyzing') return;
    onOpenChange(false);
  };

  // Success state
  if (analysisState === 'complete') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[400px]">
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-lg">Analysis Complete</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Company analysis has been updated.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Analyzing state
  if (analysisState === 'analyzing') {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[400px]" onPointerDownOutside={(e) => e.preventDefault()}>
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-lg">Analyzing Company</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Scraping website and generating insights...
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Default: Setup view
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            Regenerate Analysis
          </DialogTitle>
          <DialogDescription>
            Re-analyze {contact.display_name}'s company with different settings.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Contact Data Sources */}
          <div className="flex flex-wrap gap-2">
            {hasWebsite && (
              <Badge variant="outline" className="gap-1.5">
                <Globe className="h-3 w-3" />
                Website available
              </Badge>
            )}
            {hasLinkedIn && (
              <Badge variant="outline" className="gap-1.5">
                <Linkedin className="h-3 w-3" />
                LinkedIn available
              </Badge>
            )}
            {!hasWebsite && !hasLinkedIn && (
              <Badge variant="destructive" className="gap-1.5">
                No data sources available
              </Badge>
            )}
          </div>

          {/* LLM Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI Model
            </label>
            <LlmModelSelect value={selectedModel} onValueChange={setSelectedModel} />
          </div>

          {/* Product Context Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" />
              Product Context (Optional)
            </label>
            {isLoadingProducts ? (
              <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading products...</span>
              </div>
            ) : !hasProducts ? (
              <div className="border border-dashed rounded-lg p-3 space-y-2">
                <p className="text-sm text-muted-foreground">
                  No products yet. Add a product to get tailored pain points and outreach hooks.
                </p>
                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link to="/assets?tab=products">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add Product in Library
                  </Link>
                </Button>
              </div>
            ) : (
              <>
                <Select
                  value={selectedProductId || "_none"}
                  onValueChange={(v) => setSelectedProductId(v === "_none" ? undefined : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a product for relevant analysis" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">
                      <span className="text-muted-foreground">No product - generic analysis</span>
                    </SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedProductId
                    ? "Pain points will be tailored to this product."
                    : "Select a product to get relevant pain points and outreach hooks."}
                </p>
                {selectedProductQuestionCount > 0 && (
                  <p className="text-xs text-primary flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {selectedProductQuestionCount} custom question{selectedProductQuestionCount === 1 ? '' : 's'} will be answered.
                  </p>
                )}
              </>
            )}
          </div>

          {/* ICP Context Selection — decoupled from product */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              ICP Context
              <span className="text-xs font-normal text-muted-foreground">(recommended)</span>
            </label>
            {isLoadingIcps ? (
              <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading ICPs...</span>
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
                      className="w-full justify-between font-normal"
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
                  Score against these ICPs (max {MAX_SELECTED_ICPS}). If none selected, the product's linked
                  ICPs are used. With neither, the score is general B2B fit — not an ICP match.
                </p>
              </>
            )}
          </div>

          {/* LinkedIn Account Selection */}
          {hasLinkedIn && (
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Linkedin className="h-4 w-4" />
                LinkedIn Account
                <span className="text-xs font-normal text-muted-foreground">(recommended)</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Selecting a LinkedIn account dramatically improves accuracy — it provides verified employee count, company size, industry, funding data, and recent posts.
              </p>
              {hasLinkedInAccount ? (
                <Select
                  value={selectedUnipileAccount || "_none"}
                  onValueChange={(v) => setSelectedUnipileAccount(v === "_none" ? undefined : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select LinkedIn account" />
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
                <div className="text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-lg p-3">
                  No LinkedIn account connected. <a href="/settings?tab=accounts" className="text-primary underline font-medium">Connect one</a> for much better analysis — without it, company size and ICP scoring rely on website guesses only.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Credit usage notice */}
        <div className="px-1 pb-2">
          <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-3 text-xs text-status-warning space-y-1">
            <p className="font-medium">This will use your API credits:</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li><span className="font-medium">OpenRouter</span> — AI analysis (uses your selected model)</li>
              <li><span className="font-medium">Apify</span> — fallback scraping if the website is blocked (only if configured)</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleRegenerate}
            disabled={(!hasWebsite && !hasLinkedIn) || !(hasOpenRouterKey || hasOllamaKey)}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
