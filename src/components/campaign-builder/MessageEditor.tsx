import { useState, useMemo } from "react";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Plus, X, Eye, Sparkles, User, Send, FileText, Braces, ChevronDown, Mail, Shuffle, ListPlus, Radar } from "lucide-react";
import {
  MESSAGE_VARIABLES,
  AI_MESSAGE_VARIABLES,
  SIGNAL_MESSAGE_VARIABLES,
  DELIVERABLE_MESSAGE_VARIABLES,
  GENERATED_EMAIL_VARIABLES,
  previewMessage,
  estimateMessageLength,
  CHARACTER_LIMITS,
  hasAIVariables,
  hasSpintax,
  type MessageVariable,
} from "@/lib/message-variables";
import { AIMessageGenerator } from "./AIMessageGenerator";
import type { MessageType } from "@/hooks/useGenerateCampaignMessage";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import { CampaignMessagePreview, useCampaignMessagePreview } from "@/components/campaign-builder/CampaignMessagePreview";

interface MessageEditorProps {
  value: string;
  onChange: (value: string) => void;
  variations?: string[];
  onVariationsChange?: (variations: string[]) => void;
  maxLength?: number;
  placeholder?: string;
  label?: string;
  showVariables?: boolean;
  showABTesting?: boolean;
  /** Message type for AI generation (connectionRequest, message, inmail, email) */
  messageType?: MessageType;
  /** User's offering/value prop for AI context */
  userOffering?: string;
  /** Campaign goal for AI context */
  campaignGoal?: string;
}

export function MessageEditor({
  value,
  onChange,
  variations = [],
  onVariationsChange,
  maxLength = CHARACTER_LIMITS.message,
  placeholder = "Type your message... use {{first_name}} for variables and {a|b|c} for spintax.",
  label = "Message",
  showVariables = true,
  showABTesting = true,
  messageType = "message",
  userOffering,
  campaignGoal,
}: MessageEditorProps) {
  const [activeTab, setActiveTab] = useState("A");
  const [showPreview, setShowPreview] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [spintaxOpen, setSpintaxOpen] = useState(false);

  const estimate = estimateMessageLength(value);
  const usesAIVariables = useMemo(() => hasAIVariables(value), [value]);
  const usesSpintax = useMemo(() => hasSpintax(value), [value]);

  const { data: customFieldDefs } = useCustomFieldDefs();
  const campaignPreview = useCampaignMessagePreview();
  // Preview the tab being edited (A = main message, B+ = variations)
  const previewTemplate =
    activeTab === "A" ? value : variations[activeTab.charCodeAt(0) - 66] ?? value;

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

  // Org-level custom field placeholder defaults, for the sample-data Preview toggle
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
      const idx = activeTab.charCodeAt(0) - 66;
      if (idx >= 0 && idx < variations.length) {
        updateVariation(idx, variations[idx] + variableKey);
      }
    }
    setVariablesOpen(false);
  };

  // Insert a spintax skeleton at the end of the active message
  const insertSpintax = (snippet: string = "{option 1|option 2|option 3}") => {
    if (activeTab === "A") {
      onChange(value + snippet);
    } else {
      const idx = activeTab.charCodeAt(0) - 66;
      if (idx >= 0 && idx < variations.length) {
        updateVariation(idx, variations[idx] + snippet);
      }
    }
    setSpintaxOpen(false);
  };

  const SPINTAX_PRESETS: { label: string; snippet: string }[] = [
    { label: "Greeting", snippet: "{Hi|Hey|Hello}" },
    { label: "Opener", snippet: "{hope you're well|long time no chat|just catching up}" },
    { label: "Ask", snippet: "{open to a quick chat|free for 15 min next week|worth a brief call}" },
    { label: "Sign-off", snippet: "{Thanks|Cheers|Best}" },
    { label: "Custom", snippet: "{option 1|option 2|option 3}" },
  ];

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

  const allMessages = [
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
      {/* Editor with A/B Tabs */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1">
              {showABTesting && variations.length > 0 ? (
                <TabsList className="h-7">
                  {allMessages.map((msg) => (
                    <TabsTrigger key={msg.label} value={msg.label} className="h-6 px-2 text-xs gap-1">
                      {msg.label}
                      {!msg.isMain && msg.index !== undefined && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove variation ${msg.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            removeVariation(msg.index!);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              e.preventDefault();
                              removeVariation(msg.index!);
                            }
                          }}
                          className="hover:text-destructive focus-visible:outline-none rounded-sm cursor-pointer"
                        >
                          <X className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              ) : (
                <p className="text-xs font-medium">{label}</p>
              )}
              {showABTesting && onVariationsChange && allMessages.length < 4 && (
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

            <AIMessageGenerator
              messageType={messageType}
              onGenerated={onChange}
              currentMessage={value}
              userOffering={userOffering}
              campaignGoal={campaignGoal}
              compact
            />
          </div>

          {showABTesting && variations.length > 0 ? (
            allMessages.map((msg) => (
              <TabsContent key={msg.label} value={msg.label} className="mt-0">
                <ExpandableTextarea
                  expandTitle={label}
                  aria-label={`${label} · Variant ${msg.label}`}
                  value={msg.isMain ? value : msg.value}
                  onChange={(e) =>
                    msg.isMain
                      ? onChange(e.target.value)
                      : updateVariation(msg.index!, e.target.value)
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

      {/* Action Row: Insert Variable + Preview */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {showVariables && (
            <Popover open={variablesOpen} onOpenChange={setVariablesOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <Braces className="h-3 w-3" />
                  Variables
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
          )}

          <Popover open={spintaxOpen} onOpenChange={setSpintaxOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <Shuffle className="h-3 w-3" />
                Spintax
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3 space-y-3" side="bottom" align="start">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Shuffle className="h-3 w-3 text-primary" />
                  <span className="text-xs font-medium">Spintax — message variation</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Wrap options in <code className="text-[10px] bg-muted px-1 rounded">{"{a|b|c}"}</code>{" "}
                  and each send picks one at random. Great for avoiding spam filters and keeping
                  outreach feeling human.
                </p>
              </div>

              <div className="bg-muted/60 rounded-md p-2 space-y-1">
                <p className="text-[10px] text-muted-foreground font-medium">Example</p>
                <p className="text-[11px] font-mono leading-snug">
                  {"{Hi|Hey} {{first_name}}, {hope you're well|long time}."}
                </p>
                <p className="text-[10px] text-muted-foreground">→ sends one of 4 combinations.</p>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground font-medium px-0.5">
                  Insert a preset
                </p>
                <div className="flex flex-wrap gap-1">
                  {SPINTAX_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => insertSpintax(preset.snippet)}
                      className="inline-flex items-center h-6 px-1.5 text-[11px] rounded border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
                      title={preset.snippet}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="h-3 w-3" />
            Preview
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] ${
              estimate.max > maxLength ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            ~{estimate.min}-{estimate.max}/{maxLength}
          </span>
          {estimate.max > maxLength && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
              Too long
            </Badge>
          )}
        </div>
      </div>

      {/* AI Variables Warning */}
      {usesAIVariables && (
        <div className="flex items-center gap-2 text-xs text-status-warning bg-status-warning/10 px-3 py-2 rounded-md">
          <Sparkles className="h-3 w-3 flex-shrink-0" />
          <span>Uses AI analysis data — contacts need enrichment</span>
        </div>
      )}

      {/* Spintax Detected Hint */}
      {usesSpintax && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/60 px-3 py-2 rounded-md">
          <Shuffle className="h-3 w-3 flex-shrink-0" />
          <span>Spintax detected — each send picks one variant. Click Preview to sample.</span>
        </div>
      )}

      {/* Preview */}
      {showPreview && value && (
        <div className="p-2.5 bg-muted rounded-md text-xs space-y-1">
          {campaignPreview ? (
            <>
              <p className="text-[10px] text-muted-foreground font-medium">Preview as a lead from this campaign:</p>
              <CampaignMessagePreview template={previewTemplate} customFieldDefaults={customFieldDefaults} />
            </>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground font-medium">Preview with sample data:</p>
              <p className="whitespace-pre-wrap">{previewMessage(previewTemplate, customFieldDefaults)}</p>
            </>
          )}
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
