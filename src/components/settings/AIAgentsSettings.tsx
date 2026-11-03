import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bot,
  Plus,
  Star,
  Pencil,
  Trash2,
  Copy,
  MoreHorizontal,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Shield,
  BookOpen,
  AudioLines,
  Target,
  MessageSquare,
  Clock,
  Zap,
  FlaskConical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { AgentTestChat } from "@/components/autopilot/AgentTestChat";
import {
  useAgentProfiles,
  useCreateAgentProfile,
  useUpdateAgentProfile,
  useDeleteAgentProfile,
  useSetDefaultAgentProfile,
  type AgentProfile,
} from "@/hooks/useAgentProfiles";
import { LEAD_INTENT_LABELS } from "@/types/classification";
import type { AutopilotConfig, AutopilotRule } from "@/types/email";
import { cn } from "@/lib/utils";

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

const AGENT_COLORS = [
  "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
];

const ACTION_LABELS: Record<AutopilotRule["action"], string> = {
  auto_reply: "Auto Reply",
  draft_for_approval: "Draft for Approval",
  send_calendly: "Send Calendly",
  book_ghl_appointment: "Book Appointment",
  auto_followup_after_return: "Follow Up After OOO",
  escalate: "Escalate",
};

const ESCALATION_LABELS: Record<string, string> = {
  low_confidence: "Low Confidence",
  hostile_sentiment: "Hostile Sentiment",
  explicit_request: "Human Requested",
  max_turns: "Max Turns Reached",
  custom_keyword: "Custom Keywords",
};

function getAgentColor(index: number) {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type PanelMode = "empty" | "view" | "edit" | "create";

export function AIAgentsSettings() {
  const { data: profiles, isLoading } = useAgentProfiles();
  const createProfile = useCreateAgentProfile();
  const updateProfile = useUpdateAgentProfile();
  const deleteProfile = useDeleteAgentProfile();
  const setDefault = useSetDefaultAgentProfile();

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [editingProfile, setEditingProfile] = useState<AgentProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentProfile | null>(null);
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [testingProfile, setTestingProfile] = useState<AgentProfile | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formConfig, setFormConfig] = useState<AutopilotConfig>(DEFAULT_CONFIG);

  // Auto-select first/default profile on load
  useEffect(() => {
    if (profiles?.length && !selectedProfileId && !isCreateMode) {
      const defaultProfile = profiles.find((p) => p.is_default);
      setSelectedProfileId(defaultProfile?.id || profiles[0].id);
    }
  }, [profiles, selectedProfileId, isCreateMode]);

  // Collapse instructions when switching agents
  useEffect(() => {
    setInstructionsExpanded(false);
  }, [selectedProfileId]);

  const selectedProfile = profiles?.find((p) => p.id === selectedProfileId) || null;
  const selectedIndex = profiles?.findIndex((p) => p.id === selectedProfileId) ?? -1;

  // Derive panel mode
  const panelMode: PanelMode = isCreateMode
    ? "create"
    : editingProfile
    ? "edit"
    : selectedProfile
    ? "view"
    : "empty";

  const openCreate = () => {
    setFormName("");
    setFormDescription("");
    setFormConfig(DEFAULT_CONFIG);
    setEditingProfile(null);
    setIsCreateMode(true);
  };

  const openEdit = (profile: AgentProfile) => {
    setFormName(profile.name);
    setFormDescription(profile.description || "");
    setFormConfig(profile.config);
    setIsCreateMode(false);
    setEditingProfile(profile);
  };

  const openDuplicate = (profile: AgentProfile) => {
    setFormName(`${profile.name} (copy)`);
    setFormDescription(profile.description || "");
    setFormConfig(profile.config);
    setEditingProfile(null);
    setIsCreateMode(true);
  };

  const cancelEditOrCreate = () => {
    setEditingProfile(null);
    setIsCreateMode(false);
  };

  const handleCreate = () => {
    if (!formName.trim()) return;
    createProfile.mutate(
      { name: formName.trim(), description: formDescription.trim() || undefined, config: formConfig },
      {
        onSuccess: (newProfile) => {
          setIsCreateMode(false);
          if (newProfile?.id) setSelectedProfileId(newProfile.id);
        },
      }
    );
  };

  const handleUpdate = () => {
    if (!editingProfile || !formName.trim()) return;
    updateProfile.mutate(
      { id: editingProfile.id, name: formName.trim(), description: formDescription.trim() || undefined, config: formConfig },
      { onSuccess: () => setEditingProfile(null) }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteProfile.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        if (selectedProfileId === deleteTarget.id) {
          setSelectedProfileId(null);
        }
      },
    });
  };

  const selectAgent = (profile: AgentProfile) => {
    setSelectedProfileId(profile.id);
    setEditingProfile(null);
    setIsCreateMode(false);
  };

  // ----- Loading state -----
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-80 mt-1.5" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="flex h-[calc(100vh-280px)] min-h-[500px] rounded-lg border overflow-hidden">
          <div className="w-80 border-r p-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-3 rounded-lg border space-y-2.5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-18 rounded-full" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex-1 p-8 space-y-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // ----- Full empty state (zero agents, not in create mode) -----
  if (!profiles?.length && !isCreateMode) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold">AI Agents</h3>
          <p className="text-sm text-muted-foreground">
            Create reusable AI agent configurations. Apply them to inbox conversations, campaigns, sequences, and lead magnets.
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-rose-500/20 flex items-center justify-center mb-6">
              <Bot className="h-10 w-10 text-amber-600 dark:text-amber-400" />
            </div>
            <h4 className="text-lg font-medium mb-2">Create your first AI Agent</h4>
            <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
              AI Agents automate conversation handling across your inbox, campaigns, and email sequences.
              Configure intent rules, escalation triggers, and approval workflows.
            </p>
            <Button variant="cta" size="lg" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ----- Main layout: master-detail -----
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">AI Agents</h3>
          <p className="text-sm text-muted-foreground">
            Create reusable AI agent configurations. Apply them to inbox conversations, campaigns, sequences, and lead magnets.
          </p>
        </div>
      </div>

      {/* Split layout */}
      <div className="flex h-[calc(100vh-260px)] min-h-[540px] rounded-lg border overflow-hidden bg-background">
        {/* ----- Left: Agent List ----- */}
        <div className={cn(
          "w-80 border-r flex flex-col shrink-0 bg-muted/20",
          (panelMode !== "empty" && selectedProfile) ? "hidden md:flex" : "flex"
        )}>
          {/* List header */}
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Agents ({profiles?.length || 0})
            </span>
            <Button variant="cta" size="sm" className="h-7 text-xs px-2.5" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {profiles?.map((profile, index) => {
                const isSelected = profile.id === selectedProfileId && !isCreateMode;
                const ruleCount = profile.config.rules?.length || 0;
                return (
                  <button
                    key={profile.id}
                    onClick={() => selectAgent(profile)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg transition-all",
                      "hover:bg-accent/50",
                      isSelected
                        ? "bg-accent shadow-sm ring-1 ring-accent-foreground/10"
                        : "hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                          getAgentColor(index)
                        )}
                      >
                        <Bot className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-sm font-medium leading-tight line-clamp-2">
                            {profile.name}
                          </span>
                          {profile.is_default && (
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
                          )}
                        </div>
                        {profile.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {profile.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-2">
                          <Badge variant="secondary" className="text-[10px] h-5 px-2 font-normal gap-1">
                            <Zap className="h-2.5 w-2.5" />
                            {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px] h-5 px-2 font-normal gap-1",
                              !profile.config.require_approval && "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            )}
                          >
                            <Shield className="h-2.5 w-2.5" />
                            {profile.config.require_approval ? "Approval" : "Auto-send"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* ----- Right: Detail Panel ----- */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Empty selection state */}
          {panelMode === "empty" && (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-muted/80 to-muted/40 flex items-center justify-center mb-4">
                <Bot className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <h4 className="text-base font-medium mb-1">Select an agent</h4>
              <p className="text-sm text-muted-foreground max-w-sm">
                Choose an agent from the list to view its configuration and settings.
              </p>
            </div>
          )}

          {/* View mode */}
          {panelMode === "view" && selectedProfile && (
            <>
              {/* Header bar — stacked layout for breathing room */}
              <div className="px-8 pt-6 pb-5 border-b shrink-0 space-y-4">
                {/* Top row: back button (mobile) + actions */}
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs md:hidden -ml-2"
                    onClick={() => setSelectedProfileId(null)}
                  >
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <div className="flex items-center gap-2 ml-auto">
                    <Button variant="outline" size="sm" onClick={() => setTestingProfile(selectedProfile)}>
                      <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Test
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(selectedProfile)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDuplicate(selectedProfile)}>
                          <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        {!selectedProfile.is_default && (
                          <DropdownMenuItem onClick={() => setDefault.mutate(selectedProfile.id)}>
                            <Star className="h-3.5 w-3.5 mr-2" /> Set as Default
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(selectedProfile)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Agent identity */}
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                      getAgentColor(selectedIndex >= 0 ? selectedIndex : 0)
                    )}
                  >
                    <Bot className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-semibold leading-tight">{selectedProfile.name}</h3>
                      {selectedProfile.is_default && (
                        <Badge variant="secondary" className="text-[10px] h-5 gap-0.5">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Default
                        </Badge>
                      )}
                    </div>
                    {selectedProfile.description && (
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {selectedProfile.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Read-only detail content */}
              <ScrollArea className="flex-1">
                <div className="px-8 py-6 space-y-6">
                  {/* Stat cards */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-xl border p-4 space-y-1">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Status</p>
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          selectedProfile.config.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                        )} />
                        <p className={cn(
                          "text-sm font-semibold",
                          selectedProfile.config.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                        )}>
                          {selectedProfile.config.enabled ? "Active" : "Disabled"}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border p-4 space-y-1">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Approval</p>
                      <div className="flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-sm font-semibold">
                          {selectedProfile.config.require_approval ? "Required" : "Auto-send"}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border p-4 space-y-1">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Limits</p>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-sm font-semibold">
                          {selectedProfile.config.max_auto_replies} replies · {selectedProfile.config.max_conversation_turns || 10} turns
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Feature badges */}
                  {(selectedProfile.config.use_knowledge_base || selectedProfile.config.use_tone_profile) && (
                    <div className="flex flex-wrap gap-2">
                      {selectedProfile.config.use_knowledge_base && (
                        <Badge variant="secondary" className="text-xs font-normal gap-1.5 h-6 px-2.5">
                          <BookOpen className="h-3 w-3" />
                          Knowledge Base
                        </Badge>
                      )}
                      {selectedProfile.config.use_tone_profile && (
                        <Badge variant="secondary" className="text-xs font-normal gap-1.5 h-6 px-2.5">
                          <AudioLines className="h-3 w-3" />
                          Tone Matching
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Conversation Goal */}
                  {selectedProfile.config.conversation_goal && (
                    <div className="rounded-xl border p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversation Goal</p>
                      </div>
                      <p className="text-sm leading-relaxed">{selectedProfile.config.conversation_goal}</p>
                    </div>
                  )}

                  {/* System Instructions — collapsible for long text */}
                  {selectedProfile.config.system_instructions && (
                    <div className="rounded-xl border p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System Instructions</p>
                      </div>
                      <div className="relative">
                        <p className={cn(
                          "text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap",
                          !instructionsExpanded && "line-clamp-4"
                        )}>
                          {selectedProfile.config.system_instructions}
                        </p>
                        {selectedProfile.config.system_instructions.length > 300 && (
                          <button
                            onClick={() => setInstructionsExpanded(!instructionsExpanded)}
                            className="flex items-center gap-1 mt-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {instructionsExpanded ? (
                              <>
                                <ChevronUp className="h-3 w-3" />
                                Show less
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-3 w-3" />
                                Show more
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* Intent Rules */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Intent Rules ({selectedProfile.config.rules.length})
                    </p>
                    {selectedProfile.config.rules.length > 0 ? (
                      <div className="space-y-1.5">
                        {selectedProfile.config.rules.map((rule, i) => (
                          <div key={i} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/40 text-sm">
                            <span className="font-medium">
                              {LEAD_INTENT_LABELS[rule.intent as keyof typeof LEAD_INTENT_LABELS] || rule.intent}
                            </span>
                            <Badge variant="outline" className="text-xs font-normal">
                              {ACTION_LABELS[rule.action] || rule.action}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No intent rules configured</p>
                    )}
                  </div>

                  {/* Escalation Rules */}
                  {(selectedProfile.config.escalation_rules?.length || 0) > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Escalation Rules ({selectedProfile.config.escalation_rules!.length})
                      </p>
                      <div className="space-y-1.5">
                        {selectedProfile.config.escalation_rules!.map((rule, i) => (
                          <div key={i} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/40 text-sm">
                            <span className="font-medium">{ESCALATION_LABELS[rule.condition] || rule.condition}</span>
                            {rule.threshold !== undefined && (
                              <Badge variant="outline" className="text-xs font-mono">
                                {rule.threshold.toFixed(2)}
                              </Badge>
                            )}
                            {rule.keywords?.length && (
                              <Badge variant="outline" className="text-xs font-normal">
                                {rule.keywords.join(", ")}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* Metadata */}
                  <p className="text-xs text-muted-foreground">
                    Created {formatDate(selectedProfile.created_at)} · Last updated {formatDate(selectedProfile.updated_at)}
                  </p>
                </div>
              </ScrollArea>
            </>
          )}

          {/* Edit mode */}
          {panelMode === "edit" && editingProfile && (
            <>
              <div className="flex items-center justify-between px-8 py-5 border-b shrink-0">
                <div>
                  <h3 className="text-base font-semibold">Edit Agent</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Editing: {editingProfile.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEditOrCreate}>
                    Cancel
                  </Button>
                  <Button
                    variant="cta"
                    size="sm"
                    onClick={handleUpdate}
                    disabled={!formName.trim() || updateProfile.isPending}
                  >
                    {updateProfile.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-8 py-6 space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      className="min-h-[60px]"
                    />
                  </div>
                  <AgentSettingsPanel
                    config={formConfig}
                    onChange={setFormConfig}
                    context="conversation"
                  />
                </div>
              </ScrollArea>
            </>
          )}

          {/* Create mode */}
          {panelMode === "create" && (
            <>
              <div className="flex items-center justify-between px-8 py-5 border-b shrink-0">
                <div>
                  <h3 className="text-base font-semibold">New Agent</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Configure your new AI agent profile</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEditOrCreate}>
                    Cancel
                  </Button>
                  <Button
                    variant="cta"
                    size="sm"
                    onClick={handleCreate}
                    disabled={!formName.trim() || createProfile.isPending}
                  >
                    {createProfile.isPending ? "Creating..." : "Create Agent"}
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-8 py-6 space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      placeholder="e.g. SDR Follow-up, Inbound Qualifier"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Textarea
                      placeholder="What does this agent do?"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      className="min-h-[60px]"
                    />
                  </div>
                  <AgentSettingsPanel
                    config={formConfig}
                    onChange={setFormConfig}
                    context="conversation"
                  />
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteTarget?.name}". Conversations using this profile will keep their current config but won't receive future updates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Agent Test Chat */}
      <AgentTestChat
        open={!!testingProfile}
        onOpenChange={(open) => !open && setTestingProfile(null)}
        profile={testingProfile}
      />
    </div>
  );
}
