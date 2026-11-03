import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  ChevronRight,
  Mail,
  MessageSquare,
  Target,
  Bot,
  GitBranch,
  Info,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmailSequences } from "@/hooks/useEmailSequences";
import { useICPs } from "@/hooks/useICPs";
import type { AutopilotConfig } from "@/types/email";
import { FollowupRulesPanel } from "@/components/email/FollowupRulesPanel";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { CreateAgentDialog } from "@/components/autopilot/CreateAgentDialog";
import { AgentEditConfirmDialog } from "@/components/autopilot/AgentEditConfirmDialog";
import { useAgentProfiles, useUpdateAgentProfile } from "@/hooks/useAgentProfiles";

type AiMode = "chatbot_only" | "autopilot_only" | "chatbot_smart";

interface SmartConfig {
  email_capture_sequence_id: string | null;
  followup_enabled: boolean;
  followup_delay_hours: number;
  followup_message_1: string;
  followup_message_2: string;
  max_followups: number;
  icp_routing_enabled: boolean;
  icp_product_id: string | null;
  high_icp_threshold: number;
  low_icp_action: "ai_auto" | "skip";
}

const DEFAULT_SMART_CONFIG: SmartConfig = {
  email_capture_sequence_id: null,
  followup_enabled: false,
  followup_delay_hours: 72,
  followup_message_1: "",
  followup_message_2: "",
  max_followups: 2,
  icp_routing_enabled: false,
  icp_product_id: null,
  high_icp_threshold: 70,
  low_icp_action: "ai_auto",
};

const AI_MODE_OPTIONS: {
  value: AiMode;
  label: string;
  description: string;
  detail: string;
  recommended?: boolean;
}[] = [
  {
    value: "chatbot_only",
    label: "AI Chatbot",
    description: "Multi-turn AI nurture with your knowledge base",
    detail:
      "The chatbot handles all DM replies using RAG-powered responses. It nurtures leads across multiple turns, answers questions from your knowledge base, and hands off to you when a lead requests a human or hits a handoff keyword. Best for high-touch, education-heavy funnels.",
    recommended: true,
  },
  {
    value: "autopilot_only",
    label: "Autopilot",
    description: "Classify replies by intent, route with rules",
    detail:
      "Every reply is classified by AI (interested, not interested, OOO, etc.) and routed through your autopilot rules — no chatbot involved. Works like your email sequences and LinkedIn campaigns. Best for simple funnels where you want consistent intent-based routing.",
  },
  {
    value: "chatbot_smart",
    label: "Chatbot + Rules",
    description: "Chatbot nurtures, rules fire on handoff",
    detail:
      "The chatbot handles conversations as usual, but every reply is also classified in the background. When a conversation is handed off (lead asks for human, max turns reached), follow-up rules evaluate the lead's intent and can auto-enroll them in email sequences. Best of both worlds.",
  },
];

interface LeadMagnetSmartSettingsProps {
  smartConfig: Partial<SmartConfig>;
  onSmartConfigChange: (config: SmartConfig) => void;
  autopilotConfig?: AutopilotConfig | null;
  onAutopilotChange?: (config: AutopilotConfig) => void;
  aiMode?: AiMode;
  onAiModeChange?: (mode: AiMode) => void;
  agentProfileId?: string | null;
  onAgentProfileChange?: (profileId: string | null, config: AutopilotConfig) => void;
  campaignId: string;
  className?: string;
}

export function LeadMagnetSmartSettings({
  smartConfig: rawConfig,
  onSmartConfigChange,
  autopilotConfig,
  onAutopilotChange,
  aiMode: aiModeProp,
  onAiModeChange,
  agentProfileId,
  onAgentProfileChange,
  campaignId,
  className,
}: LeadMagnetSmartSettingsProps) {
  const config = { ...DEFAULT_SMART_CONFIG, ...rawConfig };
  const aiMode = aiModeProp || "chatbot_only";
  const { data: sequences } = useEmailSequences();
  const { icps } = useICPs();
  const { data: agentProfiles } = useAgentProfiles();
  const updateAgentProfile = useUpdateAgentProfile();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AutopilotConfig | null>(null);
  const [createFromConfig, setCreateFromConfig] = useState<AutopilotConfig | null>(null);

  const selectedAgentProfile = agentProfiles?.find((p) => p.id === agentProfileId);

  const handleAutopilotChange = (config: AutopilotConfig) => {
    if (agentProfileId) {
      // Profile attached — ask user whether to update globally or save as new
      setPendingConfig(config);
      setEditConfirmOpen(true);
    } else {
      // No profile — save inline as before
      onAutopilotChange?.(config);
    }
  };

  const handleUpdateAgent = () => {
    if (!pendingConfig || !agentProfileId) return;
    updateAgentProfile.mutate(
      { id: agentProfileId, config: pendingConfig },
      {
        onSuccess: () => {
          onAutopilotChange?.(pendingConfig);
          setPendingConfig(null);
          setEditConfirmOpen(false);
        },
      }
    );
  };

  const handleSaveAsNew = () => {
    if (!pendingConfig) return;
    setCreateFromConfig(pendingConfig);
    setEditConfirmOpen(false);
    setPendingConfig(null);
    setCreateAgentOpen(true);
  };

  const toggleSection = (id: string) => {
    const next = new Set(openSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenSections(next);
  };

  const updateConfig = (update: Partial<SmartConfig>) => {
    onSmartConfigChange({ ...config, ...update });
  };

  const activeSequences = (sequences || []).filter(
    (s) => s.status === "active"
  );
  const showAutopilot =
    aiMode === "autopilot_only" || aiMode === "chatbot_smart";
  const currentModeOption = AI_MODE_OPTIONS.find((o) => o.value === aiMode);

  // ─── Section Definitions ──────────────────────────────────────────────
  // Order: Autopilot (conditional) → Sequence Enrollment Rules → Email Capture → Reminder DMs → Lead Prioritization

  const sections = [
    // Chatbot Agent — only for chatbot_only mode
    {
      id: "chatbot_agent",
      label: "AI Agent",
      icon: Bot,
      badge: agentProfileId ? "Loaded" : undefined,
      visible: aiMode === "chatbot_only",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Load a saved agent profile to configure the chatbot's instructions, knowledge base, and conversation settings.
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Agent profile</Label>
              {agentProfileId && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => onAgentProfileChange?.(null, autopilotConfig || { enabled: false, rules: [], require_approval: true, max_auto_replies: 3 })}
                >
                  Clear
                </button>
              )}
            </div>
            <AgentProfileSelector
              selectedProfileId={agentProfileId ?? null}
              onSelect={(profile) => onAgentProfileChange?.(profile.id, profile.config)}
              onCreateNew={() => setCreateAgentOpen(true)}
            />
          </div>
        </div>
      ),
    },

    // Autopilot Rules — only for autopilot_only or chatbot_smart
    {
      id: "autopilot",
      label: "Autopilot Rules",
      icon: Bot,
      badge: autopilotConfig?.enabled ? "On" : undefined,
      visible: showAutopilot,
      content: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Load from saved agent profile</Label>
              {agentProfileId && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => onAgentProfileChange?.(null, autopilotConfig || { enabled: false, rules: [], require_approval: true, max_auto_replies: 3 })}
                >
                  Clear
                </button>
              )}
            </div>
            <AgentProfileSelector
              selectedProfileId={agentProfileId ?? null}
              onSelect={(profile) => onAgentProfileChange?.(profile.id, profile.config)}
              onCreateNew={() => setCreateAgentOpen(true)}
            />
          </div>
          <AgentSettingsPanel
            config={autopilotConfig || { enabled: false, rules: [], require_approval: true, max_auto_replies: 3 }}
            onChange={handleAutopilotChange}
            context="lead_magnet"
          />
        </div>
      ),
    },

    // Sequence Enrollment Rules — visible in all AI modes
    {
      id: "followup_rules",
      label: "Sequence Enrollment Rules",
      icon: GitBranch,
      badge: undefined,
      visible: true,
      content: (
        <div className="space-y-3">
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/50 border border-border/50">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {aiMode === "chatbot_only"
                ? "Auto-enroll leads into email sequences when the chatbot hands off a conversation. Rules evaluate the lead's classified intent (e.g., interested → enroll in demo sequence)."
                : aiMode === "autopilot_only"
                  ? "Auto-enroll leads into email sequences based on their reply intent. Rules run after autopilot processes each reply."
                  : "Auto-enroll leads into email sequences when the chatbot hands off. The chatbot nurtures the conversation, and on handoff these rules evaluate intent to trigger email follow-ups."}
            </p>
          </div>
          <FollowupRulesPanel leadMagnetCampaignId={campaignId} />
        </div>
      ),
    },

    // Email Capture Auto-Enrollment
    {
      id: "auto_enroll",
      label: "Email Capture Enrollment",
      icon: Mail,
      badge: config.email_capture_sequence_id ? "Active" : undefined,
      visible: true,
      content: (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            When a lead enters their email on your lead magnet gate page,
            automatically enroll them in an email nurture sequence. This is
            independent of DM conversations — it fires on email capture only.
          </p>
          <div className="space-y-2">
            <Label htmlFor={`lm-${campaignId}-sequence`} className="text-sm">Target Sequence</Label>
            <Select
              value={config.email_capture_sequence_id || "__none"}
              onValueChange={(v) =>
                updateConfig({
                  email_capture_sequence_id: v === "__none" ? null : v,
                })
              }
            >
              <SelectTrigger id={`lm-${campaignId}-sequence`}>
                <SelectValue placeholder="Select a sequence..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None (disabled)</SelectItem>
                {activeSequences.map((seq) => (
                  <SelectItem key={seq.id} value={seq.id}>
                    {seq.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeSequences.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No active email sequences found. Create one in the Sequences
                page first.
              </p>
            )}
          </div>
        </div>
      ),
    },

    // Reminder DMs (renamed from "No-Reply Follow-Up DMs")
    {
      id: "reminder_dms",
      label: "Reminder DMs",
      icon: MessageSquare,
      badge: config.followup_enabled ? "On" : undefined,
      visible: true,
      content: (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Automatically send reminder DMs to leads who received your initial
            message but never replied. Different from enrollment rules — this is
            a simple "bump" message, not an intent-based action.
          </p>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor={`lm-${campaignId}-reminders`} className="text-sm">Enable Reminders</Label>
              <p className="text-xs text-muted-foreground">
                Send automated bump DMs after a set delay
              </p>
            </div>
            <Switch
              id={`lm-${campaignId}-reminders`}
              checked={config.followup_enabled}
              onCheckedChange={(checked) =>
                updateConfig({ followup_enabled: checked })
              }
            />
          </div>
          {config.followup_enabled && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`lm-${campaignId}-reminder-delay`} className="text-sm">Wait Before Reminding</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`lm-${campaignId}-reminder-delay`}
                    type="number"
                    min={1}
                    max={720}
                    value={config.followup_delay_hours}
                    onChange={(e) =>
                      updateConfig({
                        followup_delay_hours: parseInt(e.target.value) || 72,
                      })
                    }
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">hours</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  72 hours (3 days) is recommended. Too soon feels pushy, too
                  late loses momentum.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`lm-${campaignId}-max-reminders`} className="text-sm">Max Reminders</Label>
                <Input
                  id={`lm-${campaignId}-max-reminders`}
                  type="number"
                  min={1}
                  max={5}
                  value={config.max_followups}
                  onChange={(e) =>
                    updateConfig({
                      max_followups: parseInt(e.target.value) || 2,
                    })
                  }
                  className="w-20"
                />
                <p className="text-xs text-muted-foreground">
                  How many reminders before giving up. 2 is usually enough —
                  more feels spammy.
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Available variables</p>
                <div className="flex flex-wrap gap-1.5">
                  <code className="text-[11px] bg-background border border-border px-1.5 py-0.5 rounded">{"{name}"}</code>
                  <span className="text-[11px] text-muted-foreground self-center">— lead's full name</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`lm-${campaignId}-reminder-1`} className="text-sm">Reminder 1</Label>
                <Textarea
                  placeholder="Hey {name}, just wanted to make sure you got the doc I sent over."
                  id={`lm-${campaignId}-reminder-1`}
                  value={config.followup_message_1}
                  onChange={(e) =>
                    updateConfig({ followup_message_1: e.target.value })
                  }
                  rows={3}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`lm-${campaignId}-reminder-2`} className="text-sm">Reminder 2</Label>
                <Textarea
                  placeholder="Hey {name}, last nudge — did you get a chance to check it out?"
                  id={`lm-${campaignId}-reminder-2`}
                  value={config.followup_message_2}
                  onChange={(e) =>
                    updateConfig({ followup_message_2: e.target.value })
                  }
                  rows={3}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Leave a reminder empty to let AI generate it contextually.
                </p>
              </div>
            </>
          )}
        </div>
      ),
    },

    // Lead Prioritization (renamed from "ICP Routing")
    {
      id: "lead_prioritization",
      label: "Lead Prioritization",
      icon: Target,
      badge: config.icp_routing_enabled ? "Active" : undefined,
      visible: true,
      content: (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Score captured leads against your ICP and prioritize accordingly.
            High-fit leads get flagged for human attention; low-fit leads can be
            handled entirely by AI or skipped.
          </p>
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/50 border border-border/50">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This is different from the Lead Quality Gate in campaign settings.
              That gate filters leads <strong>before</strong> sending a DM. This
              scores leads <strong>after</strong> capture to prioritize your
              human time.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor={`lm-${campaignId}-prioritization`} className="text-sm">Enable Prioritization</Label>
              <p className="text-xs text-muted-foreground">
                Score leads and route based on fit
              </p>
            </div>
            <Switch
              id={`lm-${campaignId}-prioritization`}
              checked={config.icp_routing_enabled}
              onCheckedChange={(checked) =>
                updateConfig({ icp_routing_enabled: checked })
              }
            />
          </div>
          {config.icp_routing_enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`lm-${campaignId}-icp`} className="text-sm">ICP Profile</Label>
                <Select
                  value={config.icp_product_id || "__none"}
                  onValueChange={(v) =>
                    updateConfig({
                      icp_product_id: v === "__none" ? null : v,
                    })
                  }
                >
                  <SelectTrigger id={`lm-${campaignId}-icp`}>
                    <SelectValue placeholder="Select ICP..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {(icps || []).map((icp) => (
                      <SelectItem key={icp.id} value={icp.id}>
                        {icp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">
                  High-Fit Threshold: {config.high_icp_threshold}%
                </Label>
                <Slider
                  min={30}
                  max={95}
                  step={5}
                  value={[config.high_icp_threshold]}
                  onValueChange={([v]) =>
                    updateConfig({ high_icp_threshold: v })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Leads scoring above {config.high_icp_threshold}% are flagged
                  for human follow-up. Below that, they're handled by your
                  action setting below.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`lm-${campaignId}-low-fit`} className="text-sm">Low-Fit Action</Label>
                <Select
                  value={config.low_icp_action}
                  onValueChange={(v: "ai_auto" | "skip") =>
                    updateConfig({ low_icp_action: v })
                  }
                >
                  <SelectTrigger id={`lm-${campaignId}-low-fit`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ai_auto">
                      AI handles fully
                    </SelectItem>
                    <SelectItem value="skip">
                      Skip (don't engage)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      ),
    },
  ];

  const visibleSections = sections.filter((s) => s.visible);

  return (
    <>
    <div className={cn("space-y-5", className)}>
      {/* ── AI Mode Selector ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <Label className="text-sm font-medium">AI Mode</Label>
        </div>
        <div className="grid grid-cols-1 gap-2 p-1.5 rounded-lg bg-muted/70 sm:grid-cols-3">
          {AI_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "relative rounded-md px-3 py-2.5 text-left transition-all",
                aiMode === option.value
                  ? "bg-background shadow-sm ring-1 ring-border"
                  : "hover:bg-background/50"
              )}
              aria-pressed={aiMode === option.value}
              onClick={() => onAiModeChange?.(option.value)}
            >
              <p
                className={cn(
                  "text-sm font-medium leading-tight",
                  aiMode === option.value
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {option.label}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {option.description}
              </p>
              {option.recommended && aiMode !== option.value && (
                <Badge
                  variant="secondary"
                  className="absolute -top-1.5 -right-1.5 text-[9px] px-1 py-0"
                >
                  Default
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Mode explanation */}
        {currentModeOption && (
          <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {currentModeOption.detail}
            </p>
          </div>
        )}
      </div>

      {/* ── Collapsible Sections ─────────────────────────────────────── */}
      <div className="space-y-1">
        {visibleSections.map((section) => (
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
              <span className="text-sm font-medium flex-1">
                {section.label}
              </span>
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
    </div>

    <CreateAgentDialog
      open={createAgentOpen}
      onOpenChange={(open) => {
        setCreateAgentOpen(open);
        if (!open) setCreateFromConfig(null);
      }}
      onCreated={(profile) => onAgentProfileChange?.(profile.id, profile.config)}
      initialConfig={createFromConfig ?? undefined}
    />
    <AgentEditConfirmDialog
      open={editConfirmOpen}
      onOpenChange={(open) => {
        setEditConfirmOpen(open);
        if (!open) setPendingConfig(null);
      }}
      agentName={selectedAgentProfile?.name || "Agent"}
      onUpdateAgent={handleUpdateAgent}
      onSaveAsNew={handleSaveAsNew}
      isPending={updateAgentProfile.isPending}
    />
    </>
  );
}
