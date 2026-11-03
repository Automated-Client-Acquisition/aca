import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sparkles, Loader2, Copy, Check, RefreshCw, Wand2, ChevronDown } from "lucide-react";
import {
  useGenerateCampaignMessage,
  type MessageType,
  type TonePreference,
  MESSAGE_CHARACTER_LIMITS,
} from "@/hooks/useGenerateCampaignMessage";
import { SAMPLE_ENRICHMENT_DATA, previewMessage, MESSAGE_VARIABLES, AI_MESSAGE_VARIABLES, SIGNAL_MESSAGE_VARIABLES, DELIVERABLE_MESSAGE_VARIABLES } from "@/lib/message-variables";
import { useLLMModels, DEFAULT_LLM_TEMPERATURE } from "@/lib/llm-models";
import { toast } from "sonner";

interface AIMessageGeneratorProps {
  messageType: MessageType;
  onGenerated: (message: string) => void;
  currentMessage?: string;
  userOffering?: string;
  campaignGoal?: string;
  /** Render as icon-only button for tight layouts */
  compact?: boolean;
}

const TONE_OPTIONS: { value: TonePreference; label: string; description: string }[] = [
  { value: "professional", label: "Professional", description: "Confident and direct, focused on value" },
  { value: "friendly", label: "Friendly", description: "Warm and approachable, personable" },
  { value: "casual", label: "Casual", description: "Relaxed and conversational" },
  { value: "formal", label: "Formal", description: "Business-like with proper salutations" },
];

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  connectionRequest: "Connection Request",
  message: "LinkedIn Message",
  inmail: "InMail",
  email: "Email",
  emailSequence: "Email Sequence",
};

export function AIMessageGenerator({
  messageType,
  onGenerated,
  currentMessage,
  userOffering,
  campaignGoal,
  compact = false,
}: AIMessageGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<TonePreference>("professional");
  const [customPrompt, setCustomPrompt] = useState("");
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [usedVariables, setUsedVariables] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(DEFAULT_LLM_TEMPERATURE);

  const generateMutation = useGenerateCampaignMessage();
  const { models: llmModels, isLoading: isLoadingModels } = useLLMModels();

  // Default to first available model once the list loads
  useEffect(() => {
    if (!model && llmModels.length > 0) {
      setModel(llmModels[0].id);
    }
  }, [llmModels, model]);

  const charLimit = MESSAGE_CHARACTER_LIMITS[messageType];

  const handleGenerate = async () => {
    setGeneratedMessage(null);

    try {
      const result = await generateMutation.mutateAsync({
        messageType,
        context: {
          userOffering,
          campaignGoal,
          tonePreference: tone,
        },
        existingMessage: currentMessage && currentMessage.length > 10 ? currentMessage : undefined,
        userPrompt: customPrompt || undefined,
        sampleEnrichment: SAMPLE_ENRICHMENT_DATA,
        model,
        temperature,
      });

      if (result.success && result.message) {
        setGeneratedMessage(result.message);
        setUsedVariables(result.usedVariables || []);
        toast.success("Message generated successfully");
      }
    } catch {
      // Error is handled in the hook
    }
  };

  const handleInsert = () => {
    if (generatedMessage) {
      onGenerated(generatedMessage);
      toast.success("Message inserted");
      setOpen(false);
      // Reset state after closing
      setTimeout(() => {
        setGeneratedMessage(null);
        setCustomPrompt("");
      }, 300);
    }
  };

  const handleCopy = async () => {
    if (generatedMessage) {
      await navigator.clipboard.writeText(generatedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      // Reset state when dialog closes
      setTimeout(() => {
        setGeneratedMessage(null);
        setCustomPrompt("");
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="outline" size="icon" className="h-7 w-7" title="Generate with AI">
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" />
            Generate with AI
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Message Generator
          </DialogTitle>
          <DialogDescription>
            Generate a personalized {MESSAGE_TYPE_LABELS[messageType].toLowerCase()} with AI.
            The message will use {"{{variables}}"} that get replaced per-contact.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Message Type Info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Message Type</span>
            <Badge variant="outline">{MESSAGE_TYPE_LABELS[messageType]}</Badge>
          </div>

          {/* Character Limit Info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Character Limit</span>
            <span className="font-mono text-xs">{charLimit} chars</span>
          </div>

          {/* Tone Selection */}
          <div className="space-y-2">
            <Label>Tone</Label>
            <Select value={tone} onValueChange={(v) => setTone(v as TonePreference)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {TONE_OPTIONS.find((o) => o.value === tone)?.description}
            </p>
          </div>

          {/* Custom Instructions */}
          <div className="space-y-2">
            <Label>Custom Instructions (Optional)</Label>
            <Textarea
              placeholder="e.g., Focus on their recent funding round, mention our case study with similar companies..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="min-h-[140px]"
            />
            <p className="text-xs text-muted-foreground">
              Add specific instructions to guide the AI. Click a variable to insert it.
            </p>
            <div className="flex flex-wrap gap-1">
              {[...MESSAGE_VARIABLES, ...AI_MESSAGE_VARIABLES, ...SIGNAL_MESSAGE_VARIABLES, ...DELIVERABLE_MESSAGE_VARIABLES].map((v) => (
                <Button
                  key={v.key}
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] px-1.5"
                  onClick={() => setCustomPrompt((prev) => prev + v.key)}
                >
                  {v.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Advanced Settings */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                Advanced Settings
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="text-xs">Model</Label>
                {llmModels.length > 0 ? (
                  <SearchableSelect
                    value={model}
                    onValueChange={setModel}
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Temperature</Label>
                  <span className="text-xs text-muted-foreground">
                    {temperature.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[temperature]}
                  onValueChange={([v]) => setTemperature(v)}
                  min={0}
                  max={1}
                  step={0.1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Lower = more consistent, Higher = more creative
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Generate Button */}
          {!generatedMessage && (
            <Button
              variant="cta"
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="w-full gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Message
                </>
              )}
            </Button>
          )}

          {/* Generated Result */}
          {generatedMessage && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label>Generated Message</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    className="h-7 gap-1"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending}
                    className="h-7 gap-1"
                  >
                    <RefreshCw className={`h-3 w-3 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                    Regenerate
                  </Button>
                </div>
              </div>

              {/* Raw message with variables */}
              <div className="p-3 bg-background rounded border font-mono text-sm whitespace-pre-wrap">
                {generatedMessage}
              </div>

              {/* Variables used */}
              {usedVariables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Variables:</span>
                  {usedVariables.map((v) => (
                    <Badge key={v} variant="secondary" className="text-xs font-mono">
                      {v}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Preview with sample data */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Preview with sample data:</span>
                </div>
                <div className="p-3 bg-background rounded border text-sm whitespace-pre-wrap text-muted-foreground">
                  {previewMessage(generatedMessage)}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="cta" onClick={handleInsert} className="gap-1.5">
                  <Check className="h-4 w-4" />
                  Insert Message
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
