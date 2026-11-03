import { useState, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Info,
  Search,
  Sparkles,
  Save,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  useStartNotionPagesGeneration,
  useEmailSequenceJob,
  useCancelEmailSequenceJob,
} from "@/hooks/useEmailSequenceJobs";
import type { NotionConfig } from "@/hooks/useEmailSequenceJobs";
import { useToolConnections, useNotionDatabases } from "@/hooks/useToolConnections";
import { useProducts } from "@/hooks/useProducts";
import { LlmModelSelect } from "@/components/shared/LlmModelSelect";
import { DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { useAnalyzePreview } from "@/hooks/useAnalyzeCompanies";
import { toast } from "sonner";
import { VARIABLE_CATEGORIES, NOTION_BLUEPRINTS } from "@/lib/email-sequence-constants";
import { useNotionCustomTemplates } from "@/hooks/useNotionCustomTemplates";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";

interface GenerateNotionPagesDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  onJobStarted?: (jobId: string) => void;
  regenerate?: boolean;
}

export function GenerateNotionPagesDialog({
  contactIds,
  open,
  onOpenChange,
  onComplete,
  onJobStarted,
  regenerate = false,
}: GenerateNotionPagesDialogProps) {
  // Notion config state
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const [databaseId, setDatabaseId] = useState<string | undefined>();
  const [productId, setProductId] = useState<string | undefined>();
  const [icpThreshold, setIcpThreshold] = useState(0);
  const [blueprintIds, setBlueprintIds] = useState<string[]>(['strategic-growth']);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_LLM_MODEL);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [runAnalysisFirst, setRunAnalysisFirst] = useState(true);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);

  // Job tracking
  const [jobId, setJobId] = useState<string | null>(null);

  // Hooks
  const { data: notionConnections } = useToolConnections(open ? 'notion' : undefined);
  const { data: notionDatabases, isLoading: notionDbLoading } = useNotionDatabases(connectionId);
  const { products } = useProducts();
  const startMutation = useStartNotionPagesGeneration();
  const { data: job } = useEmailSequenceJob(jobId);
  const cancelJob = useCancelEmailSequenceJob();
  const { data: analysisPreview } = useAnalyzePreview(open ? contactIds : []);
  const { templates: savedTemplates, createTemplate, deleteTemplate } = useNotionCustomTemplates();

  const unanalyzedCount = analysisPreview?.summary?.needsAnalysis ?? 0;
  const allAnalyzed = unanalyzedCount === 0;

  const isRunning = jobId !== null && (job?.status === 'pending' || job?.status === 'running');
  const isDone = job?.status === 'completed' || job?.status === 'failed' || job?.status === 'cancelled';

  const canStart = connectionId && databaseId && contactIds.length > 0 &&
    (!blueprintIds.includes('custom') || customPrompt.trim().length > 0);

  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setCustomPrompt(prev => prev + `{{${varName}}}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const insertion = `{{${varName}}}`;
    const newText = customPrompt.substring(0, start) + insertion + customPrompt.substring(end);
    setCustomPrompt(newText);
    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = start + insertion.length;
      textarea.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleStart = async () => {
    if (!canStart) return;

    const notionConfig: NotionConfig = {
      enabled: true,
      connectionId: connectionId!,
      databaseId: databaseId!,
      icpThreshold,
      productId: productId || '',
      blueprintIds,
      model: selectedModel,
      ...(blueprintIds.includes('custom') && customPrompt ? { customPrompt } : {}),
      ...(regenerate ? { force: true } : {}),
      ...(runAnalysisFirst && !allAnalyzed ? { runAnalysisFirst: true } : {}),
    };

    try {
      const newJob = await startMutation.mutateAsync({
        contactIds,
        notionConfig,
      });
      setJobId(newJob.id);
      onJobStarted?.(newJob.id);
    } catch (err) {
      toast.error(`Failed to start: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleClose = () => {
    if (isRunning) {
      // Let the user close; the job runs in the background
    }
    if (isDone) {
      onComplete?.();
    }
    onOpenChange(false);
    // Reset state after close animation
    setTimeout(() => {
      setJobId(null);
    }, 300);
  };

  const renderConfigView = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            {regenerate ? <RefreshCw className="h-4 w-4 text-primary" /> : <BookOpen className="h-4 w-4 text-primary" />}
          </div>
          {regenerate ? 'Regenerate Notion Pages' : 'Generate Notion Pages'}
        </DialogTitle>
        <DialogDescription>
          {regenerate
            ? `Re-create Notion pages for ${contactIds.length} contact${contactIds.length !== 1 ? 's' : ''} using AI. Existing pages will be replaced with new ones.`
            : `Create personalized Notion pages for ${contactIds.length} contact${contactIds.length !== 1 ? 's' : ''} using AI.`
          }
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto py-4 px-1 -mx-1 space-y-5">
        {/* Info banner */}
        <div className={cn(
          "border rounded-lg p-3",
          regenerate ? "bg-amber-500/5 border-amber-500/20" : "bg-primary/5 border-primary/20"
        )}>
          <div className={cn("flex items-start gap-2 text-sm", regenerate ? "text-amber-700" : "text-primary")}>
            {regenerate ? <RefreshCw className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <BookOpen className="h-4 w-4 mt-0.5 flex-shrink-0" />}
            <p>
              {regenerate
                ? <>Pages will be <strong>regenerated in the background</strong>. Existing Notion pages will be replaced with freshly generated ones using the latest data.</>
                : <>Pages will be generated <strong>in the background</strong>. Each contact gets a personalized Notion page based on their company analysis data.</>
              }
            </p>
          </div>
        </div>

        {/* Unanalyzed contacts warning */}
        {!allAnalyzed && analysisPreview && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-2.5">
            <div className="flex items-start gap-2 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">
                  {unanalyzedCount} of {contactIds.length} contact{contactIds.length !== 1 ? 's' : ''} haven't been AI-analyzed
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Without AI analysis, pages will lack company insights, priorities, and growth signals — resulting in generic content.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                <Label htmlFor="run-analysis-toggle" className="text-xs font-medium text-amber-700 cursor-pointer">
                  Run AI analysis first
                </Label>
              </div>
              <Switch
                id="run-analysis-toggle"
                checked={runAnalysisFirst}
                onCheckedChange={setRunAnalysisFirst}
              />
            </div>
            {runAnalysisFirst && (
              <p className="text-[10px] text-amber-600 pl-6">
                {unanalyzedCount} contact{unanalyzedCount !== 1 ? 's' : ''} will be analyzed before page generation begins. This may take a few minutes.
              </p>
            )}
          </div>
        )}

        {/* Product selector */}
        <div className="space-y-1.5">
          <Label className="text-xs">Product (optional)</Label>
          <Select value={productId || ""} onValueChange={setProductId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a product..." />
            </SelectTrigger>
            <SelectContent>
              {(products || []).map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(!products || products.length === 0) && (
            <p className="text-xs text-status-warning">No products found. Create one in Assets first.</p>
          )}
        </div>

        {/* LLM Model selector */}
        <div className="space-y-1.5">
          <Label className="text-xs">AI Model</Label>
          <LlmModelSelect value={selectedModel} onValueChange={setSelectedModel} className="space-y-1.5" />
        </div>

        {/* ICP threshold slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <Label className="text-xs">ICP Score Threshold</Label>
            <span className="text-sm font-bold text-primary">{icpThreshold}</span>
          </div>
          <Slider
            value={[icpThreshold]}
            onValueChange={([v]) => setIcpThreshold(v)}
            min={0}
            max={90}
            step={5}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 (all contacts)</span>
            <span>90 (only top)</span>
          </div>
        </div>

        {/* Notion connection + database */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Notion Connection</Label>
              {notionConnections && notionConnections.length > 0 ? (
                <Select value={connectionId || ""} onValueChange={(v) => {
                  setConnectionId(v);
                  setDatabaseId(undefined);
                }}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {notionConnections.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>{conn.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-xs text-status-warning bg-status-warning/10 p-2 rounded">
                  No Notion connections.{' '}
                  <Link to="/settings?tab=integrations" className="underline">Add one</Link>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Database</Label>
              {notionDbLoading ? (
                <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-xs text-muted-foreground">Loading...</span>
                </div>
              ) : connectionId && notionDatabases && notionDatabases.length === 0 ? (
                <div className="text-xs text-status-warning bg-status-warning/10 p-2 rounded">
                  No databases found. In Notion, open a database, click <strong>...</strong> then <strong>Connections</strong> and add your integration.
                </div>
              ) : (
                <Select
                  value={databaseId || ""}
                  onValueChange={setDatabaseId}
                  disabled={!connectionId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(notionDatabases || []).map((db) => (
                      <SelectItem key={db.id} value={db.id}>{db.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help flex-shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-xs">
                  <p>To hide the database name from shared pages, open your Notion database, go to <strong>... &gt; Publish</strong>, and disable <strong>Breadcrumb</strong> in the publish settings.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span>Hide database breadcrumb via Notion's publish settings</span>
          </div>

        {/* Blueprint selector */}
        <div className="space-y-2">
          <Label className="text-xs">Document Blueprints <span className="text-muted-foreground font-normal">(select one or combine multiple)</span></Label>
          <div className="grid grid-cols-2 gap-2">
            {NOTION_BLUEPRINTS.map((bp) => {
              const isSelected = blueprintIds.includes(bp.id) && activeTemplateId === null;
              return (
                <button
                  key={bp.id}
                  type="button"
                  onClick={() => {
                    setActiveTemplateId(null);
                    setBlueprintIds((prev) => {
                      if (isSelected) {
                        const next = prev.filter((id) => id !== bp.id);
                        return next.length > 0 ? next : prev;
                      }
                      return [...prev, bp.id];
                    });
                  }}
                  className={cn(
                    "p-2.5 rounded-lg border text-left transition-all relative",
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  )}
                >
                  {isSelected && blueprintIds.length > 1 && (
                    <span className="absolute top-1 right-1.5 text-[9px] font-bold text-primary bg-primary/10 rounded-full w-4 h-4 flex items-center justify-center">
                      {blueprintIds.indexOf(bp.id) + 1}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{bp.icon}</span>
                    <span className="font-medium text-xs">{bp.name}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{bp.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {bp.blockTypeTags.map((tag) => (
                      <span key={tag} className="inline-flex items-center px-1.5 py-0 rounded text-[9px] bg-gray-100 text-gray-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
            {/* Saved custom templates */}
            {savedTemplates.map((tpl) => {
              const isSelected = activeTemplateId === tpl.id;
              return (
                <button
                  key={`saved-${tpl.id}`}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setActiveTemplateId(null);
                      setBlueprintIds(['strategic-growth']);
                      setCustomPrompt('');
                    } else {
                      setActiveTemplateId(tpl.id);
                      setBlueprintIds(['custom']);
                      setCustomPrompt(tpl.custom_prompt);
                    }
                  }}
                  className={cn(
                    "p-2.5 rounded-lg border text-left transition-all relative border-dashed",
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-gray-300 hover:border-gray-400 bg-white"
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteTemplate.mutate(tpl.id);
                      if (isSelected) {
                        setActiveTemplateId(null);
                        setBlueprintIds(['strategic-growth']);
                        setCustomPrompt('');
                      }
                    }}
                    className="absolute top-1 right-1.5 p-0.5 rounded hover:bg-red-100 text-muted-foreground hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{tpl.icon}</span>
                    <span className="font-medium text-xs">{tpl.name}</span>
                    <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium">Saved</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                    {tpl.description || tpl.custom_prompt.slice(0, 80) + (tpl.custom_prompt.length > 80 ? '...' : '')}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] bg-gray-100 text-gray-600">
                      AI-Determined
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {blueprintIds.length > 1 && (
            <p className="text-[10px] text-primary font-medium">
              Combining {blueprintIds.length} blueprints into one document
            </p>
          )}

          {/* Section preview for selected blueprints */}
          {!blueprintIds.includes('custom') && (
            <div className="bg-gray-50 rounded-lg p-2.5 space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Document sections</span>
              {blueprintIds.flatMap((bpId) => {
                const bp = NOTION_BLUEPRINTS.find(b => b.id === bpId);
                return bp?.sections.map((section, i) => ({ section, bpName: bp.name, key: `${bpId}-${i}` })) || [];
              }).map(({ section, bpName, key }, i) => (
                <div key={key} className="flex items-start gap-1.5">
                  <span className="text-[10px] text-muted-foreground mt-0.5 w-3 text-right flex-shrink-0">{i + 1}.</span>
                  <div>
                    <span className="text-[11px] font-medium">{section.title}</span>
                    {blueprintIds.length > 1 && (
                      <span className="text-[9px] text-primary ml-1">({bpName})</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-1">{section.description}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Custom prompt — only when custom blueprint is selected */}
          {blueprintIds.includes('custom') && (
            <div className="space-y-2">
              <div className="space-y-1">
                {VARIABLE_CATEGORIES.map((category) => (
                  category.label === 'Deliverables' ? null : (
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
                        {category.label}
                      </button>
                      {expandedCategory === category.label && (
                        <div className="flex flex-wrap gap-1 mt-1 mb-2">
                          {category.variables.map((variable) => (
                            <button
                              key={variable.name}
                              type="button"
                              onClick={() => insertVariable(variable.name)}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-white border border-gray-200 text-gray-700 hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-colors cursor-pointer"
                            >
                              {variable.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                ))}
              </div>
              <Textarea
                ref={textareaRef}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe what the AI should generate for the Notion page..."
                className="min-h-[120px] text-xs bg-white font-mono"
              />
              {/* Save as template */}
              {customPrompt.trim().length > 0 && (
                <div className="space-y-2">
                  {!showSaveForm ? (
                    <button
                      type="button"
                      onClick={() => setShowSaveForm(true)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Save className="h-3 w-3" />
                      Save as template
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        value={saveTemplateName}
                        onChange={(e) => setSaveTemplateName(e.target.value)}
                        placeholder="Template name..."
                        className="h-7 text-xs flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setShowSaveForm(false);
                            setSaveTemplateName('');
                          }
                          if (e.key === 'Enter' && saveTemplateName.trim()) {
                            createTemplate.mutate(
                              { name: saveTemplateName.trim(), custom_prompt: customPrompt },
                              { onSuccess: () => { setShowSaveForm(false); setSaveTemplateName(''); } }
                            );
                          }
                        }}
                      />
                      <Button
                        variant="cta"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!saveTemplateName.trim() || createTemplate.isPending}
                        onClick={() => {
                          createTemplate.mutate(
                            { name: saveTemplateName.trim(), custom_prompt: customPrompt },
                            { onSuccess: () => { setShowSaveForm(false); setSaveTemplateName(''); } }
                          );
                        }}
                      >
                        {createTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                      </Button>
                      <button
                        type="button"
                        onClick={() => { setShowSaveForm(false); setSaveTemplateName(''); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="border-t pt-4">
        <Button variant="outline" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="cta"
          onClick={handleStart}
          disabled={!canStart || startMutation.isPending}
        >
          {startMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              {regenerate ? <RefreshCw className="h-4 w-4 mr-2" /> : <BookOpen className="h-4 w-4 mr-2" />}
              {regenerate ? 'Regenerate' : 'Generate'} {contactIds.length} Page{contactIds.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );

  const renderProgressView = () => {
    if (!job) return null;

    const isComplete = job.status === 'completed';
    const isFailed = job.status === 'failed';
    const isCancelled = job.status === 'cancelled';

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              {isComplete ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : isFailed ? (
                <AlertCircle className="h-4 w-4 text-red-500" />
              ) : (
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              )}
            </div>
            {isComplete ? 'Preview Pages Generated' : isFailed ? 'Generation Failed' : isCancelled ? 'Generation Cancelled' : 'Generating Preview Pages...'}
          </DialogTitle>
          <DialogDescription>
            {isComplete
              ? `Created ${job.generated_count} preview page${job.generated_count !== 1 ? 's' : ''}`
              : isFailed
                ? job.error_message || 'An error occurred'
                : `Processing ${job.total_contacts} contact${job.total_contacts !== 1 ? 's' : ''}...`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <Progress value={job.progress || 0} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{job.current_contact_name || (isComplete ? 'Done' : 'Waiting...')}</span>
              <span>{job.progress || 0}%</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-lg font-bold text-green-700">{job.generated_count || 0}</div>
              <div className="text-xs text-green-600">Generated</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-700">{job.skipped_count || 0}</div>
              <div className="text-xs text-gray-600">Skipped</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-lg font-bold text-red-700">{job.failed_count || 0}</div>
              <div className="text-xs text-red-600">Failed</div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          {isRunning && (
            <Button
              variant="outline"
              onClick={() => cancelJob.mutate(jobId!)}
              disabled={cancelJob.isPending}
            >
              {cancelJob.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              Cancel
            </Button>
          )}
          {(isDone) && (
            <Button variant="cta" onClick={handleClose}>
              Close
            </Button>
          )}
          {isRunning && (
            <Button variant="ghost" onClick={handleClose}>
              Close (runs in background)
            </Button>
          )}
        </DialogFooter>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {jobId ? renderProgressView() : renderConfigView()}
      </DialogContent>
    </Dialog>
  );
}
