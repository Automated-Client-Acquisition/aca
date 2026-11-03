import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TEMPLATE_FIELDS, templateSlots, useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampaignSetupSlider as Slider } from "@/components/campaign-builder/CampaignSetupSlider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, ArrowLeft, Trash2, Settings, AlertCircle, Sparkles, PenLine, Plus, Brain, Package, Search, Info, CornerDownLeft, MailCheck, Target, ListPlus, ChevronUp, ChevronDown, Split } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { MessageEditor } from "@/components/campaign-builder/MessageEditor";
import { PromptEditor } from "@/components/campaign-builder/PromptEditor";
import { CHARACTER_LIMITS } from "@/lib/message-variables";
import type { ChannelType, MessageMode } from "@/lib/sequence-utils";
import {
  NODE_TYPE_CONFIGS,
  type SequenceNode,
  type SequenceNodeType,
  // LinkedIn
  type ConnectionRequestNodeData,
  type MessageNodeData,
  type InMailNodeData,
  type DelayNodeData,
  type LikePostNodeData,
  type WarmupEngagementNodeData,
  type WarmupReactionType,
  // Control
  type SwitchChannelNodeData,
  type ConditionChannelAvailableNodeData,
  type RouteByChannelNodeData,
  type RouteChannel,
  type ContactCheck,
  CONTACT_CHECK_OPTIONS,
  ROUTE_CHANNEL_OPTIONS,
  SENDER_CHECK_CHANNELS,
  resolveContactCheck,
  routeChannels,
  type ConditionReplyReceivedNodeData,
  type ConditionIntentNodeData,
  type HandoffToAgentNodeData,
  // Multi-channel
  type WhatsAppMessageNodeData,
  type InstagramDmNodeData,
  type InstagramLikePostNodeData,
  type TelegramMessageNodeData,
  type SmsMessageNodeData,
  type WhatsAppTemplateNodeData,
  type ScheduleMeetingNodeData,
  // Email Tool Handoffs
  type SendToEmailToolNodeData,
  // Email (direct SMTP)
  type EmailNodeData,
  // Enrichment
  type FindEmailNodeData,
  type EnrichmentProviderType,
  type AnalyzeContactNodeData,
  type GenerateEmailsNodeData,
  type VerifyEmailNodeData,
  type VerifyEmailProvider,
  type ConditionIcpScoreNodeData,
  // Routing
  type AddToListNodeData,
  // Notion
  type CreateNotionPageNodeData,
  // Control - Go To
  type GoToNodeData,
} from "@/lib/sequence-utils";
import { useToolConnections, useToolCampaigns, useNotionDatabases } from "@/hooks/useToolConnections";
import { useEnrichmentProviders } from "@/hooks/useEnrichmentSettings";
import { useLLMModels, DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import { useEmailMailboxes, useEmailMailboxStats } from "@/hooks/useEmailMailboxes";
import { MailboxPickerButton } from "@/components/email/picker/MailboxPickerButton";
import { useEmailSequences } from "@/hooks/useEmailSequences";
import { useProducts } from "@/hooks/useProducts";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useLeadLists } from "@/hooks/useLeadLists";
import { NOTION_BLUEPRINTS } from "@/lib/email-sequence-constants";
import { Link } from "react-router-dom";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { entryRuleSummary, type CampaignEntryRule } from "@/lib/campaign-entry";

interface NodeConfigPanelProps {
  node: SequenceNode;
  allNodes?: SequenceNode[];
  onUpdate: (data: Partial<SequenceNode["data"]>) => void;
  onDelete: () => void;
  onClose: () => void;
  entryTriggers?: CampaignEntryRule[];
  onOpenTriggers?: () => void;
}

export function NodeConfigPanel({
  node,
  allNodes,
  onUpdate,
  onDelete,
  onClose,
  entryTriggers = [],
  onOpenTriggers,
}: NodeConfigPanelProps) {
  const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
  const canDelete = node.type !== "start";
  const customLabel = node.data?.customLabel || (node.data?.label !== config?.label ? node.data?.label : undefined);

  // Some nodes have a dynamic label that depends on their config (e.g. the
  // ICP/DM score gate switches between "If ICP Score" and "If DM Score").
  const baseLabel =
    node.type === "conditionIcpScore"
      ? `If ${(node.data as ConditionIcpScoreNodeData).scoreType === "dm" ? "DM" : "ICP"} Score`
      : config?.label || "Custom step";

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(customLabel || "");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync local state when node changes
  useEffect(() => {
    setNameValue(customLabel || "");
    setIsEditingName(false);
  }, [node.id, customLabel]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const commitName = () => {
    const trimmed = nameValue.trim();
    onUpdate({ customLabel: trimmed || undefined });
    setIsEditingName(false);
  };

  return (
    <section aria-label={`${customLabel || baseLabel} settings`} className="absolute inset-0 z-20 flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-card lg:static lg:w-[360px] lg:shrink-0 lg:border-l xl:w-[380px]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 shrink-0 lg:hidden" aria-label="Back to sequence">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          {isEditingName ? (
            <Input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setNameValue(customLabel || "");
                  setIsEditingName(false);
                }
              }}
              placeholder={baseLabel}
              aria-label="Step name"
              className="h-7 text-sm font-medium"
            />
          ) : (
            <button type="button" aria-label={`Rename ${customLabel || baseLabel}`} className="group flex min-h-[28px] max-w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setIsEditingName(true)}>
              <span className="truncate text-sm font-semibold">{customLabel || baseLabel}</span>
              <PenLine className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          )}
          {customLabel && customLabel.trim().toLowerCase() !== baseLabel.trim().toLowerCase() && !isEditingName && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{baseLabel}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 shrink-0" aria-label="Close step settings">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{config?.description || "Review this step before running your campaign."}</p>

        {/* Node-specific configuration */}
        {node.type === "start" && onOpenTriggers && <div className="space-y-3"><p className="text-sm font-medium">Campaign entry</p>{entryTriggers.length ? <div className="divide-y rounded-lg border">{entryTriggers.map(rule => <div key={rule.id} className="p-3"><p className="text-sm font-medium">{rule.name}</p><p className="mt-1 text-xs text-muted-foreground">{rule.enabled ? entryRuleSummary(rule) : "Paused"}</p></div>)}</div> : <p className="text-xs leading-relaxed text-muted-foreground">This campaign starts from its audience lists and lead-processing routes. Add a trigger to start from an incoming invitation, message, comment, keyword or signal.</p>}<Button variant="outline" className="w-full" onClick={onOpenTriggers}>Configure entry triggers</Button></div>}
        {node.type === "connectionRequest" && (
          <ConnectionRequestConfig
            data={node.data as ConnectionRequestNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "message" && (
          <MessageConfig
            data={node.data as MessageNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "inmail" && (
          <InMailConfig
            data={node.data as InMailNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "email" && (
          <EmailConfig
            data={node.data as EmailNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "delay" && (
          <DelayConfig
            data={node.data as DelayNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "likePost" && (
          <LikePostConfig
            data={node.data as LikePostNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "warmupEngagement" && (
          <WarmupEngagementConfig
            data={node.data as WarmupEngagementNodeData}
            onUpdate={onUpdate}
          />
        )}

        {/* Control nodes */}
        {node.type === "switchChannel" && (
          <SwitchChannelConfig
            data={node.data as SwitchChannelNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "conditionChannelAvailable" && (
          <ConditionChannelAvailableConfig
            data={node.data as ConditionChannelAvailableNodeData}
            onUpdate={onUpdate}
            entryTriggers={entryTriggers}
            onOpenTriggers={onOpenTriggers}
          />
        )}

        {node.type === "routeByChannel" && (
          <RouteByChannelConfig
            data={node.data as RouteByChannelNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "conditionReplyReceived" && (
          <ConditionReplyReceivedConfig
            data={node.data as ConditionReplyReceivedNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "conditionIntent" && (
          <ConditionIntentConfig
            data={node.data as ConditionIntentNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "handoffToAgent" && (
          <HandoffToAgentConfig
            data={node.data as HandoffToAgentNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "conditionConnection" && (
          <ConditionConnectionConfig
            data={node.data as { withinDays?: number }}
            onUpdate={onUpdate}
          />
        )}

        {(node.type === "conditionEmailOpened" || node.type === "conditionEmailClicked") && (
          <ConditionEmailConfig
            data={node.data as { withinDays?: number }}
            onUpdate={onUpdate}
            type={node.type as "conditionEmailOpened" | "conditionEmailClicked"}
          />
        )}

        {node.type === "goTo" && (
          <GoToConfig
            data={node.data as GoToNodeData}
            onUpdate={onUpdate}
            allNodes={allNodes || []}
            currentNodeId={node.id}
          />
        )}

        {/* Multi-channel nodes */}
        {node.type === "whatsappMessage" && (
          <WhatsAppMessageConfig
            data={node.data as WhatsAppMessageNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "instagramDm" && (
          <InstagramDmConfig
            data={node.data as InstagramDmNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "telegramMessage" && (
          <TelegramMessageConfig
            data={node.data as TelegramMessageNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "smsMessage" && (
          <SmsMessageConfig
            data={node.data as SmsMessageNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "whatsappTemplate" && (
          <WhatsAppTemplateConfig
            data={node.data as WhatsAppTemplateNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "instagramLikePost" && (
          <InstagramLikePostConfig
            data={node.data as InstagramLikePostNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "scheduleMeeting" && (
          <ScheduleMeetingConfig
            data={node.data as ScheduleMeetingNodeData}
            onUpdate={onUpdate}
          />
        )}

        {/* Email Tool Handoff nodes */}
        {node.type === "sendToSmartlead" && (
          <SendToEmailToolConfig
            data={node.data as SendToEmailToolNodeData}
            onUpdate={onUpdate}
            toolType="smartlead"
          />
        )}

        {node.type === "sendToInstantly" && (
          <SendToEmailToolConfig
            data={node.data as SendToEmailToolNodeData}
            onUpdate={onUpdate}
            toolType="instantly"
          />
        )}

        {node.type === "sendToLeadConnector" && (
          <SendToLeadConnectorConfig
            data={node.data as SendToEmailToolNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "sendToZapMail" && (
          <SendToZapMailConfig
            key={node.id}
            data={node.data as SendToEmailToolNodeData}
            onUpdate={onUpdate}
          />
        )}

        {/* Enrichment nodes */}
        {node.type === "findEmail" && (
          <FindEmailConfig
            data={node.data as FindEmailNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "analyzeContact" && (
          <AnalyzeContactConfig
            data={node.data as AnalyzeContactNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "generateEmails" && (
          <GenerateEmailsConfig
            data={node.data as GenerateEmailsNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "verifyEmail" && (
          <VerifyEmailConfig
            data={node.data as VerifyEmailNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "conditionIcpScore" && (
          <ConditionIcpScoreConfig
            data={node.data as ConditionIcpScoreNodeData}
            onUpdate={onUpdate}
          />
        )}

        {node.type === "addToList" && (
          <AddToListConfig
            data={node.data as AddToListNodeData}
            onUpdate={onUpdate}
          />
        )}

        {/* Notion nodes */}
        {node.type === "createNotionPage" && (
          <CreateNotionPageConfig
            data={node.data as CreateNotionPageNodeData}
            onUpdate={onUpdate}
          />
        )}

        {/* Non-critical action nodes — show continue-on-failure toggle */}
        {(node.type === "viewProfile" ||
          node.type === "follow" ||
          node.type === "instagramFollow") && (
          <ContinueOnFailureToggle
            checked={node.data.continueOnFailure !== false}
            onCheckedChange={(checked) => onUpdate({ continueOnFailure: checked })}
          />
        )}

        {/* Nodes with no additional config */}
        {(node.type === "whatsappCheckNumber" ||
          node.type === "conditionOpenProfile" ||
          node.type === "conditionEnriched" ||
          node.type === "conditionAnalyzed" ||
          node.type === "end") && (
          <p className="text-sm text-muted-foreground">
            No additional configuration needed for this action.
          </p>
        )}
      </div>

      {/* Footer */}
      {canDelete && (
        <div className="flex shrink-0 items-center justify-end border-t bg-card px-4 py-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                className="h-9 bg-transparent px-3 text-destructive shadow-none hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete step
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this step?</AlertDialogTitle>
                <AlertDialogDescription>
                  "{customLabel || baseLabel}" and its connections will be removed
                  from the sequence.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </section>
  );
}

// Reusable message mode toggle
function MessageModeToggle({
  mode,
  onChange,
}: {
  mode: MessageMode | undefined;
  onChange: (mode: MessageMode) => void;
}) {
  const isManual = !mode || mode === "manual";

  return (
    <div className="space-y-2 pb-3 border-b">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Mode</Label>
        <Tabs
          value={mode || "manual"}
          onValueChange={(v) => onChange(v as MessageMode)}
        >
          <TabsList className="h-8">
            <TabsTrigger value="manual" className="text-xs gap-1 px-3">
              <PenLine className="h-3 w-3" />
              Manual
            </TabsTrigger>
            <TabsTrigger value="prompt" className="text-xs gap-1 px-3">
              <Sparkles className="h-3 w-3" />
              AI Prompt
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {isManual && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span>Manual messages are sent as-is. Switch to <strong>AI Prompt</strong> for follow-ups that adapt to the conversation.</span>
        </p>
      )}
    </div>
  );
}

// Connection Request Configuration
function ContinueOnFailureToggle({
  checked,
  onCheckedChange,
  description = "Proceed to next step even if this action fails",
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Label htmlFor="continue-on-failure" className="text-sm font-medium">
          Continue on failure
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id="continue-on-failure"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function ConnectionRequestConfig({
  data,
  onUpdate,
}: {
  data: ConnectionRequestNodeData;
  onUpdate: (data: Partial<ConnectionRequestNodeData>) => void;
}) {
  const isPrompt = data.messageMode === "prompt";

  return (
    <div className="space-y-4">
      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md text-sm text-blue-700 dark:text-blue-300">
        LinkedIn limits personalized connection request notes to 5-10 per month
        for non-premium accounts. Requests without notes are unlimited.
      </div>

      {isPrompt ? (
        <PromptEditor
          value={data.prompt || ""}
          onChange={(prompt) => onUpdate({ prompt })}
          variations={data.promptVariations || []}
          onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
          llmModel={data.llmModel}
          onModelChange={(llmModel) => onUpdate({ llmModel })}
          llmTemperature={data.llmTemperature}
          onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
          messageType="connectionRequest"
          placeholder="Write a short LinkedIn connection request to {{first_name}} at {{company}}. They work in {{ai_company_niche}}. Keep under 300 characters."
        />
      ) : (
        <MessageEditor
          value={data.message || ""}
          onChange={(message) => onUpdate({ message })}
          variations={data.messageVariations || []}
          onVariationsChange={(messageVariations) => onUpdate({ messageVariations })}
          maxLength={CHARACTER_LIMITS.connectionRequest}
          placeholder="Hi {{first_name}}, I noticed you work at {{company}}..."
          label="Connection Note (Optional)"
          messageType="connectionRequest"
        />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Withdraw after (days)</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.withdrawAfterDays || 14}</Badge>
        </div>
        <Slider aria-label="Withdraw after (days)"
          value={[data.withdrawAfterDays || 14]}
          onValueChange={([value]) => onUpdate({ withdrawAfterDays: value })}
          min={7}
          max={30}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Automatically withdraw pending requests after this many days
        </p>
      </div>
    </div>
  );
}

// Message Configuration
function MessageConfig({
  data,
  onUpdate,
}: {
  data: MessageNodeData;
  onUpdate: (data: Partial<MessageNodeData>) => void;
}) {
  const isPrompt = data.messageMode === "prompt";

  return (
    <div className="space-y-4">
      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      {isPrompt ? (
        <PromptEditor
          value={data.prompt || ""}
          onChange={(prompt) => onUpdate({ prompt })}
          variations={data.promptVariations || []}
          onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
          llmModel={data.llmModel}
          onModelChange={(llmModel) => onUpdate({ llmModel })}
          llmTemperature={data.llmTemperature}
          onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
          messageType="message"
        />
      ) : (
        <MessageEditor
          value={data.message || ""}
          onChange={(message) => onUpdate({ message })}
          variations={data.messageVariations || []}
          onVariationsChange={(messageVariations) => onUpdate({ messageVariations })}
          maxLength={CHARACTER_LIMITS.message}
          placeholder="Hi {{first_name}}, thanks for connecting..."
          label="Message"
          messageType="message"
        />
      )}
    </div>
  );
}

// InMail Configuration
function InMailConfig({
  data,
  onUpdate,
}: {
  data: InMailNodeData;
  onUpdate: (data: Partial<InMailNodeData>) => void;
}) {
  const isPrompt = data.messageMode === "prompt";
  const savedVariants = (data.messageVariations || []).filter(
    (variant) => variant?.subject?.trim() || variant?.message?.trim(),
  );
  const firstMessageVariant = savedVariants.find((variant) => variant.message?.trim());

  return (
    <div className="space-y-4">
      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      {/* Subject line is always manual */}
      <div className="space-y-2">
        <Label>Subject Line</Label>
        <Input aria-label="Subject Line"
          value={data.subject || ""}
          onChange={(e) => onUpdate({ subject: e.target.value })}
          placeholder="Quick question about {{company}}"
          maxLength={CHARACTER_LIMITS.inmailSubject}
        />
        <p className="text-xs text-muted-foreground text-right">
          {(data.subject || "").length}/{CHARACTER_LIMITS.inmailSubject}
        </p>
      </div>

      {isPrompt ? (
        <PromptEditor
          value={data.prompt || ""}
          onChange={(prompt) => onUpdate({ prompt })}
          variations={data.promptVariations || []}
          onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
          llmModel={data.llmModel}
          onModelChange={(llmModel) => onUpdate({ llmModel })}
          llmTemperature={data.llmTemperature}
          onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
          messageType="inmail"
        />
      ) : (
        <MessageEditor
          value={data.message || ""}
          onChange={(message) => onUpdate({ message })}
          maxLength={CHARACTER_LIMITS.inmail}
          placeholder="Hi {{first_name}}, I came across your profile..."
          label="Message"
          showABTesting={false}
          messageType="inmail"
        />
      )}

      {!isPrompt && savedVariants.length > 0 && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <p className="leading-relaxed text-muted-foreground">
            This step sends the primary subject and message above. Saved variants
            are retained but are not used for sending.
          </p>
          <details className="group">
            <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Review {savedVariants.length} saved variant{savedVariants.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-3 space-y-3">
              {savedVariants.map((variant, index) => (
                <div key={index} className="space-y-1 border-t pt-3">
                  <p className="font-medium">Variant {index + 1}</p>
                  {variant.subject && <p className="break-words font-medium">{variant.subject}</p>}
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                    {variant.message || "No message saved"}
                  </p>
                </div>
              ))}
            </div>
          </details>
          {!data.message?.trim() && firstMessageVariant && (
            <Button
              variant="cta"
              size="sm"
              className="w-full"
              onClick={() => onUpdate({
                subject: firstMessageVariant.subject || data.subject || "",
                message: firstMessageVariant.message,
              })}
            >
              Use first variant as primary
            </Button>
          )}
        </div>
      )}

      <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-md text-sm text-yellow-700 dark:text-yellow-300">
        InMails require LinkedIn Premium or Sales Navigator credits.
      </div>
    </div>
  );
}

// Email Configuration (direct SMTP send)
function EmailConfig({
  data,
  onUpdate,
}: {
  data: EmailNodeData;
  onUpdate: (data: Partial<EmailNodeData>) => void;
}) {
  const isPrompt = data.messageMode === "prompt";
  const { data: mailboxes } = useEmailMailboxes();
  const readyMailboxes = (mailboxes || []).filter(
    (m) => m.status === "ready" && m.imap_connected
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Sending From</Label>
        {readyMailboxes.length === 0 ? (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              No ready mailboxes found.{" "}
              <Link to="/settings?tab=mailboxes" className="underline font-medium">
                Connect mailboxes
              </Link>{" "}
              in settings first.
            </div>
          </div>
        ) : (
          <MailboxPickerButton
            value={data.mailboxId || null}
            onChange={(mailboxId) => onUpdate({ mailboxId: mailboxId || undefined })}
            placeholder="Select a mailbox"
          />
        )}
      </div>

      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      {/* Subject line is always manual */}
      <div className="space-y-2">
        <Label>Subject Line</Label>
        <Input aria-label="Subject Line"
          value={data.subject || ""}
          onChange={(e) => onUpdate({ subject: e.target.value })}
          placeholder="Quick question about {{company}}"
        />
      </div>

      {isPrompt ? (
        <PromptEditor
          value={data.prompt || ""}
          onChange={(prompt) => onUpdate({ prompt })}
          variations={data.promptVariations || []}
          onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
          llmModel={data.llmModel}
          onModelChange={(llmModel) => onUpdate({ llmModel })}
          llmTemperature={data.llmTemperature}
          onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
          messageType="email"
        />
      ) : (
        <MessageEditor
          value={data.body || ""}
          onChange={(body) => onUpdate({ body })}
          variations={data.bodyVariations || []}
          onVariationsChange={(bodyVariations) => onUpdate({ bodyVariations })}
          placeholder="Hi {{first_name}}, I noticed..."
          label="Email Body"
          messageType="email"
        />
      )}

      <div className="space-y-3 pt-2 border-t">
        <Label>Tracking</Label>
        <div className="flex items-center justify-between">
          <Label className="text-sm">Track Opens</Label>
          <Switch
            aria-label="Track Opens"
            checked={data.trackOpens ?? true}
            onCheckedChange={(trackOpens) => onUpdate({ trackOpens })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm">Track Clicks</Label>
          <Switch
            aria-label="Track Clicks"
            checked={data.trackClicks ?? true}
            onCheckedChange={(trackClicks) => onUpdate({ trackClicks })}
          />
        </div>
      </div>
    </div>
  );
}

// Delay Configuration
function DelayConfig({
  data,
  onUpdate,
}: {
  data: DelayNodeData;
  onUpdate: (data: Partial<DelayNodeData>) => void;
}) {
  const totalMinutes = (data.days || 0) * 1440 + (data.hours || 0) * 60 + (data.minutes || 0);
  const totalDisplay = totalMinutes >= 1440
    ? `${(totalMinutes / 1440).toFixed(1)} days`
    : totalMinutes >= 60
      ? `${(totalMinutes / 60).toFixed(1)} hours`
      : `${totalMinutes} minutes`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Days</Label>
          <Input aria-label="Days"
            type="number"
            value={data.days || 0}
            onChange={(e) => onUpdate({ days: parseInt(e.target.value) || 0 })}
            min={0}
            max={30}
          />
        </div>
        <div className="space-y-2">
          <Label>Hours</Label>
          <Input aria-label="Hours"
            type="number"
            value={data.hours || 0}
            onChange={(e) => onUpdate({ hours: parseInt(e.target.value) || 0 })}
            min={0}
            max={23}
          />
        </div>
        <div className="space-y-2">
          <Label>Minutes</Label>
          <Input aria-label="Minutes"
            type="number"
            value={data.minutes || 0}
            onChange={(e) => onUpdate({ minutes: parseInt(e.target.value) || 0 })}
            min={0}
            max={59}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Total wait time: {totalDisplay}
      </p>
    </div>
  );
}

// Like Post Configuration
function LikePostConfig({
  data,
  onUpdate,
}: {
  data: LikePostNodeData;
  onUpdate: (data: Partial<LikePostNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Number of posts to like</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.likeCount || 1}</Badge>
        </div>
        <Slider aria-label="Number of posts to like"
          value={[data.likeCount || 1]}
          onValueChange={([value]) => onUpdate({ likeCount: value })}
          min={1}
          max={3}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Will like the most recent posts on their profile
        </p>
      </div>
    </div>
  );
}

// Warmup Engagement Configuration
const REACTION_OPTIONS: { value: WarmupReactionType; label: string; emoji: string }[] = [
  { value: "like", label: "Like", emoji: "👍" },
  { value: "celebrate", label: "Celebrate", emoji: "👏" },
  { value: "support", label: "Support", emoji: "💜" },
  { value: "love", label: "Love", emoji: "❤️" },
  { value: "insightful", label: "Insightful", emoji: "💡" },
  { value: "funny", label: "Funny", emoji: "😄" },
];

function WarmupEngagementConfig({
  data,
  onUpdate,
}: {
  data: WarmupEngagementNodeData;
  onUpdate: (data: Partial<WarmupEngagementNodeData>) => void;
}) {
  const handleAddComment = () => {
    const templates = data.commentTemplates || [];
    onUpdate({ commentTemplates: [...templates, ""] });
  };

  const handleRemoveComment = (index: number) => {
    const templates = [...(data.commentTemplates || [])];
    templates.splice(index, 1);
    onUpdate({ commentTemplates: templates });
  };

  const handleUpdateComment = (index: number, value: string) => {
    const templates = [...(data.commentTemplates || [])];
    templates[index] = value;
    onUpdate({ commentTemplates: templates });
  };

  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md text-sm text-amber-700 dark:text-amber-300">
        Warm up engagement helps build rapport before sending connection requests
        or messages. This increases acceptance rates significantly.
      </div>

      <div className="space-y-2">
        <Label>Engagement Type</Label>
        <Select
          value={data.engagementType || "reaction"}
          onValueChange={(value: "reaction" | "comment" | "both") =>
            onUpdate({ engagementType: value })
          }
        >
          <SelectTrigger aria-label="Engagement Type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reaction">React to posts</SelectItem>
            <SelectItem value="comment">Comment on posts</SelectItem>
            <SelectItem value="both">React & Comment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(data.engagementType === "reaction" || data.engagementType === "both") && (
        <div className="space-y-2">
          <Label>Reaction Type</Label>
          <Select
            value={data.reactionType || "like"}
            onValueChange={(value: WarmupReactionType) =>
              onUpdate({ reactionType: value })
            }
          >
            <SelectTrigger aria-label="Reaction Type">
              <SelectValue placeholder="Select reaction" />
            </SelectTrigger>
            <SelectContent>
              {REACTION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} textValue={opt.label}>
                  <span className="flex items-center gap-2">
                    <span>{opt.emoji}</span>
                    <span>{opt.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(data.engagementType === "comment" || data.engagementType === "both") && (
        <div className="space-y-2">
          <Label>Comment Templates</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Add multiple templates - one will be randomly selected. Use variables
            like {"{{first_name}}"} or {"{{company}}"}.
          </p>
          {(data.commentTemplates || []).map((template, index) => (
            <div key={index} className="flex gap-2">
              <Textarea
                value={template}
                onChange={(e) => handleUpdateComment(index, e.target.value)}
                placeholder="Great insights on {{topic}}! I especially liked..."
                className="flex-1 min-h-[60px]"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveComment(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddComment}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Comment Template
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Number of posts to engage with</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.postCount || 1}</Badge>
        </div>
        <Slider aria-label="Number of posts to engage with"
          value={[data.postCount || 1]}
          onValueChange={([value]) => onUpdate({ postCount: value })}
          min={1}
          max={3}
          step={1}
          className="w-full"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="prefer-high" className="font-normal">
            Prefer high-engagement posts
          </Label>
          <p className="text-xs text-muted-foreground">
            Your interaction will be more visible
          </p>
        </div>
        <Switch
          id="prefer-high"
          checked={data.preferHighEngagement !== false}
          onCheckedChange={(checked) => onUpdate({ preferHighEngagement: checked })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Cooldown period (days)</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.cooldownDays || 7}</Badge>
        </div>
        <Slider aria-label="Cooldown period (days)"
          value={[data.cooldownDays || 7]}
          onValueChange={([value]) => onUpdate({ cooldownDays: value })}
          min={1}
          max={30}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Skip if already engaged with this contact recently
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// CONTROL NODE CONFIGURATIONS
// ============================================================================

function ConditionReplyReceivedConfig({
  data,
  onUpdate,
}: {
  data: ConditionReplyReceivedNodeData;
  onUpdate: (data: Partial<ConditionReplyReceivedNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Check for reply within (days)</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.withinDays || 7}</Badge>
        </div>
        <Slider aria-label="Check for reply within (days)"
          value={[data.withinDays || 7]}
          onValueChange={([value]) => onUpdate({ withinDays: value })}
          min={1}
          max={30}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Check if contact replied within this time period (any channel)
        </p>
      </div>

      <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded-md text-sm text-primary dark:text-primary">
        Routes to "Replied" if the contact has responded on any channel,
        otherwise routes to "No Reply".
      </div>
    </div>
  );
}

function ConditionIntentConfig({
  data,
  onUpdate,
}: {
  data: ConditionIntentNodeData;
  onUpdate: (data: Partial<ConditionIntentNodeData>) => void;
}) {
  const { models, isLoading: isLoadingModels, hasOpenRouterKey } = useLLMModels();

  return (
    <div className="space-y-4">
      <div className="p-3 bg-violet-50 dark:bg-violet-950/30 rounded-md text-sm text-violet-700 dark:text-violet-300 flex items-start gap-2">
        <Brain className="h-4 w-4 mt-0.5 shrink-0" />
        AI reads the lead's most recent reply and routes them down the matching
        branch. Wire only the intents you want to act on — unwired branches stop
        the lead here.
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Look back for a reply (days)</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.withinDays || 14}</Badge>
        </div>
        <Slider aria-label="Look back for a reply (days)"
          value={[data.withinDays || 14]}
          onValueChange={([value]) => onUpdate({ withinDays: value })}
          min={1}
          max={60}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Only replies received within this window are classified. No reply in the
          window routes to "No Reply".
        </p>
      </div>

      {/* AI Model Selection (optional) */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <Brain className="h-3.5 w-3.5" />
          AI Model
          <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </Label>
        {!hasOpenRouterKey ? (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-2.5">
            OpenRouter API key required.{" "}
            <Link to="/settings?tab=integrations" className="underline font-medium">
              Add in Settings
            </Link>
          </div>
        ) : isLoadingModels ? (
          <div className="h-9 border rounded-md bg-muted/50 flex items-center px-3">
            <span className="text-xs text-muted-foreground">Loading models...</span>
          </div>
        ) : (
          <SearchableSelect
            value={data.model || DEFAULT_LLM_MODEL}
            onValueChange={(v) => onUpdate({ model: v })}
            options={models}
            placeholder="Default (fast classifier)"
            searchPlaceholder="Search models..."
          />
        )}
        <p className="text-[11px] text-muted-foreground">
          Obvious replies (out-of-office, auto-replies, clear interest) are matched
          instantly without an LLM call.
        </p>
      </div>
    </div>
  );
}

function HandoffToAgentConfig({
  data,
  onUpdate,
}: {
  data: HandoffToAgentNodeData;
  onUpdate: (data: Partial<HandoffToAgentNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-sky-50 dark:bg-sky-950/30 rounded-md text-sm text-sky-700 dark:text-sky-300 flex items-start gap-2">
        <Settings className="h-4 w-4 mt-0.5 shrink-0" />
        When the lead reaches this step, the AI agent starts handling their replies
        automatically — following the agent profile's per-intent rules (auto-reply
        vs. draft for review). Great wired off "Check Reply Intent → Interested".
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">AI agent profile</Label>
        <AgentProfileSelector
          selectedProfileId={data.agentProfileId || null}
          onSelect={(profile) => onUpdate({ agentProfileId: profile.id })}
        />
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-muted-foreground">
            {data.agentProfileId
              ? "Uses this specific agent profile."
              : "Uses the campaign's agent (Smart Settings → AI Agent)."}
          </p>
          {data.agentProfileId && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onUpdate({ agentProfileId: null })}
            >
              Use campaign agent
            </button>
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="handoff-exit" className="font-normal">
              Exit sequence after handoff
            </Label>
            <p className="text-xs text-muted-foreground">
              Mark the lead as handed off and stop running further steps.
            </p>
          </div>
          <Switch
            id="handoff-exit"
            checked={data.exitAfterHandoff !== false}
            onCheckedChange={(checked) => onUpdate({ exitAfterHandoff: checked })}
          />
        </div>
      </div>
    </div>
  );
}

function ConditionConnectionConfig({
  data,
  onUpdate,
}: {
  data: { withinDays?: number };
  onUpdate: (data: { withinDays?: number }) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Wait for acceptance (days)</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.withinDays || 14}</Badge>
        </div>
        <Slider aria-label="Wait for acceptance (days)"
          value={[data.withinDays || 14]}
          onValueChange={([value]) => onUpdate({ withinDays: value })}
          min={1}
          max={30}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Wait for connection acceptance within this time period
        </p>
      </div>

      <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded-md text-sm text-primary dark:text-primary">
        Routes to "Accepted" immediately when connection is accepted,
        otherwise waits up to {data.withinDays || 14} days before routing to "Not Accepted".
      </div>
    </div>
  );
}

function ConditionEmailConfig({
  data,
  onUpdate,
  type,
}: {
  data: { withinDays?: number };
  onUpdate: (data: { withinDays?: number }) => void;
  type: "conditionEmailOpened" | "conditionEmailClicked";
}) {
  const isOpen = type === "conditionEmailOpened";
  const action = isOpen ? "open" : "click";
  const positiveLabel = isOpen ? "Opened" : "Clicked";
  const negativeLabel = isOpen ? "Not Opened" : "Not Clicked";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Check for {action} within (days)</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.withinDays || 7}</Badge>
        </div>
        <Slider aria-label={`Check for ${action} within (days)`}
          value={[data.withinDays || 7]}
          onValueChange={([value]) => onUpdate({ withinDays: value })}
          min={1}
          max={30}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Check if email was {isOpen ? "opened" : "clicked"} within this time period
        </p>
      </div>

      <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded-md text-sm text-primary dark:text-primary">
        Routes to "{positiveLabel}" if the email was {isOpen ? "opened" : "clicked"},
        otherwise waits up to {data.withinDays || 7} days before routing to "{negativeLabel}".
      </div>
    </div>
  );
}

// ============================================================================
// MULTI-CHANNEL NODE CONFIGURATIONS
// ============================================================================

const CHANNEL_OPTIONS: Array<{ value: Exclude<ChannelType, "any">; label: string }> = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "messenger", label: "Messenger" },
  { value: "twitter", label: "X (Twitter)" },
];

function SwitchChannelConfig({
  data,
  onUpdate,
}: {
  data: SwitchChannelNodeData;
  onUpdate: (data: Partial<SwitchChannelNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Target channel</Label>
        <Select
          value={data.targetChannel || "email"}
          onValueChange={(value) =>
            onUpdate({ targetChannel: value as Exclude<ChannelType, "any"> })
          }
        >
          <SelectTrigger aria-label="Target channel">
            <SelectValue placeholder="Select channel" />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_OPTIONS.map((channel) => (
              <SelectItem key={channel.value} value={channel.value}>
                {channel.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Fallback channel (optional)</Label>
        <Select
          value={data.fallbackChannel || "none"}
          onValueChange={(value) =>
            onUpdate({
              fallbackChannel:
                value === "none"
                  ? undefined
                  : (value as Exclude<ChannelType, "any">),
            })
          }
        >
          <SelectTrigger aria-label="Fallback channel (optional)">
            <SelectValue placeholder="No fallback" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No fallback</SelectItem>
            {CHANNEL_OPTIONS.map((channel) => (
              <SelectItem key={channel.value} value={channel.value}>
                {channel.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function GoToConfig({
  data,
  allNodes,
}: {
  data: GoToNodeData;
  onUpdate: (data: Partial<GoToNodeData>) => void;
  allNodes: SequenceNode[];
  currentNodeId: string;
}) {
  let targetLabel = "Not connected";
  if (data.targetNodeId) {
    const targetNode = allNodes.find(n => n.id === data.targetNodeId);
    if (targetNode) {
      const nodeConfig = NODE_TYPE_CONFIGS[targetNode.type as SequenceNodeType];
      targetLabel = (targetNode.data as any)?.customLabel || nodeConfig?.label || targetNode.type;
    } else {
      targetLabel = "Target not found";
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Jumps to</Label>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <CornerDownLeft className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className={data.targetNodeId ? "text-foreground" : "text-muted-foreground"}>
            {targetLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Drag from this node's bottom handle to the target node on the canvas. When a lead reaches this node, they jump to the connected node.
        </p>
      </div>
    </div>
  );
}

function ConditionChannelAvailableConfig({
  data,
  onUpdate,
  entryTriggers,
  onOpenTriggers,
}: {
  data: ConditionChannelAvailableNodeData;
  onUpdate: (data: Partial<ConditionChannelAvailableNodeData>) => void;
  entryTriggers: CampaignEntryRule[];
  onOpenTriggers?: () => void;
}) {
  // Nodes saved before checks existed only carry a channel; show what they actually run.
  const check = resolveContactCheck(data);
  const option = CONTACT_CHECK_OPTIONS.find((o) => o.value === check);
  const renderOption = (o: (typeof CONTACT_CHECK_OPTIONS)[number]) => (
    <SelectItem key={o.value} value={o.value} textValue={o.label}>
      {o.label}
    </SelectItem>
  );
  // "Sender connected" looks at Unipile channels; "Came in on a channel" at any routable one.
  const channelOptions = check === "senderConnected"
    ? ROUTE_CHANNEL_OPTIONS.filter((o) => SENDER_CHECK_CHANNELS.includes(o.value))
    : check === "enteredOnChannel" ? ROUTE_CHANNEL_OPTIONS : [];
  const pickedChannel = channelOptions.some((o) => o.value === data.channel) ? data.channel : undefined;
  const missingTrigger = !!data.triggerId && !entryTriggers.some((rule) => rule.id === data.triggerId);

  const selectCheck = (value: ContactCheck) => {
    const allowed = value === "senderConnected" ? SENDER_CHECK_CHANNELS
      : value === "enteredOnChannel" ? ROUTE_CHANNEL_OPTIONS.map((o) => o.value) : null;
    const needsChannel = !!allowed && !allowed.includes(data.channel as RouteChannel);
    onUpdate({
      check: value,
      checkRegistration: undefined,
      ...(needsChannel ? { channel: "linkedin" } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Check</Label>
        <Select value={check ?? undefined} onValueChange={(value) => selectCheck(value as ContactCheck)}>
          <SelectTrigger aria-label="Check">
            <SelectValue placeholder="Pick what to check" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Contact data</SelectLabel>
              {CONTACT_CHECK_OPTIONS.filter((o) => o.group === "contact").map(renderOption)}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Unipile</SelectLabel>
              {CONTACT_CHECK_OPTIONS.filter((o) => o.group === "unipile").map(renderOption)}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>How they came in</SelectLabel>
              {CONTACT_CHECK_OPTIONS.filter((o) => o.group === "entry").map(renderOption)}
            </SelectGroup>
          </SelectContent>
        </Select>
        {option && <p className="text-xs text-muted-foreground">{option.description}</p>}
      </div>

      {channelOptions.length > 0 && (
        <div className="space-y-2">
          <Label>Channel</Label>
          <Select value={pickedChannel} onValueChange={(value) => onUpdate({ channel: value as RouteChannel })}>
            <SelectTrigger aria-label="Channel">
              <SelectValue placeholder="Pick a channel" />
            </SelectTrigger>
            <SelectContent>
              {channelOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {check === "enteredViaTrigger" && (
        <div className="space-y-2">
          <Label>Trigger</Label>
          <Select
            value={data.triggerId || "_any"}
            onValueChange={(value) => onUpdate({ triggerId: value === "_any" ? undefined : value })}
          >
            <SelectTrigger aria-label="Trigger">
              <SelectValue>
                {missingTrigger
                  ? "Removed trigger"
                  : entryTriggers.find((rule) => rule.id === data.triggerId)?.name ?? "Any trigger"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_any" textValue="Any trigger">Any trigger</SelectItem>
              {entryTriggers.map((rule) => (
                <SelectItem key={rule.id} value={rule.id} textValue={rule.name}>
                  {rule.name}
                  {!rule.enabled && <span className="ml-1.5 text-muted-foreground">(paused)</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {missingTrigger && (
            <p className="text-xs text-destructive">
              This trigger was removed from the campaign, so every lead goes down <strong>Not Available</strong>.
            </p>
          )}
        </div>
      )}

      {option?.group === "entry" && entryTriggers.length === 0 && (
        <div className="space-y-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This campaign has no entry triggers yet, so every lead goes down <strong>Not Available</strong>.
          </p>
          {onOpenTriggers && (
            <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={onOpenTriggers}>
              Configure entry triggers
            </Button>
          )}
        </div>
      )}

      {option?.group === "unipile" && check !== "senderConnected" && (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Runs through one of this campaign's senders on that channel. With no sender there, leads go
            down <strong>Not Available</strong>. If the sender is disconnected, they wait here and retry every hour.
          </span>
        </div>
      )}
    </div>
  );
}

function RouteByChannelConfig({
  data,
  onUpdate,
}: {
  data: RouteByChannelNodeData;
  onUpdate: (data: Partial<RouteByChannelNodeData>) => void;
}) {
  const channels = routeChannels(data);
  const unused = ROUTE_CHANNEL_OPTIONS.filter((o) => !channels.includes(o.value));

  const move = (index: number, offset: number) => {
    const next = [...channels];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onUpdate({ channels: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md bg-violet-50 p-3 text-sm text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
        <Split className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Each lead goes down the first channel below it can be reached on. Leads no channel can reach
          go down <strong>No channel</strong>.
        </span>
      </div>

      <div className="space-y-2">
        <Label>Channels, in priority order</Label>
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add at least one channel.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {channels.map((channel, index) => {
              const option = ROUTE_CHANNEL_OPTIONS.find((o) => o.value === channel)!;
              return (
                <div key={channel} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-muted-foreground">If the lead {option.reach}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move ${option.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move ${option.label} down`}
                    disabled={index === channels.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Remove ${option.label}`}
                    onClick={() => onUpdate({ channels: channels.filter((c) => c !== channel) })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {unused.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {unused.map((o) => (
              <Button
                key={o.value}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onUpdate({ channels: [...channels, o.value] })}
              >
                <Plus className="mr-1 h-3 w-3" />
                {o.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="route-require-sender" className="font-normal">
            Only channels this campaign sends on
          </Label>
          <p className="text-xs text-muted-foreground">
            Skips LinkedIn, Instagram, WhatsApp or Telegram when the campaign has no sender there. If that
            sender is disconnected, leads wait here. Email always counts.
          </p>
        </div>
        <Switch
          id="route-require-sender"
          checked={data.requireSender !== false}
          onCheckedChange={(checked) => onUpdate({ requireSender: checked })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="route-entry-first" className="font-normal">
            Start with the channel they reached out on
          </Label>
          <p className="text-xs text-muted-foreground">
            For leads a trigger brought in from a message, comment or invitation, try that channel first
            when it is in the list.
          </p>
        </div>
        <Switch
          id="route-entry-first"
          checked={data.entryChannelFirst === true}
          onCheckedChange={(checked) => onUpdate({ entryChannelFirst: checked })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="route-verify" className="font-normal">
            Verify on Unipile
          </Label>
          <p className="text-xs text-muted-foreground">
            Looks LinkedIn URLs, Instagram handles and WhatsApp numbers up through your sender before
            routing. Catches dead profiles and numbers that are not on WhatsApp.
          </p>
        </div>
        <Switch
          id="route-verify"
          checked={data.verifyOnUnipile === true}
          onCheckedChange={(checked) => onUpdate({ verifyOnUnipile: checked })}
        />
      </div>
    </div>
  );
}

type MultiChannelMessageData = {
  message?: string;
  messageVariations?: string[];
  messageMode?: MessageMode;
  prompt?: string;
  promptVariations?: string[];
  llmModel?: string;
  llmTemperature?: number;
};

function MultiChannelMessageConfig({
  data,
  onUpdate,
  label,
  placeholder,
  messageType,
}: {
  data: MultiChannelMessageData;
  onUpdate: (data: Partial<MultiChannelMessageData>) => void;
  label: string;
  placeholder: string;
  messageType: "message";
}) {
  const isPrompt = data.messageMode === "prompt";

  return (
    <div className="space-y-4">
      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      {isPrompt ? (
        <PromptEditor
          value={data.prompt || ""}
          onChange={(prompt) => onUpdate({ prompt })}
          variations={data.promptVariations || []}
          onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
          llmModel={data.llmModel}
          onModelChange={(llmModel) => onUpdate({ llmModel })}
          llmTemperature={data.llmTemperature}
          onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
          messageType={messageType}
          placeholder={placeholder}
        />
      ) : (
        <MessageEditor
          value={data.message || ""}
          onChange={(message) => onUpdate({ message })}
          variations={data.messageVariations || []}
          onVariationsChange={(messageVariations) => onUpdate({ messageVariations })}
          maxLength={CHARACTER_LIMITS.message}
          placeholder={placeholder}
          label={label}
          messageType="message"
        />
      )}
    </div>
  );
}

function WhatsAppMessageConfig({
  data,
  onUpdate,
}: {
  data: WhatsAppMessageNodeData;
  onUpdate: (data: Partial<WhatsAppMessageNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <MultiChannelMessageConfig
        data={data}
        onUpdate={onUpdate}
        label="WhatsApp Message"
        placeholder="Hi {{first_name}}, quick update from {{company}}..."
        messageType="message"
      />

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="include-wa-media" className="font-normal">
            Include media
          </Label>
          <p className="text-xs text-muted-foreground">
            Attach image, video, or document to the message
          </p>
        </div>
        <Switch
          id="include-wa-media"
          checked={data.includeMedia === true}
          onCheckedChange={(checked) => onUpdate({ includeMedia: checked })}
        />
      </div>

      {data.includeMedia && (
        <>
          <div className="space-y-2">
            <Label>Media Type</Label>
            <Select
              value={data.mediaType || "image"}
              onValueChange={(value) =>
                onUpdate({ mediaType: value as "image" | "video" | "document" })
              }
            >
              <SelectTrigger aria-label="Media Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="document">Document</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Media URL</Label>
            <Input aria-label="Media URL"
              value={data.mediaUrl || ""}
              onChange={(e) => onUpdate({ mediaUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>
        </>
      )}
    </div>
  );
}

function InstagramDmConfig({
  data,
  onUpdate,
}: {
  data: InstagramDmNodeData;
  onUpdate: (data: Partial<InstagramDmNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <MultiChannelMessageConfig
        data={data}
        onUpdate={onUpdate}
        label="Instagram DM"
        placeholder="Hey {{first_name}}, loved your post about {{ai_linkedin_topic_1}}..."
        messageType="message"
      />

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="include-ig-media" className="font-normal">
            Include media
          </Label>
          <p className="text-xs text-muted-foreground">
            Attach media in the DM when supported by the connected sender
          </p>
        </div>
        <Switch
          id="include-ig-media"
          checked={data.includeMedia === true}
          onCheckedChange={(checked) => onUpdate({ includeMedia: checked })}
        />
      </div>

      {data.includeMedia && (
        <div className="space-y-2">
          <Label>Media URL</Label>
          <Input aria-label="Media URL"
            value={data.mediaUrl || ""}
            onChange={(e) => onUpdate({ mediaUrl: e.target.value })}
            placeholder="https://..."
          />
        </div>
      )}
    </div>
  );
}

function TelegramMessageConfig({
  data,
  onUpdate,
}: {
  data: TelegramMessageNodeData;
  onUpdate: (data: Partial<TelegramMessageNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <MultiChannelMessageConfig
        data={data}
        onUpdate={onUpdate}
        label="Telegram Message"
        placeholder="Hi {{first_name}}, wanted to share a quick idea for {{company}}..."
        messageType="message"
      />

      <div className="space-y-2">
        <Label>Formatting mode</Label>
        <Select
          value={data.parseMode || "HTML"}
          onValueChange={(value) =>
            onUpdate({ parseMode: value as "HTML" | "Markdown" | "MarkdownV2" })
          }
        >
          <SelectTrigger aria-label="Formatting mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="HTML">HTML</SelectItem>
            <SelectItem value="Markdown">Markdown</SelectItem>
            <SelectItem value="MarkdownV2">Markdown V2</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SmsMessageConfig({
  data,
  onUpdate,
}: {
  data: SmsMessageNodeData;
  onUpdate: (data: Partial<SmsMessageNodeData>) => void;
}) {
  const length = data.messageMode === "prompt" ? null : (data.message || "").length;
  return (
    <div className="space-y-4">
      <MultiChannelMessageConfig
        data={data}
        onUpdate={onUpdate}
        label="SMS Message"
        placeholder="Hi {{first_name}}, is this still the best number for you?"
        messageType="message"
      />
      {length !== null && length > 0 && (
        <p className={`text-xs ${length > 160 ? "text-amber-600" : "text-muted-foreground"}`}>
          {length} characters{length > 160 ? ` · sent as ${Math.ceil(length / 153)} SMS` : ""}
        </p>
      )}
      <Alert>
        <AlertDescription className="text-xs">
          Sent from your Twilio numbers (Settings → Senders), only during the recipient's local sending hours.
          Opt-out wording is added where required ("STOP au 36111" in France). Contacts without a mobile number
          or who replied STOP are skipped.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function WhatsAppTemplateConfig({
  data,
  onUpdate,
}: {
  data: WhatsAppTemplateNodeData;
  onUpdate: (data: Partial<WhatsAppTemplateNodeData>) => void;
}) {
  const { data: templates = [], isLoading } = useWhatsAppTemplates();
  // Only approved templates can be sent; in-review ones are listed so a step can be set up early
  const usable = templates.filter((t) => ["approved", "pending", "submitted"].includes(t.approval_status));
  const selected = templates.find((t) => t.id === data.templateId);
  const fieldLabel = (field: string) => TEMPLATE_FIELDS.find((f) => f.value === field)?.label || field;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Template</Label>
        <Select
          value={data.templateId || ""}
          onValueChange={(id) => onUpdate({ templateId: id, templateName: templates.find((t) => t.id === id)?.name })}
        >
          <SelectTrigger aria-label="WhatsApp template">
            <SelectValue placeholder={isLoading ? "Loading…" : "Pick a template"} />
          </SelectTrigger>
          <SelectContent>
            {usable.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.language}){t.approval_status === "approved" ? "" : " · in review"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isLoading && usable.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No templates yet. Create one in Settings → SMS &amp; WhatsApp.
          </p>
        )}
      </div>

      {selected && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-sm whitespace-pre-wrap">{selected.body}</p>
          {templateSlots(selected.body).map((slot) => (
            <p key={slot} className="text-xs text-muted-foreground">
              {`{{${slot}}}`} ← {selected.variables?.[slot] ? fieldLabel(selected.variables[slot]) : "not mapped yet"}
            </p>
          ))}
          {selected.approval_status !== "approved" && (
            <p className="text-xs text-amber-600">Leads wait on this step until Meta approves the template.</p>
          )}
        </div>
      )}

      <Alert>
        <AlertDescription className="text-xs">
          Sent from your Twilio WhatsApp Business senders. When the contact replies, the inbox and autopilot can
          write freely for 24 hours. Marketing templates go out only during the recipient's sending hours, and
          never to US numbers (Meta doesn't deliver them there).
        </AlertDescription>
      </Alert>
    </div>
  );
}

function InstagramLikePostConfig({
  data,
  onUpdate,
}: {
  data: InstagramLikePostNodeData;
  onUpdate: (data: Partial<InstagramLikePostNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Number of posts to like</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.likeCount || 1}</Badge>
        </div>
        <Slider aria-label="Number of posts to like"
          value={[data.likeCount || 1]}
          onValueChange={([value]) => onUpdate({ likeCount: value })}
          min={1}
          max={3}
          step={1}
          className="w-full"
        />
      </div>
    </div>
  );
}

function ScheduleMeetingConfig({
  data,
  onUpdate,
}: {
  data: ScheduleMeetingNodeData;
  onUpdate: (data: Partial<ScheduleMeetingNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Meeting title template</Label>
        <Input aria-label="Meeting title template"
          value={data.titleTemplate || ""}
          onChange={(e) => onUpdate({ titleTemplate: e.target.value })}
          placeholder="Intro call with {{first_name}} from {{company}}"
        />
      </div>

      <div className="space-y-2">
        <Label>Trigger condition</Label>
        <Select
          value={data.triggerCondition || "positive_reply"}
          onValueChange={(value) =>
            onUpdate({
              triggerCondition: value as "positive_reply" | "any_reply" | "manual",
            })
          }
        >
          <SelectTrigger aria-label="Trigger condition">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="positive_reply">Positive reply</SelectItem>
            <SelectItem value="any_reply">Any reply</SelectItem>
            <SelectItem value="manual">Manual trigger</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Duration</Label>
        <Select
          value={String(data.durationMinutes || 30)}
          onValueChange={(value) =>
            onUpdate({ durationMinutes: parseInt(value, 10) })
          }
        >
          <SelectTrigger aria-label="Duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[15, 30, 45, 60].map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes} minutes
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Conference provider</Label>
        <Select
          value={data.conferenceProvider || "google_meet"}
          onValueChange={(value) =>
            onUpdate({
              conferenceProvider: value as
                | "google_meet"
                | "zoom"
                | "teams"
                | "none",
            })
          }
        >
          <SelectTrigger aria-label="Conference provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="google_meet">Google Meet</SelectItem>
            <SelectItem value="zoom">Zoom</SelectItem>
            <SelectItem value="teams">Microsoft Teams</SelectItem>
            <SelectItem value="none">No conference link</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Body template (optional)</Label>
        <Textarea aria-label="Body template (optional)"
          value={data.bodyTemplate || ""}
          onChange={(e) => onUpdate({ bodyTemplate: e.target.value })}
          placeholder="Agenda, prep notes, and context..."
          className="min-h-[120px]"
        />
      </div>
    </div>
  );
}

// ============================================================================
// EMAIL TOOL HANDOFF NODE CONFIGURATIONS
// ============================================================================

// Email count selector for AI prompt mode
function EmailCountSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (count: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Number of Emails</Label>
      <Select
        value={String(value || 3)}
        onValueChange={(v) => onChange(parseInt(v, 10))}
      >
        <SelectTrigger aria-label="Number of Emails">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[2, 3, 4, 5, 6, 7].map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} emails
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        AI will generate a {value || 3}-email sequence with unique subjects and bodies
      </p>
    </div>
  );
}

function SendToEmailToolConfig({
  data,
  onUpdate,
  toolType,
}: {
  data: SendToEmailToolNodeData;
  onUpdate: (data: Partial<SendToEmailToolNodeData>) => void;
  toolType: "smartlead" | "instantly";
}) {
  const { data: connections, isLoading: connectionsLoading } = useToolConnections(toolType);
  const { data: campaigns, isLoading: campaignsLoading } = useToolCampaigns(data.connectionId);

  const toolName = toolType === "smartlead" ? "Smartlead" : "Instantly";
  const isPrompt = data.messageMode === "prompt";

  return (
    <div className="space-y-4">
      <div className={toolType === "smartlead" ? "p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md text-sm text-blue-700 dark:text-blue-300" : "p-3 bg-cta/10 dark:bg-cta/20 rounded-md text-sm text-cta dark:text-cta"}>
        Push leads with fully personalized email content to {toolName}. The email
        will be stored as custom fields that you can use in your {toolName} email
        templates.
      </div>

      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      <div className="space-y-2">
        <Label>{toolName} Connection</Label>
        <Select
          value={data.connectionId || ""}
          onValueChange={(value) => onUpdate({ connectionId: value, externalCampaignId: undefined })}
          disabled={connectionsLoading}
        >
          <SelectTrigger aria-label={`${toolName} Connection`}>
            <SelectValue placeholder={connectionsLoading ? "Loading..." : `Select ${toolName} connection`} />
          </SelectTrigger>
          <SelectContent>
            {connections?.map((conn) => (
              <SelectItem key={conn.id} value={conn.id}>
                {conn.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!connectionsLoading && (!connections || connections.length === 0) && (
          <p className="text-xs text-amber-600">
            No {toolName} connections found. Add one in Settings → Email Tools.
          </p>
        )}
      </div>

      {data.connectionId && (
        <div className="space-y-2">
          <Label>{toolName} Campaign</Label>
          <Select
            value={data.externalCampaignId || ""}
            onValueChange={(value) => onUpdate({ externalCampaignId: value })}
            disabled={campaignsLoading}
          >
            <SelectTrigger aria-label={`${toolName} Campaign`}>
              <SelectValue placeholder={campaignsLoading ? "Loading campaigns..." : "Select campaign"} />
            </SelectTrigger>
            <SelectContent>
              {campaigns?.map((camp) => (
                <SelectItem key={camp.id} value={String(camp.id)}>
                  {camp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The lead will be added to this campaign in {toolName}
          </p>
        </div>
      )}

      {isPrompt ? (
        <>
          <EmailCountSelector
            value={data.emailCount || 3}
            onChange={(emailCount) => onUpdate({ emailCount })}
          />
          <PromptEditor
            value={data.prompt || ""}
            onChange={(prompt) => onUpdate({ prompt })}
            variations={data.promptVariations || []}
            onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
            llmModel={data.llmModel}
            onModelChange={(llmModel) => onUpdate({ llmModel })}
            llmTemperature={data.llmTemperature}
            onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
            messageType="emailSequence"
            emailCount={data.emailCount || 3}
            placeholder={`Write a ${data.emailCount || 3}-email cold outreach sequence to {{first_name}} at {{company}}. They operate in {{ai_company_niche}} and their primary need is {{ai_primary_need}}. Reference their focus on {{ai_priority_1}} and pitch our solution.`}
          />
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Email Subject</Label>
            <Input aria-label="Email Subject"
              value={data.emailSubject || ""}
              onChange={(e) => onUpdate({ emailSubject: e.target.value })}
              placeholder="Quick question about {{company}}"
            />
            <p className="text-xs text-muted-foreground">
              Use {"{{first_name}}"}, {"{{company}}"}, {"{{job_title}}"} for personalization
            </p>
          </div>

          <div className="space-y-2">
            <Label>Email Body</Label>
            <Textarea aria-label="Email Body"
              value={data.emailBody || ""}
              onChange={(e) => onUpdate({ emailBody: e.target.value })}
              placeholder={`Hi {{first_name}},\n\nI noticed you work at {{company}}...`}
              className="min-h-[150px]"
            />
            <p className="text-xs text-muted-foreground">
              This will be available as {toolType === "smartlead" ? "{{email_body}}" : "personalization field"} in {toolName}
            </p>
          </div>
        </>
      )}

      {isPrompt && (
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="require-review" className="font-normal">
              Review before push
            </Label>
            <p className="text-xs text-muted-foreground">
              Review and edit generated emails before pushing to {toolName}
            </p>
          </div>
          <Switch
            id="require-review"
            checked={data.requireReview !== false}
            onCheckedChange={(checked) => onUpdate({ requireReview: checked })}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="exit-handoff" className="font-normal">
            Exit campaign after handoff
          </Label>
          <p className="text-xs text-muted-foreground">
            Mark lead as "handed off" and stop sequence
          </p>
        </div>
        <Switch
          id="exit-handoff"
          checked={data.exitAfterHandoff !== false}
          onCheckedChange={(checked) => onUpdate({ exitAfterHandoff: checked })}
        />
      </div>
    </div>
  );
}

function SendToZapMailConfig({
  data,
  onUpdate,
}: {
  data: SendToEmailToolNodeData;
  onUpdate: (data: Partial<SendToEmailToolNodeData>) => void;
}) {
  const { data: stats } = useEmailMailboxStats();
  const { data: allSequences } = useEmailSequences();
  const availableSequences = allSequences?.filter(s => s.status === 'active' || s.status === 'draft' || s.status === 'paused') || [];
  const readyCount = stats?.ready || 0;
  const [isPersonalizationOpen, setIsPersonalizationOpen] = useState(false);
  const personalizeEmails = isPersonalizationOpen || data.messageMode === "prompt" || !!data.prompt;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-md text-sm text-emerald-700 dark:text-emerald-300">
        Hand off leads from this campaign into an email sequence. Each lead gets enrolled individually and receives emails through your connected mailboxes.
      </div>

      {readyCount === 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            No ready mailboxes found.{" "}
            <Link to="/settings?tab=mailboxes" className="underline font-medium">
              Connect mailboxes
            </Link>{" "}
            in settings first.
          </div>
        </div>
      )}

      {readyCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {readyCount} mailbox{readyCount !== 1 ? "es" : ""} ready to send
        </p>
      )}

      {/* Sequence Picker */}
      <div className="space-y-1.5">
        <Label className="text-sm">Select Sequence</Label>
        {availableSequences.length === 0 ? (
          <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              No sequences found.{" "}
              <Link to="/email-engine" className="underline font-medium">
                Create one
              </Link>{" "}
              in the Email Engine first.
            </p>
          </div>
        ) : (
          <Select
            value={data.existingSequenceId || ""}
            onValueChange={(value) => {
              const seq = availableSequences.find(s => s.id === value);
              const emailStepCount = seq?.steps?.filter((s: any) => s.type === 'email').length || 0;
              onUpdate({
                enrollmentMode: 'existing',
                existingSequenceId: value,
                existingSequenceName: seq?.name || undefined,
                emailCount: emailStepCount,
              });
            }}
          >
            <SelectTrigger aria-label="Select Sequence" className="truncate">
              <SelectValue placeholder="Choose a sequence..." />
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const activeSeqs = availableSequences.filter(s => s.status === 'active');
                const pausedSeqs = availableSequences.filter(s => s.status === 'paused');
                const draftSeqs = availableSequences.filter(s => s.status === 'draft');
                const renderItem = (seq: typeof availableSequences[0]) => {
                  const emailSteps = seq.steps?.filter((s: any) => s.type === 'email') || [];
                  return (
                    <SelectItem key={seq.id} value={seq.id} textValue={seq.name}>
                      <span className="truncate">{seq.name}</span>
                      <span className="text-muted-foreground text-xs shrink-0 ml-1">
                        {emailSteps.length} email{emailSteps.length !== 1 ? 's' : ''}
                      </span>
                      {seq.source_type === 'template' && (
                        <span className="text-primary text-xs shrink-0 ml-1">AI</span>
                      )}
                      {seq.status === 'paused' && (
                        <span className="text-amber-500 text-xs shrink-0 ml-1">paused</span>
                      )}
                      {seq.status === 'draft' && (
                        <span className="text-muted-foreground text-xs shrink-0 ml-1">draft</span>
                      )}
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

      {/* Selected sequence summary + AI config */}
      {data.existingSequenceId && (() => {
        const selectedSeq = availableSequences.find(s => s.id === data.existingSequenceId);
        if (!selectedSeq) return null;
        const emailSteps = selectedSeq.steps?.filter((s: any) => s.type === 'email') || [];
        const delaySteps = selectedSeq.steps?.filter((s: any) => s.type === 'delay') || [];
        const isTemplate = selectedSeq.source_type === 'template';
        return (
          <div className="space-y-3">
            <div className="border rounded-lg p-3 bg-muted/30 space-y-1">
              <p className="text-sm font-medium">{selectedSeq.name}</p>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{emailSteps.length} email{emailSteps.length !== 1 ? 's' : ''}</span>
                <span>{delaySteps.length} delay{delaySteps.length !== 1 ? 's' : ''}</span>
                <span className="italic">{isTemplate ? 'AI-personalized' : 'Static content'}</span>
              </div>
              {selectedSeq.status !== 'active' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  This sequence is {selectedSeq.status} — emails won't send until it's activated.
                </p>
              )}
              {isTemplate ? (
                <p className="text-xs text-muted-foreground mt-1">
                  AI-personalized — each lead gets unique email content generated from the prompt below.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  {personalizeEmails
                    ? 'AI will generate unique content for each lead, overriding this sequence\'s static emails.'
                    : 'Leads will receive this sequence\'s emails as written. Enable AI Prompt below to personalize per lead.'}
                </p>
              )}
            </div>

            {/* AI prompt — always shown for template sequences */}
            {/* Manual sequences: optional toggle to personalize */}
            {!isTemplate && (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="zapmail-ai-personalize" className="font-normal text-sm">
                    AI-personalize emails
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Generate unique email content per lead instead of using static content
                  </p>
                </div>
                <Switch
                  id="zapmail-ai-personalize"
                  checked={personalizeEmails}
                  onCheckedChange={(checked) => {
                    setIsPersonalizationOpen(checked);
                    if (!checked) {
                      onUpdate({ prompt: '', messageMode: undefined });
                    }
                  }}
                />
              </div>
            )}

            {(isTemplate || personalizeEmails) && (
              <PromptEditor
                value={data.prompt || ""}
                onChange={(prompt) => onUpdate({ prompt, messageMode: 'prompt' })}
                variations={data.promptVariations || []}
                onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
                llmModel={data.llmModel}
                onModelChange={(llmModel) => onUpdate({ llmModel })}
                llmTemperature={data.llmTemperature}
                onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
                messageType="emailSequence"
                emailCount={emailSteps.length}
                placeholder={`Write a ${emailSteps.length}-email cold outreach sequence to {{first_name}} at {{company}}. They operate in {{ai_company_niche}} and their primary need is {{ai_primary_need}}. Reference their focus on {{ai_priority_1}} and pitch our solution.`}
              />
            )}
          </div>
        );
      })()}

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="zapmail-exit-handoff" className="font-normal">
            Exit campaign after enrollment
          </Label>
          <p className="text-xs text-muted-foreground">
            Mark lead as "handed off" and stop campaign sequence
          </p>
        </div>
        <Switch
          id="zapmail-exit-handoff"
          checked={data.exitAfterHandoff !== false}
          onCheckedChange={(checked) => onUpdate({ exitAfterHandoff: checked })}
        />
      </div>
    </div>
  );
}

function SendToLeadConnectorConfig({
  data,
  onUpdate,
}: {
  data: SendToEmailToolNodeData;
  onUpdate: (data: Partial<SendToEmailToolNodeData>) => void;
}) {
  const isPrompt = data.messageMode === "prompt";

  return (
    <div className="space-y-4">
      <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md text-sm text-green-700 dark:text-green-300">
        Push leads with fully personalized email content to LeadConnector (GoHighLevel).
        The email will be stored as custom fields that you can use in workflows and
        email templates.
      </div>

      <MessageModeToggle
        mode={data.messageMode}
        onChange={(messageMode) => onUpdate({ messageMode })}
      />

      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md text-sm text-blue-700 dark:text-blue-300">
        LeadConnector uses your connected GHL account. Make sure you've connected
        it in Settings → Integrations → GoHighLevel.
      </div>

      <div className="space-y-2">
        <Label>GHL Workflow ID (Optional)</Label>
        <Input aria-label="GHL Workflow ID (Optional)"
          value={data.externalWorkflowId || ""}
          onChange={(e) => onUpdate({ externalWorkflowId: e.target.value })}
          placeholder="e.g., abc123xyz"
        />
        <p className="text-xs text-muted-foreground">
          Optionally add the contact to a GHL workflow after creation.
          Find workflow IDs in your GHL account settings.
        </p>
      </div>

      {isPrompt ? (
        <>
          <EmailCountSelector
            value={data.emailCount || 3}
            onChange={(emailCount) => onUpdate({ emailCount })}
          />
          <PromptEditor
            value={data.prompt || ""}
            onChange={(prompt) => onUpdate({ prompt })}
            variations={data.promptVariations || []}
            onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
            llmModel={data.llmModel}
            onModelChange={(llmModel) => onUpdate({ llmModel })}
            llmTemperature={data.llmTemperature}
            onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
            messageType="emailSequence"
            emailCount={data.emailCount || 3}
            placeholder={`Write a ${data.emailCount || 3}-email cold outreach sequence to {{first_name}} at {{company}}. They operate in {{ai_company_niche}} and their primary need is {{ai_primary_need}}. Reference their focus on {{ai_priority_1}} and pitch our solution.`}
          />
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Email Subject</Label>
            <Input aria-label="Email Subject"
              value={data.emailSubject || ""}
              onChange={(e) => onUpdate({ emailSubject: e.target.value })}
              placeholder="Quick question about {{company}}"
            />
            <p className="text-xs text-muted-foreground">
              Use {"{{first_name}}"}, {"{{company}}"}, {"{{job_title}}"} for personalization
            </p>
          </div>

          <div className="space-y-2">
            <Label>Email Body</Label>
            <Textarea aria-label="Email Body"
              value={data.emailBody || ""}
              onChange={(e) => onUpdate({ emailBody: e.target.value })}
              placeholder={`Hi {{first_name}},\n\nI noticed you work at {{company}}...`}
              className="min-h-[150px]"
            />
            <p className="text-xs text-muted-foreground">
              This will be available as {"{{email_body}}"} custom field in GHL
            </p>
          </div>
        </>
      )}

      {isPrompt && (
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="require-review-ghl" className="font-normal">
              Review before push
            </Label>
            <p className="text-xs text-muted-foreground">
              Review and edit generated emails before pushing to LeadConnector
            </p>
          </div>
          <Switch
            id="require-review-ghl"
            checked={data.requireReview !== false}
            onCheckedChange={(checked) => onUpdate({ requireReview: checked })}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="exit-handoff-ghl" className="font-normal">
            Exit campaign after handoff
          </Label>
          <p className="text-xs text-muted-foreground">
            Mark lead as "handed off" and stop sequence
          </p>
        </div>
        <Switch
          id="exit-handoff-ghl"
          checked={data.exitAfterHandoff !== false}
          onCheckedChange={(checked) => onUpdate({ exitAfterHandoff: checked })}
        />
      </div>
    </div>
  );
}

// ============================================================================
// ENRICHMENT NODE CONFIGURATIONS
// ============================================================================

const ENRICHMENT_PROVIDER_INFO: Record<EnrichmentProviderType | 'auto', { name: string; description: string }> = {
  auto: {
    name: "Auto (Priority Order)",
    description: "Use providers in order configured in Settings",
  },
  apollo: {
    name: "Apollo.io",
    description: "Email + phone enrichment with high accuracy",
  },
  prospeo: {
    name: "Prospeo",
    description: "Email verification and discovery",
  },
  moltsets: {
    name: "MoltSets",
    description: "LinkedIn identity resolution — lower coverage, paid daily quota",
  },
  quickenrich: {
    name: "QuickEnrich",
    description: "Email, phone & domain from LinkedIn URL, company, or name",
  },
};

function FindEmailConfig({
  data,
  onUpdate,
}: {
  data: FindEmailNodeData;
  onUpdate: (data: Partial<FindEmailNodeData>) => void;
}) {
  const { data: providers, isLoading: loadingProviders } = useEnrichmentProviders();

  // Check which providers are connected
  const connectedProviders = new Set(
    providers?.filter((p) => p.isConnected).map((p) => p.provider) || []
  );
  const hasAnyProvider = connectedProviders.size > 0;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md text-sm text-amber-700 dark:text-amber-300">
        Find email addresses for contacts using enrichment providers like Apollo or Prospeo.
      </div>

      {/* Empty state if no providers connected */}
      {!loadingProviders && !hasAnyProvider && (
        <div className="p-4 border border-dashed border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                No email finder integrations connected
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Connect an enrichment provider like Apollo or Prospeo to find email addresses for your contacts.
              </p>
              <Button variant="outline" size="sm" asChild className="mt-2">
                <Link to="/settings?tab=enrichment">
                  <Settings className="h-4 w-4 mr-2" />
                  Connect Provider
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Provider selector (shown even without providers, but disabled) */}
      <div className="space-y-2">
        <Label>Email Finder Provider</Label>
        <Select
          value={data.provider || "auto"}
          onValueChange={(value) => onUpdate({ provider: value as EnrichmentProviderType | 'auto' })}
          disabled={loadingProviders || !hasAnyProvider}
        >
          <SelectTrigger aria-label="Email Finder Provider">
            <SelectValue placeholder={loadingProviders ? "Loading..." : "Select provider"}>
              {ENRICHMENT_PROVIDER_INFO[data.provider || 'auto']?.name || "Select provider"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto" textValue={ENRICHMENT_PROVIDER_INFO.auto.name}>
              <div className="flex flex-col">
                <span>{ENRICHMENT_PROVIDER_INFO.auto.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ENRICHMENT_PROVIDER_INFO.auto.description}
                </span>
              </div>
            </SelectItem>
            {(Object.keys(ENRICHMENT_PROVIDER_INFO) as (EnrichmentProviderType | 'auto')[])
              .filter((key) => key !== 'auto')
              .map((provider) => {
                const info = ENRICHMENT_PROVIDER_INFO[provider];
                const isConnected = connectedProviders.has(provider);
                return (
                  <SelectItem
                    key={provider}
                    value={provider}
                    disabled={!isConnected}
                    textValue={info.name}
                  >
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2">
                        {info.name}
                        {!isConnected && (
                          <span className="text-xs text-muted-foreground">(not connected)</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{info.description}</span>
                    </div>
                  </SelectItem>
                );
              })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {data.provider === 'auto'
            ? "Will try providers in priority order until email is found"
            : "Will only use this specific provider"}
        </p>
      </div>

      {/* Accept catch-all */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="accept-catch-all" className="font-normal">
            Accept catch-all emails
          </Label>
          <p className="text-xs text-muted-foreground">
            Include emails from domains that accept any address
          </p>
        </div>
        <Switch
          id="accept-catch-all"
          checked={data.acceptCatchAll === true}
          onCheckedChange={(checked) => onUpdate({ acceptCatchAll: checked })}
          disabled={!hasAnyProvider}
        />
      </div>

      {/* Validate email */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="validate-email" className="font-normal">
            Validate email deliverability
          </Label>
          <p className="text-xs text-muted-foreground">
            Run additional verification to check if email is deliverable
          </p>
        </div>
        <Switch
          id="validate-email"
          checked={data.validateEmail !== false}
          onCheckedChange={(checked) => onUpdate({ validateEmail: checked })}
          disabled={!hasAnyProvider}
        />
      </div>

      {/* Skip if has email */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="skip-has-email" className="font-normal">
            Skip if contact has email
          </Label>
          <p className="text-xs text-muted-foreground">
            Don't enrich if contact already has an email address
          </p>
        </div>
        <Switch
          id="skip-has-email"
          checked={data.skipIfHasEmail !== false}
          onCheckedChange={(checked) => onUpdate({ skipIfHasEmail: checked })}
          disabled={!hasAnyProvider}
        />
      </div>

      {/* Continue on failure */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="continue-failure" className="font-normal">
            Continue if email not found
          </Label>
          <p className="text-xs text-muted-foreground">
            Proceed to next step even if enrichment fails
          </p>
        </div>
        <Switch
          id="continue-failure"
          checked={data.continueOnFailure !== false}
          onCheckedChange={(checked) => onUpdate({ continueOnFailure: checked })}
          disabled={!hasAnyProvider}
        />
      </div>
    </div>
  );
}

function AnalyzeContactConfig({
  data,
  onUpdate,
}: {
  data: AnalyzeContactNodeData;
  onUpdate: (data: Partial<AnalyzeContactNodeData>) => void;
}) {
  const { models, isLoading: isLoadingModels, hasOpenRouterKey } = useLLMModels();
  const { products, isLoading: isLoadingProducts } = useProducts();

  const selectedProductName = products?.find((p) => p.id === data.productId)?.name;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-violet-50 dark:bg-violet-950/30 rounded-md text-sm text-violet-700 dark:text-violet-300">
        Run AI analysis on the contact's company and LinkedIn activity.
        Populates personalization variables like {"{{ai_company_niche}}"}, {"{{ai_primary_need}}"}, {"{{ai_best_hook}}"}, etc.
      </div>

      {/* AI Model Selection */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <Brain className="h-3.5 w-3.5" />
          AI Model
        </Label>
        {!hasOpenRouterKey ? (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-2.5">
            OpenRouter API key required.{" "}
            <Link to="/settings?tab=integrations" className="underline font-medium">
              Add in Settings
            </Link>
          </div>
        ) : isLoadingModels ? (
          <div className="h-9 border rounded-md bg-muted/50 flex items-center px-3">
            <span className="text-xs text-muted-foreground">Loading models...</span>
          </div>
        ) : (
          <SearchableSelect
            value={data.model || DEFAULT_LLM_MODEL}
            onValueChange={(v) => onUpdate({ model: v })}
            options={models}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
          />
        )}
      </div>

      {/* Product Context */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <Package className="h-3.5 w-3.5" />
          Product Context
          <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </Label>
        {isLoadingProducts ? (
          <div className="h-9 border rounded-md bg-muted/50 flex items-center px-3">
            <span className="text-xs text-muted-foreground">Loading products...</span>
          </div>
        ) : !products || products.length === 0 ? (
          <div className="text-xs text-muted-foreground border border-dashed rounded-md p-2.5">
            No products yet.{" "}
            <Link to="/assets?tab=products" className="text-primary underline font-medium">
              Add a product
            </Link>{" "}
            for tailored pain points.
          </div>
        ) : (
          <>
            <Select
              value={data.productId || "_none"}
              onValueChange={(v) => onUpdate({ productId: v === "_none" ? undefined : v })}
            >
              <SelectTrigger aria-label="Product Context" className="h-9 text-xs">
                <SelectValue>
                  {selectedProductName || "No product — generic analysis"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none" textValue="No product — generic analysis">
                  <span className="text-xs text-muted-foreground">No product — generic analysis</span>
                </SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    <span className="text-xs">{product.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {data.productId
                ? "Pain points and ICP matching will be tailored to this product."
                : "Select a product for relevant pain points and outreach hooks."}
            </p>
          </>
        )}
      </div>

      <div className="border-t pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="skip-enriched" className="font-normal">
              Skip if already enriched
            </Label>
            <p className="text-xs text-muted-foreground">
              Don't re-analyze contacts that already have AI data
            </p>
          </div>
          <Switch
            id="skip-enriched"
            checked={data.skipIfAlreadyEnriched !== false}
            onCheckedChange={(checked) => onUpdate({ skipIfAlreadyEnriched: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="analyze-continue-failure" className="font-normal">
              Continue if analysis fails
            </Label>
            <p className="text-xs text-muted-foreground">
              Proceed to next step even if AI analysis fails
            </p>
          </div>
          <Switch
            id="analyze-continue-failure"
            checked={data.continueOnFailure !== false}
            onCheckedChange={(checked) => onUpdate({ continueOnFailure: checked })}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// GENERATE EMAILS NODE CONFIGURATION
// ============================================================================

function GenerateEmailsConfig({
  data,
  onUpdate,
}: {
  data: GenerateEmailsNodeData;
  onUpdate: (data: Partial<GenerateEmailsNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-md text-sm text-emerald-700 dark:text-emerald-300">
        AI-generates personalized email content for each lead. Use{" "}
        <code className="text-xs bg-emerald-100 dark:bg-emerald-900/50 px-1 rounded">{"{{email_subject_1}}"}</code>,{" "}
        <code className="text-xs bg-emerald-100 dark:bg-emerald-900/50 px-1 rounded">{"{{email_body_1}}"}</code>,
        etc. as variables in downstream nodes.
      </div>

      <EmailCountSelector
        value={data.emailCount || 3}
        onChange={(emailCount) => onUpdate({ emailCount })}
      />

      <PromptEditor
        value={data.prompt || ""}
        onChange={(prompt) => onUpdate({ prompt })}
        variations={data.promptVariations || []}
        onVariationsChange={(promptVariations) => onUpdate({ promptVariations })}
        llmModel={data.llmModel}
        onModelChange={(llmModel) => onUpdate({ llmModel })}
        llmTemperature={data.llmTemperature}
        onTemperatureChange={(llmTemperature) => onUpdate({ llmTemperature })}
        messageType="emailSequence"
        emailCount={data.emailCount || 3}
        placeholder={`Write a ${data.emailCount || 3}-email cold outreach sequence to {{first_name}} at {{company}}. They operate in {{ai_company_niche}} and their primary need is {{ai_primary_need}}. Reference their focus on {{ai_priority_1}} and pitch our solution.`}
      />

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="skip-if-generated" className="font-normal">
              Skip if already generated
            </Label>
            <p className="text-xs text-muted-foreground">
              Don't regenerate if this lead already has email content
            </p>
          </div>
          <Switch
            id="skip-if-generated"
            checked={data.skipIfAlreadyGenerated !== false}
            onCheckedChange={(checked) => onUpdate({ skipIfAlreadyGenerated: checked })}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// NOTION NODE CONFIGURATIONS
// ============================================================================

function CreateNotionPageConfig({
  data,
  onUpdate,
}: {
  data: CreateNotionPageNodeData;
  onUpdate: (data: Partial<CreateNotionPageNodeData>) => void;
}) {
  const { data: connections, isLoading: connectionsLoading } = useToolConnections("notion");
  const { data: databases, isLoading: databasesLoading } = useNotionDatabases(data.connectionId);
  const { products, isLoading: productsLoading } = useProducts();

  const hasConnections = connections && connections.length > 0;
  const hasCustomBlueprint = data.blueprintIds?.includes("custom");

  return (
    <div className="space-y-4">
      <div className="p-3 bg-neutral-50 dark:bg-neutral-900/40 rounded-md text-sm text-neutral-700 dark:text-neutral-300">
        Generate a personalized Notion preview page for each contact using AI.
        The page URL will be available as {"{{notion_preview_url}}"} in subsequent steps.
      </div>

      {/* Empty state if no Notion connections */}
      {!connectionsLoading && !hasConnections && (
        <div className="p-4 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50/50 dark:bg-neutral-950/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-neutral-500 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-medium text-neutral-700 dark:text-neutral-300">
                No Notion connections found
              </p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Connect your Notion workspace to generate preview pages.
              </p>
              <Button variant="outline" size="sm" asChild className="mt-2">
                <Link to="/settings?tab=email-tools">
                  <Settings className="h-4 w-4 mr-2" />
                  Connect Notion
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Notion Connection */}
      <div className="space-y-2">
        <Label>Notion Connection</Label>
        <Select
          value={data.connectionId || ""}
          onValueChange={(value) => onUpdate({ connectionId: value, databaseId: undefined })}
          disabled={connectionsLoading || !hasConnections}
        >
          <SelectTrigger aria-label="Notion Connection">
            <SelectValue placeholder={connectionsLoading ? "Loading..." : "Select connection"} />
          </SelectTrigger>
          <SelectContent>
            {connections?.map((conn) => (
              <SelectItem key={conn.id} value={conn.id}>
                {conn.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Notion Database */}
      {data.connectionId && (
        <div className="space-y-2">
          <Label>Notion Database</Label>
          <Select
            value={data.databaseId || ""}
            onValueChange={(value) => onUpdate({ databaseId: value })}
            disabled={databasesLoading}
          >
            <SelectTrigger aria-label="Notion Database">
              <SelectValue placeholder={databasesLoading ? "Loading databases..." : "Select database"} />
            </SelectTrigger>
            <SelectContent>
              {databases?.map((db) => (
                <SelectItem key={db.id} value={db.id}>
                  {db.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Pages will be created in this database
          </p>
        </div>
      )}

      {/* Product (optional) */}
      <div className="space-y-2">
        <Label>Product (Optional)</Label>
        <Select
          value={data.productId || "none"}
          onValueChange={(value) => onUpdate({ productId: value === "none" ? undefined : value })}
          disabled={productsLoading}
        >
          <SelectTrigger aria-label="Product (Optional)">
            <SelectValue placeholder={productsLoading ? "Loading..." : "No product"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No product</SelectItem>
            {products?.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Product context adds domain expertise to the AI-generated page
        </p>
      </div>

      {/* Blueprint Selection */}
      <div className="space-y-2">
        <Label>Blueprint(s)</Label>
        <div className="space-y-2">
          {NOTION_BLUEPRINTS.map((blueprint) => {
            const isSelected = data.blueprintIds?.includes(blueprint.id) || false;
            return (
              <button
                key={blueprint.id}
                type="button"
                className={`w-full text-left p-3 rounded-md border transition-colors ${
                  isSelected
                    ? "border-neutral-600 bg-neutral-100 dark:bg-neutral-800"
                    : "border-border hover:border-neutral-400 hover:bg-accent"
                }`}
                onClick={() => {
                  const current = data.blueprintIds || [];
                  const updated = isSelected
                    ? current.filter((id) => id !== blueprint.id)
                    : [...current, blueprint.id];
                  onUpdate({ blueprintIds: updated.length > 0 ? updated : ["strategic-growth"] });
                }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base shrink-0">{blueprint.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{blueprint.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{blueprint.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Prompt (shown when custom blueprint selected) */}
      {hasCustomBlueprint && (
        <div className="space-y-2">
          <Label>Custom Prompt</Label>
          <Textarea aria-label="Custom Prompt"
            value={data.customPrompt || ""}
            onChange={(e) => onUpdate({ customPrompt: e.target.value })}
            placeholder="Describe what the Notion page should contain. Use variables like {{first_name}}, {{company}}, {{ai_company_niche}}..."
            className="min-h-[120px]"
          />
        </div>
      )}

      {/* ICP Threshold */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>ICP Threshold</Label>
          <Badge variant="secondary" className="font-mono text-xs">{data.icpThreshold || 0}</Badge>
        </div>
        <Slider aria-label="ICP Threshold"
          value={[data.icpThreshold || 0]}
          onValueChange={([value]) => onUpdate({ icpThreshold: value })}
          min={0}
          max={90}
          step={5}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          {data.icpThreshold
            ? `Skip contacts with ICP score below ${data.icpThreshold}`
            : "Generate for all contacts (no filtering)"}
        </p>
      </div>

      {/* Continue on failure */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="notion-continue-failure" className="font-normal">
            Continue if generation fails
          </Label>
          <p className="text-xs text-muted-foreground">
            Proceed to next step even if Notion page generation fails
          </p>
        </div>
        <Switch
          id="notion-continue-failure"
          checked={data.continueOnFailure !== false}
          onCheckedChange={(checked) => onUpdate({ continueOnFailure: checked })}
        />
      </div>
    </div>
  );
}

const VERIFY_PROVIDER_OPTIONS: Array<{ value: VerifyEmailProvider; label: string; hint: string }> = [
  { value: "lite", label: "Lite", hint: "Free · heuristic checks" },
  { value: "apify_million_verifier", label: "Full", hint: "~$0.001/email · SMTP probe" },
  { value: "mailtester_ninja", label: "Mailtester Ninja", hint: "Your own key" },
];

function VerifyEmailConfig({
  data,
  onUpdate,
}: {
  data: VerifyEmailNodeData;
  onUpdate: (data: Partial<VerifyEmailNodeData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-violet-50 dark:bg-violet-950/30 rounded-md text-sm text-violet-700 dark:text-violet-300 flex items-start gap-2">
        <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
        Verifies the contact's email, then branches: <strong>clean</strong> / <strong>risky</strong> / <strong>failed</strong>.
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Verification provider</Label>
        <Select
          value={data.provider || "mailtester_ninja"}
          onValueChange={(v) => onUpdate({ provider: v as VerifyEmailProvider })}
        >
          <SelectTrigger aria-label="Verification provider" className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERIFY_PROVIDER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} textValue={opt.label}>
                <span className="font-medium">{opt.label}</span>
                <span className="text-muted-foreground"> · {opt.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="verify-skip" className="text-sm">Skip if recently verified</Label>
        <Switch
          id="verify-skip"
          checked={data.skipIfAlreadyVerified !== false}
          onCheckedChange={(checked) => onUpdate({ skipIfAlreadyVerified: checked })}
        />
      </div>
    </div>
  );
}

function ConditionIcpScoreConfig({
  data,
  onUpdate,
}: {
  data: ConditionIcpScoreNodeData;
  onUpdate: (data: Partial<ConditionIcpScoreNodeData>) => void;
}) {
  const { products, isLoading } = useProducts();
  const minScore = data.minScore ?? 50;
  const scoreType = data.scoreType || "icp";
  const selectedProductName = products?.find((p) => p.id === data.productId)?.name;
  const scoreLabel = scoreType === "dm" ? "decision-maker fit" : "ICP fit";

  return (
    <div className="space-y-4">
      <div className="p-3 bg-violet-50 dark:bg-violet-950/30 rounded-md text-sm text-violet-700 dark:text-violet-300 flex items-start gap-2">
        <Target className="h-4 w-4 mt-0.5 shrink-0" />
        Branches on the contact's {scoreLabel} score: <strong>pass</strong> (≥ threshold) or <strong>fail</strong>.
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Score</Label>
        <Select
          value={scoreType}
          onValueChange={(v) => onUpdate({ scoreType: v as "icp" | "dm" })}
        >
          <SelectTrigger aria-label="Score" className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="icp" textValue="ICP fit (company)">ICP fit (company)</SelectItem>
            <SelectItem value="dm" textValue="Decision-maker fit (person)">Decision-maker fit (person)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <Package className="h-3.5 w-3.5" /> Product
          <span className="text-xs font-normal text-muted-foreground">(defaults to campaign product)</span>
        </Label>
        {isLoading ? (
          <div className="h-9 border rounded-md bg-muted/50 flex items-center px-3">
            <span className="text-xs text-muted-foreground">Loading products...</span>
          </div>
        ) : (
          <Select
            value={data.productId || "_campaign"}
            onValueChange={(v) => onUpdate({ productId: v === "_campaign" ? undefined : v })}
          >
            <SelectTrigger aria-label="Product" className="h-9 text-xs">
              <SelectValue>{selectedProductName || "Use campaign product"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_campaign" textValue="Use campaign product">Use campaign product</SelectItem>
              {(products || []).map((p) => (
                <SelectItem key={p.id} value={p.id} textValue={p.name}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Minimum {scoreType === "dm" ? "decision-maker" : "ICP"} score</Label>
          <span className="text-sm font-semibold tabular-nums">{minScore}</span>
        </div>
        <Slider
          aria-label={`Minimum ${scoreType === "dm" ? "decision-maker" : "ICP"} score`}
          value={[minScore]}
          onValueChange={([v]) => onUpdate({ minScore: v })}
          max={100}
          step={5}
        />
      </div>
    </div>
  );
}

function AddToListConfig({
  data,
  onUpdate,
}: {
  data: AddToListNodeData;
  onUpdate: (data: Partial<AddToListNodeData>) => void;
}) {
  const { leadLists, isLoading } = useLeadLists();
  // Static lists only — can't add members to a smart (filter-defined) list.
  const staticLists = (leadLists || []).filter((l) => !l.is_smart);
  const selectedListName = staticLists.find((l) => l.id === data.listId)?.name;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-md text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
        <ListPlus className="h-4 w-4 mt-0.5 shrink-0" />
        Adds the contact to another lead list when it reaches this node (e.g. collect verified + high-ICP survivors).
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Target list</Label>
        {isLoading ? (
          <div className="h-9 border rounded-md bg-muted/50 flex items-center px-3">
            <span className="text-xs text-muted-foreground">Loading lists...</span>
          </div>
        ) : staticLists.length === 0 ? (
          <div className="text-xs text-muted-foreground border border-dashed rounded-md p-2.5">
            No static lists yet. Create one in Lead Lists first.
          </div>
        ) : (
          <Select
            value={data.listId || "_none"}
            onValueChange={(v) => onUpdate({ listId: v === "_none" ? undefined : v })}
          >
            <SelectTrigger aria-label="Target list" className="h-9 text-xs">
              <SelectValue>{selectedListName || "Choose a list…"}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[260px]">
              <SelectItem value="_none" textValue="Choose a list…">Choose a list…</SelectItem>
              {staticLists.map((l) => (
                <SelectItem key={l.id} value={l.id} textValue={l.name}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
