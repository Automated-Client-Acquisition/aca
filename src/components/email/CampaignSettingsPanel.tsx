import { useEffect, useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveSpintax } from "@/lib/message-variables";
import {
  SettingsGroup,
  SettingsToggle,
  SettingsField,
  SettingsAddressList,
  SettingsNumberInput,
} from "@/components/email/SequenceSettingsLayout";
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
import { Button } from "@/components/ui/button";
import { SendingPatternConfig } from "@/components/email/SendingPatternConfig";
import { AIFilterSettings } from "@/components/email/AIFilterSettings";
import { DeliverabilitySettings } from "@/components/email/DeliverabilitySettings";
import { ESPRoutingRulesEditor } from "@/components/email/ESPRoutingRulesEditor";
import { TagInput } from "@/components/email/TagInput";
import { MailboxPoolSummary } from "@/components/email/picker/MailboxPoolSummary";
import { AutoMailboxPool } from "@/components/email/picker/AutoMailboxPool";
import { FollowupRulesPanel } from "@/components/email/FollowupRulesPanel";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { AgentEditConfirmDialog } from "@/components/autopilot/AgentEditConfirmDialog";
import { CreateAgentDialog } from "@/components/autopilot/CreateAgentDialog";
import {
  useAgentProfiles,
  useUpdateAgentProfile,
} from "@/hooks/useAgentProfiles";
import { useFollowupRules } from "@/hooks/useFollowupRules";
import { useProducts } from "@/hooks/useProducts";
import { useTrackingDomains } from "@/hooks/useTrackingDomains";
import {
  Users,
  StopCircle,
  Brain,
  Eye,
  Timer,
  Shield,
  Split,
  Scale,
  AtSign,
  Tag,
  GitBranch,
  Bot,
  Globe,
  AlertTriangle,
  Variable,
  Package,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  EMAIL_VARIABLES,
  EMAIL_AI_VARIABLES,
  EMAIL_DELIVERABLE_VARIABLES,
  EMAIL_MAILBOX_VARIABLES,
  EMAIL_COMPLIANCE_VARIABLES,
} from "@/lib/email-sequence-utils";
import { DEFAULT_MAILBOX_SELECTION } from "@/types/email";
import type {
  EmailSequenceSettings,
  AutopilotConfig,
  EmailSequenceStep,
  EmailSendingDomain,
} from "@/types/email";
import type { EmailMailbox } from "@/types/email";

interface CampaignSettingsPanelProps {
  settings: EmailSequenceSettings;
  onChange: (update: Partial<EmailSequenceSettings>) => void;
  mailboxes?: EmailMailbox[];
  sequenceId?: string;
  className?: string;
  autopilotConfig?: AutopilotConfig | null;
  onAutopilotChange?: (config: AutopilotConfig) => void;
  agentProfileId?: string | null;
  onAgentProfileChange?: (
    profileId: string | null,
    config: AutopilotConfig,
  ) => void;
  steps?: EmailSequenceStep[];
  sendingDomains?: EmailSendingDomain[];
  initialOpenSection?: string;
}

interface SettingsSection {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  content: React.ReactNode;
}

const SETTINGS_GROUPS = [
  {
    label: "Sending",
    ids: ["accounts", "sending_pattern", "tracking", "deliverability"],
  },
  {
    label: "Automation",
    ids: [
      "stop_conditions",
      "followup_rules",
      "autopilot",
      "ai_filtering",
      "ab_testing",
    ],
  },
  {
    label: "Personalization",
    ids: ["product", "variable_defaults", "cc_bcc", "compliance", "crm"],
  },
];

const SECTION_DESCRIPTIONS: Record<string, string> = {
  accounts: "Choose your senders and manage how daily volume is allocated.",
  sending_pattern: "Set your sending schedule, daily volume and pacing.",
  tracking: "Manage your tracking domain and engagement signals.",
  deliverability: "Control how emails are delivered and routed.",
  stop_conditions:
    "Choose what happens to scheduled emails when a lead replies.",
  followup_rules: "Decide how to follow up after a lead responds.",
  autopilot: "Choose the agent that handles replies for this sequence.",
  ai_filtering: "Set how AI evaluates leads before sending.",
  ab_testing: "Choose how email variants are evaluated and optimized.",
  product: "Connect the offer used to personalize this sequence.",
  variable_defaults: "Provide fallback values for missing lead information.",
  cc_bcc: "Include additional recipients in outgoing emails.",
  compliance:
    "Set opt-out wording and control which email addresses can receive outreach.",
  crm: "Organize this sequence with campaign tags.",
};

export function CampaignSettingsPanel({
  settings,
  onChange,
  mailboxes = [],
  sequenceId,
  className,
  autopilotConfig,
  onAutopilotChange,
  agentProfileId,
  onAgentProfileChange,
  steps = [],
  sendingDomains,
  initialOpenSection,
}: CampaignSettingsPanelProps) {
  const { data: followupRules } = useFollowupRules(sequenceId);
  const { data: agentProfiles } = useAgentProfiles();
  const { products } = useProducts();
  const updateAgentProfile = useUpdateAgentProfile();
  const [activeSectionId, setActiveSectionId] = useState(
    initialOpenSection || "accounts",
  );
  const panelId = useId();
  useEffect(() => {
    if (initialOpenSection) setActiveSectionId(initialOpenSection);
  }, [initialOpenSection]);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AutopilotConfig | null>(
    null,
  );
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createFromConfig, setCreateFromConfig] =
    useState<AutopilotConfig | null>(null);
  // Bumped on click to roll a fresh spintax variation of the unsubscribe footer.
  const [unsubPreviewSeed, setUnsubPreviewSeed] = useState(0);

  const unsubscribeFooterPreview = useMemo(
    () =>
      resolveSpintax(settings.unsubscribe_footer_text ?? "").replace(
        /\[([^\]]*)\]/,
        "$1",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.unsubscribe_footer_text, unsubPreviewSeed],
  );

  const selectedAgentProfile = agentProfiles?.find(
    (p) => p.id === agentProfileId,
  );

  const handleAutopilotChange = (config: AutopilotConfig) => {
    if (agentProfileId) {
      setPendingConfig(config);
      setEditConfirmOpen(true);
    } else {
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
      },
    );
  };

  const handleSaveAsNew = () => {
    if (!pendingConfig) return;
    setCreateFromConfig(pendingConfig);
    setEditConfirmOpen(false);
    setPendingConfig(null);
    setCreateAgentOpen(true);
  };

  // Legacy sequences have no mailbox_selection — they stay on manual, which is
  // exactly their current behaviour.
  const mailboxSelection =
    settings.mailbox_selection ?? DEFAULT_MAILBOX_SELECTION;
  const isAutoPool = mailboxSelection.mode === "auto";

  /**
   * Auto mode has exactly one volume number. Writing `daily_target` alone only
   * sized the pool while `daily_limit` (default 30) kept enforcing the real
   * cap — so a 2,500/day pool quietly sent 30. Mirror the two on every edit.
   */
  const handleMailboxSelectionChange = (
    mailbox_selection: typeof mailboxSelection,
  ) =>
    onChange(
      mailbox_selection.mode === "auto"
        ? { mailbox_selection, daily_limit: mailbox_selection.daily_target }
        : { mailbox_selection },
    );

  const sections: SettingsSection[] = [
    {
      id: "accounts",
      label: "Senders",
      icon: Users,
      badge:
        mailboxSelection.mode === "auto"
          ? mailboxSelection.daily_target
            ? `Auto · ${mailboxSelection.daily_target}/day`
            : "Auto"
          : settings.mailbox_ids.length > 0
            ? `${settings.mailbox_ids.length} selected`
            : undefined,
      content: (
        <div className="space-y-4">
          <AutoMailboxPool
            config={mailboxSelection}
            onChange={handleMailboxSelectionChange}
            sequenceId={sequenceId}
          />
          {mailboxSelection.mode === "manual" && (
            <MailboxPoolSummary
              selectedIds={settings.mailbox_ids}
              onChange={(ids) => onChange({ mailbox_ids: ids })}
              excludeSequenceId={sequenceId}
            />
          )}
        </div>
      ),
    },
    {
      id: "stop_conditions",
      label: "Reply handling",
      icon: StopCircle,
      badge: settings.stop_on_reply ? "Stop on reply" : "Continue on reply",
      content: (
        <div className="space-y-6">
          <SettingsGroup
            title="When someone replies"
            description="Decide whether this sequence should keep sending its scheduled emails."
          >
            <SettingsToggle
              label="Stop when a lead replies"
              description="End this lead's sequence as soon as a reply is received."
              checked={settings.stop_on_reply}
              onChange={(checked) => onChange({ stop_on_reply: checked })}
            />
            <SettingsToggle
              label="Stop on automatic replies"
              description="Also stop for out-of-office messages and other automated responses."
              checked={settings.stop_on_auto_reply}
              onChange={(checked) => onChange({ stop_on_auto_reply: checked })}
            />
            <SettingsToggle
              label="Stop everyone at the same company"
              description="When one lead replies, stop outreach to other leads from that company too."
              checked={settings.stop_company_on_reply}
              onChange={(checked) =>
                onChange({ stop_company_on_reply: checked })
              }
            />
          </SettingsGroup>
          <div className="rounded-lg bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
            These controls stop scheduled sequence emails. Configure{" "}
            <button
              className="font-medium text-foreground underline underline-offset-4"
              onClick={() =>
                setActiveSectionId(sequenceId ? "followup_rules" : "autopilot")
              }
            >
              reply automation
            </button>{" "}
            separately to decide what happens next.
          </div>
        </div>
      ),
    },
    ...(sequenceId
      ? [
          {
            id: "followup_rules",
            label: "Follow-up Rules",
            icon: GitBranch,
            badge: followupRules?.length
              ? `${followupRules.length} rule${followupRules.length !== 1 ? "s" : ""}`
              : undefined,
            content: <FollowupRulesPanel sequenceId={sequenceId} />,
          },
        ]
      : []),
    ...(onAutopilotChange
      ? [
          {
            id: "autopilot",
            label: "Autopilot",
            icon: Bot,
            badge: autopilotConfig?.enabled ? "On" : undefined,
            content: (
              <div className="space-y-4">
                {onAgentProfileChange && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        Load from saved agent profile
                      </Label>
                      {agentProfileId && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() =>
                            onAgentProfileChange(
                              null,
                              autopilotConfig || {
                                enabled: false,
                                rules: [],
                                require_approval: true,
                                max_auto_replies: 3,
                              },
                            )
                          }
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <AgentProfileSelector
                      selectedProfileId={agentProfileId ?? null}
                      onSelect={(profile) =>
                        onAgentProfileChange(profile.id, profile.config)
                      }
                    />
                  </div>
                )}
                <AgentSettingsPanel
                  config={
                    autopilotConfig || {
                      enabled: false,
                      rules: [],
                      require_approval: true,
                      max_auto_replies: 3,
                    }
                  }
                  onChange={handleAutopilotChange}
                  context="email_sequence"
                />
              </div>
            ),
          },
        ]
      : []),
    {
      id: "ai_filtering",
      label: "AI filtering",
      icon: Brain,
      badge: "AI",
      content: <AIFilterSettings settings={settings} onChange={onChange} />,
    },
    {
      id: "tracking",
      label: "Tracking",
      icon: Eye,
      content: <TrackingTabContent settings={settings} onChange={onChange} />,
    },
    {
      id: "sending_pattern",
      label: "Schedule & limits",
      icon: Timer,
      badge: settings.daily_limit ? `${settings.daily_limit}/day` : "Max/day",
      content: (
        <SendingPatternConfig
          settings={settings}
          onChange={onChange}
          volumeSetInAccounts={isAutoPool}
          onOpenAccounts={() => setActiveSectionId("accounts")}
          mailboxCount={settings.mailbox_ids.length}
          selectedMailboxes={mailboxes.filter((m) =>
            settings.mailbox_ids.includes(m.id),
          )}
        />
      ),
    },
    {
      id: "deliverability",
      label: "Deliverability",
      icon: Shield,
      badge: settings.hypersend_mode ? "Hypersend" : undefined,
      content: (
        <div className="space-y-6">
          <DeliverabilitySettings settings={settings} onChange={onChange} />
          <ESPRoutingRulesEditor
            rules={settings.esp_routing_rules}
            onChange={(rules) => onChange({ esp_routing_rules: rules })}
          />
        </div>
      ),
    },
    {
      id: "ab_testing",
      label: "A/B testing",
      icon: Split,
      badge: settings.auto_optimize_ab ? "Automatic" : "Manual",
      content: (
        <div className="space-y-6">
          <SettingsGroup
            title="Choosing a winning email"
            description="These settings apply to A/B test steps in your sequence."
          >
            <SettingsToggle
              label="Select the winner automatically"
              description="After each variant reaches the sample size, use the variant with the strongest result."
              checked={settings.auto_optimize_ab}
              onChange={(checked) => onChange({ auto_optimize_ab: checked })}
            />
            <SettingsField
              label="Compare variants by"
              description="The result used to choose the winning email."
            >
              <Select
                value={settings.ab_winning_metric}
                onValueChange={(
                  value: "open_rate" | "click_rate" | "reply_rate",
                ) => onChange({ ab_winning_metric: value })}
              >
                <SelectTrigger aria-label="Winning metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reply_rate">Reply rate</SelectItem>
                  <SelectItem value="click_rate">Click rate</SelectItem>
                  <SelectItem value="open_rate">Open rate</SelectItem>
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField
              label="Sample size per variant"
              htmlFor={`${panelId}-sample`}
              description="Sends per variant before an automatic winner can be selected."
            >
              <div className="relative">
                <SettingsNumberInput
                  id={`${panelId}-sample`}
                  min={10}
                  value={settings.ab_sample_size}
                  className="pr-16"
                  onChange={(value) => {
                    if (value !== null) onChange({ ab_sample_size: value });
                  }}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  sends
                </span>
              </div>
            </SettingsField>
          </SettingsGroup>
          {settings.ab_winning_metric === "open_rate" &&
            !settings.open_tracking && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                Open tracking is off.{" "}
                <button
                  className="font-medium underline underline-offset-4"
                  onClick={() => setActiveSectionId("tracking")}
                >
                  Review tracking
                </button>{" "}
                to record opens for this metric.
              </p>
            )}
          {settings.ab_winning_metric === "click_rate" &&
            !settings.click_tracking && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                Click tracking is off.{" "}
                <button
                  className="font-medium underline underline-offset-4"
                  onClick={() => setActiveSectionId("tracking")}
                >
                  Review tracking
                </button>{" "}
                to record clicks for this metric.
              </p>
            )}
        </div>
      ),
    },
    {
      id: "compliance",
      label: "Unsubscribe & safety",
      icon: Scale,
      content: (
        <div className="space-y-6">
          <SettingsGroup title="Give recipients a way to opt out">
            <SettingsToggle
              label="Include an unsubscribe header"
              description="Add List-Unsubscribe headers so supported email clients can show their own unsubscribe action."
              checked={settings.unsubscribe_header}
              onChange={(checked) => onChange({ unsubscribe_header: checked })}
            />
            <SettingsToggle
              label="Add an unsubscribe footer"
              description={
                <>
                  Append an opt-out link to each email. If the body already
                  includes <code>{"{{unsubscribe_link}}"}</code>, no extra
                  footer is added.
                </>
              }
              checked={settings.unsubscribe_link_footer ?? true}
              onChange={(checked) =>
                onChange({ unsubscribe_link_footer: checked })
              }
            />
            <div className="space-y-3">
              <label
                htmlFor={`${panelId}-footer`}
                className="text-sm font-medium"
              >
                Footer wording
              </label>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Leave empty to use ACA's rotating defaults. Put the linked words
                in square brackets.
              </p>
              <Textarea
                id={`${panelId}-footer`}
                value={settings.unsubscribe_footer_text ?? ""}
                onChange={(event) =>
                  onChange({
                    unsubscribe_footer_text: event.target.value || null,
                  })
                }
                placeholder="{Not interested?|Not a fit?} [{Unsubscribe|Opt out}]"
                rows={3}
                className="font-mono text-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    Footer preview
                  </p>
                  <span className="text-sm underline underline-offset-4">
                    {unsubscribeFooterPreview || "unsubscribe"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUnsubPreviewSeed((value) => value + 1)}
                >
                  Another variation
                </Button>
              </div>
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">
                  Use rotating wording
                </summary>
                <p className="mt-2 leading-relaxed">
                  Write <code>{"{option one|option two}"}</code> to pick a
                  variation at send time. With no square brackets, the entire
                  footer line becomes the link.
                </p>
              </details>
            </div>
          </SettingsGroup>
          <SettingsGroup title="Email address quality">
            <SettingsToggle
              label="Allow risky email addresses"
              description="Include unverified or risky addresses, subject to the existing enrollment checks."
              checked={settings.allow_risky_emails}
              onChange={(checked) => onChange({ allow_risky_emails: checked })}
            />
          </SettingsGroup>
        </div>
      ),
    },
    {
      id: "product",
      label: "Offer",
      icon: Package,
      badge: settings.product_id
        ? (products || []).find((product) => product.id === settings.product_id)
            ?.name
        : undefined,
      content: (
        <SettingsGroup title="The offer behind your outreach">
          <SettingsField
            label="Product or service"
            description={
              <>
                Use this offer's name and description wherever your email
                includes product variables such as{" "}
                <code>{"{{product_name}}"}</code>.
              </>
            }
          >
            <Select
              value={settings.product_id || "__none__"}
              onValueChange={(value) =>
                onChange({ product_id: value === "__none__" ? null : value })
              }
            >
              <SelectTrigger aria-label="Sequence offer">
                <SelectValue placeholder="Choose an offer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No offer selected</SelectItem>
                {(products || []).map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsField>
        </SettingsGroup>
      ),
    },
    {
      id: "variable_defaults",
      label: "Fallback variables",
      icon: Variable,
      badge: (() => {
        const defaults = settings.variable_defaults || {};
        const count = Object.values(defaults).filter(Boolean).length;
        return count > 0 ? `${count} set` : undefined;
      })(),
      content: (() => {
        // Auto-detect variables used across all step subjects, bodies, and A/B variants
        const varSet = new Set<string>();
        for (const step of steps) {
          const texts = [step.subject, step.body];
          if (step.variants) {
            for (const v of step.variants) {
              texts.push(v.subject, v.body);
            }
          }
          for (const t of texts) {
            if (!t) continue;
            const matches = t.matchAll(/\{\{\s*(\w+)\s*\}\}/g);
            for (const m of matches) {
              varSet.add(m[1]);
            }
          }
        }

        // Skip system-resolved variables that users should never set defaults for
        const systemVars = new Set([
          "signature",
          "unsubscribe_link",
          "unsubscribeLink",
        ]);
        // Contact custom fields ({{custom_<key>}}) take fallbacks like any other
        // variable; only AI-generated per-enrollment email content is skipped.
        const detectedVars = [...varSet].filter(
          (v) =>
            !systemVars.has(v) &&
            !/^(?:custom_)?email_(?:\d+_(?:subject|body)|(?:subject|body)_\d+)$/.test(v),
        );

        // Build label map from the known variable lists
        const labelMap: Record<string, string> = {};
        const allKnown = [
          ...EMAIL_VARIABLES,
          ...EMAIL_AI_VARIABLES,
          ...EMAIL_DELIVERABLE_VARIABLES,
          ...EMAIL_MAILBOX_VARIABLES,
          ...EMAIL_COMPLIANCE_VARIABLES,
        ];
        for (const entry of allKnown) {
          // entry.variable is like "{{first_name}}"
          const key = entry.variable.replace(/\{\{|\}\}/g, "").trim();
          labelMap[key] = entry.label;
        }

        const defaults = settings.variable_defaults || {};

        if (detectedVars.length === 0) {
          return (
            <p className="rounded-lg border border-dashed p-5 text-sm leading-relaxed text-muted-foreground">
              No variables detected in your email steps. Add variables like{" "}
              <code className="text-[10px]">{"{{company}}"}</code> to your
              emails, then set fallback defaults here.
            </p>
          );
        }

        return (
          <SettingsGroup
            title="When lead information is missing"
            description="Set a fallback so your email still reads naturally when a lead has no value for a variable."
          >
            {detectedVars.map((varName) => (
              <div
                key={varName}
                className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(160px,240px)] sm:gap-6"
              >
                <Label
                  htmlFor={`${panelId}-fallback-${varName}`}
                  className="text-sm flex flex-wrap items-center gap-1.5"
                >
                  <code className="text-[10px] bg-muted px-1 py-0.5 rounded">
                    {`{{${varName}}}`}
                  </code>
                  {labelMap[varName] && (
                    <span className="text-muted-foreground font-normal">
                      {labelMap[varName]}
                    </span>
                  )}
                </Label>
                <Input
                  id={`${panelId}-fallback-${varName}`}
                  value={defaults[varName] || ""}
                  onChange={(e) => {
                    const next = { ...defaults };
                    if (e.target.value) {
                      next[varName] = e.target.value;
                    } else {
                      delete next[varName];
                    }
                    onChange({ variable_defaults: next });
                  }}
                  placeholder={`e.g. ${varName === "first_name" ? "there" : varName === "company" ? "your company" : "fallback text"}`}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </SettingsGroup>
        );
      })(),
    },
    {
      id: "cc_bcc",
      label: "Additional recipients",
      icon: AtSign,
      badge:
        settings.cc.length + settings.bcc.length > 0
          ? `${settings.cc.length + settings.bcc.length} addresses`
          : undefined,
      content: (
        <SettingsGroup
          title="Copy additional people"
          description="These addresses receive a copy of every outgoing email. Separate multiple addresses with commas."
        >
          <SettingsAddressList
            label="CC"
            description="Visible to the lead and other recipients."
            values={settings.cc}
            onChange={(values) => onChange({ cc: values })}
          />
          <SettingsAddressList
            label="BCC"
            description="Hidden from the lead and other recipients."
            values={settings.bcc}
            onChange={(values) => onChange({ bcc: values })}
          />
        </SettingsGroup>
      ),
    },
    {
      id: "crm",
      label: "Tags",
      icon: Tag,
      content: (
        <SettingsGroup
          title="Organize this sequence"
          description="Add tags to make this campaign easier to find and group."
        >
          <div className="space-y-3">
            <p className="text-sm font-medium">Sequence tags</p>
            <TagInput
              tags={settings.tags}
              onChange={(tags) => onChange({ tags })}
              ariaLabel="Sequence tags"
              placeholder="Add a tag and press Enter"
            />
            <p className="text-sm text-muted-foreground">
              Press Enter or comma to add a tag.
            </p>
          </div>
        </SettingsGroup>
      ),
    },
  ];

  const navigationGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: group.ids.flatMap((sectionId) => {
      const section = sections.find((item) => item.id === sectionId);
      return section ? [section] : [];
    }),
  })).filter((group) => group.sections.length > 0);
  const activeSection =
    sections.find((section) => section.id === activeSectionId) || sections[0];

  return (
    <>
      <div
        className={cn(
          "grid min-w-0 gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6",
          className,
        )}
      >
        <div className="space-y-2 lg:hidden">
          <Label
            htmlFor={`${panelId}-picker`}
            className="text-xs text-muted-foreground"
          >
            Settings section
          </Label>
          <Select value={activeSection.id} onValueChange={setActiveSectionId}>
            <SelectTrigger id={`${panelId}-picker`} className="h-11 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {navigationGroups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      <span className="flex items-center gap-2">
                        <section.icon className="h-4 w-4 text-muted-foreground" />
                        {section.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav
          aria-label="Sequence settings"
          className="hidden space-y-6 self-start lg:sticky lg:top-4 lg:max-h-[calc(var(--app-content-height,calc(100dvh-4rem))-2rem)] lg:overflow-y-auto lg:block"
        >
          {navigationGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.label}
              </p>
              {group.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={
                    activeSection.id === section.id ? "true" : undefined
                  }
                  aria-controls={`${panelId}-content`}
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeSection.id === section.id
                      ? "border-amber-500/20 bg-amber-500/10 font-medium text-amber-800 dark:text-amber-300"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <section.icon className="h-4 w-4 shrink-0" />
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <section
          id={`${panelId}-content`}
          aria-labelledby={`${panelId}-heading`}
          className="min-w-0 self-start rounded-xl border bg-card shadow-sm"
        >
          <div className="flex items-start gap-3 border-b p-5 sm:p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
              <activeSection.icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id={`${panelId}-heading`}
                  className="text-base font-semibold"
                >
                  {activeSection.label}
                </h3>
                {activeSection.badge && (
                  <Badge variant="secondary" className="text-[10px]">
                    {activeSection.badge}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {SECTION_DESCRIPTIONS[activeSection.id]}
              </p>
            </div>
          </div>
          <div key={activeSection.id} className="min-w-0 p-5 sm:p-6">
            {activeSection.content}
          </div>
        </section>
      </div>

      <CreateAgentDialog
        open={createAgentOpen}
        onOpenChange={(open) => {
          setCreateAgentOpen(open);
          if (!open) setCreateFromConfig(null);
        }}
        onCreated={(profile) =>
          onAgentProfileChange?.(profile.id, profile.config)
        }
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

// ============================================================================
// Tracking Tab Content
// ============================================================================

function TrackingTabContent({
  settings,
  onChange,
}: {
  settings: EmailSequenceSettings;
  onChange: (update: Partial<EmailSequenceSettings>) => void;
}) {
  const { data: domains, isLoading, isError, refetch } = useTrackingDomains();
  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Tracking domain"
        description="This domain is used for tracking pixels and link redirects."
      >
        <div className="space-y-3">
          {isLoading ? (
            <div
              role="status"
              aria-label="Loading tracking domains"
              className="h-10 animate-pulse rounded-md border bg-muted/30"
            />
          ) : isError ? (
            <div role="alert" className="text-sm">
              <p>Tracking domains could not be loaded.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => refetch()}
              >
                Try again
              </Button>
            </div>
          ) : !domains?.length ? (
            <div className="rounded-lg border border-dashed p-4">
              <p className="text-sm font-medium">Add a tracking domain</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A domain is required before you can activate this sequence.
              </p>
              <Button asChild variant="cta" size="sm" className="mt-3">
                <Link to="/settings?tab=email">Manage tracking domains</Link>
              </Button>
            </div>
          ) : (
            <>
              <Select
                value={settings.tracking_domain_id || ""}
                onValueChange={(value) =>
                  onChange({ tracking_domain_id: value || null })
                }
              >
                <SelectTrigger aria-label="Tracking domain">
                  <SelectValue placeholder="Choose a tracking domain" />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.id}>
                      <span className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        {domain.domain}
                        {domain.is_default && (
                          <Badge variant="secondary" className="text-xs">
                            Default
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Link
                to="/settings?tab=email"
                className="inline-block text-sm text-muted-foreground underline underline-offset-4"
              >
                Manage domains
              </Link>
            </>
          )}
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="Engagement signals"
        description="Choose which interactions are recorded for this sequence."
      >
        <SettingsToggle
          label="Track email opens"
          description="Add a tracking pixel to record when an email is opened."
          checked={settings.open_tracking}
          onChange={(checked) => onChange({ open_tracking: checked })}
        />
        <SettingsToggle
          label="Track link clicks"
          description="Use tracked redirects to record when a lead clicks a link."
          checked={settings.click_tracking}
          onChange={(checked) => onChange({ click_tracking: checked })}
        />
      </SettingsGroup>
      {settings.first_email_text_only &&
        (settings.open_tracking || settings.click_tracking) && (
          <p className="rounded-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            The first email is configured as plain text. Its tracking pixels and
            links are removed; tracking settings apply to later emails.
          </p>
        )}
    </div>
  );
}
