import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnrollmentModeSelector } from "@/components/lead-lists/EnrollmentModeSelector";
import { EnrollmentFilterStep } from "@/components/lead-lists/EnrollmentFilterStep";
import { CreateSmartListDialog } from "@/components/lead-lists/CreateSmartListDialog";
import { EnrollmentSources } from "@/components/lead-lists/EnrollmentSources";
import {
  activeInflowListIds,
  useEnrollmentInflows,
} from "@/hooks/useEnrollmentInflows";
import { useListsAwaitingProcessing } from "@/hooks/useListsAwaitingProcessing";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SequenceOutline } from "@/components/email/SequenceOutline";
import { SequenceEmailPreview } from "@/components/email/SequenceEmailPreview";
import type { CrmContact } from "@/hooks/crm/useContacts";
import { SequenceAnalyticsTab } from "@/components/email/SequenceAnalyticsTab";
import { EnrollFromListDialog } from "@/components/email/EnrollFromListDialog";
import { EnrollmentJobBanner } from "@/components/email/EnrollmentJobBanner";
import { SequenceFleetNotice } from "@/components/email/FleetDemandNotice";
import { effectiveDailyLimit } from "@/lib/fleet-demand";
import { SequenceStepEditor } from "@/components/email/SequenceStepEditor";
import { ABVariantEditor } from "@/components/email/ABVariantEditor";
import { ABTestResults } from "@/components/email/ABTestResults";
import {
  getStepABPerformanceVariants,
  hydrateABVariantIds,
} from "@/lib/email-ab-performance";
import { CampaignSettingsPanel } from "@/components/email/CampaignSettingsPanel";
import { EnrollmentTable } from "@/components/email/EnrollmentTable";
import { FilteredLeadsTable } from "@/components/email/FilteredLeadsTable";
import {
  useEmailSequence,
  useUpdateEmailSequence,
  useToggleSequenceStatus,
} from "@/hooks/useEmailSequences";
import { useEmailSequenceAutosave } from "@/hooks/useEmailSequenceAutosave";
import { useEnrollmentCounts } from "@/hooks/useEmailEnrollments";
import { DuplicateSequenceDialog } from "@/components/email/DuplicateSequenceDialog";
import { useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { useLeadLists, useCreateSmartList, isLivingLeadList } from "@/hooks/useLeadLists";
import { useEmailSendingDomains } from "@/hooks/useEmailSendingDomains";
import {
  useABVariants,
  useSyncABVariants,
  useDeclareWinner,
} from "@/hooks/useEmailABTests";
import {
  getDefaultEmailStep,
  getDefaultDelayStep,
  getDefaultConditionStep,
  getDefaultABTestStep,
  convertEmailStepToABTest,
  reorderSteps,
  selectedStepIndexAfterMove,
  validateSequenceSteps,
  validateSettings,
  type ValidationError,
} from "@/lib/email-sequence-utils";
import {
  ArrowLeft,
  Play,
  Pause,
  Plus,
  Mail,
  Clock,
  Settings,
  Users,
  AlertCircle,
  AlertTriangle,
  Pencil,
  ShieldAlert,
  FileEdit,
  Check,
  Copy,
  Loader2,
  Eye,
  MoreHorizontal,
  BarChart3,
  ListFilter,
  Split,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EmailSequenceStep,
  EmailSequenceSettings,
  StepType,
  UpdateEmailSequenceInput,
  AutopilotConfig,
} from "@/types/email";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { EmailCampaignsShowcase } from "@/components/showcase/EmailCampaignsShowcase";

export default function EmailSequenceBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentOrganization } = useAuth();
  const [searchParams] = useSearchParams();
  const initialSettingsSection = searchParams.get("settings") || undefined;
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseEmail = hasFeature("email_campaigns");
  const { data: sequence, isLoading, isError, refetch } = useEmailSequence(id);
  const { data: mailboxes } = useEmailMailboxes();
  const { data: sendingDomains } = useEmailSendingDomains();
  const { leadLists } = useLeadLists();
  const updateMutation = useUpdateEmailSequence();
  const toggleMutation = useToggleSequenceStatus();
  const syncABVariantsMutation = useSyncABVariants();
  const declareWinnerMutation = useDeclareWinner();
  const {
    data: abVariants,
    isLoading: abStatsLoading,
    isFetching: abStatsRefreshing,
    isError: abStatsError,
    refetch: refreshABStats,
  } = useABVariants(id);
  const {
    data: enrollmentCounts,
    isError: countsError,
    refetch: refetchCounts,
  } = useEnrollmentCounts(id);

  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(
    null,
  );
  const [editingName, setEditingName] = useState(false);
  const cancelNameEditRef = useRef(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [createSegmentOpen, setCreateSegmentOpen] = useState(false);
  const createSegment = useCreateSmartList();
  const [showPreview, setShowPreview] = useState(false);
  const [abView, setABView] = useState<"edit" | "performance">("edit");
  const [previewContact, setPreviewContact] = useState<CrmContact | null>(null);
  const [stepRevision, setStepRevision] = useState(0);
  const [stepToDelete, setStepToDelete] = useState<number | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [localSteps, setLocalSteps] = useState<EmailSequenceStep[]>([]);
  const [stepIds, setStepIds] = useState<string[]>([]);
  const [localSettings, setLocalSettings] =
    useState<EmailSequenceSettings | null>(null);
  const [localAutopilotConfig, setLocalAutopilotConfig] =
    useState<AutopilotConfig | null>(null);
  const [localAgentProfileId, setLocalAgentProfileId] = useState<string | null>(
    null,
  );
  const [localLeadListIds, setLocalLeadListIds] = useState<string[]>([]);
  const [localAutoEnroll, setLocalAutoEnroll] = useState(false);
  const [localEnrollFilter, setLocalEnrollFilter] =
    useState<SmartListFilterCriteria>({});
  const initializedRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState(
    initialSettingsSection ? "settings" : (["steps", "audience", "settings", "analytics", "enrollments", "filtered"].includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "steps"),
  );
  const [settingsSection, setSettingsSection] = useState(
    initialSettingsSection,
  );
  const [changingStatus, setChangingStatus] = useState(false);
  const [settingsNavigationRequest, setSettingsNavigationRequest] = useState(0);

  // The other half of "who gets contacted": lead lists whose processing
  // pipeline routes its approved leads into this sequence. Those lists own
  // their leads — attaching one directly below would bypass that gate.
  const { data: pipelineInflows } = useEnrollmentInflows("email_sequence", id);
  const pipelineOwnedListIds = activeInflowListIds(pipelineInflows);
  const { data: awaitingProcessing } =
    useListsAwaitingProcessing(localLeadListIds);

  const { mutateAsync: updateSequence } = updateMutation;
  const { mutateAsync: syncVariants } = syncABVariantsMutation;
  const persistChanges = useCallback(
    async (payload: UpdateEmailSequenceInput) => {
      await updateSequence({
        ...payload,
        organization_id: currentOrganization?.id,
      });
      if (payload.steps) {
        await syncVariants({ sequence_id: payload.id, steps: payload.steps });
      }
    },
    [updateSequence, syncVariants, currentOrganization?.id],
  );
  const {
    saveStatus,
    saveError,
    queueSave: debouncedSave,
    flush,
    retry,
  } = useEmailSequenceAutosave({
    sequenceId: id,
    scopeKey: `${currentOrganization?.id}:${id}`,
    save: persistChanges,
  });

  const waitingForLegacyStats =
    !!sequence?.steps.some(
      (step) =>
        step.type === "ab_test" &&
        step.variants?.some((variant) => !variant.id),
    ) &&
    initializedRef.current !== `${sequence.organization_id}:${sequence.id}` &&
    abVariants === undefined;

  // Sync from server only on initial load (not on every refetch)
  useEffect(() => {
    if (
      sequence &&
      initializedRef.current !== `${sequence.organization_id}:${sequence.id}`
    ) {
      if (waitingForLegacyStats) return;
      initializedRef.current = `${sequence.organization_id}:${sequence.id}`;
      setSelectedStepIndex(sequence.steps.length ? 0 : null);
      setLocalSteps(
        hydrateABVariantIds(sequence.steps, abVariants || [], sequence.id),
      );
      setStepIds(sequence.steps.map(() => crypto.randomUUID()));
      setLocalSettings(sequence.settings);
      setLocalAutopilotConfig(sequence.autopilot_config || null);
      setLocalAgentProfileId(sequence.agent_profile_id || null);
      setLocalLeadListIds(
        sequence.lead_list_ids ??
          (sequence.lead_list_id ? [sequence.lead_list_id] : []),
      );
      setLocalAutoEnroll(sequence.auto_enroll_new_members ?? false);
      setLocalEnrollFilter(
        (sequence as { enroll_filter_criteria?: SmartListFilterCriteria })
          .enroll_filter_criteria ?? {},
      );
      setNameValue(sequence.name);
    }
  }, [sequence, abVariants, waitingForLegacyStats]);

  const saveSteps = useCallback(
    (steps: EmailSequenceStep[]) => {
      if (!id) return;
      debouncedSave({ id, steps });
    },
    [id, debouncedSave],
  );

  const saveSettings = useCallback(
    (update: Partial<EmailSequenceSettings>) => {
      if (!id) return;
      debouncedSave({ id, settings: update });
    },
    [id, debouncedSave],
  );

  const saveAutopilotConfig = useCallback(
    (config: AutopilotConfig) => {
      if (!id) return;
      debouncedSave({ id, autopilot_config: config });
    },
    [id, debouncedSave],
  );

  const handleAutopilotChange = (config: AutopilotConfig) => {
    setLocalAutopilotConfig(config);
    saveAutopilotConfig(config);
  };

  const handleStepChange = (index: number, step: EmailSequenceStep) => {
    const updated = [...localSteps];
    updated[index] = step;
    setLocalSteps(updated);
    saveSteps(updated);
  };

  const handleAddEmailVariant = (index: number) => {
    if (localSteps[index]?.type !== "email") return;
    setABView("edit");
    setStepRevision((value) => value + 1);
    handleStepChange(index, convertEmailStepToABTest(localSteps[index]));
  };

  const handleDeleteStep = (index: number) => {
    // Step positions are not identities: remount Tiptap when deletion replaces
    // the selected email with a different email at the same position.
    setStepRevision((value) => value + 1);
    setStepIds((ids) => ids.filter((_, position) => position !== index));
    const updated = localSteps
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, order: i }));
    setLocalSteps(updated);
    setSelectedStepIndex(
      updated.length ? Math.min(index, updated.length - 1) : null,
    );
    saveSteps(updated);
  };

  const handleAddStep = (type: StepType) => {
    const order = localSteps.length;
    let newStep: EmailSequenceStep;

    switch (type) {
      case "email":
        newStep = getDefaultEmailStep(order);
        break;
      case "delay":
        newStep = getDefaultDelayStep(order);
        break;
      case "condition":
        newStep = getDefaultConditionStep(order);
        break;
      case "ab_test":
        setABView("edit");
        newStep = getDefaultABTestStep(order);
        break;
    }

    const updated = [...localSteps, newStep];
    setStepIds((ids) => [...ids, crypto.randomUUID()]);
    setLocalSteps(updated);
    setSelectedStepIndex(order);
    saveSteps(updated);
  };

  const handleReorderStep = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      fromIndex >= localSteps.length ||
      toIndex < 0 ||
      toIndex >= localSteps.length
    )
      return;
    const updated = reorderSteps(localSteps, fromIndex, toIndex);
    setStepIds((ids) => {
      const reordered = [...ids];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return reordered;
    });
    // A reordered position can otherwise reuse a different email's Tiptap state.
    setStepRevision((value) => value + 1);
    setLocalSteps(updated);
    setSelectedStepIndex((selected) =>
      selectedStepIndexAfterMove(selected, fromIndex, toIndex),
    );
    saveSteps(updated);
  };

  const handleMoveStep = (fromIndex: number, direction: "up" | "down") => {
    handleReorderStep(
      fromIndex,
      direction === "up" ? fromIndex - 1 : fromIndex + 1,
    );
  };

  /**
   * Detach a lead list. Shared by the list row's × and by the "Let the pipeline
   * decide" fix on a conflicting pipeline inflow — both mean the same thing:
   * this sequence stops pulling the list directly.
   */
  const detachLeadList = (listId: string) => {
    const next = localLeadListIds.filter((x) => x !== listId);
    setLocalLeadListIds(next);
    if (next.length === 0) setLocalAutoEnroll(false);
    if (id) {
      debouncedSave({
        id,
        lead_list_ids: next,
        ...(next.length === 0 ? { auto_enroll_new_members: false } : {}),
      });
    }
  };

  const handleSettingsChange = (update: Partial<EmailSequenceSettings>) => {
    if (!localSettings) return;
    setLocalSettings((current) =>
      current ? { ...current, ...update } : current,
    );
    saveSettings(update);
  };

  const handleSaveName = () => {
    if (cancelNameEditRef.current) {
      cancelNameEditRef.current = false;
      return;
    }
    if (id && nameValue.trim()) {
      debouncedSave({ id, name: nameValue.trim() });
    }
    if (!nameValue.trim()) setNameValue(sequence?.name || "New sequence");
    setEditingName(false);
  };

  const validationErrors = [
    ...validateSequenceSteps(localSteps),
    ...(localSettings ? validateSettings(localSettings) : []),
  ];

  const openSettings = (section: string) => {
    setSettingsSection(section);
    setSettingsNavigationRequest((value) => value + 1);
    setActiveTab("settings");
  };
  const changeStatus = async (status: "active" | "paused" | "draft") => {
    setChangingStatus(true);
    try {
      if (status === "active") await flush();
      await toggleMutation.mutateAsync({ id: id!, status });
    } catch {
      /* Mutation and autosave surface their errors. */
    } finally {
      setChangingStatus(false);
    }
  };

  // Feature gating
  if (!canUseEmail && showUpgradePrompts) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 min-w-0 p-4 sm:p-6">
          <EmailCampaignsShowcase />
        </div>
      </AppLayout>
    );
  }

  if (!canUseEmail) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8 text-center py-12">
          <p className="text-muted-foreground">
            This feature is not available for your organization.
          </p>
        </div>
      </AppLayout>
    );
  }

  if (
    isError ||
    (!isLoading && !sequence) ||
    (waitingForLegacyStats && abStatsError)
  ) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="p-6 sm:p-8 text-center space-y-4">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">
            {waitingForLegacyStats && abStatsError
              ? "Unable to load variant history"
              : isError
                ? "Unable to load this sequence"
                : "Sequence not found"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {waitingForLegacyStats && abStatsError
              ? "Try again to restore saved variants before editing."
              : isError
                ? "Try again to load the latest sequence."
                : "This sequence may have been removed or belongs to another workspace."}
          </p>
          <Button
            variant="outline"
            aria-label="Back to sequences"
            onClick={async () => {
              try {
                await flush();
                navigate("/email/sequences");
              } catch {
                /* Keep unsaved edits visible. */
              }
            }}
          >
            Back to sequences
          </Button>
          {(isError || abStatsError) && (
            <Button
              variant="cta"
              onClick={() =>
                waitingForLegacyStats ? refreshABStats() : refetch()
              }
            >
              Try again
            </Button>
          )}
        </div>
      </AppLayout>
    );
  }

  if (isLoading || !sequence || waitingForLegacyStats) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 min-w-0 p-4 sm:p-6">
          <div className="max-w-[1600px] mx-auto space-y-5">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
              <Skeleton className="h-96" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Mailbox-pool health: mirror the worker's selectMailbox filter (ready +
  // IMAP-connected). An empty pool means "use the whole org". When an active
  // sequence resolves to zero usable mailboxes, enrollments silently stall.
  const readyMailboxIds = new Set(
    (mailboxes || [])
      .filter((m) => m.status === "ready" && m.imap_connected)
      .map((m) => m.id),
  );
  const poolIds =
    localSettings?.mailbox_selection?.mode === "auto"
      ? []
      : (localSettings?.mailbox_ids ?? []);
  const hasUsableMailbox =
    poolIds.length === 0
      ? readyMailboxIds.size > 0
      : poolIds.some((id) => readyMailboxIds.has(id));
  const showMailboxWarning =
    sequence.status === "active" && !!mailboxes && !hasUsableMailbox;
  const launchErrors = [...validationErrors];
  if (
    mailboxes &&
    !hasUsableMailbox &&
    !launchErrors.some((error) => error.field === "mailbox_ids")
  ) {
    launchErrors.push({
      field: "mailbox_ids",
      message: "Select a ready, connected mailbox before sending.",
    });
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 min-w-0 p-4 sm:p-6">
        <div className="max-w-[1600px] mx-auto space-y-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              className="hover:text-foreground"
              onClick={async () => {
                try {
                  await flush();
                  navigate("/email/sequences");
                } catch {
                  /* Save error remains visible. */
                }
              }}
            >
              Sequences
            </button>
            <span>/</span>
            <span>Email campaign</span>
          </div>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-full lg:basis-80 items-start gap-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to sequences"
                onClick={async () => {
                  try {
                    await flush();
                    navigate("/email/sequences");
                  } catch {
                    /* Keep unsaved edits visible. */
                  }
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <Input
                    aria-label="Sequence name"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onBlur={handleSaveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") {
                        cancelNameEditRef.current = true;
                        setNameValue(sequence.name);
                        setEditingName(false);
                      }
                    }}
                    className="h-8 text-lg font-bold"
                    autoFocus
                  />
                ) : (
                  <div className="flex items-center gap-2 group">
                    <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
                      {nameValue || sequence.name}
                    </h1>
                    <button
                      onClick={() => {
                        cancelNameEditRef.current = false;
                        setEditingName(true);
                      }}
                      aria-label="Rename sequence"
                      className="shrink-0 p-2 rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      sequence.status === "active"
                        ? "bg-green-500/10 text-green-600 border-green-500/20"
                        : sequence.status === "paused"
                          ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                          : "bg-gray-500/10 text-gray-500 border-gray-500/20",
                    )}
                  >
                    {sequence.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {localSteps.length}{" "}
                    {localSteps.length === 1 ? "step" : "steps"}
                  </span>
                  {typeof enrollmentCounts?.total === "number" && (
                    <span className="text-xs text-muted-foreground">
                      · {enrollmentCounts.total.toLocaleString()} enrolled
                    </span>
                  )}
                  {saveStatus === "idle" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="h-3 w-3" />
                      All changes saved
                    </span>
                  )}
                  {saveStatus === "saving" && (
                    <span
                      role="status"
                      className="text-xs text-muted-foreground flex items-center gap-1 animate-in fade-in duration-150"
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving…
                    </span>
                  )}
                  {saveStatus === "saved" && (
                    <span
                      role="status"
                      className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 animate-in fade-in duration-150"
                    >
                      <Check className="h-3 w-3" />
                      Saved
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Sequence actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={async () => {
                      try {
                        await flush();
                        setDuplicateOpen(true);
                      } catch {
                        /* Retry save first. */
                      }
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate sequence
                  </DropdownMenuItem>
                  {sequence.status !== "draft" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={changingStatus || toggleMutation.isPending}
                        onClick={() => changeStatus("draft")}
                      >
                        <FileEdit className="mr-2 h-4 w-4" />
                        Move to draft
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await flush();
                    setEnrollOpen(true);
                  } catch {
                    /* Save error remains visible. */
                  }
                }}
              >
                <Users className="mr-2 h-4 w-4" />
                Add leads
              </Button>
              {(sequence.status === "draft" ||
                sequence.status === "paused") && (
                <Button
                  onClick={() => changeStatus("active")}
                  disabled={
                    changingStatus ||
                    toggleMutation.isPending ||
                    saveStatus === "error" ||
                    launchErrors.length > 0 ||
                    !mailboxes
                  }
                  variant="cta"
                >
                  {changingStatus ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {sequence.status === "paused"
                    ? "Resume sequence"
                    : "Activate sequence"}
                </Button>
              )}
              {sequence.status === "active" && (
                <Button
                  variant="outline"
                  onClick={() => changeStatus("paused")}
                  disabled={changingStatus || toggleMutation.isPending}
                >
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              )}
            </div>
          </div>

          {/* No-mailbox warning: active sequence with an empty/disconnected pool */}
          {showMailboxWarning && (
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-600" />
              <div className="min-w-0 flex-1 text-red-700 dark:text-red-400">
                <span className="font-medium">
                  This sequence has no connected mailbox.
                </span>{" "}
                Enrollments will stall until you assign one. Open the{" "}
                <span className="font-medium">Settings → Accounts</span> panel
                and select a ready, connected mailbox (or reconnect one in the
                app's Settings → Mailboxes).
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openSettings("accounts")}
              >
                Choose mailboxes
              </Button>
            </div>
          )}

          {saveStatus === "error" && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <div>
                <p className="text-sm font-semibold">
                  Changes have not been saved
                </p>
                <p className="text-sm text-muted-foreground">
                  {saveError || "Keep this page open and retry your save."}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  void retry().catch(() => {});
                }}
              >
                Retry save
              </Button>
            </div>
          )}

          {launchErrors.length > 0 && (
            <details className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Review {launchErrors.length}{" "}
                {launchErrors.length === 1 ? "item" : "items"} before sending
              </summary>
              <ul className="mt-3 space-y-2">
                {launchErrors.map((error, index) => (
                  <li key={index}>
                    <button
                      className="text-left text-sm underline underline-offset-4 hover:text-foreground text-muted-foreground"
                      onClick={() => {
                        if (error.stepIndex !== undefined) {
                          setActiveTab("steps");
                          setSelectedStepIndex(error.stepIndex);
                        } else {
                          openSettings(
                            error.field === "tracking_domain_id"
                              ? "tracking"
                              : error.field === "mailbox_ids"
                                ? "accounts"
                                : "sending_pattern",
                          );
                        }
                      }}
                    >
                      {error.message}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <EnrollmentJobBanner sequenceId={id} />

          {localSettings?.mailbox_selection?.mode === "auto" && (
            <SequenceFleetNotice
              sequenceId={id}
              selection={localSettings.mailbox_selection}
              ownLimit={effectiveDailyLimit(localSettings)}
              variant="banner"
            />
          )}

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="min-w-0"
          >
            <div className="overflow-x-auto border-b">
              <TabsList className="h-auto min-w-max justify-start gap-5 rounded-none bg-transparent p-0">
                <TabsTrigger
                  value="steps"
                  className="rounded-none border-b-2 border-transparent px-1 py-3 text-sm shadow-none data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Sequence
                </TabsTrigger>
                <TabsTrigger
                  value="audience"
                  className="rounded-none border-b-2 border-transparent px-1 py-3 text-sm shadow-none data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <ListFilter className="mr-2 h-4 w-4" />
                  Lead sources
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="rounded-none border-b-2 border-transparent px-1 py-3 text-sm shadow-none data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </TabsTrigger>
                <TabsTrigger
                  value="enrollments"
                  className="rounded-none border-b-2 border-transparent px-1 py-3 text-sm shadow-none data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <Users className="mr-2 h-4 w-4" />
                  Leads{" "}
                  {typeof enrollmentCounts?.total === "number" && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                      {enrollmentCounts.total.toLocaleString()}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="analytics"
                  className="rounded-none border-b-2 border-transparent px-1 py-3 text-sm shadow-none data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Analytics
                </TabsTrigger>
                <TabsTrigger
                  value="filtered"
                  className="rounded-none border-b-2 border-transparent px-1 py-3 text-sm shadow-none data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  Filtered leads
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="steps" className="mt-6 min-w-0">
              <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(var(--app-content-height,calc(100dvh-4rem))-3rem)] lg:self-start lg:overflow-y-auto">
                  <SequenceOutline
                    steps={localSteps}
                    stepIds={stepIds}
                    selectedIndex={selectedStepIndex}
                    onSelect={setSelectedStepIndex}
                    onAdd={handleAddStep}
                    onReorder={handleReorderStep}
                    errors={validationErrors}
                  />
                  <div className="mt-4 hidden space-y-3 rounded-xl border bg-card px-4 py-4 lg:block">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground">
                        SENDING SETUP
                      </p>
                      <button
                        className="text-xs font-medium underline underline-offset-4"
                        onClick={() => openSettings("accounts")}
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {poolIds.length
                          ? `${poolIds.length} selected mailboxes`
                          : localSettings?.mailbox_selection?.mode === "auto"
                            ? "Automatic mailbox pool"
                            : "All ready mailboxes"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {localSettings?.daily_limit
                          ? `${localSettings.daily_limit.toLocaleString()} emails / day`
                          : "No sequence daily cap"}
                      </span>
                    </div>
                    <p className="border-t pt-3 text-xs text-muted-foreground">
                      {localSettings?.stop_on_reply
                        ? "Follow-ups stop when a lead replies."
                        : "Follow-ups can continue after a reply."}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">
                        {selectedStepIndex !== null
                          ? `Step ${selectedStepIndex + 1} of ${localSteps.length}`
                          : "Build your sequence"}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Write, personalize and fine-tune each touchpoint.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedStepIndex !== null &&
                        localSteps[selectedStepIndex]?.type === "email" && (
                          <Button
                            variant="cta"
                            size="sm"
                            onClick={() =>
                              handleAddEmailVariant(selectedStepIndex)
                            }
                          >
                            <Split className="mr-2 h-4 w-4" />
                            Add variant
                          </Button>
                        )}
                      {selectedStepIndex !== null &&
                        localSteps[selectedStepIndex]?.type === "ab_test" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openSettings("ab_testing")}
                          >
                            <Settings className="mr-2 h-4 w-4" />
                            A/B test settings
                          </Button>
                        )}
                      {selectedStepIndex !== null &&
                        ["email", "ab_test"].includes(
                          localSteps[selectedStepIndex]?.type,
                        ) && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-pressed={showPreview}
                            onClick={() => setShowPreview(!showPreview)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            {showPreview ? "Hide preview" : "Preview email"}
                          </Button>
                        )}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "grid min-w-0 items-start gap-4",
                      showPreview &&
                        selectedStepIndex !== null &&
                        ["email", "ab_test"].includes(
                          localSteps[selectedStepIndex]?.type,
                        ) &&
                        "xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]",
                    )}
                  >
                    <div className="min-w-0 space-y-4">
                      {localSteps.length === 0 && (
                        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center">
                          <div className="mb-4 rounded-2xl bg-amber-500/10 p-4">
                            <Mail className="h-7 w-7 text-amber-600" />
                          </div>
                          <h3 className="text-lg font-semibold">
                            Start a conversation
                          </h3>
                          <p className="mb-5 mt-2 max-w-sm text-sm text-muted-foreground">
                            Write your first email, then build a thoughtful
                            follow-up sequence.
                          </p>
                          <Button
                            variant="cta"
                            onClick={() => handleAddStep("email")}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Write first email
                          </Button>
                        </div>
                      )}
                      {/* Step List */}
                      {localSteps.map((step, index) => {
                        // Find the most recent preceding email/ab_test step's subject for Re: threading
                        const previousSubject = (() => {
                          for (let i = index - 1; i >= 0; i--) {
                            const prev = localSteps[i];
                            if (prev.type === "email" && prev.subject)
                              return prev.subject;
                            if (
                              prev.type === "ab_test" &&
                              prev.variants?.[0]?.subject
                            )
                              return prev.variants[0].subject;
                          }
                          return undefined;
                        })();

                        if (selectedStepIndex !== index) return null;
                        return (
                          <div key={`step-${stepRevision}-${index}`}>
                            <SequenceStepEditor
                              step={step}
                              stepIndex={index}
                              totalSteps={localSteps.length}
                              isSelected={selectedStepIndex === index}
                              onSelect={() => setSelectedStepIndex(index)}
                              onChange={(s) => handleStepChange(index, s)}
                              onDelete={() => setStepToDelete(index)}
                              onMoveUp={() => handleMoveStep(index, "up")}
                              onMoveDown={() => handleMoveStep(index, "down")}
                              previousSubject={previousSubject}
                              errors={validationErrors.filter(
                                (e) => e.stepIndex === index,
                              )}
                            />

                            {/* A/B Variant Editor (inline below the step) */}
                            {step.type === "ab_test" &&
                              selectedStepIndex === index &&
                              step.variants && (
                                <div className="mt-3 space-y-4">
                                  <div
                                    className="flex flex-wrap items-center gap-2"
                                    role="group"
                                    aria-label="A/B step view"
                                  >
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      aria-pressed={abView === "edit"}
                                      onClick={() => setABView("edit")}
                                      className={cn(
                                        abView === "edit" &&
                                          "border-emerald-500/40 bg-emerald-500/10",
                                      )}
                                    >
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit variants
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      aria-pressed={abView === "performance"}
                                      onClick={() => setABView("performance")}
                                      className={cn(
                                        abView === "performance" &&
                                          "border-emerald-500/40 bg-emerald-500/10",
                                      )}
                                    >
                                      <BarChart3 className="mr-2 h-4 w-4" />
                                      Performance
                                    </Button>
                                  </div>
                                  {abView === "edit" ? (
                                    <ABVariantEditor
                                      variants={step.variants}
                                      onChange={(variants) =>
                                        handleStepChange(index, {
                                          ...step,
                                          variants,
                                        })
                                      }
                                      previousSubject={previousSubject}
                                      errors={validationErrors.filter(
                                        (e) => e.stepIndex === index,
                                      )}
                                    />
                                  ) : (
                                    <ABTestResults
                                      variants={getStepABPerformanceVariants(
                                        step,
                                        abVariants || [],
                                        id!,
                                      )}
                                      onDeclareWinner={async (variantId) => {
                                        await flush();
                                        return declareWinnerMutation.mutateAsync(
                                          {
                                            variant_id: variantId,
                                            sequence_id: id!,
                                            step_index: step.order,
                                          },
                                        );
                                      }}
                                      winningMetric={
                                        localSettings?.ab_winning_metric ||
                                        "reply_rate"
                                      }
                                      sampleSize={
                                        localSettings?.ab_sample_size || 100
                                      }
                                      autoOptimize={
                                        localSettings?.auto_optimize_ab
                                      }
                                      openTracking={
                                        localSettings?.open_tracking
                                      }
                                      clickTracking={
                                        localSettings?.click_tracking
                                      }
                                      isLoading={abStatsLoading}
                                      isRefreshing={abStatsRefreshing}
                                      error={abStatsError}
                                      onRefresh={() => {
                                        void refreshABStats();
                                      }}
                                    />
                                  )}
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                    {showPreview &&
                      selectedStepIndex !== null &&
                      ["email", "ab_test"].includes(
                        localSteps[selectedStepIndex]?.type,
                      ) && (
                        <SequenceEmailPreview
                          step={localSteps[selectedStepIndex]}
                          sequenceId={id!}
                          contact={
                            previewContact?.organization_id ===
                            currentOrganization?.id
                              ? previewContact
                              : null
                          }
                          onContactChange={setPreviewContact}
                          mailboxes={mailboxes || []}
                          mailboxIds={localSettings?.mailbox_ids}
                          variableDefaults={localSettings?.variable_defaults}
                          previousSubject={localSteps
                            .slice(0, selectedStepIndex)
                            .reverse()
                            .map((step) =>
                              step.type === "email"
                                ? step.subject
                                : step.type === "ab_test"
                                  ? step.variants?.[0]?.subject
                                  : undefined,
                            )
                            .find(Boolean)}
                        />
                      )}
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="audience" className="mt-5 max-w-3xl space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Audience sources</h2>
                <p className="text-sm text-muted-foreground">
                  Choose a saved audience, decide when people enroll, and check destination eligibility.
                </p>
              </div>
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    Who enters this sequence
                  </h2>
                </div>

                <EnrollmentSources
                  destination="sequence"
                  autoEnroll={localAutoEnroll}
                  availableLists={leadLists}
                  attachedListIds={localLeadListIds}
                  inflows={pipelineInflows ?? []}
                  pipelineOwnedListIds={pipelineOwnedListIds}
                  pickerFooter={<Button variant="outline" size="sm" className="w-full" onClick={() => setCreateSegmentOpen(true)}><Plus className="mr-2 h-4 w-4" />Create smart segment</Button>}
                  onDetach={detachLeadList}
                  onAttach={(val) => {
                    const next = [...localLeadListIds, val];
                    // Derive the auto-enroll default from list type only when the
                    // first list is attached (living → ON, fixed-cohort → OFF);
                    // later adds preserve the user's current choice.
                    const nextAutoEnroll =
                      localLeadListIds.length === 0
                        ? isLivingLeadList(leadLists.find((l) => l.id === val))
                        : localAutoEnroll;
                    setLocalLeadListIds(next);
                    setLocalAutoEnroll(nextAutoEnroll);
                    if (id) {
                      debouncedSave({
                        id,
                        lead_list_ids: next,
                        auto_enroll_new_members: nextAutoEnroll,
                      });
                    }
                  }}
                />

                {localLeadListIds.length > 0 && (
                  <EnrollmentModeSelector
                    value={localAutoEnroll}
                    leadCount={localLeadListIds.reduce(
                      (sum, lid) =>
                        sum +
                        (leadLists.find((l) => l.id === lid)?.lead_count ?? 0),
                      0,
                    )}
                    list={{
                      is_smart: localLeadListIds.every(
                        (listId) =>
                          leadLists.find((list) => list.id === listId)
                            ?.is_smart,
                      ),
                      source_type: localLeadListIds.some((listId) =>
                        isLivingLeadList(
                          leadLists.find((list) => list.id === listId),
                        ),
                      )
                        ? "smart"
                        : "manual",
                    }}
                    awaitingProcessing={awaitingProcessing ?? 0}
                    onChange={(ongoing) => {
                      setLocalAutoEnroll(ongoing);
                      if (id)
                        debouncedSave({ id, auto_enroll_new_members: ongoing });
                    }}
                  />
                )}
                {localLeadListIds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                  <p className="max-w-xl text-sm text-muted-foreground">{localAutoEnroll ? "New eligible members enroll while this sequence is active. You can review the current audience at any time." : "Review and enroll your current audience once. Later matches require another manual enrollment."}</p>
                  <Button variant="cta" size="sm" onClick={async () => { try { await flush(); setEnrollOpen(true); } catch { /* Autosave surfaces errors. */ } }}>Review current audience</Button>
                </div>}
                {/* Filter step — enforced by the enroll-leads edge function for
                    EVERY enrollment route (cron, bulk enroll, MCP), not just
                    the ongoing top-up. */}
                {localLeadListIds.length > 0 && (
                  <EnrollmentFilterStep
                    criteria={localEnrollFilter}
                    listIds={localLeadListIds}
                    onChange={(next) => {
                      setLocalEnrollFilter(next);
                      if (id)
                        debouncedSave({
                          id,
                          enroll_filter_criteria: { ...next },
                        });
                    }}
                  />
                )}
              </div>
            </TabsContent>
            <TabsContent value="settings" className="mt-6 space-y-5">
              <div id="campaign-settings">
                <h2 className="text-lg font-semibold">Sending settings</h2>
                <p className="text-sm text-muted-foreground">
                  Choose senders, timing and the rules that stop or continue
                  your outreach.
                </p>
              </div>
              {localSettings && (
                <CampaignSettingsPanel
                  settings={localSettings}
                  onChange={handleSettingsChange}
                  mailboxes={mailboxes || []}
                  sendingDomains={sendingDomains}
                  sequenceId={id}
                  key={`${settingsSection || "default"}-${settingsNavigationRequest}`}
                  initialOpenSection={settingsSection}
                  steps={localSteps}
                  autopilotConfig={localAutopilotConfig}
                  onAutopilotChange={handleAutopilotChange}
                  agentProfileId={localAgentProfileId}
                  onAgentProfileChange={(profileId, config) => {
                    setLocalAgentProfileId(profileId);
                    setLocalAutopilotConfig(config);
                    if (id)
                      debouncedSave({
                        id,
                        agent_profile_id: profileId,
                        autopilot_config: config,
                      });
                  }}
                />
              )}
            </TabsContent>
            <TabsContent value="analytics" className="mt-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Sequence performance</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Follow enrollment outcomes and see how each email performs.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x rounded-xl border bg-card py-4">
                {[
                  ["Enrolled", enrollmentCounts?.total],
                  ["In progress", enrollmentCounts?.active],
                  ["Replied", enrollmentCounts?.replied],
                  ["Bounced", enrollmentCounts?.bounced],
                ].map(([label, count]) => (
                  <div key={String(label)} className="px-4 py-1">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {typeof count === "number" ? count.toLocaleString() : "—"}
                    </p>
                  </div>
                ))}
              </div>

              {countsError && (
                <p role="alert" className="text-sm text-muted-foreground">
                  Enrollment counts could not be loaded.{" "}
                  <button
                    className="underline underline-offset-4"
                    onClick={() => {
                      void refetchCounts();
                    }}
                  >
                    Try again
                  </button>
                </p>
              )}

              <SequenceAnalyticsTab
                settings={localSettings || undefined}
                sequenceId={sequence.id}
                steps={localSteps}
              />
            </TabsContent>
            <TabsContent value="enrollments" className="mt-5 min-w-0">
              <EnrollmentTable
                sequenceId={sequence.id}
                steps={localSteps}
                onStepChange={handleStepChange}
                mailboxIds={localSettings?.mailbox_ids}
              />
            </TabsContent>
            <TabsContent value="filtered" className="mt-5 min-w-0">
              <FilteredLeadsTable sequenceId={sequence.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <DeleteConfirmDialog
        open={stepToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setStepToDelete(null);
        }}
        itemName={`Step ${(stepToDelete ?? 0) + 1}`}
        itemType="step"
        onConfirm={() => {
          if (stepToDelete !== null) handleDeleteStep(stepToDelete);
          setStepToDelete(null);
        }}
      />

      <CreateSmartListDialog
        open={createSegmentOpen}
        attachTo="email sequence"
        onOpenChange={setCreateSegmentOpen}
        isLoading={createSegment.isPending}
        onSubmit={(input) => createSegment.mutate(input, { onSuccess: (created) => {
          const next = [...localLeadListIds, created.id];
          const ongoing = localLeadListIds.length === 0 ? true : localAutoEnroll;
          setLocalLeadListIds(next);
          setLocalAutoEnroll(ongoing);
          setCreateSegmentOpen(false);
          if (id) debouncedSave({ id, lead_list_ids: next, auto_enroll_new_members: ongoing });
        } })}
      />
      <EnrollFromListDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        initialListIds={localLeadListIds}
        sequenceId={sequence.id}
      />

      <DuplicateSequenceDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        sequence={sequence}
        enrollmentTotal={enrollmentCounts?.total}
      />
    </AppLayout>
  );
}
