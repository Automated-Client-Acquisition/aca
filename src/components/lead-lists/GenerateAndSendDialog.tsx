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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  CheckCircle2,
  Brain,
  Search,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronRight,
  FileText,
  Rocket,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  BookOpen,
  Mail,
  Plus,
  ListPlus,
  Users,
  ShieldAlert,
  Package,
  XCircle,
  MessageSquare,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { EmailToolLogo } from "@/components/icons/EmailToolLogos";
import { useSequenceGenerationPreview, useEmailSequences, useEnrollmentConflicts } from "@/hooks/useEmailSequences";
import type { EmailSequenceConfig } from "@/hooks/useEmailSequences";
import { useStartEmailSequenceGeneration } from "@/hooks/useEmailSequenceJobs";
import type { PushConfig, NotionConfig } from "@/hooks/useEmailSequenceJobs";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { LlmModelSelect } from "@/components/shared/LlmModelSelect";
import { DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { useToolConnections, useToolCampaigns, useNotionDatabases } from "@/hooks/useToolConnections";
import { useProducts } from "@/hooks/useProducts";
import { useCompletedKnowledgeDocuments } from "@/hooks/useKnowledgeBase";
import { useEmailMailboxStats, useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { useEmailSendingDomains } from "@/hooks/useEmailSendingDomains";
import { CampaignSettingsPanel } from "@/components/email/CampaignSettingsPanel";
import { getDefaultSettings } from "@/lib/email-sequence-utils";
import type { EmailSequenceSettings, AutopilotConfig } from "@/types/email";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VARIABLE_CATEGORIES, PROMPT_PRESETS, NOTION_BLUEPRINTS } from "@/lib/email-sequence-constants";

interface GenerateAndSendDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  onJobStarted?: (jobId: string) => void;
}

type WizardStep = 'configure-generation' | 'configure-push';

export function GenerateAndSendDialog({
  contactIds,
  open,
  onOpenChange,
  onComplete,
  onJobStarted,
}: GenerateAndSendDialogProps) {
  // Wizard state
  const [step, setStep] = useState<WizardStep>('configure-generation');

  // Generation config state
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].template);
  const [emailCount, setEmailCount] = useState(3);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_LLM_MODEL);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Contact');

  // Push config state
  const [selectedToolType, setSelectedToolType] = useState<'smartlead' | 'instantly' | 'successai' | 'internal' | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();

  // Internal engine config state
  const [sequenceMode, setSequenceMode] = useState<'new' | 'existing'>('new');
  const [existingSequenceId, setExistingSequenceId] = useState<string | undefined>();
  const [internalSequenceName, setInternalSequenceName] = useState('');
  const [activationMode, setActivationMode] = useState<'activate' | 'draft'>('activate');
  const [internalFullSettings, setInternalFullSettings] = useState<EmailSequenceSettings>(() => getDefaultSettings());
  const [internalAutopilotConfig, setInternalAutopilotConfig] = useState<AutopilotConfig | null>(null);
  const [internalAgentProfileId, setInternalAgentProfileId] = useState<string | null>(null);

  // Product context state (independent of Notion — drives AI prompt enrichment)
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>();

  // Knowledge base state
  const [knowledgeDocumentIds, setKnowledgeDocumentIds] = useState<string[]>([]);
  const [kbExpanded, setKbExpanded] = useState(false);

  // Notion deliverable preview state
  const [notionEnabled, setNotionEnabled] = useState(false);
  const [notionConnectionId, setNotionConnectionId] = useState<string | undefined>();
  const [notionDatabaseId, setNotionDatabaseId] = useState<string | undefined>();
  const [notionProductId, setNotionProductId] = useState<string | undefined>();
  const [notionIcpThreshold, setNotionIcpThreshold] = useState(70);
  const [notionBlueprintIds, setNotionBlueprintIds] = useState<string[]>(['strategic-growth']);
  const [notionCustomPrompt, setNotionCustomPrompt] = useState<string>('');
  const notionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [notionExpandedCategory, setNotionExpandedCategory] = useState<string | null>(null);

  // Hooks
  const { data: preview, isLoading: previewLoading } = useSequenceGenerationPreview(open ? contactIds : []);
  const { hasOpenRouterKey } = useOpenRouterModels();
  const { hasOllamaKey } = useOllamaModels();
  const startGenerationMutation = useStartEmailSequenceGeneration();
  const { data: mailboxStats } = useEmailMailboxStats();
  const { data: mailboxes } = useEmailMailboxes();
  const { data: sendingDomains } = useEmailSendingDomains();
  const { data: allSequences } = useEmailSequences();
  const availableSequences = allSequences?.filter(s => s.status === 'active' || s.status === 'draft' || s.status === 'paused') || [];
  const [includeFirewalled, setIncludeFirewalled] = useState(false);
  const firewallCount = preview?.summary.behindFirewall || 0;
  const generatableIds = preview?.contacts
    .filter(c => c.canGenerate && (includeFirewalled || !c.seg_provider))
    .map(c => c.id) || [];
  const { data: conflicts } = useEnrollmentConflicts(
    generatableIds,
    step === 'configure-push' && selectedToolType === 'internal',
    sequenceMode === 'existing' ? existingSequenceId : undefined,
  );
  const { data: connections, isLoading: connectionsLoading } = useToolConnections(
    selectedToolType && selectedToolType !== 'internal' ? selectedToolType : undefined
  );
  const { data: campaigns, isLoading: campaignsLoading } = useToolCampaigns(selectedConnectionId);
  const { data: notionConnections } = useToolConnections(notionEnabled ? 'notion' : undefined);
  const { data: notionDatabases, isLoading: notionDbLoading, error: notionDbError } = useNotionDatabases(notionConnectionId);
  const { products } = useProducts();
  const { data: knowledgeDocuments } = useCompletedKnowledgeDocuments();

  const filteredConnections = connections?.filter(c =>
    !selectedToolType || c.tool_type === selectedToolType
  ) || [];

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      const timeout = setTimeout(() => {
        setStep('configure-generation');
        setPrompt(PROMPT_PRESETS[0].template);
        setEmailCount(3);
        setSelectedModel(DEFAULT_LLM_MODEL);
        setExpandedCategory('Contact');
        setSelectedToolType(null);
        setSelectedConnectionId(undefined);
        setSelectedCampaignId(undefined);
        setSequenceMode('new');
        setExistingSequenceId(undefined);
        setIncludeFirewalled(false);
        setInternalSequenceName('');
        setActivationMode('activate');
        setInternalFullSettings(getDefaultSettings());
        setInternalAutopilotConfig(null);
        setInternalAgentProfileId(null);
        setSelectedProductId(undefined);
        setKnowledgeDocumentIds([]);
        setKbExpanded(false);
        setNotionEnabled(false);
        setNotionConnectionId(undefined);
        setNotionDatabaseId(undefined);
        setNotionProductId(undefined);
        setNotionIcpThreshold(70);
        setNotionBlueprintIds(['strategic-growth']);
        setNotionCustomPrompt('');
        setNotionExpandedCategory(null);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  // Reset connection/campaign when tool type changes
  useEffect(() => {
    setSelectedConnectionId(undefined);
    setSelectedCampaignId(undefined);
  }, [selectedToolType]);

  useEffect(() => {
    setSelectedCampaignId(undefined);
  }, [selectedConnectionId]);

  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setPrompt(prev => prev + `{{${varName}}}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const insertion = `{{${varName}}}`;
    const newText = prompt.substring(0, start) + insertion + prompt.substring(end);
    setPrompt(newText);
    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = start + insertion.length;
      textarea.setSelectionRange(newCursor, newCursor);
    });
  };

  const insertNotionVariable = (varName: string) => {
    const textarea = notionTextareaRef.current;
    if (!textarea) {
      setNotionCustomPrompt(prev => prev + `{{${varName}}}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const insertion = `{{${varName}}}`;
    const newText = notionCustomPrompt.substring(0, start) + insertion + notionCustomPrompt.substring(end);
    setNotionCustomPrompt(newText);
    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = start + insertion.length;
      textarea.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleStartExecution = async () => {
    if (!preview || !selectedToolType) return;
    if (selectedToolType !== 'internal' && (!selectedConnectionId || !selectedCampaignId)) return;

    let generatableContactIds = preview.contacts
      .filter(c => c.canGenerate && (includeFirewalled || !c.seg_provider))
      .map(c => c.id);

    // Always skip bounced/unsubscribed contacts (hard safety)
    if (conflicts && conflicts.length > 0) {
      const skipIds = new Set<string>();
      for (const c of conflicts) {
        if (c.status === 'bounced' || c.status === 'unsubscribed') {
          skipIds.add(c.contactId);
        }
      }
      if (skipIds.size > 0) {
        generatableContactIds = generatableContactIds.filter(id => !skipIds.has(id));
      }
    }

    if (generatableContactIds.length === 0) {
      toast.warning('No contacts have enrichment data');
      return;
    }

    const config: EmailSequenceConfig = { prompt, productId: selectedProductId, knowledgeDocumentIds: knowledgeDocumentIds.length > 0 ? knowledgeDocumentIds : undefined };
    const pushConfig: PushConfig = selectedToolType === 'internal'
      ? {
          toolType: 'internal',
          sequenceName: sequenceMode === 'new' ? (internalSequenceName || undefined) : undefined,
          existingSequenceId: sequenceMode === 'existing' ? existingSequenceId : undefined,
          internalSettings: sequenceMode === 'new' ? {
            fullSettings: internalFullSettings,
            autopilotConfig: internalAutopilotConfig || undefined,
            agentProfileId: internalAgentProfileId,
          } : undefined,
          createAsDraft: sequenceMode === 'new' ? activationMode === 'draft' : undefined,
        }
      : {
          toolType: selectedToolType,
          connectionId: selectedConnectionId!,
          externalCampaignId: selectedCampaignId!,
        };

    // Build Notion config if enabled
    const notionConfig: NotionConfig | undefined = notionEnabled && notionConnectionId && notionDatabaseId && notionProductId
      ? {
          enabled: true,
          connectionId: notionConnectionId,
          databaseId: notionDatabaseId,
          icpThreshold: notionIcpThreshold,
          productId: notionProductId,
          blueprintIds: notionBlueprintIds,
          ...(notionBlueprintIds.includes('custom') && notionCustomPrompt ? { customPrompt: notionCustomPrompt } : {}),
        }
      : undefined;

    try {
      const job = await startGenerationMutation.mutateAsync({
        contactIds: generatableContactIds,
        emailCount,
        model: selectedModel,
        config,
        pushConfig,
        notionConfig,
      });

      const toolName = selectedToolType === 'smartlead' ? 'SmartLead'
        : selectedToolType === 'instantly' ? 'Instantly'
        : selectedToolType === 'internal' ? 'Internal Email Engine'
        : 'Success.ai';

      const notionSuffix = notionConfig ? ' + Notion previews' : '';
      const isDraftMode = selectedToolType === 'internal' && sequenceMode === 'new' && activationMode === 'draft';
      const verb = isDraftMode ? 'creating draft for' : selectedToolType === 'internal' ? 'enrolling' : 'sending';
      toast.success(`Generating & ${verb} ${generatableContactIds.length} sequences to ${toolName}${notionSuffix} in the background`);
      onJobStarted?.(job.id);
      onOpenChange(false);
      onComplete?.();
    } catch (error) {
      toast.error(`Failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const canGenerate = preview && generatableIds.length > 0 && prompt.trim() && (hasOpenRouterKey || hasOllamaKey);
  const canPush = selectedToolType === 'internal'
    ? (mailboxStats?.ready ?? 0) > 0 && (sequenceMode === 'new' || !!existingSequenceId)
    : selectedToolType && selectedConnectionId && selectedCampaignId;

  const dialogMaxWidth = step === 'configure-generation'
    ? 'sm:max-w-[700px]'
    : selectedToolType === 'internal' && sequenceMode === 'new'
      ? 'sm:max-w-3xl'
      : 'sm:max-w-[550px]';

  const renderContent = () => {
    // ============= STEP: Configure Generation =============
    if (step === 'configure-generation') {
      return (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cta/20 to-cta-hover/20 flex items-center justify-center">
                <Rocket className="h-4 w-4 text-cta" />
              </div>
              Generate & Send
            </DialogTitle>
            <DialogDescription>
              Step 1 of 2: Configure the email sequence generation.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-4 px-1 -mx-1 space-y-5">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : preview ? (
              <>
                {/* Prompt section */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Your Prompt
                  </label>

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

                    <Textarea
                      ref={textareaRef}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Tell the AI what kind of emails to write. Use variables like {{first_name}} and {{ai_primary_need}} for per-contact personalization..."
                      className="min-h-[120px] text-sm font-mono"
                      style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Variables like <code className="bg-muted px-1 py-0.5 rounded text-primary">{"{{ai_primary_need}}"}</code> are resolved per-contact using their enrichment data.
                    </p>
                  </div>
                </div>

                {/* Product Context */}
                <div className="border rounded-lg p-3 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    Product Context
                    <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                  </label>
                  <Select
                    value={selectedProductId || "_none"}
                    onValueChange={(v) => {
                      const val = v === '_none' ? undefined : v;
                      setSelectedProductId(val);
                      if (val && notionEnabled) setNotionProductId(val);
                      // Also sync to internal sequence settings so {{product_*}} variables resolve at send time
                      setInternalFullSettings((prev) => ({ ...prev, product_id: val || null }));
                    }}
                  >
                    <SelectTrigger className="h-9">
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
                  <p className="text-xs text-muted-foreground">
                    Selecting a product injects your product's benefits, ICP intelligence, and domain expertise into the AI prompt.
                  </p>
                </div>

                {/* Knowledge Base Documents */}
                {knowledgeDocuments && knowledgeDocuments.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setKbExpanded(!kbExpanded)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKbExpanded(!kbExpanded); } }}
                      className={cn(
                        "w-full p-3 flex items-center justify-between transition-colors cursor-pointer",
                        kbExpanded ? "bg-primary/5 border-b" : "hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Knowledge Base</span>
                        {knowledgeDocumentIds.length > 0 && (
                          <Badge variant="secondary" className="text-[10px]">{knowledgeDocumentIds.length} selected</Badge>
                        )}
                        {knowledgeDocumentIds.length === 0 && (
                          <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                        )}
                      </div>
                      {kbExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    {kbExpanded && (
                      <div className="p-3 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Selected documents provide RAG context to the AI when generating each email sequence.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setKnowledgeDocumentIds(knowledgeDocuments.map(doc => doc.id))}
                            className="text-xs h-7"
                          >
                            Select all
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setKnowledgeDocumentIds([])}
                            disabled={knowledgeDocumentIds.length === 0}
                            className="text-xs h-7"
                          >
                            Clear
                          </Button>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {knowledgeDocumentIds.length} / {knowledgeDocuments.length}
                          </span>
                        </div>
                        <div className="max-h-[140px] overflow-y-auto space-y-0.5">
                          {knowledgeDocuments.map((doc) => {
                            const isChecked = knowledgeDocumentIds.includes(doc.id);
                            return (
                              <label
                                key={doc.id}
                                className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setKnowledgeDocumentIds(prev => [...prev, doc.id]);
                                    } else {
                                      setKnowledgeDocumentIds(prev => prev.filter(id => id !== doc.id));
                                    }
                                  }}
                                />
                                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="text-sm truncate flex-1">{doc.name}</span>
                                <span className="text-[10px] text-muted-foreground flex-shrink-0">{doc.chunk_count} chunks</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Settings: email count + model */}
                <div className="border rounded-lg divide-y">
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm font-medium">Number of Emails</Label>
                      <span className="text-lg font-bold text-blue-600">{emailCount}</span>
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

                  <div className="p-3 space-y-2">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Brain className="h-3.5 w-3.5" />
                      AI Model
                    </label>
                    <LlmModelSelect value={selectedModel} onValueChange={setSelectedModel} />
                  </div>
                </div>

                {/* Notion Deliverable Preview Section */}
                <div className="border rounded-lg overflow-hidden">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setNotionEnabled(!notionEnabled)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setNotionEnabled(!notionEnabled); } }}
                    className={cn(
                      "w-full p-3 flex items-center justify-between transition-colors cursor-pointer",
                      notionEnabled ? "bg-primary/5 border-b" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Deliverable Preview</span>
                      <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                    </div>
                    <Switch
                      checked={notionEnabled}
                      onCheckedChange={setNotionEnabled}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  {notionEnabled && (
                    <div className="p-4 space-y-4">
                      <p className="text-xs text-muted-foreground">
                        AI-generates a personalized preview page per high-ICP contact. The page link is available as <code className="bg-muted px-1 py-0.5 rounded text-primary">{"{{notion_preview_url}}"}</code> in your email prompt.
                      </p>

                      {/* Product selector */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Product</Label>
                        <Select value={notionProductId || ""} onValueChange={setNotionProductId}>
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
                          <p className="text-xs text-amber-600 dark:text-amber-400">No products found. Create one in Assets first.</p>
                        )}
                      </div>

                      {/* ICP threshold slider */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs">ICP Score Threshold</Label>
                          <span className="text-sm font-bold text-primary">{notionIcpThreshold}</span>
                        </div>
                        <Slider
                          value={[notionIcpThreshold]}
                          onValueChange={([v]) => setNotionIcpThreshold(v)}
                          min={50}
                          max={90}
                          step={5}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>50 (more contacts)</span>
                          <span>90 (only top)</span>
                        </div>
                      </div>

                      {/* Notion connection + database */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Notion Connection</Label>
                          {notionConnections && notionConnections.length > 0 ? (
                            <Select value={notionConnectionId || ""} onValueChange={(v) => {
                              setNotionConnectionId(v);
                              setNotionDatabaseId(undefined);
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
                            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
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
                          ) : notionConnectionId && notionDbError ? (
                            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 p-2 rounded">
                              {notionDbError instanceof Error ? notionDbError.message : 'Failed to load databases.'}
                              {' '}<Link to="/settings?tab=integrations" className="underline">Fix in Settings</Link>
                            </div>
                          ) : notionConnectionId && notionDatabases && notionDatabases.length === 0 ? (
                            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                              No databases found. In Notion, open a database → <strong>...</strong> → <strong>Connections</strong> → add your integration.
                            </div>
                          ) : (
                            <Select
                              value={notionDatabaseId || ""}
                              onValueChange={setNotionDatabaseId}
                              disabled={!notionConnectionId}
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
                            const isSelected = notionBlueprintIds.includes(bp.id);
                            return (
                              <button
                                key={bp.id}
                                type="button"
                                onClick={() => {
                                  setNotionBlueprintIds((prev) => {
                                    if (isSelected) {
                                      // Deselect — but keep at least one
                                      const next = prev.filter((id) => id !== bp.id);
                                      return next.length > 0 ? next : prev;
                                    }
                                    // Select — add to list
                                    return [...prev, bp.id];
                                  });
                                }}
                                className={cn(
                                  "p-2.5 rounded-lg border text-left transition-all relative",
                                  isSelected
                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                    : "border-border hover:border-muted-foreground/30 bg-background"
                                )}
                              >
                                {isSelected && notionBlueprintIds.length > 1 && (
                                  <span className="absolute top-1 right-1.5 text-[9px] font-bold text-primary bg-primary/10 rounded-full w-4 h-4 flex items-center justify-center">
                                    {notionBlueprintIds.indexOf(bp.id) + 1}
                                  </span>
                                )}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-base">{bp.icon}</span>
                                  <span className="font-medium text-xs">{bp.name}</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{bp.description}</p>
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {bp.blockTypeTags.map((tag) => (
                                    <span key={tag} className="inline-flex items-center px-1.5 py-0 rounded text-[9px] bg-muted text-muted-foreground">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {notionBlueprintIds.length > 1 && (
                          <p className="text-[10px] text-primary font-medium">
                            Combining {notionBlueprintIds.length} blueprints into one document
                          </p>
                        )}

                        {/* Section preview for selected blueprints */}
                        {!notionBlueprintIds.includes('custom') && (
                          <div className="bg-muted/50 rounded-lg p-2.5 space-y-1">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Document sections</span>
                            {notionBlueprintIds.flatMap((bpId) => {
                              const bp = NOTION_BLUEPRINTS.find(b => b.id === bpId);
                              return bp?.sections.map((section, i) => ({ section, bpName: bp.name, key: `${bpId}-${i}` })) || [];
                            }).map(({ section, bpName, key }, i) => (
                              <div key={key} className="flex items-start gap-1.5">
                                <span className="text-[10px] text-muted-foreground mt-0.5 w-3 text-right flex-shrink-0">{i + 1}.</span>
                                <div>
                                  <span className="text-[11px] font-medium">{section.title}</span>
                                  {notionBlueprintIds.length > 1 && (
                                    <span className="text-[9px] text-primary ml-1">({bpName})</span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground ml-1">{section.description}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Custom prompt textarea — only shown when custom blueprint is selected */}
                        {notionBlueprintIds.includes('custom') && (
                          <div className="space-y-2">
                            <div className="space-y-1">
                              {VARIABLE_CATEGORIES.map((category) => (
                                <div key={`notion-${category.label}`}>
                                  <button
                                    type="button"
                                    onClick={() => setNotionExpandedCategory(
                                      notionExpandedCategory === category.label ? null : category.label
                                    )}
                                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-0.5"
                                  >
                                    {notionExpandedCategory === category.label ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                    {category.label}
                                  </button>
                                  {notionExpandedCategory === category.label && (
                                    <div className="flex flex-wrap gap-1 mt-1 mb-2">
                                      {category.variables.map((variable) => (
                                        <button
                                          key={`notion-${variable.name}`}
                                          type="button"
                                          onClick={() => insertNotionVariable(variable.name)}
                                          className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-card border border-border text-card-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-colors cursor-pointer"
                                        >
                                          {variable.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            <Textarea
                              ref={notionTextareaRef}
                              value={notionCustomPrompt}
                              onChange={(e) => setNotionCustomPrompt(e.target.value)}
                              placeholder="Describe what the AI should generate for the Notion page..."
                              className="min-h-[100px] text-xs font-mono"
                              style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Contact preview */}
                <div className="bg-muted/50 rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold text-foreground">
                        {generatableIds.length}
                      </span>
                      <span className="text-sm text-muted-foreground">contacts ready</span>
                    </div>
                    <Badge variant="outline" className="gap-1 text-xs bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {preview.summary.withEnrichment} analyzed
                    </Badge>
                  </div>
                  {preview.summary.needsAnalysis > 0 && (
                    <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <span>
                        <strong>{preview.summary.needsAnalysis}</strong> contacts need Company Analysis first and will be skipped.
                      </span>
                    </div>
                  )}
                  {firewallCount > 0 && (
                    <div className="flex items-center justify-between text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                        <span>
                          <strong>{firewallCount}</strong> behind email firewalls {!includeFirewalled && '(auto-excluded)'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                        onClick={() => setIncludeFirewalled(!includeFirewalled)}
                      >
                        {includeFirewalled ? 'Exclude' : 'Include anyway'}
                      </Button>
                    </div>
                  )}
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
              onClick={() => setStep('configure-push')}
              disabled={!canGenerate || previewLoading}
            >
              Next: Choose Destination
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </DialogFooter>
        </>
      );
    }

    // ============= STEP: Configure Push Destination =============
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cta/20 to-cta-hover/20 flex items-center justify-center">
              <Rocket className="h-4 w-4 text-cta" />
            </div>
            Generate & Send
          </DialogTitle>
          <DialogDescription>
            Step 2 of 2: Choose where to push the generated sequences.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 px-1 -mx-1 space-y-5">
          {/* Info banner */}
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2 text-blue-700 dark:text-blue-300 text-sm">
              <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                Sequences will be generated and pushed <strong>in the background</strong>. You can close this dialog and keep working.
              </p>
            </div>
          </div>

          {/* Tool Selection */}
          <div className="space-y-3">
            <Label>Email Tool</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedToolType('internal')}
                className={cn(
                  "p-4 rounded-lg border text-left transition-all",
                  selectedToolType === 'internal'
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-cta/20 to-cta-hover/20 mb-2">
                  <Mail className="h-4 w-4 text-cta" />
                </div>
                <div className="font-medium">Our Mailboxes</div>
                <div className="text-xs text-muted-foreground">Send via internal engine</div>
                {mailboxStats && (
                  <Badge variant="secondary" className="text-[10px] mt-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                    {mailboxStats.ready} ready
                  </Badge>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSelectedToolType('smartlead')}
                className={cn(
                  "p-4 rounded-lg border text-left transition-all",
                  selectedToolType === 'smartlead'
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <EmailToolLogo toolType="smartlead" size="md" className="mb-2" />
                <div className="font-medium">SmartLead</div>
                <div className="text-xs text-muted-foreground">Cold email outreach</div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedToolType('instantly')}
                className={cn(
                  "p-4 rounded-lg border text-left transition-all",
                  selectedToolType === 'instantly'
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <EmailToolLogo toolType="instantly" size="md" className="mb-2" />
                <div className="font-medium">Instantly</div>
                <div className="text-xs text-muted-foreground">Email outreach platform</div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedToolType('successai')}
                className={cn(
                  "p-4 rounded-lg border text-left transition-all",
                  selectedToolType === 'successai'
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <EmailToolLogo toolType="successai" size="md" className="mb-2" />
                <div className="font-medium">Success.ai</div>
                <div className="text-xs text-muted-foreground">AI-powered outreach</div>
              </button>
            </div>
          </div>

          {/* Internal Engine Configuration */}
          {selectedToolType === 'internal' && (
            <div className="space-y-4">
              {(mailboxStats?.ready ?? 0) === 0 ? (
                <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">No mailboxes ready</p>
                      <p className="text-amber-600 dark:text-amber-400">You need at least one connected mailbox to send emails.</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link to="/email-engine">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Go to Email Engine
                    </Link>
                  </Button>
                </div>
              ) : (
                <>
                  {/* Sequence Mode Toggle */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setSequenceMode('new'); setExistingSequenceId(undefined); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                        sequenceMode === 'new'
                          ? "border-foreground/30 bg-foreground/5 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create New Sequence
                    </button>
                    <button
                      type="button"
                      onClick={() => setSequenceMode('existing')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                        sequenceMode === 'existing'
                          ? "border-foreground/30 bg-foreground/5 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <ListPlus className="h-3.5 w-3.5" />
                      Add to Existing
                    </button>
                  </div>

                  {sequenceMode === 'new' ? (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Sequence Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <Input
                          value={internalSequenceName}
                          onChange={(e) => setInternalSequenceName(e.target.value)}
                          placeholder={`Outreach - ${new Date().toLocaleDateString()}`}
                        />
                      </div>

                      {/* Activation Mode */}
                      <div className="space-y-1.5">
                        <Label className="text-sm">Activation Mode</Label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setActivationMode('activate')}
                            className={cn(
                              "flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left",
                              activationMode === 'activate'
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:bg-muted"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <Rocket className="h-3.5 w-3.5" />
                              Activate Immediately
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">Starts sending according to schedule</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => setActivationMode('draft')}
                            className={cn(
                              "flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left",
                              activationMode === 'draft'
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:bg-muted"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5" />
                              Create as Draft
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">Review in the Sequence Builder first</p>
                          </button>
                        </div>
                      </div>

                      {/* Full Campaign Settings */}
                      <CampaignSettingsPanel
                        settings={internalFullSettings}
                        onChange={(update) => setInternalFullSettings(prev => ({ ...prev, ...update }))}
                        mailboxes={mailboxes || []}
                        sendingDomains={sendingDomains}
                        autopilotConfig={internalAutopilotConfig}
                        onAutopilotChange={setInternalAutopilotConfig}
                        agentProfileId={internalAgentProfileId}
                        onAgentProfileChange={(profileId, config) => {
                          setInternalAgentProfileId(profileId);
                          setInternalAutopilotConfig(config);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Select Sequence</Label>
                        {availableSequences.length === 0 ? (
                          <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                            <p className="text-sm text-amber-700 dark:text-amber-300">No sequences found. Create a new one instead.</p>
                          </div>
                        ) : (
                          <Select value={existingSequenceId || ""} onValueChange={setExistingSequenceId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a sequence..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(() => {
                                const activeSeqs = availableSequences.filter(s => s.status === 'active');
                                const pausedSeqs = availableSequences.filter(s => s.status === 'paused');
                                const draftSeqs = availableSequences.filter(s => s.status === 'draft');
                                const renderItem = (seq: typeof availableSequences[0]) => {
                                  const emailSteps = seq.steps?.filter(s => s.type === 'email') || [];
                                  return (
                                    <SelectItem key={seq.id} value={seq.id}>
                                      <div className="flex items-center gap-2">
                                        <span>{seq.name}</span>
                                        <span className="text-muted-foreground text-xs">
                                          ({emailSteps.length} email{emailSteps.length !== 1 ? 's' : ''})
                                        </span>
                                      </div>
                                    </SelectItem>
                                  );
                                };
                                return (
                                  <>
                                    {activeSeqs.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel>Active</SelectLabel>
                                        {activeSeqs.map(renderItem)}
                                      </SelectGroup>
                                    )}
                                    {pausedSeqs.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel>Paused</SelectLabel>
                                        {pausedSeqs.map(renderItem)}
                                      </SelectGroup>
                                    )}
                                    {draftSeqs.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel>Draft</SelectLabel>
                                        {draftSeqs.map(renderItem)}
                                      </SelectGroup>
                                    )}
                                  </>
                                );
                              })()}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {existingSequenceId && (() => {
                        const selectedSeq = availableSequences.find(s => s.id === existingSequenceId);
                        if (!selectedSeq) return null;
                        const emailSteps = selectedSeq.steps?.filter(s => s.type === 'email') || [];
                        return (
                          <div className="border rounded-lg p-3 bg-muted/30 space-y-1">
                            <p className="text-sm font-medium">{selectedSeq.name}</p>
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              <span>{emailSteps.length} email step{emailSteps.length !== 1 ? 's' : ''}</span>
                              <span>{selectedSeq.steps?.filter(s => s.type === 'delay').length || 0} delay{(selectedSeq.steps?.filter(s => s.type === 'delay').length || 0) !== 1 ? 's' : ''}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              New leads will be enrolled and their AI-generated content will be personalized at send time.
                            </p>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-1">
                    <div className="flex items-start gap-2 text-blue-700 dark:text-blue-300 text-sm">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">How it works</p>
                        <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                          Emails are generated per contact with AI, then enrolled into {sequenceMode === 'existing' ? 'the selected' : 'a new'} sequence.
                          Your {mailboxStats?.ready} ready mailbox{(mailboxStats?.ready ?? 0) !== 1 ? 'es' : ''} will handle
                          sending via SMTP with built-in rotation, tracking, and reply detection.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Connection Selection (external tools only) */}
          {selectedToolType && selectedToolType !== 'internal' && (
            <div className="space-y-3">
              <Label>Connection</Label>
              {connectionsLoading ? (
                <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading...</span>
                </div>
              ) : filteredConnections.length === 0 ? (
                <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">No {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} connections</p>
                      <p className="text-amber-600 dark:text-amber-400">Add a connection in Settings first.</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link to="/settings?tab=integrations">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Add Connection
                    </Link>
                  </Button>
                </div>
              ) : (
                <Select value={selectedConnectionId || ""} onValueChange={setSelectedConnectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a connection..." />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredConnections.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        <div className="flex items-center gap-2">
                          <span>{conn.name}</span>
                          {conn.status === 'active' ? (
                            <Badge variant="secondary" className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                              {conn.status}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Campaign Selection (external tools only) */}
          {selectedConnectionId && selectedToolType !== 'internal' && (
            <div className="space-y-3">
              <Label>Campaign</Label>
              {campaignsLoading ? (
                <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading campaigns...</span>
                </div>
              ) : campaigns && campaigns.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  No campaigns found. Create a campaign in {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} first.
                </div>
              ) : (
                <Select value={selectedCampaignId || ""} onValueChange={setSelectedCampaignId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a campaign..." />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns?.map((campaign) => (
                      <SelectItem key={campaign.id} value={String(campaign.id)}>
                        <div className="flex items-center gap-2">
                          <span>{campaign.name}</span>
                          {campaign.status && (
                            <Badge variant="outline" className="text-[10px]">
                              {campaign.status}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Custom fields info (external tools only) */}
          {selectedCampaignId && selectedToolType !== 'internal' && (
            <div className="border border-blue-200 dark:border-blue-800 border-l-4 border-l-blue-500 dark:border-l-blue-400 rounded-lg overflow-hidden">
              {/* Email custom fields */}
              <div className="p-4 bg-blue-50/80 dark:bg-blue-950/30">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                      Custom {selectedToolType === 'successai' ? 'Variables' : 'Fields'} Available
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                      Each contact's emails are stored as custom {selectedToolType === 'successai' ? 'variables' : 'fields'}. Use them in your{' '}
                      {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'}{' '}
                      templates:
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <code className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded font-mono">
                        {'{{email_1_subject}}'}
                      </code>
                      <code className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded font-mono">
                        {'{{email_1_body}}'}
                      </code>
                      <code className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded font-mono">
                        {'{{email_2_subject}}'}
                      </code>
                      <span className="text-xs text-blue-500 dark:text-blue-400 self-center">etc.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Ocean deliverable URL (only when Notion is enabled) */}
              {notionEnabled && (
                <div className="p-4 bg-amber-50/60 dark:bg-amber-950/20 border-t border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-2.5">
                    <BookOpen className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                        Ocean Deliverable URL
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                        Each contact's personalized Notion page link is also available as a custom {selectedToolType === 'successai' ? 'variable' : 'field'}:
                      </p>
                      <code className="inline-block text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 px-2 py-1 rounded font-mono font-semibold">
                        {'{{notion_preview_url}}'}
                      </code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => setStep('configure-generation')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            variant="cta"
            onClick={handleStartExecution}
            disabled={!canPush || startGenerationMutation.isPending}
          >
            {startGenerationMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                {selectedToolType === 'internal' && sequenceMode === 'new' && activationMode === 'draft'
                  ? `Generate & Create Draft (${generatableIds.length})`
                  : `Generate & Send ${generatableIds.length} Sequences`
                }
              </>
            )}
          </Button>
        </DialogFooter>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn(dialogMaxWidth, "max-h-[90vh] overflow-hidden flex flex-col")}>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
