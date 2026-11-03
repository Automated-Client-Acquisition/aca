import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bot,
  Check,
  ChevronRight,
  Edit2,
  Loader2,
  Power,
  Save,
  Settings2,
  ShieldAlert,
  User,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactDetails } from "@/components/inbox/ContactDetails";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { AgentProfileSelector } from "@/components/autopilot/AgentProfileSelector";
import { AgentEditConfirmDialog } from "@/components/autopilot/AgentEditConfirmDialog";
import {
  useConversationAutopilotItems,
  useApproveAutopilotItem,
  type AutopilotQueueItem,
} from "@/hooks/crm/useAutopilotQueue";
import {
  useAgentProfiles,
  useCreateAgentProfile,
  useUpdateAgentProfile,
  type AgentProfile,
} from "@/hooks/useAgentProfiles";
import type { AutopilotConfig } from "@/types/email";
import {
  useToggleConversationAI,
  useUpdateConversationAgentConfig,
  type ConversationWithContact,
} from "@/hooks/crm/useConversations";
import type { CrmContact } from "@/hooks/crm/useCrmContacts";

const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: true,
  rules: [
    { intent: "interested", action: "auto_reply" },
    { intent: "neutral", action: "auto_reply" },
    { intent: "out_of_office", action: "auto_followup_after_return" },
    { intent: "not_interested", action: "auto_reply" },
  ],
  require_approval: true,
  max_auto_replies: 10,
  max_conversation_turns: 10,
};

interface ConversationAgentPanelProps {
  conversation: ConversationWithContact | null;
  contact: CrmContact | null;
  onClose: () => void;
  defaultTab?: string;
}

export function ConversationAgentPanel({
  conversation,
  contact,
  onClose,
  defaultTab,
}: ConversationAgentPanelProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveProfileName, setSaveProfileName] = useState("");
  const [saveProfileDesc, setSaveProfileDesc] = useState("");
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AutopilotConfig | null>(null);

  const { data: autopilotItems } = useConversationAutopilotItems(
    conversation?.id || ""
  );
  const { data: agentProfiles } = useAgentProfiles();
  const createProfile = useCreateAgentProfile();
  const updateAgentProfileMutation = useUpdateAgentProfile();
  const toggleAI = useToggleConversationAI();
  const updateAgentConfig = useUpdateConversationAgentConfig();

  // Get current config — prefer agent profile over inline metadata
  const metadata = (conversation?.metadata || {}) as Record<string, unknown>;
  const currentProfileId = (conversation as any)?.agent_profile_id || null;
  const linkedProfile = agentProfiles?.find((p) => p.id === currentProfileId);
  const currentConfig = linkedProfile?.config
    || (metadata.autopilot_config as AutopilotConfig)
    || DEFAULT_CONFIG;

  // Local config state for settings tab
  const [localConfig, setLocalConfig] = useState<AutopilotConfig>(currentConfig);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(currentProfileId);

  // Smart default: explicit defaultTab wins, then pending drafts, then settings
  const resolvedDefault = defaultTab || (autopilotItems?.length ? "agent" : "settings");
  const [activeTab, setActiveTab] = useState(resolvedDefault);

  // Sync when conversation changes or agent profiles load
  useEffect(() => {
    const profId = (conversation as any)?.agent_profile_id || null;
    const profile = agentProfiles?.find((p) => p.id === profId);
    const meta = (conversation?.metadata || {}) as Record<string, unknown>;
    setLocalConfig(profile?.config || (meta.autopilot_config as AutopilotConfig) || DEFAULT_CONFIG);
    setSelectedProfileId(profId);
  }, [conversation?.id, conversation?.metadata, agentProfiles]);

  // Auto-switch to agent tab when new drafts arrive
  useEffect(() => {
    if (autopilotItems?.length) {
      setActiveTab("agent");
    }
  }, [autopilotItems?.length]);

  const pendingCount = autopilotItems?.length || 0;
  const isAiEnabled = conversation?.ai_enabled || false;

  const handleProfileSelect = (profile: AgentProfile) => {
    setSelectedProfileId(profile.id);
    setLocalConfig(profile.config);
  };

  const handleConfigChange = (config: AutopilotConfig) => {
    if (selectedProfileId) {
      // Profile attached — ask whether to update globally or save as new
      setPendingConfig(config);
      setEditConfirmOpen(true);
    } else {
      setLocalConfig(config);
    }
  };

  const handleUpdateAgent = () => {
    if (!pendingConfig || !selectedProfileId) return;
    updateAgentProfileMutation.mutate(
      { id: selectedProfileId, config: pendingConfig },
      {
        onSuccess: () => {
          setLocalConfig(pendingConfig);
          setPendingConfig(null);
          setEditConfirmOpen(false);
        },
      }
    );
  };

  const handleSaveAsNewFromEdit = () => {
    if (!pendingConfig) return;
    setLocalConfig(pendingConfig);
    setSelectedProfileId(null);
    setEditConfirmOpen(false);
    setPendingConfig(null);
    // Open save-as-profile dialog so user can name it
    setSaveProfileName("");
    setSaveProfileDesc("");
    setSaveDialogOpen(true);
  };

  const handleSaveAsProfile = () => {
    if (!saveProfileName.trim()) return;
    createProfile.mutate(
      {
        name: saveProfileName.trim(),
        description: saveProfileDesc.trim() || undefined,
        config: localConfig,
      },
      {
        onSuccess: (newProfile) => {
          setSaveDialogOpen(false);
          setSaveProfileName("");
          setSaveProfileDesc("");
          setSelectedProfileId(newProfile.id);
        },
      }
    );
  };

  // Determine agent status
  const getAgentStatus = () => {
    if (!isAiEnabled) return { label: "Inactive", color: "text-muted-foreground", dot: "bg-muted-foreground" };
    if (pendingCount > 0) return { label: "Draft Ready", color: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" };
    return { label: "Active", color: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" };
  };

  const status = getAgentStatus();

  return (
    <div className="h-full flex flex-col bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm">AI Agent</h3>
          <div className="flex items-center gap-1.5">
            <div className={cn("h-2 w-2 rounded-full", status.dot)} />
            <span className={cn("text-xs", status.color)}>{status.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isAiEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1 px-2"
              onClick={() => {
                if (conversation) {
                  toggleAI.mutate(
                    {
                      conversationId: conversation.id,
                      enabled: false,
                    },
                    { onSuccess: () => onClose() },
                  );
                }
              }}
              disabled={toggleAI.isPending}
            >
              <Power className="h-3 w-3" />
              Deactivate
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2">
          <TabsList className="w-full grid grid-cols-3 h-8">
            <TabsTrigger value="agent" className="text-xs relative">
              Agent
              {pendingCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[9px] bg-amber-500">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">
              <Settings2 className="h-3 w-3 mr-1" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="contact" className="text-xs">
              <User className="h-3 w-3 mr-1" />
              Contact
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Agent Tab */}
        <TabsContent value="agent" className="flex-1 mt-0 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Status Overview */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Zap className="h-3 w-3" />
                  <span>
                    {isAiEnabled
                      ? `Agent active — ${currentConfig.require_approval ? "drafts for approval" : "auto-sending"}`
                      : "Agent not enabled on this conversation"}
                  </span>
                </div>
                {currentConfig.conversation_goal && (
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                    Goal: {currentConfig.conversation_goal}
                  </div>
                )}
              </div>

              <Separator />

              {/* Pending Drafts */}
              {pendingCount > 0 ? (
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Pending Drafts
                  </h4>
                  {autopilotItems!.map((item) => (
                    <AgentDraftCard key={item.id} item={item} />
                  ))}
                </div>
              ) : isAiEnabled ? (
                <div className="text-center py-6">
                  <Bot className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Agent is listening. Drafts will appear here when a new message arrives.
                  </p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <Bot className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Enable AI on this conversation to start the agent.
                  </p>
                </div>
              )}

              {/* Rules Summary */}
              {isAiEnabled && currentConfig.rules?.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Active Rules
                    </h4>
                    <div className="space-y-1">
                      {currentConfig.rules.map((rule, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <Badge variant="outline" className="h-5 text-[10px]">
                            {rule.intent.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-muted-foreground">
                            {rule.action.replace(/_/g, " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="flex-1 mt-0 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Profile Selector */}
              <div className="space-y-2">
                <Label className="text-xs">Agent Profile</Label>
                <AgentProfileSelector
                  selectedProfileId={selectedProfileId}
                  onSelect={handleProfileSelect}
                  onCreateNew={() => {
                    setSaveProfileName("");
                    setSaveProfileDesc("");
                    setSaveDialogOpen(true);
                  }}
                />
              </div>

              <Separator />

              {/* Full Agent Config */}
              <AgentSettingsPanel
                config={localConfig}
                onChange={handleConfigChange}
                context="conversation"
              />

              <Separator />

              {/* Apply Settings to Conversation */}
              <Button
                variant="cta"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  if (conversation) {
                    updateAgentConfig.mutate({
                      conversationId: conversation.id,
                      profileId: selectedProfileId,
                      config: localConfig as unknown as Record<string, unknown>,
                    });
                  }
                }}
                disabled={!conversation || updateAgentConfig.isPending}
              >
                {updateAgentConfig.isPending ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-3 w-3 mr-1.5" />
                )}
                Apply Settings
              </Button>

              {/* Save as Profile */}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  setSaveProfileName("");
                  setSaveProfileDesc("");
                  setSaveDialogOpen(true);
                }}
              >
                <Save className="h-3 w-3 mr-1.5" />
                Save as New Profile
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Contact Tab */}
        <TabsContent value="contact" className="flex-1 mt-0 min-h-0">
          <ContactDetails
            contact={contact}
            conversation={conversation}
            onClose={onClose}
          />
        </TabsContent>
      </Tabs>

      {/* Save Profile Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Agent Profile</DialogTitle>
            <DialogDescription>
              Save the current configuration as a reusable profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Profile Name</Label>
              <Input
                placeholder="e.g. SDR Follow-up"
                value={saveProfileName}
                onChange={(e) => setSaveProfileName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input
                placeholder="What does this agent do?"
                value={saveProfileDesc}
                onChange={(e) => setSaveProfileDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              size="sm"
              onClick={handleSaveAsProfile}
              disabled={!saveProfileName.trim() || createProfile.isPending}
            >
              {createProfile.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgentEditConfirmDialog
        open={editConfirmOpen}
        onOpenChange={(open) => {
          setEditConfirmOpen(open);
          if (!open) setPendingConfig(null);
        }}
        agentName={linkedProfile?.name || agentProfiles?.find((p) => p.id === selectedProfileId)?.name || "Agent"}
        onUpdateAgent={handleUpdateAgent}
        onSaveAsNew={handleSaveAsNewFromEdit}
        isPending={updateAgentProfileMutation.isPending}
      />
    </div>
  );
}

// ============================================================================
// Agent Draft Card — renders within Agent tab
// ============================================================================

function AgentDraftCard({ item }: { item: AutopilotQueueItem }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedMessage, setEditedMessage] = useState(item.draft_message);
  const approveMutation = useApproveAutopilotItem();

  const handleApprove = () => {
    approveMutation.mutate({
      queueItemId: item.id,
      action: "approve",
      editedMessage: isEditing ? editedMessage : undefined,
    });
  };

  const handleReject = () => {
    approveMutation.mutate({ queueItemId: item.id, action: "reject" });
  };

  const handleToggleEdit = () => {
    if (isEditing) setEditedMessage(item.draft_message);
    setIsEditing(!isEditing);
  };

  const isProcessing = approveMutation.isPending;
  const intentLabel = item.trigger_intent
    ?.replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown";
  const isEscalated = !!(item.metadata as Record<string, unknown>)?.escalated;
  const escalationReason = (item.metadata as Record<string, unknown>)?.escalation_reason as string | undefined;
  const confidence = (item.metadata as Record<string, unknown>)?.confidence as number | undefined;

  return (
    <div
      className={cn(
        "border rounded-lg p-3",
        isEscalated
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
          : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {isEscalated ? (
          <ShieldAlert className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        )}
        <span
          className={cn(
            "text-xs font-medium",
            isEscalated ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"
          )}
        >
          {isEscalated ? "Escalated" : "AI Draft"}
        </span>
        <Badge variant="outline" className="h-4 text-[9px] px-1">
          {intentLabel}
        </Badge>
        {confidence != null && (
          <Badge
            variant="outline"
            className={cn(
              "h-4 text-[9px] px-1",
              confidence >= 0.7
                ? "border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400"
                : confidence >= 0.4
                  ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                  : "border-red-300 dark:border-red-700 text-red-700 dark:text-red-400"
            )}
          >
            {Math.round(confidence * 100)}%
          </Badge>
        )}
      </div>

      {/* Escalation reason */}
      {isEscalated && escalationReason && (
        <p className="text-[10px] text-red-600 dark:text-red-400 mb-2">
          {escalationReason}
        </p>
      )}

      {/* Draft content */}
      {isEditing ? (
        <Textarea
          value={editedMessage}
          onChange={(e) => setEditedMessage(e.target.value)}
          className="mb-2 text-xs min-h-[80px] bg-white dark:bg-background"
        />
      ) : (
        <p
          className={cn(
            "text-xs mb-2 whitespace-pre-wrap",
            isEscalated ? "text-red-900 dark:text-red-200" : "text-amber-900 dark:text-amber-200"
          )}
        >
          {item.draft_message}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button variant="cta" size="sm" className="h-6 text-[10px] px-2" onClick={handleApprove} disabled={isProcessing}>
          {isProcessing && approveMutation.variables?.action === "approve" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          {isEditing ? "Save & Send" : "Approve"}
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={handleToggleEdit} disabled={isProcessing}>
          <Edit2 className="h-3 w-3 mr-1" />
          {isEditing ? "Cancel" : "Edit"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
          onClick={handleReject}
          disabled={isProcessing}
        >
          {isProcessing && approveMutation.variables?.action === "reject" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <X className="h-3 w-3 mr-1" />
          )}
          Reject
        </Button>
      </div>
    </div>
  );
}
