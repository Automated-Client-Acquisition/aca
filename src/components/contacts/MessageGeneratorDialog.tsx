import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Mail,
  Linkedin,
  Target,
  AlertCircle,
} from "lucide-react";
import {
  useGenerateCampaignMessage,
  type MessageType,
  type TonePreference,
  MESSAGE_CHARACTER_LIMITS,
} from "@/hooks/useGenerateCampaignMessage";
import {
  parseMessage,
  type Contact,
  type EnrichmentData,
} from "@/lib/message-variables";
import { toast } from "sonner";
import type { CrmContact } from "@/hooks/crm/useContacts";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";

interface MessageGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageType: "email" | "inmail";
  contact: CrmContact;
}

const TONE_OPTIONS: { value: TonePreference; label: string; description: string }[] = [
  { value: "professional", label: "Professional", description: "Confident and direct, focused on value" },
  { value: "friendly", label: "Friendly", description: "Warm and approachable, personable" },
  { value: "casual", label: "Casual", description: "Relaxed and conversational" },
  { value: "formal", label: "Formal", description: "Business-like with proper salutations" },
];

export function MessageGeneratorDialog({
  open,
  onOpenChange,
  messageType,
  contact,
}: MessageGeneratorDialogProps) {
  const [tone, setTone] = useState<TonePreference>("professional");
  const [customPrompt, setCustomPrompt] = useState("");
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateMutation = useGenerateCampaignMessage();

  const enrichmentData = contact.enrichment_data as EnrichmentData | null;
  const charLimit = MESSAGE_CHARACTER_LIMITS[messageType];
  const firstName = contact.first_name || contact.display_name?.split(" ")[0] || "Contact";

  // Convert CrmContact to Contact format for parseMessage
  const contactForParsing: Contact = {
    first_name: contact.first_name,
    last_name: contact.last_name,
    full_name: contact.display_name,
    job_title: contact.job_title,
    company: contact.company,
    location: contact.city
      ? `${contact.city}${contact.state ? `, ${contact.state}` : ""}${contact.country ? `, ${contact.country}` : ""}`
      : null,
    industry: (contact.custom_fields as Record<string, unknown>)?.industry as string || null,
    enrichment_data: enrichmentData,
    custom_fields: contact.custom_fields as Record<string, unknown> | null,
  };

  const { data: customFieldDefs } = useCustomFieldDefs();
  const customFieldDefaults: Record<string, string> = {};
  for (const def of customFieldDefs || []) {
    if (def.default_value) customFieldDefaults[def.field_key] = def.default_value;
  }

  const handleGenerate = async () => {
    setGeneratedMessage(null);

    try {
      // Build context from contact's enrichment data
      const context = {
        userOffering: enrichmentData?.company_offering || undefined,
        campaignGoal: `Reach out to ${contact.display_name}${contact.company ? ` at ${contact.company}` : ""} about ${enrichmentData?.primary_need || "their business needs"}`,
        tonePreference: tone,
      };

      const result = await generateMutation.mutateAsync({
        messageType,
        context,
        existingMessage: undefined,
        userPrompt: customPrompt || undefined,
        // Pass enrichment as sample so AI knows what data is available
        sampleEnrichment: enrichmentData || undefined,
      });

      if (result.success && result.message) {
        // Replace variables with actual contact data
        const personalizedMessage = parseMessage(result.message, contactForParsing, undefined, customFieldDefaults);
        setGeneratedMessage(personalizedMessage);
        toast.success("Message generated successfully");
      }
    } catch {
      // Error is handled in the hook
    }
  };

  const handleCopy = async () => {
    if (generatedMessage) {
      await navigator.clipboard.writeText(generatedMessage);
      setCopied(true);
      toast.success("Message copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      // Reset state when dialog closes
      setTimeout(() => {
        setGeneratedMessage(null);
        setCustomPrompt("");
      }, 300);
    }
  };

  const hasEnrichment = !!enrichmentData?.primary_need;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {messageType === "email" ? (
              <Mail className="h-5 w-5 text-blue-600" />
            ) : (
              <Linkedin className="h-5 w-5 text-[#0A66C2]" />
            )}
            Generate {messageType === "email" ? "Email" : "InMail"} for {firstName}
          </DialogTitle>
          <DialogDescription>
            AI will generate a personalized message ready to send to {contact.display_name}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Contact Context Preview */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Contact Context
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>{" "}
                <span className="font-medium">{contact.display_name}</span>
              </div>
              {contact.company && (
                <div>
                  <span className="text-muted-foreground">Company:</span>{" "}
                  <span className="font-medium">{contact.company}</span>
                </div>
              )}
              {contact.job_title && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Role:</span>{" "}
                  <span className="font-medium">{contact.job_title}</span>
                </div>
              )}
            </div>
          </div>

          {/* Primary Need (if enriched) */}
          {hasEnrichment ? (
            <div className="bg-gradient-to-r from-primary/5 to-blue-50 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-primary mb-1">
                    Their Primary Need
                  </p>
                  <p className="text-sm text-foreground">{enrichmentData?.primary_need}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-status-warning mt-0.5" />
                <div>
                  <p className="text-sm text-status-warning">
                    No AI analysis available for this contact. The message will still be generated
                    but may be less personalized.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Message Type Info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Character Limit</span>
            <Badge variant="outline">{charLimit.toLocaleString()} chars</Badge>
          </div>

          {/* Tone Selection */}
          <div className="space-y-2">
            <Label>Tone</Label>
            <Select value={tone} onValueChange={(v) => setTone(v as TonePreference)}>
              <SelectTrigger>
                <SelectValue>
                  {TONE_OPTIONS.find((o) => o.value === tone)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TONE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col items-start">
                      <span>{option.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom Instructions */}
          <div className="space-y-2">
            <Label>Custom Instructions (Optional)</Label>
            <Textarea
              placeholder="e.g., Focus on their recent funding round, mention our case study with similar companies..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="min-h-[80px] resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Add specific instructions to guide the AI
            </p>
          </div>

          {/* Generate Button */}
          {!generatedMessage && (
            <Button
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
                  Generate Personalized Message
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
                    <RefreshCw
                      className={`h-3 w-3 ${generateMutation.isPending ? "animate-spin" : ""}`}
                    />
                    Regenerate
                  </Button>
                </div>
              </div>

              {/* Personalized message */}
              <div className="p-3 bg-background rounded border text-sm whitespace-pre-wrap">
                {generatedMessage}
              </div>

              {/* Character count */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {generatedMessage.length.toLocaleString()} / {charLimit.toLocaleString()} characters
                </span>
                {generatedMessage.length > charLimit && (
                  <Badge variant="destructive" className="text-xs">
                    Over limit
                  </Badge>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button variant="cta" onClick={handleCopy} className="gap-1.5">
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy to Clipboard
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
