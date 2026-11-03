import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  ChevronRight,
  FileText,
  GitBranch,
  Plus,
  Search,
  HelpCircle,
  ShieldAlert,
  Timer,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCompletedKnowledgeDocuments } from "@/hooks/useKnowledgeBase";
import { useGHLCalendars } from "@/hooks/useGHLCalendars";
import { useGHLAccounts } from "@/hooks/useGHLAccounts";
import { normalizeAgentConfig } from "@/hooks/useAgentProfiles";
import type { AutopilotConfig, AutopilotRule, EscalationRule } from "@/types/email";
import { LEAD_INTENT_LABELS } from "@/types/classification";

const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET) — New York" },
  { value: "America/Chicago", label: "Central Time (CT) — Chicago" },
  { value: "America/Denver", label: "Mountain Time (MT) — Denver" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT) — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska Time — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii Time — Honolulu" },
  { value: "America/Toronto", label: "Eastern Time — Toronto" },
  { value: "America/Vancouver", label: "Pacific Time — Vancouver" },
  { value: "Europe/London", label: "GMT/BST — London" },
  { value: "Europe/Paris", label: "CET/CEST — Paris" },
  { value: "Europe/Berlin", label: "CET/CEST — Berlin" },
  { value: "Europe/Amsterdam", label: "CET/CEST — Amsterdam" },
  { value: "Europe/Madrid", label: "CET/CEST — Madrid" },
  { value: "Europe/Rome", label: "CET/CEST — Rome" },
  { value: "Europe/Zurich", label: "CET/CEST — Zurich" },
  { value: "Europe/Stockholm", label: "CET/CEST — Stockholm" },
  { value: "Europe/Helsinki", label: "EET/EEST — Helsinki" },
  { value: "Europe/Athens", label: "EET/EEST — Athens" },
  { value: "Europe/Istanbul", label: "TRT — Istanbul" },
  { value: "Asia/Dubai", label: "GST — Dubai" },
  { value: "Asia/Kolkata", label: "IST — India" },
  { value: "Asia/Singapore", label: "SGT — Singapore" },
  { value: "Asia/Hong_Kong", label: "HKT — Hong Kong" },
  { value: "Asia/Tokyo", label: "JST — Tokyo" },
  { value: "Asia/Seoul", label: "KST — Seoul" },
  { value: "Australia/Sydney", label: "AEST/AEDT — Sydney" },
  { value: "Australia/Melbourne", label: "AEST/AEDT — Melbourne" },
  { value: "Pacific/Auckland", label: "NZST/NZDT — Auckland" },
  { value: "America/Sao_Paulo", label: "BRT — São Paulo" },
  { value: "America/Mexico_City", label: "CST — Mexico City" },
  { value: "Africa/Johannesburg", label: "SAST — Johannesburg" },
  { value: "Africa/Lagos", label: "WAT — Lagos" },
  { value: "UTC", label: "UTC — Coordinated Universal Time" },
];

interface AgentSettingsPanelProps {
  config: AutopilotConfig;
  onChange: (config: AutopilotConfig) => void;
  context: "email_sequence" | "linkedin_campaign" | "lead_magnet" | "conversation";
  className?: string;
}

interface SettingsSection {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  content: React.ReactNode;
}

export function AgentSettingsPanel({
  config: rawConfig,
  onChange,
  context,
  className,
}: AgentSettingsPanelProps) {
  const config: AutopilotConfig = normalizeAgentConfig(rawConfig);
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["agent_config"])
  );
  const [kbSearchQuery, setKbSearchQuery] = useState("");
  const { data: knowledgeDocuments } = useCompletedKnowledgeDocuments();
  const { data: ghlAccountsData } = useGHLAccounts();
  const ghlConnected = !!(ghlAccountsData?.success && !ghlAccountsData?.needsOAuth && !ghlAccountsData?.needsReconnect);
  const { data: ghlCalendars } = useGHLCalendars({ enabled: ghlConnected });

  const toggleSection = (id: string) => {
    const next = new Set(openSections);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setOpenSections(next);
  };

  const updateConfig = (update: Partial<AutopilotConfig>) => {
    onChange({ ...config, ...update });
  };

  const addRule = () => {
    updateConfig({
      rules: [...config.rules, { intent: "interested", action: "draft_for_approval" }],
    });
  };

  const removeRule = (index: number) => {
    updateConfig({
      rules: config.rules.filter((_, i) => i !== index),
    });
  };

  const updateRule = (index: number, update: Partial<AutopilotRule>) => {
    const newRules = [...config.rules];
    newRules[index] = { ...newRules[index], ...update };
    updateConfig({ rules: newRules });
  };

  const addEscalationRule = () => {
    updateConfig({
      escalation_rules: [
        ...(config.escalation_rules || []),
        { condition: "low_confidence", threshold: 0.4 },
      ],
    });
  };

  const removeEscalationRule = (index: number) => {
    updateConfig({
      escalation_rules: (config.escalation_rules || []).filter((_, i) => i !== index),
    });
  };

  const updateEscalationRule = (index: number, update: Partial<EscalationRule>) => {
    const rules = [...(config.escalation_rules || [])];
    rules[index] = { ...rules[index], ...update };
    updateConfig({ escalation_rules: rules });
  };

  const actionOptions: { value: AutopilotRule["action"]; label: string; hint: string }[] = [
    { value: "draft_for_approval", label: "Draft for Approval", hint: "AI drafts a reply and queues it for your review" },
    { value: "auto_reply", label: "Auto Reply", hint: config.require_approval ? "AI drafts a reply, queued for your approval" : "AI generates and sends a reply automatically" },
    { value: "send_calendly", label: "Send Calendly Link", hint: config.require_approval ? "AI drafts a message with your link, queued for approval" : "AI sends a message with your Calendly link automatically" },
    { value: "book_ghl_appointment", label: "Book GHL Appointment", hint: "AI checks your GHL calendar availability, suggests times, and books when the contact confirms" },
    { value: "auto_followup_after_return", label: "Follow Up After OOO", hint: "Snoozes the conversation until the contact is back" },
    { value: "escalate", label: "Escalate to Human", hint: "Stops autopilot and flags the conversation for human attention" },
  ];

  const escalationConditionLabels: Record<EscalationRule["condition"], { label: string; description: string }> = {
    low_confidence: { label: "Low Confidence Score", description: "Escalate when AI classification confidence is below the threshold" },
    hostile_sentiment: { label: "Hostile Sentiment", description: "Escalate when the contact appears hostile or requests no contact" },
    explicit_request: { label: "Human Requested", description: "Escalate when the contact explicitly asks for a real person" },
    max_turns: { label: "Max Turns Reached", description: "Escalate when the conversation reaches the turn limit" },
    custom_keyword: { label: "Custom Keywords", description: "Escalate when specific keywords are detected in messages" },
  };

  const sections: SettingsSection[] = [
    {
      id: "agent_config",
      label: "Agent Configuration",
      icon: Bot,
      badge: config.enabled ? "On" : undefined,
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable Autopilot</Label>
              <p className="text-xs text-muted-foreground">
                Activate AI auto-reply for this {context === "email_sequence" ? "sequence" : context === "linkedin_campaign" ? "campaign" : "lead magnet"}
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => updateConfig({ enabled: checked })}
            />
          </div>

          {config.enabled && (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm">Conversation Goal</Label>
                <Textarea
                  rows={2}
                  placeholder="Book a demo meeting, qualify the lead, gather requirements..."
                  value={config.conversation_goal || ""}
                  onChange={(e) => updateConfig({ conversation_goal: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  What should the agent try to achieve in conversations?
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">System Instructions</Label>
                <Textarea
                  rows={3}
                  placeholder="Always mention our free trial. Never discuss pricing unless asked."
                  value={config.system_instructions || ""}
                  onChange={(e) => updateConfig({ system_instructions: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Custom rules and guidelines for the agent
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-sm">Knowledge Base</Label>
                    <p className="text-xs text-muted-foreground">
                      Ground agent responses in your company knowledge
                    </p>
                  </div>
                  <Switch
                    checked={config.use_knowledge_base || false}
                    onCheckedChange={(checked) => updateConfig({
                      use_knowledge_base: checked,
                      ...(!checked ? { knowledge_document_ids: undefined } : {}),
                    })}
                  />
                </div>

                {config.use_knowledge_base && (
                  <>
                    {!knowledgeDocuments || knowledgeDocuments.length === 0 ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        No knowledge documents uploaded yet. Upload documents in <Link to="/assets" className="underline hover:text-amber-700 dark:hover:text-amber-300">Assets</Link>.
                      </p>
                    ) : (
                      <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              type="text"
                              placeholder="Search documents..."
                              value={kbSearchQuery}
                              onChange={(e) => setKbSearchQuery(e.target.value)}
                              className="pl-8 h-7 text-xs"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px] px-2"
                              onClick={() => updateConfig({ knowledge_document_ids: knowledgeDocuments.map((d) => d.id) })}
                            >
                              All
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px] px-2"
                              onClick={() => updateConfig({ knowledge_document_ids: [] })}
                              disabled={!config.knowledge_document_ids?.length}
                            >
                              Clear
                            </Button>
                          </div>
                        </div>

                        <p className="text-[11px] text-muted-foreground">
                          {config.knowledge_document_ids?.length
                            ? `${config.knowledge_document_ids.length} of ${knowledgeDocuments.length} documents selected`
                            : `All ${knowledgeDocuments.length} documents (no filter)`}
                        </p>

                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                          {knowledgeDocuments
                            .filter((doc) =>
                              !kbSearchQuery ||
                              doc.name.toLowerCase().includes(kbSearchQuery.toLowerCase()) ||
                              doc.description?.toLowerCase().includes(kbSearchQuery.toLowerCase())
                            )
                            .map((doc) => {
                              const isChecked = config.knowledge_document_ids?.includes(doc.id) ?? false;
                              return (
                                <label
                                  key={doc.id}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      const current = config.knowledge_document_ids || [];
                                      updateConfig({
                                        knowledge_document_ids: checked
                                          ? [...current, doc.id]
                                          : current.filter((id) => id !== doc.id),
                                      });
                                    }}
                                  />
                                  <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                  <span className="text-xs truncate flex-1">{doc.name}</span>
                                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                    {doc.chunk_count} chunks
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm">Tone Matching</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-xs">
                        Analyzes your last 20 sent messages to learn your writing style (formality, greetings, sentence length, emoji usage) and applies it to AI-generated replies so they sound like you.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Match your writing style from past messages
                  </p>
                </div>
                <Switch
                  checked={config.use_tone_profile || false}
                  onCheckedChange={(checked) => updateConfig({ use_tone_profile: checked })}
                  className="shrink-0"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm">Require Approval</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-xs">
                        When enabled, AI drafts are queued for your review before being sent. When off, the agent sends replies automatically — recommended only after testing.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {config.require_approval
                      ? "All AI-generated replies go to your approval queue before sending"
                      : "AI replies are sent automatically without human review"}
                  </p>
                </div>
                <Switch
                  checked={config.require_approval}
                  onCheckedChange={(checked) => updateConfig({ require_approval: checked })}
                  className="shrink-0"
                />
              </div>

              {!config.require_approval && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Auto Reply and Send Calendly actions will send messages without your review. Draft for Approval and Escalate always require review.
                  </p>
                </div>
              )}

              {ghlConnected && (
                <div className="space-y-4 rounded-md border border-border/50 p-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Booking Calendar</Label>
                    {!ghlCalendars || ghlCalendars.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No calendars found in your LeadConnector location. Create a calendar in GoHighLevel first.
                      </p>
                    ) : (
                      <Select
                        value={config.ghl_calendar_id || ""}
                        onValueChange={(v) => {
                          const calendarId = v || undefined;
                          const update: Partial<AutopilotConfig> = { ghl_calendar_id: calendarId };

                          if (calendarId) {
                            // Auto-add a booking rule if none exists
                            const hasBookingRule = config.rules.some((r) => r.action === 'book_ghl_appointment');
                            if (!hasBookingRule) {
                              update.rules = [
                                ...config.rules,
                                { intent: 'meeting_booked', action: 'book_ghl_appointment' as const, ghl_calendar_id: calendarId },
                              ];
                            } else {
                              // Update existing booking rule's calendar ID
                              update.rules = config.rules.map((r) =>
                                r.action === 'book_ghl_appointment' ? { ...r, ghl_calendar_id: calendarId } : r
                              );
                            }
                          } else {
                            // Calendar cleared — remove booking rules
                            update.rules = config.rules.filter((r) => r.action !== 'book_ghl_appointment');
                          }

                          updateConfig(update);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs [&>span]:truncate">
                          <SelectValue placeholder="Select calendar for auto-booking..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ghlCalendars.map((cal) => (
                            <SelectItem key={cal.calendar_id} value={cal.calendar_id}>
                              <span className="truncate">{cal.calendar_name}</span>
                              {cal.calendar_type && (
                                <span className="text-[10px] text-muted-foreground ml-1.5 shrink-0">
                                  ({cal.calendar_type})
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <p className="text-xs text-muted-foreground">
                      When a contact asks to schedule, the AI will automatically check availability and book into this calendar
                    </p>
                  </div>

                  {config.ghl_calendar_id && (
                    <div className="space-y-1.5">
                      <Label className="text-sm">Booking Timezone</Label>
                      <Select
                        value={config.booking_timezone || ""}
                        onValueChange={(v) => updateConfig({ booking_timezone: v })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select timezone for calendar slots..." />
                        </SelectTrigger>
                        <SelectContent>
                          {COMMON_TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        The AI will present available times in this timezone
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      id: "limits",
      label: "Conversation Limits",
      icon: Timer,
      content: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Max Auto-Replies</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={config.max_auto_replies}
              onChange={(e) =>
                updateConfig({ max_auto_replies: parseInt(e.target.value) || 3 })
              }
              className="w-20"
            />
            <p className="text-xs text-muted-foreground">
              Stop autopilot after this many AI replies per conversation
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Max Conversation Turns</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={config.max_conversation_turns || 10}
              onChange={(e) =>
                updateConfig({ max_conversation_turns: parseInt(e.target.value) || 10 })
              }
              className="w-20"
            />
            <p className="text-xs text-muted-foreground">
              Agent escalates to human after this many back-and-forth exchanges
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "intent_rules",
      label: "Intent Rules",
      icon: GitBranch,
      badge:
        config.rules.length > 0
          ? `${config.rules.length} rule${config.rules.length !== 1 ? "s" : ""}`
          : undefined,
      content: (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Rules</Label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={addRule}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Rule
            </Button>
          </div>

          {config.rules.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Bot className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                No rules yet. Add a rule to define how AI handles each intent.
              </p>
            </div>
          )}

          {config.rules.map((rule, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded-lg border bg-muted/30"
            >
              <div className="flex-1 space-y-2">
                <Select
                  value={rule.intent}
                  onValueChange={(v) => updateRule(i, { intent: v })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEAD_INTENT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={rule.action}
                  onValueChange={(v) =>
                    updateRule(i, { action: v as AutopilotRule["action"] })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {actionOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {actionOptions.find((o) => o.value === rule.action)?.hint}
                </p>
                {rule.action === "send_calendly" && (
                  <Input
                    placeholder="https://calendly.com/..."
                    value={rule.calendly_link || ""}
                    onChange={(e) => updateRule(i, { calendly_link: e.target.value })}
                    className="h-7 text-xs"
                  />
                )}
                {rule.action === "book_ghl_appointment" && (
                  <div className="space-y-1">
                    {!ghlConnected ? (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        Connect LeadConnector in{" "}
                        <Link to="/settings" className="underline hover:text-amber-700 dark:hover:text-amber-300">
                          Settings → Integrations
                        </Link>{" "}
                        to use this action
                      </p>
                    ) : !ghlCalendars || ghlCalendars.length === 0 ? (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        No calendars found in your GHL location. Create a calendar in GoHighLevel first.
                      </p>
                    ) : (
                      <Select
                        value={rule.ghl_calendar_id || ""}
                        onValueChange={(v) => updateRule(i, { ghl_calendar_id: v })}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select GHL Calendar..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ghlCalendars.map((cal) => (
                            <SelectItem key={cal.calendar_id} value={cal.calendar_id}>
                              <div className="flex items-center gap-2">
                                <span>{cal.calendar_name}</span>
                                {cal.calendar_type && (
                                  <span className="text-[10px] text-muted-foreground">
                                    ({cal.calendar_type})
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRule(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "escalation",
      label: "Escalation Settings",
      icon: ShieldAlert,
      badge:
        (config.escalation_rules?.length || 0) > 0
          ? `${config.escalation_rules!.length} rule${config.escalation_rules!.length !== 1 ? "s" : ""}`
          : undefined,
      content: (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Escalation Rules</Label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={addEscalationRule}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Escalation Rule
            </Button>
          </div>

          {(!config.escalation_rules || config.escalation_rules.length === 0) && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <ShieldAlert className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                No escalation rules. The agent will hand off only when max conversation turns is reached.
              </p>
            </div>
          )}

          {(config.escalation_rules || []).map((rule, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded-lg border bg-muted/30"
            >
              <div className="flex-1 space-y-2">
                <Select
                  value={rule.condition}
                  onValueChange={(v) =>
                    updateEscalationRule(i, { condition: v as EscalationRule["condition"] })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(escalationConditionLabels).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="text-[10px] text-muted-foreground leading-tight">
                  {escalationConditionLabels[rule.condition]?.description}
                </p>

                {rule.condition === "low_confidence" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Threshold</Label>
                      <span className="text-xs font-mono text-muted-foreground">
                        {(rule.threshold ?? 0.4).toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      min={0.3}
                      max={0.8}
                      step={0.05}
                      value={[rule.threshold ?? 0.4]}
                      onValueChange={([v]) => updateEscalationRule(i, { threshold: v })}
                    />
                  </div>
                )}

                {rule.condition === "custom_keyword" && (
                  <Input
                    placeholder="cancel, refund, lawsuit (comma-separated)"
                    value={(rule.keywords || []).join(", ")}
                    onChange={(e) =>
                      updateEscalationRule(i, {
                        keywords: e.target.value
                          .split(",")
                          .map((k) => k.trim())
                          .filter(Boolean),
                      })
                    }
                    className="h-7 text-xs"
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeEscalationRule(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className={cn("space-y-1", className)}>
      {sections.map((section) => (
        <Collapsible
          key={section.id}
          open={openSections.has(section.id)}
          onOpenChange={() => toggleSection(section.id)}
        >
          <CollapsibleTrigger className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left">
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                openSections.has(section.id) && "rotate-90"
              )}
            />
            <section.icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium flex-1">{section.label}</span>
            {section.badge && (
              <Badge
                variant="secondary"
                className="text-[10px] font-normal"
              >
                {section.badge}
              </Badge>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-4 pt-2">
            {section.content}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
