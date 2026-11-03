import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AIFilterSettings } from "@/components/email/AIFilterSettings";
import { FollowupRulesPanel } from "@/components/email/FollowupRulesPanel";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { CreateAgentDialog } from "@/components/autopilot/CreateAgentDialog";
import { AgentEditConfirmDialog } from "@/components/autopilot/AgentEditConfirmDialog";
import { useFollowupRules } from "@/hooks/useFollowupRules";
import { useAgentProfiles, useUpdateAgentProfile } from "@/hooks/useAgentProfiles";
import {
  ChevronRight,
  StopCircle,
  Brain,
  GitBranch,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignPowerSettings as CampaignPowerSettingsType, AutopilotConfig } from "@/types/email";

interface CampaignPowerSettingsProps {
  campaignId: string;
  settings: CampaignPowerSettingsType;
  onChange: (update: Partial<CampaignPowerSettingsType>) => void;
  stopOnReply: boolean;
  onStopOnReplyChange: (checked: boolean) => void;
  autopilotConfig?: AutopilotConfig | null;
  onAutopilotChange?: (config: AutopilotConfig) => void;
  agentProfileId?: string | null;
  onAgentProfileChange?: (profileId: string | null, config: AutopilotConfig) => void;
  className?: string;
  disabled?: boolean;
}

interface SettingsSection {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  content: React.ReactNode;
}

export function CampaignPowerSettings({
  campaignId,
  settings,
  onChange,
  stopOnReply,
  onStopOnReplyChange,
  autopilotConfig,
  onAutopilotChange,
  agentProfileId,
  onAgentProfileChange,
  className,
  disabled = false,
}: CampaignPowerSettingsProps) {
  const { data: followupRules } = useFollowupRules(undefined, campaignId);
  const { data: agentProfiles, isLoading: profilesLoading, refetch: refetchProfiles } = useAgentProfiles();
  const updateAgentProfile = useUpdateAgentProfile();
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["stop_conditions"])
  );
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AutopilotConfig | null>(null);
  const [createFromConfig, setCreateFromConfig] = useState<AutopilotConfig | null>(null);

  const selectedAgentProfile = agentProfiles?.find((p) => p.id === agentProfileId);
  const effectiveConfig = selectedAgentProfile?.config ?? autopilotConfig ?? {
    enabled: false, rules: [], require_approval: true, max_auto_replies: 3,
  };
  const savedAgentUnavailable = !!agentProfileId && !selectedAgentProfile;

  const handleAutopilotChange = (config: AutopilotConfig) => {
    if (disabled || savedAgentUnavailable) return;
    if (agentProfileId) {
      setPendingConfig(config);
      setEditConfirmOpen(true);
    } else {
      onAutopilotChange?.(config);
    }
  };

  const handleUpdateAgent = () => {
    if (disabled || !pendingConfig || !agentProfileId) return;
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
    if (disabled || !pendingConfig) return;
    setCreateFromConfig(pendingConfig);
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

  const sections: SettingsSection[] = [
    {
      id: "stop_conditions",
      label: "Stop Conditions",
      icon: StopCircle,
      content: (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={`campaign-${campaignId}-reply`} className="text-sm">Stop on reply</Label>
              <p className="text-xs text-muted-foreground">
                Stop sending when a lead replies.
              </p>
            </div>
            <Switch
              id={`campaign-${campaignId}-reply`}
              disabled={disabled}
              checked={stopOnReply}
              onCheckedChange={onStopOnReplyChange}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={`campaign-${campaignId}-auto-reply`} className="text-sm">Stop on auto-reply</Label>
              <p className="text-xs text-muted-foreground">
                Stop on out-of-office or automatic replies.
              </p>
            </div>
            <Switch
              id={`campaign-${campaignId}-auto-reply`}
              disabled={disabled}
              checked={settings.stop_on_auto_reply}
              onCheckedChange={(checked) =>
                onChange({ stop_on_auto_reply: checked })
              }
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={`campaign-${campaignId}-company-reply`} className="text-sm">Stop company on reply</Label>
              <p className="text-xs text-muted-foreground">
                When one lead from a company replies, stop all leads from that
                company.
              </p>
            </div>
            <Switch
              id={`campaign-${campaignId}-company-reply`}
              disabled={disabled}
              checked={settings.stop_company_on_reply}
              onCheckedChange={(checked) =>
                onChange({ stop_company_on_reply: checked })
              }
            />
          </div>
        </div>
      ),
    },
    {
      id: "followup_rules",
      label: "Follow-up Rules",
      icon: GitBranch,
      badge:
        followupRules && followupRules.length > 0
          ? `${followupRules.length} rule${followupRules.length !== 1 ? "s" : ""}`
          : undefined,
      content: (
        <FollowupRulesPanel campaignId={campaignId} />
      ),
    },
    {
      id: "autopilot",
      label: "Autopilot",
      icon: Bot,
      badge: savedAgentUnavailable ? profilesLoading ? "Loading" : "Unavailable" : effectiveConfig.enabled ? "On" : undefined,
      content: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-4">
              <Label className="text-xs text-muted-foreground">Load from saved agent profile</Label>
              {agentProfileId && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => onAgentProfileChange?.(null, effectiveConfig)}
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
          {savedAgentUnavailable ? (
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground" role="status">
              {profilesLoading ? "Loading the saved agent…" : "The saved agent is unavailable. Retry, choose another agent, or clear it to edit this campaign’s reply settings."}
              {!profilesLoading && <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchProfiles()}>Retry agent</Button>}
            </div>
          ) : (
            <AgentSettingsPanel config={effectiveConfig} onChange={handleAutopilotChange} context="linkedin_campaign" />
          )}
        </div>
      ),
    },
    {
      id: "ai_filtering",
      label: "AI Lead Filtering",
      icon: Brain,
      badge:
        settings.ai_filter_unlikely_reply === "skip" ||
        settings.ai_filter_hostile === "skip"
          ? "Active"
          : undefined,
      content: (
        <AIFilterSettings
          settings={settings}
          onChange={(update) => onChange(update as Partial<CampaignPowerSettingsType>)}
        />
      ),
    },
  ];

  return (
    <>
      <div className={cn("space-y-3", className)}>
        {sections.map((section) => (
          <Collapsible
            key={section.id}
            className="overflow-hidden rounded-lg border"
            open={openSections.has(section.id)}
            onOpenChange={() => toggleSection(section.id)}
          >
            <CollapsibleTrigger className="flex items-center gap-3 w-full px-4 py-3.5 hover:bg-muted/50 transition-colors text-left">
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
            <CollapsibleContent className="border-t px-4 py-4">
              <fieldset key={disabled ? "read-only" : "editable"} disabled={disabled} className="min-w-0">{section.content}</fieldset>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      <CreateAgentDialog
        open={!disabled && createAgentOpen}
        onOpenChange={(open) => {
          setCreateAgentOpen(open);
          if (!open) setCreateFromConfig(null);
        }}
        onCreated={(profile) => onAgentProfileChange?.(profile.id, profile.config)}
        initialConfig={createFromConfig ?? undefined}
      />
      <AgentEditConfirmDialog
        open={!disabled && editConfirmOpen}
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
