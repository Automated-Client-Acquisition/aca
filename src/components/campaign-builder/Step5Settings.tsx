import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CampaignSetupSlider as Slider } from "@/components/campaign-builder/CampaignSetupSlider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AIFilterSettings } from "@/components/email/AIFilterSettings";
import { FollowupRulesPanel } from "@/components/email/FollowupRulesPanel";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { CreateAgentDialog } from "@/components/autopilot/CreateAgentDialog";
import { AgentEditConfirmDialog } from "@/components/autopilot/AgentEditConfirmDialog";
import {
  useAgentProfiles,
  useUpdateAgentProfile,
} from "@/hooks/useAgentProfiles";
import { useFollowupRules } from "@/hooks/useFollowupRules";
import {
  ChevronRight,
  StopCircle,
  Brain,
  GitBranch,
  Bot,
  Info,
  Gauge,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";
import type {
  AutopilotConfig,
  CampaignPowerSettings,
  CampaignRateSettings,
} from "@/types/email";

interface Step5SettingsProps {
  builder: CampaignBuilderReturn;
  campaignId?: string;
}

export function Step5Settings({ builder, campaignId }: Step5SettingsProps) {
  const { state, updateField } = builder;
  const settings = state.campaignSettings;

  const { data: followupRules } = useFollowupRules(undefined, campaignId);
  const {
    data: agentProfiles,
    isLoading: profilesLoading,
    isError: profilesError,
    isFetching: profilesFetching,
    refetch: retryProfiles,
  } = useAgentProfiles();
  const updateAgentProfile = useUpdateAgentProfile();
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["rate_limits", "stop_conditions"]),
  );
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AutopilotConfig | null>(
    null,
  );

  const selectedAgentProfile = agentProfiles?.find(
    (p) => p.id === state.agentProfileId,
  );
  const autopilotConfig = state.agentProfileId
    ? selectedAgentProfile?.config
    : state.autopilotConfig;

  const handleAutopilotChange = (config: AutopilotConfig) => {
    if (state.agentProfileId) {
      setPendingConfig(config);
      setEditConfirmOpen(true);
    } else {
      updateField("autopilotConfig", config);
    }
  };

  const handleUpdateAgent = () => {
    if (!pendingConfig || !state.agentProfileId) return;
    updateAgentProfile.mutate(
      { id: state.agentProfileId, config: pendingConfig },
      {
        onSuccess: () => {
          updateField("autopilotConfig", pendingConfig);
          setPendingConfig(null);
          setEditConfirmOpen(false);
        },
      },
    );
  };

  const handleSaveAsNew = () => {
    if (!pendingConfig) return;
    updateField("autopilotConfig", pendingConfig);
    updateField("agentProfileId", null);
    setEditConfirmOpen(false);
    setPendingConfig(null);
    setCreateAgentOpen(true);
  };

  const toggleSection = (id: string) => {
    const next = new Set(openSections);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setOpenSections(next);
  };

  const updateSettings = (update: Partial<CampaignPowerSettings>) => {
    updateField("campaignSettings", { ...settings, ...update });
  };

  const rateSettings = state.rateSettings;
  const [minimumDelay, setMinimumDelay] = useState(
    String(rateSettings.min_delay_seconds ?? 60),
  );
  const [maximumDelay, setMaximumDelay] = useState(
    String(rateSettings.max_delay_seconds ?? 180),
  );
  useEffect(() => {
    setMinimumDelay(String(rateSettings.min_delay_seconds ?? 60));
    setMaximumDelay(String(rateSettings.max_delay_seconds ?? 180));
  }, [rateSettings.min_delay_seconds, rateSettings.max_delay_seconds]);
  const updateRateSettings = (update: Partial<CampaignRateSettings>) => {
    updateField("rateSettings", { ...rateSettings, ...update });
  };
  const commitMinimumDelay = () => {
    const value = Math.max(
      10,
      Math.min(
        300,
        Number.parseInt(minimumDelay, 10) ||
          (rateSettings.min_delay_seconds ?? 60),
      ),
    );
    setMinimumDelay(String(value));
    updateRateSettings({
      min_delay_seconds: value,
      ...((rateSettings.max_delay_seconds ?? 180) < value
        ? { max_delay_seconds: value }
        : {}),
    });
  };
  const commitMaximumDelay = () => {
    const value = Math.max(
      10,
      Math.min(
        600,
        Number.parseInt(maximumDelay, 10) ||
          (rateSettings.max_delay_seconds ?? 180),
      ),
    );
    setMaximumDelay(String(value));
    updateRateSettings({
      max_delay_seconds: value,
      ...(value < (rateSettings.min_delay_seconds ?? 60)
        ? { min_delay_seconds: value }
        : {}),
    });
  };

  interface SettingsSection {
    id: string;
    label: string;
    description: string;
    icon: React.ElementType;
    badge?: string;
    content: React.ReactNode;
  }

  const sections: SettingsSection[] = [
    {
      id: "rate_limits",
      label: "Sending pace",
      description: "Space LinkedIn actions to match each sender’s limits.",
      icon: Gauge,
      badge: `${rateSettings.min_delay_seconds ?? 60}–${rateSettings.max_delay_seconds ?? 180} sec`,
      content: (
        <div className="space-y-5">
          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-3">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p
              id="campaign-pace-help"
              className="text-xs text-muted-foreground leading-relaxed"
            >
              Random delay between LinkedIn actions from the same sender
              account. Applies across all campaigns sharing this account to
              mimic human behavior.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-minimum-delay" className="text-sm">
              Minimum delay (seconds)
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[rateSettings.min_delay_seconds ?? 60]}
                onValueChange={([v]) => {
                  const newMin = v;
                  const currentMax = rateSettings.max_delay_seconds ?? 180;
                  updateRateSettings({
                    min_delay_seconds: newMin,
                    ...(currentMax < newMin
                      ? { max_delay_seconds: newMin }
                      : {}),
                  });
                }}
                min={10}
                max={300}
                step={10}
                className="flex-1"
                aria-label="Minimum action delay"
                aria-describedby="campaign-pace-help"
              />
              <Input
                type="number"
                id="campaign-minimum-delay"
                min={10}
                max={300}
                step={10}
                value={minimumDelay}
                onChange={(event) => setMinimumDelay(event.target.value)}
                onBlur={commitMinimumDelay}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                aria-describedby="campaign-pace-help"
                className="h-10 w-24 text-center"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-maximum-delay" className="text-sm">
              Maximum delay (seconds)
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[rateSettings.max_delay_seconds ?? 180]}
                onValueChange={([v]) => {
                  const newMax = v;
                  const currentMin = rateSettings.min_delay_seconds ?? 60;
                  updateRateSettings({
                    max_delay_seconds: newMax,
                    ...(newMax < currentMin
                      ? { min_delay_seconds: newMax }
                      : {}),
                  });
                }}
                min={10}
                max={600}
                step={10}
                className="flex-1"
                aria-label="Maximum action delay"
                aria-describedby="campaign-pace-help"
              />
              <Input
                type="number"
                id="campaign-maximum-delay"
                min={10}
                max={600}
                step={10}
                value={maximumDelay}
                onChange={(event) => setMaximumDelay(event.target.value)}
                onBlur={commitMaximumDelay}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                aria-describedby="campaign-pace-help"
                className="h-10 w-24 text-center"
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "stop_conditions",
      label: "Stop conditions",
      description: "Decide when a lead or company should exit outreach.",
      badge: state.stopOnReply ? "Stop on reply" : "Replies continue",
      icon: StopCircle,
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="campaign-stop-reply" className="text-sm">
                Stop on reply
              </Label>
              <p className="text-xs text-muted-foreground">
                Stop sending when a lead replies.
              </p>
            </div>
            <Switch
              id="campaign-stop-reply"
              className="shrink-0"
              checked={state.stopOnReply}
              onCheckedChange={(checked) => updateField("stopOnReply", checked)}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="campaign-stop-auto-reply" className="text-sm">
                Stop on auto-reply
              </Label>
              <p className="text-xs text-muted-foreground">
                Stop on out-of-office or automatic replies.
              </p>
            </div>
            <Switch
              id="campaign-stop-auto-reply"
              className="shrink-0"
              checked={settings.stop_on_auto_reply}
              onCheckedChange={(checked) =>
                updateSettings({ stop_on_auto_reply: checked })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="campaign-stop-company" className="text-sm">
                Stop company on reply
              </Label>
              <p className="text-xs text-muted-foreground">
                When one lead from a company replies, stop all leads from that
                company.
              </p>
            </div>
            <Switch
              id="campaign-stop-company"
              className="shrink-0"
              checked={settings.stop_company_on_reply}
              onCheckedChange={(checked) =>
                updateSettings({ stop_company_on_reply: checked })
              }
            />
          </div>
        </div>
      ),
    },
    {
      id: "autopilot",
      label: "AI reply agent",
      description: "Choose a saved agent or configure how replies are handled.",
      icon: Bot,
      badge: autopilotConfig
        ? autopilotConfig.enabled
          ? "On"
          : "Off"
        : profilesLoading
          ? "Loading…"
          : "Unavailable",
      content: (
        <div className="space-y-4">
          {autopilotConfig && (
            <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-3">
              <Bot className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {autopilotConfig.enabled
                    ? "When a lead replies, this AI agent evaluates the message and follows its response and approval rules."
                    : "No AI agent — replies land in your inbox and wait for you to answer them."}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Want the agent to take over only for specific replies? Add a{" "}
                  <span className="font-medium">Hand off to AI Agent</span> step
                  in the sequence (e.g. wire it off{" "}
                  <span className="font-medium">
                    Check Reply Intent → Interested
                  </span>
                  ).
                </p>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Saved agent profile</p>
              {state.agentProfileId && (
                <button
                  type="button"
                  aria-label="Clear saved agent profile"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => updateField("agentProfileId", null)}
                >
                  Clear
                </button>
              )}
            </div>
            <AgentProfileSelector
              selectedProfileId={state.agentProfileId}
              onSelect={(profile) => {
                updateField("agentProfileId", profile.id);
                updateField("autopilotConfig", profile.config);
              }}
              onCreateNew={() => setCreateAgentOpen(true)}
            />
          </div>
          {autopilotConfig ? (
            <AgentSettingsPanel
              config={autopilotConfig}
              onChange={handleAutopilotChange}
              context="linkedin_campaign"
            />
          ) : profilesLoading ? (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the saved
              agent profile…
            </p>
          ) : (
            <div
              role="alert"
              className="space-y-3 rounded-lg border bg-muted/30 p-3"
            >
              <p className="text-sm text-muted-foreground">
                {profilesError
                  ? "The saved agent profile could not be loaded."
                  : "This campaign’s saved agent profile is unavailable. Select another profile or clear the selection to configure a campaign agent."}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={profilesFetching}
                onClick={() => void retryProfiles()}
              >
                {profilesFetching ? "Loading…" : "Retry profiles"}
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "followup_rules",
      label: "Follow-up rules",
      description:
        "Route leads into follow-up sequences based on their replies.",
      icon: GitBranch,
      badge:
        followupRules && followupRules.length > 0
          ? `${followupRules.length} rule${followupRules.length !== 1 ? "s" : ""}`
          : undefined,
      content: campaignId ? (
        <FollowupRulesPanel campaignId={campaignId} />
      ) : (
        <div className="flex items-start gap-2.5 px-3 py-3 rounded-md bg-muted/50 border border-border/50">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">
              Save as draft first
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Follow-up rules let you auto-enroll leads into email sequences
              based on reply intent. Save this campaign as a draft to start
              adding rules.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "ai_filtering",
      label: "AI lead filtering",
      description:
        "Choose whether outreach continues for unlikely or hostile leads.",
      icon: Brain,
      badge:
        settings.ai_filter_unlikely_reply === "skip" ||
        settings.ai_filter_hostile === "skip"
          ? "Active"
          : undefined,
      content: (
        <AIFilterSettings
          settings={settings}
          onChange={(update) =>
            updateSettings(update as Partial<CampaignPowerSettings>)
          }
        />
      ),
    },
  ];

  return (
    <>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Campaign settings</h2>
          <p className="text-sm text-muted-foreground">
            Control sending pace, replies and follow-ups. These settings can be
            changed after launch.
          </p>
        </div>

        <div className="space-y-3">
          {sections.map((section) => (
            <Collapsible
              key={section.id}
              open={openSections.has(section.id)}
              onOpenChange={() => toggleSection(section.id)}
              className="overflow-hidden rounded-xl border bg-card"
            >
              <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30 sm:px-5">
                <section.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {section.label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {section.description}
                  </span>
                </span>
                {section.badge && (
                  <Badge
                    variant="secondary"
                    className="hidden shrink-0 text-xs font-normal sm:inline-flex"
                  >
                    {section.badge}
                  </Badge>
                )}
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    openSections.has(section.id) && "rotate-90",
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t px-4 py-5 sm:px-5">
                {section.content}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>

      <CreateAgentDialog
        open={createAgentOpen}
        onOpenChange={setCreateAgentOpen}
        onCreated={(profile) => {
          updateField("agentProfileId", profile.id);
          updateField("autopilotConfig", profile.config);
        }}
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
