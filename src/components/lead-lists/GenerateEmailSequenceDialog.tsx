import { useState, useEffect, useRef } from "react";
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
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  Brain,
  Search,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronRight,
  FileText,
  Package,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useSequenceGenerationPreview } from "@/hooks/useEmailSequences";
import type { EmailSequenceConfig } from "@/hooks/useEmailSequences";
import { useProducts } from "@/hooks/useProducts";
import { useStartEmailSequenceGeneration, useWatchEmailSequenceJobCompletion } from "@/hooks/useEmailSequenceJobs";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { LlmModelSelect } from "@/components/shared/LlmModelSelect";
import { DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { VARIABLE_CATEGORIES, PROMPT_PRESETS } from "@/lib/email-sequence-constants";

interface GenerateEmailSequenceDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (generatedCount: number) => void;
}

export function GenerateEmailSequenceDialog({
  contactIds,
  open,
  onOpenChange,
  onComplete,
}: GenerateEmailSequenceDialogProps) {
  // Form state
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].template);
  const [emailCount, setEmailCount] = useState(3);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_LLM_MODEL);
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>(undefined);

  // Variable insertion
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Contact');

  // Async job tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Hooks
  const { data: preview, isLoading: previewLoading } = useSequenceGenerationPreview(open ? contactIds : []);
  const { hasOpenRouterKey } = useOpenRouterModels();
  const { hasOllamaKey } = useOllamaModels();
  const { products } = useProducts();
  const startGenerationMutation = useStartEmailSequenceGeneration();

  // Does the prompt reference any product variables? Used to nudge the user to pick a product.
  const promptUsesProductVars = /\{\{\s*(product_name|product_description|product_features|product_benefits|ai_selected_outcome)\s*\}\}/i.test(prompt);

  // Watch for job completion and show toast
  useWatchEmailSequenceJobCompletion(activeJobId);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      const timeout = setTimeout(() => {
        setPrompt(PROMPT_PRESETS[0].template);
        setEmailCount(3);
        setSelectedModel(DEFAULT_LLM_MODEL);
        setSelectedProductId(undefined);
        setExpandedCategory('Contact');
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setPrompt(prev => prev + `{{${varName}}}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = prompt;
    const insertion = `{{${varName}}}`;
    const newText = text.substring(0, start) + insertion + text.substring(end);
    setPrompt(newText);

    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = start + insertion.length;
      textarea.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleGenerate = async () => {
    if (!preview) return;

    const generatableContactIds = preview.contacts
      .filter(c => c.canGenerate)
      .map(c => c.id);

    if (generatableContactIds.length === 0) {
      toast.warning('No contacts have enrichment data');
      return;
    }

    const config: EmailSequenceConfig = {
      prompt,
      ...(selectedProductId ? { productId: selectedProductId } : {}),
    };

    try {
      const job = await startGenerationMutation.mutateAsync({
        contactIds: generatableContactIds,
        emailCount,
        model: selectedModel,
        config,
      });

      setActiveJobId(job.id);

      toast.success(
        `Email sequence generation started for ${generatableContactIds.length} contacts`,
        { description: "You can close this page — we'll notify you when it's done." }
      );

      onOpenChange(false);
      onComplete?.(generatableContactIds.length);
    } catch (error) {
      toast.error(`Failed to start generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mail className="h-4 w-4 text-blue-600" />
            </div>
            Generate Email Sequences
          </DialogTitle>
          <DialogDescription>
            Write your prompt with variables that get resolved per-contact using enrichment data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 px-1 -mx-1 space-y-5">
          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview ? (
            <>
              {/* Section 1: Prompt */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">1</div>
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Your Prompt
                  </label>
                </div>

                <div className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-blue-50/50 dark:to-blue-950/30 rounded-lg p-4 space-y-3">
                  {/* Preset selector */}
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <Select
                      value="_custom"
                      onValueChange={(v) => {
                        if (v !== '_custom') {
                          const preset = PROMPT_PRESETS[parseInt(v)];
                          if (preset) setPrompt(preset.template);
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs w-[200px]" style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}>
                        <SelectValue placeholder="Load a preset..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_custom">
                          <span className="text-muted-foreground">Load a preset...</span>
                        </SelectItem>
                        {PROMPT_PRESETS.map((preset, index) => (
                          <SelectItem key={index} value={String(index)}>
                            <div className="flex flex-col">
                              <span>{preset.name}</span>
                              <span className="text-xs text-muted-foreground">{preset.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Variable insertion chips */}
                  <div className="space-y-1">
                    {VARIABLE_CATEGORIES.map((category) => (
                      <div key={category.label}>
                        <button
                          type="button"
                          onClick={() => setExpandedCategory(
                            expandedCategory === category.label ? null : category.label
                          )}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-0.5"
                        >
                          {expandedCategory === category.label ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          {category.label} variables
                        </button>
                        {expandedCategory === category.label && (
                          <div className="flex flex-wrap gap-1 mt-1 mb-2">
                            {category.variables.map((variable) => (
                              <button
                                key={variable.name}
                                type="button"
                                onClick={() => insertVariable(variable.name)}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-card border border-border text-card-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-colors cursor-pointer"
                                title={`Insert {{${variable.name}}}`}
                              >
                                {variable.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Main prompt textarea */}
                  <ExpandableTextarea
                    ref={textareaRef}
                    expandTitle="Edit Email Prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Tell the AI what kind of emails to write. Use variables like {{first_name}} and {{ai_primary_need}} for per-contact personalization..."
                    className="min-h-[160px] text-sm font-mono"
                    style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Variables like <code className="bg-muted px-1 py-0.5 rounded text-primary">{"{{ai_primary_need}}"}</code> are resolved per-contact using their enrichment data.
                  </p>

                  {/* Product Context — resolves {{product_*}} variables */}
                  <div className="border rounded-lg p-3 space-y-2 bg-card">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5" />
                      Product Context
                      <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                    </label>
                    <Select
                      value={selectedProductId || "_none"}
                      onValueChange={(v) => setSelectedProductId(v === '_none' ? undefined : v)}
                    >
                      <SelectTrigger className="h-9" style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}>
                        <SelectValue placeholder="Select a product..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">
                          <span className="text-muted-foreground">No product</span>
                        </SelectItem>
                        {(products || []).map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {promptUsesProductVars && !selectedProductId ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                        Your prompt uses <code className="bg-muted px-1 py-0.5 rounded">{"{{product_*}}"}</code> variables. Select a product so they resolve — otherwise they'll be left blank.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Selecting a product resolves <code className="bg-muted px-1 py-0.5 rounded text-primary">{"{{product_name}}"}</code>, <code className="bg-muted px-1 py-0.5 rounded text-primary">{"{{product_description}}"}</code>, and injects its benefits & ICP intelligence into the prompt.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 2: Settings */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold">2</div>
                  <label className="text-sm font-medium">Settings</label>
                </div>

                <div className="border rounded-lg divide-y">
                  {/* Number of Emails */}
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm font-medium">Number of Emails</Label>
                      <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{emailCount}</span>
                    </div>
                    <Slider
                      value={[emailCount]}
                      onValueChange={([value]) => setEmailCount(value)}
                      min={2}
                      max={7}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>2 emails</span>
                      <span>7 emails</span>
                    </div>
                  </div>

                  {/* AI Model */}
                  <div className="p-3 space-y-2">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Brain className="h-3.5 w-3.5" />
                      AI Model
                    </label>
                    <LlmModelSelect value={selectedModel} onValueChange={setSelectedModel} />
                  </div>
                </div>
              </div>

              {/* Section 3: Preview */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-bold">3</div>
                  <label className="text-sm font-medium">Contacts to generate for</label>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold text-foreground">
                        {preview.summary.canGenerate}
                      </span>
                      <span className="text-sm text-muted-foreground">contacts ready</span>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className="gap-1 text-xs bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        {preview.summary.withEnrichment} analyzed
                      </Badge>
                    </div>
                  </div>

                  {preview.summary.needsAnalysis > 0 && (
                    <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <span>
                        <strong>{preview.summary.needsAnalysis}</strong> contacts need Company Analysis first and will be skipped.
                      </span>
                    </div>
                  )}

                  {preview.summary.canGenerate === 0 && (
                    <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">
                      <XCircle className="h-4 w-4 flex-shrink-0" />
                      <span>
                        No contacts have enrichment data. Please run "Analyze Companies" first.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Async info banner */}
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
                <p>
                  Generation runs in the background. You can close this dialog and navigate away — we'll notify you when it's complete.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleGenerate}
            disabled={
              previewLoading ||
              !preview ||
              !(hasOpenRouterKey || hasOllamaKey) ||
              preview.summary.canGenerate === 0 ||
              !prompt.trim() ||
              startGenerationMutation.isPending
            }
          >
            {startGenerationMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Generate {preview?.summary.canGenerate || 0} Sequences
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
