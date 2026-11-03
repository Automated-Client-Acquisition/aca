import { useState, useMemo } from "react";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignSetupSlider as Slider } from "@/components/campaign-builder/CampaignSetupSlider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus, X, Sparkles, User, Send, ChevronDown, FlaskConical, Loader2, Info, FileText, Braces, Mail, ListPlus, Radar } from "lucide-react";
import {
  MESSAGE_VARIABLES,
  AI_MESSAGE_VARIABLES,
  SIGNAL_MESSAGE_VARIABLES,
  DELIVERABLE_MESSAGE_VARIABLES,
  GENERATED_EMAIL_VARIABLES,
  previewMessage,
  type MessageVariable,
} from "@/lib/message-variables";
import { useGenerateCampaignMessage, type MessageType } from "@/hooks/useGenerateCampaignMessage";
import { useLLMModels, DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  variations?: string[];
  onVariationsChange?: (variations: string[]) => void;
  llmModel?: string;
  onModelChange?: (model: string) => void;
  llmTemperature?: number;
  onTemperatureChange?: (temp: number) => void;
  messageType?: MessageType;
  placeholder?: string;
  label?: string;
  /** Number of emails for emailSequence mode (displayed in info banner) */
  emailCount?: number;
  /** Hide the built-in Test button. Set by callers that ship their own preview
   *  running the real generation path (Lead processing setup), because this
   *  one always returns a single sample message. */
  showTest?: boolean;
  /** Replaces the default info banner text. */
  infoText?: React.ReactNode;
}

export function PromptEditor({
  value,
  onChange,
  variations = [],
  onVariationsChange,
  llmModel,
  onModelChange,
  llmTemperature,
  onTemperatureChange,
  messageType = "message",
  placeholder = "Write a friendly LinkedIn message to {{first_name}} at {{company}}. Mention their focus on {{ai_company_niche}} and reference how we can help with {{ai_primary_need}}. Keep it concise and end with a question.",
  label = "AI Prompt",
  emailCount,
  showTest = true,
  infoText,
}: PromptEditorProps) {
  const [activeTab, setActiveTab] = useState("A");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);

  const { mutateAsync: generateMessage } = useGenerateCampaignMessage();
  const { models: llmModels, isLoading: isLoadingModels } = useLLMModels();

  const { data: customFieldDefs } = useCustomFieldDefs();

  // Group variables by category
  const variableGroups = useMemo(() => {
    const contactVars = MESSAGE_VARIABLES.filter(v => v.category === 'contact' || !v.category);
    const senderVars = MESSAGE_VARIABLES.filter(v => v.category === 'sender');
    const aiVars = AI_MESSAGE_VARIABLES;
    const customVars: MessageVariable[] = (customFieldDefs || []).map((f) => ({
      key: `{{custom_${f.field_key}}}`,
      label: f.display_name,
      field: `custom_${f.field_key}`,
      category: 'custom' as const,
      description: f.description || `Custom field: ${f.display_name}`,
    }));
    return { contact: contactVars, sender: senderVars, ai_analysis: aiVars, signal: SIGNAL_MESSAGE_VARIABLES, deliverable: DELIVERABLE_MESSAGE_VARIABLES, generated_email: GENERATED_EMAIL_VARIABLES, custom: customVars };
  }, [customFieldDefs]);

  // Org-level custom field placeholder defaults, for the sample-data test/preview
  const customFieldDefaults = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const def of customFieldDefs || []) {
      if (def.default_value) defaults[def.field_key] = def.default_value;
    }
    return defaults;
  }, [customFieldDefs]);

  // Insert variable at cursor position
  const insertVariable = (variableKey: string) => {
    if (activeTab === "A") {
      onChange(value + variableKey);
    } else {
      const idx = activeTab.charCodeAt(0) - 66; // B=0, C=1, D=2
      if (idx >= 0 && idx < variations.length) {
        updateVariation(idx, variations[idx] + variableKey);
      }
    }
    setVariablesOpen(false);
  };

  // Add variation
  const addVariation = () => {
    if (onVariationsChange && variations.length < 3) {
      onVariationsChange([...variations, ""]);
      setActiveTab(String.fromCharCode(66 + variations.length));
    }
  };

  // Remove variation
  const removeVariation = (index: number) => {
    if (onVariationsChange) {
      const newVariations = variations.filter((_, i) => i !== index);
      onVariationsChange(newVariations);
      if (activeTab !== "A") {
        setActiveTab("A");
      }
    }
  };

  // Update variation
  const updateVariation = (index: number, text: string) => {
    if (onVariationsChange) {
      const newVariations = [...variations];
      newVariations[index] = text;
      onVariationsChange(newVariations);
    }
  };

  // Test the prompt with sample data
  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await generateMessage({
        messageType,
        userPrompt: previewMessage(value, customFieldDefaults),
        context: { tonePreference: "professional" },
        model: llmModel || DEFAULT_LLM_MODEL,
        temperature: llmTemperature,
      });
      if (result.success) {
        setTestResult(result.message);
      } else {
        setTestResult(`Error: ${result.error || "Failed to generate"}`);
      }
    } catch {
      setTestResult("Error: Could not test prompt. Check your OpenRouter API key in Settings.");
    } finally {
      setIsTesting(false);
    }
  };

  const allPrompts = [
    { label: "A", value, isMain: true, index: undefined as number | undefined },
    ...variations.map((v, i) => ({
      label: String.fromCharCode(66 + i),
      value: v,
      isMain: false,
      index: i,
    })),
  ];

  return (
    <div className="space-y-3">
      {/* Model Selector — always visible */}
      <div className="space-y-2">
        <Label className="text-xs">Model</Label>
        {llmModels.length > 0 ? (
          <SearchableSelect
            value={llmModel || DEFAULT_LLM_MODEL}
            onValueChange={(v) => onModelChange?.(v)}
            options={llmModels}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {isLoadingModels ? "Loading models..." : "Add an OpenRouter API key in Settings to choose a model."}
          </p>
        )}
      </div>

      {/* Temperature — compact row */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Creativity</Label>
          <span className="text-xs text-muted-foreground">
            {(llmTemperature ?? 0.7).toFixed(1)}
          </span>
        </div>
        <Slider
          aria-label="AI creativity"
          value={[llmTemperature ?? 0.7]}
          onValueChange={([v]) => onTemperatureChange?.(v)}
          min={0}
          max={1}
          step={0.1}
          className="w-full"
        />
      </div>

      {/* Info Banner — slim */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/50 px-2.5 py-1.5 rounded-md">
        <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
        <span>
          {infoText ?? (messageType === "emailSequence"
            ? `AI generates a unique ${emailCount || 3}-email sequence per contact. Use {{variables}} for personalization.`
            : "Your prompt defines the goal and angle. For follow-up steps, AI also sees the conversation history so it won't repeat itself and can reference prior replies."
          )}
        </span>
      </div>

      {/* Prompt Editor with A/B Tabs */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1">
              {variations.length > 0 ? (
                <TabsList className="h-7">
                  {allPrompts.map((p) => (
                    <TabsTrigger key={p.label} value={p.label} className="h-6 px-2 text-xs gap-1">
                      {p.label}
                      {!p.isMain && p.index !== undefined && (
                        <button
                          type="button"
                          tabIndex={0}
                          aria-label={`Remove variation ${p.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeVariation(p.index!);
                          }}
                          className="hover:text-destructive focus-visible:outline-none rounded-sm"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              ) : (
                <p className="text-xs font-medium">{label}</p>
              )}
              {onVariationsChange && allPrompts.length < 4 && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={addVariation}
                        aria-label="Add message variation"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">Add A/B variation</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {variations.length > 0 ? (
            allPrompts.map((p) => (
              <TabsContent key={p.label} value={p.label} className="mt-0">
                <ExpandableTextarea
                  expandTitle={label}
                  aria-label={`${label} · Variant ${p.label}`}
                  value={p.isMain ? value : p.value}
                  onChange={(e) =>
                    p.isMain
                      ? onChange(e.target.value)
                      : updateVariation(p.index!, e.target.value)
                  }
                  placeholder={placeholder}
                  rows={6}
                  className="font-mono text-xs"
                />
              </TabsContent>
            ))
          ) : (
            <ExpandableTextarea
              expandTitle={label}
              aria-label={label}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              rows={6}
              className="font-mono text-xs"
            />
          )}
        </Tabs>
      </div>

      {/* Action Row: Insert Variable + Test */}
      <div className="flex items-center gap-2">
        <Popover open={variablesOpen} onOpenChange={setVariablesOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <Braces className="h-3 w-3" />
              Insert Variable
              <ChevronDown className="h-2.5 w-2.5 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 p-0 max-h-80 overflow-y-auto"
            side="bottom"
            align="start"
          >
            <div className="p-2 space-y-2">
              <VariablePopoverGroup
                title="Contact Info"
                icon={<User className="h-3 w-3 text-blue-500" />}
                variables={variableGroups.contact}
                onInsert={insertVariable}
              />
              <VariablePopoverGroup
                title="AI Analysis"
                icon={<Sparkles className="h-3 w-3 text-primary" />}
                variables={variableGroups.ai_analysis}
                onInsert={insertVariable}
                badge="Enrichment"
              />
              <VariablePopoverGroup
                title="Buying Signals"
                icon={<Radar className="h-3 w-3 text-cyan-500" />}
                variables={variableGroups.signal}
                onInsert={insertVariable}
                badge="Signal"
              />
              <VariablePopoverGroup
                title="Sender"
                icon={<Send className="h-3 w-3 text-green-500" />}
                variables={variableGroups.sender}
                onInsert={insertVariable}
              />
              <VariablePopoverGroup
                title="Deliverables"
                icon={<FileText className="h-3 w-3 text-neutral-600" />}
                variables={variableGroups.deliverable}
                onInsert={insertVariable}
                badge="Notion"
              />
              <VariablePopoverGroup
                title="Generated Emails"
                icon={<Mail className="h-3 w-3 text-emerald-500" />}
                variables={variableGroups.generated_email}
                onInsert={insertVariable}
                badge="AI Generated"
              />
              <VariablePopoverGroup
                title="Custom Fields"
                icon={<ListPlus className="h-3 w-3 text-amber-600" />}
                variables={variableGroups.custom}
                onInsert={insertVariable}
              />
            </div>
          </PopoverContent>
        </Popover>

        {showTest && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleTest}
            disabled={!value || isTesting}
          >
            {isTesting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FlaskConical className="h-3 w-3" />
            )}
            Test
          </Button>
        )}
      </div>

      {/* Test Result */}
      {testResult && (
        <div className="p-2.5 bg-muted rounded-md text-xs space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium">
            Sample AI output:
          </p>
          <p className="whitespace-pre-wrap">{previewMessage(testResult, customFieldDefaults)}</p>
        </div>
      )}
    </div>
  );
}

// Variable group inside the popover
interface VariablePopoverGroupProps {
  title: string;
  icon?: React.ReactNode;
  variables: MessageVariable[];
  onInsert: (key: string) => void;
  badge?: string;
}

function VariablePopoverGroup({ title, icon, variables, onInsert, badge }: VariablePopoverGroupProps) {
  if (variables.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-1 py-1">
        {icon}
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        {badge && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal">
            {badge}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1 px-1">
        {variables.map((variable) => (
          <button
            key={variable.key}
            type="button"
            onClick={() => onInsert(variable.key)}
            className="inline-flex items-center h-6 px-1.5 text-[11px] rounded border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
            title={variable.description}
          >
            {variable.label}
          </button>
        ))}
      </div>
    </div>
  );
}
