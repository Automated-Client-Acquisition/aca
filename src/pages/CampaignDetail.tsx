import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type MouseEvent,
} from "react";
import { MessagingFunnelCard } from "@/components/campaigns/MessagingFunnelCard";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUpRight,
  Play,
  Pause,
  Pencil,
  Copy,
  Users,
  Send,
  MessageSquare,
  UserCheck,
  Settings2,
  Activity,
  FileEdit,
  Check,
  Loader2,
  AlertTriangle,
  MoreHorizontal,
  GitBranch,
  ChevronRight,
  ListFilter,
  RefreshCw,
  Clock,
  Linkedin,
  Mail,
  MessageCircle,
  Instagram,
  PhoneCall,
  Gauge,
  ShieldCheck,
  Bot,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCampaign,
  useStartCampaign,
  usePauseCampaign,
  useDuplicateCampaign,
  useDraftCampaign,
  type LinkedInCampaign,
} from "@/hooks/useCampaigns";
import {
  useCampaignProgressStats,
  type CampaignLeadFilter,
} from "@/hooks/useCampaignProgress";
import { useCampaignPendingReviewSequences } from "@/hooks/useEmailSequences";
import { useAccountsWithLimits } from "@/hooks/useAccountsWithLimits";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useEnrollmentInflows } from "@/hooks/useEnrollmentInflows";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { CampaignSequenceReview } from "@/components/campaigns/CampaignSequenceReview";
import { CampaignSequencePreview } from "@/components/campaigns/CampaignSequencePreview";
import { CampaignPowerSettings } from "@/components/campaigns/CampaignPowerSettings";
import { CampaignLeadTable } from "@/components/campaigns/CampaignLeadTable";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { NODE_TYPE_CONFIGS, type SequenceNodeType } from "@/lib/sequence-utils";
import { cn } from "@/lib/utils";
import { CampaignTriggerActivity } from "@/components/campaign-builder/CampaignTriggerActivity";
import { normalizeEntryRules, entryRuleSummary } from "@/lib/campaign-entry";
import {
  DEFAULT_CAMPAIGN_POWER_SETTINGS,
  DEFAULT_CAMPAIGN_RATE_SETTINGS,
  type CampaignPowerSettings as PowerSettings,
  type CampaignRateSettings,
} from "@/types/email";

type DetailTab = "leads" | "sequence" | "triggers" | "review" | "settings";
type SettingsCampaign = LinkedInCampaign & {
  rate_settings?: CampaignRateSettings;
  agent_profile_id?: string | null;
};
type SaveStatus = "idle" | "saving" | "saved" | "error";
const FILTERS: CampaignLeadFilter[] = [
  "all",
  "in_sequence",
  "filtered",
  "pending",
  "in_progress",
  "waiting",
  "completed",
  "failed",
  "replied",
  "skipped",
  "handed_off",
  "pending_review",
  "sender_disconnected",
  "sequence_changed",
];

function resolveTab(value: string | null): DetailTab {
  if (value === "progress") return "leads";
  if (value === "smart_features") return "settings";
  return ["leads", "sequence", "triggers", "review", "settings"].includes(value || "")
    ? (value as DetailTab)
    : "leads";
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { currentOrganization } = useAuth();
  const {
    data: campaign,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useCampaign(id);
  const notFound =
    !id || (error as { code?: string } | null)?.code === "PGRST116";
  return (
    <AppLayout>
      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1440px]">
          {isLoading ? (
            <div className="space-y-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-12 w-full max-w-xl" />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className="h-28 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-[400px] rounded-xl" />
            </div>
          ) : !campaign || !currentOrganization ? (
            <div className="rounded-xl border bg-card px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              </div>
              <h1 className="text-lg font-semibold">
                {notFound ? "Campaign not found" : "Unable to load campaign"}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {notFound
                  ? "This campaign may have been removed or belongs to another workspace."
                  : "The campaign could not be loaded. Retry to reconnect to your workspace."}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button variant="outline" asChild>
                  <Link to="/campaigns">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    All campaigns
                  </Link>
                </Button>
                {!notFound && (
                  <Button
                    variant="cta"
                    disabled={isFetching}
                    onClick={() => refetch()}
                  >
                    <RefreshCw
                      className={cn(
                        "mr-2 h-4 w-4",
                        isFetching && "animate-spin",
                      )}
                    />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <CampaignWorkspace
              key={`${currentOrganization.id}:${campaign.id}`}
              campaign={campaign as SettingsCampaign}
              organizationId={currentOrganization.id}
              refreshFailed={!!error}
              onRetry={() => refetch()}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function CampaignWorkspace({
  campaign,
  organizationId,
  refreshFailed,
  onRetry,
}: {
  campaign: SettingsCampaign;
  organizationId: string;
  refreshFailed: boolean;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = resolveTab(searchParams.get("tab"));
  const statusParam = searchParams.get("status");
  const statusFilter: CampaignLeadFilter = FILTERS.includes(
    statusParam as CampaignLeadFilter,
  )
    ? (statusParam as CampaignLeadFilter)
    : "all";
  const isActive = campaign.status === "active";
  const {
    data: stats,
    error: statsError,
    refetch: refetchStats,
  } = useCampaignProgressStats(campaign.id, { live: isActive });
  const { data: pendingSequences } = useCampaignPendingReviewSequences(
    campaign.id,
  );
  const {
    data: accountsData,
    isLoading: accountsLoading,
    error: accountsError,
    refetch: refetchAccounts,
  } = useAccountsWithLimits();
  const { leadLists } = useLeadLists();
  const { data: pipelineInflows } = useEnrollmentInflows(
    "linkedin_campaign",
    campaign.id,
  );
  const startCampaign = useStartCampaign();
  const pauseCampaign = usePauseCampaign();
  const draftCampaign = useDraftCampaign();
  const duplicateCampaign = useDuplicateCampaign();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [navigationPending, setNavigationPending] = useState(false);
  const [draft, setDraft] = useState(() => ({
    settings: {
      ...DEFAULT_CAMPAIGN_POWER_SETTINGS,
      ...campaign.campaign_settings,
    } as PowerSettings,
    autopilotConfig: campaign.autopilot_config || null,
    agentProfileId: campaign.agent_profile_id || null,
    stopOnReply: campaign.stop_on_reply ?? true,
    excludeOtherCampaigns: campaign.exclude_other_campaigns,
    excludeSameSender: campaign.exclude_same_sender,
    autoEnrollNewMembers: campaign.auto_enroll_new_members ?? false,
    senderIds: [
      ...new Set(
        campaign.sender_accounts?.linkedin?.length
          ? campaign.sender_accounts.linkedin
          : campaign.sender_account_ids || [],
      ),
    ],
    senderAccounts: campaign.sender_accounts || {},
    rateSettings: {
      ...DEFAULT_CAMPAIGN_RATE_SETTINGS,
      ...campaign.rate_settings,
    },
  }));
  const draftRef = useRef(draft);
  const [rateInputs, setRateInputs] = useState(() => ({
    min: String(draft.rateSettings.min_delay_seconds),
    max: String(draft.rateSettings.max_delay_seconds),
  }));
  const mountedRef = useRef(true);
  const pendingPatchRef = useRef<Record<string, unknown>>({});
  const failedPatchRef = useRef<Record<string, unknown>>({});
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const queuedSaveCountRef = useRef(0);
  const retryScopedSaveRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );

  // Writes are serialized and scoped to this keyed workspace. Refetches do not
  // reset draft text, and a navigation cannot save it into a different campaign.
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const payload = { ...pendingPatchRef.current };
    if (
      !Object.keys(payload).length &&
      !Object.keys(failedPatchRef.current).length
    )
      return saveQueueRef.current;
    pendingPatchRef.current = {};
    const revision = revisionRef.current;
    let writePayload = payload;
    queuedSaveCountRef.current += 1;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(async () => {
        // A previous queued request can fail after this request was queued. Merge
        // its failed columns here so the next successful write also recovers them.
        writePayload = { ...failedPatchRef.current, ...payload };
        failedPatchRef.current = {};
        const savedAt = new Date().toISOString();
        const { error } = await supabase
          .from("linkedin_campaigns")
          .update({ ...writePayload, updated_at: savedAt })
          .eq("id", campaign.id)
          .eq("organization_id", organizationId)
          .select("id")
          .single();
        if (error) throw error;
        // The sequence builder initializes its draft once from this cache. Patch
        // the confirmed save before navigating so it cannot reopen stale settings.
        queryClient.setQueryData<SettingsCampaign>(
          ["linkedin-campaign", organizationId, campaign.id],
          (previous) =>
            previous
              ? ({
                  ...previous,
                  ...writePayload,
                  updated_at: savedAt,
                } as SettingsCampaign)
              : previous,
        );
        queryClient.invalidateQueries({
          queryKey: ["linkedin-campaign", organizationId, campaign.id],
        });
        queryClient.invalidateQueries({
          queryKey: ["linkedin-campaigns", organizationId],
        });
        if (
          mountedRef.current &&
          revisionRef.current === revision &&
          !Object.keys(pendingPatchRef.current).length
        ) {
          setSaveStatus("saved");
          savedTimerRef.current = setTimeout(() => {
            if (mountedRef.current) setSaveStatus("idle");
          }, 2500);
        }
      })
      .catch((error) => {
        failedPatchRef.current = { ...writePayload, ...failedPatchRef.current };
        if (mountedRef.current) {
          setSaveStatus("error");
          toast.error(
            "Campaign changes could not be saved. Retry to keep your changes.",
          );
        } else {
          toast.error(`Changes to “${campaign.name}” could not be saved.`, {
            action: {
              label: "Retry save",
              onClick: () => {
                void retryScopedSaveRef
                  .current()
                  .then(() => toast.success("Campaign changes saved."))
                  .catch(() => {});
              },
            },
          });
        }
        throw error;
      })
      .finally(() => {
        queuedSaveCountRef.current -= 1;
      });
    return saveQueueRef.current;
  }, [campaign.id, campaign.name, organizationId, queryClient]);
  retryScopedSaveRef.current = flushSave;

  const savePatch = useCallback(
    (payload: Record<string, unknown>, debounce = false) => {
      revisionRef.current += 1;
      pendingPatchRef.current = { ...pendingPatchRef.current, ...payload };
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (debounce)
        saveTimerRef.current = setTimeout(() => {
          void flushSave().catch(() => {});
        }, 700);
      else void flushSave().catch(() => {});
    },
    [flushSave],
  );

  const updateDraft = useCallback((update: Partial<typeof draft>) => {
    const next = { ...draftRef.current, ...update };
    draftRef.current = next;
    setDraft(next);
    return next;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const guardUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (
        queuedSaveCountRef.current > 0 ||
        Object.keys(pendingPatchRef.current).length > 0 ||
        Object.keys(failedPatchRef.current).length > 0
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guardUnsavedChanges);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", guardUnsavedChanges);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      // Preserve the final text edit when leaving instead of dropping the debounce.
      void flushSave().catch(() => {});
    };
  }, [flushSave]);

  const changeTab = (tab: string, filter?: CampaignLeadFilter) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    if (filter === "all") next.delete("status");
    else if (filter) next.set("status", filter);
    setSearchParams(next, { replace: true });
  };
  const navigateAfterSave = async (destination: string) => {
    setNavigationPending(true);
    try {
      await flushSave();
      navigate(destination);
    } catch {
      setNavigationPending(false);
    }
  };
  const savedLink =
    (destination: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      void navigateAfterSave(destination);
    };
  const editSequence = () =>
    navigateAfterSave(`/campaigns/${campaign.id}/edit`);
  const lifecyclePending =
    startCampaign.isPending ||
    pauseCampaign.isPending ||
    draftCampaign.isPending;
  const busy = lifecyclePending || navigationPending;
  const canEdit = campaign.status !== "completed";
  const canDraft = campaign.status === "active" || campaign.status === "paused";
  const sourceIds = campaign.lead_list_ids ?? (campaign.lead_list_id ? [campaign.lead_list_id] : []);
  const sourceLists = sourceIds.map(
    (listId) =>
      leadLists.find((list) => list.id === listId) ||
      (campaign.lead_list?.id === listId
        ? campaign.lead_list
        : { id: listId, name: "Assigned list", lead_count: null }),
  );
  const allSenderIds = [
    ...new Set([
      ...draft.senderIds,
      ...Object.values(draft.senderAccounts).flat(),
    ]),
  ];
  const selectedAccounts = (accountsData?.accounts || []).filter((account) =>
    allSenderIds.includes(account.id),
  );
  const unavailableSenderCount = accountsData
    ? allSenderIds.filter(
        (senderId) =>
          !accountsData.accounts.some(
            (account) => account.id === senderId && account.status === "active",
          ),
      ).length
    : 0;
  const actionCount = (campaign.sequence_nodes || []).filter(
    (node) =>
      NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.category === "action",
  ).length;
  const sequenceChannels = (campaign.sequence_nodes || [])
    .map((node) => NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.channel)
    .filter((channel) => channel && channel !== "any");
  const senderChannels = Object.entries(draft.senderAccounts)
    .filter(([, senderIds]) => senderIds?.length)
    .map(([channel]) => channel);
  const campaignChannels = [
    ...new Set(
      sequenceChannels.length
        ? sequenceChannels
        : senderChannels.length
          ? senderChannels
          : [
              campaign.primary_channel ||
                (campaign.campaign_type === "email_only"
                  ? "email"
                  : "linkedin"),
            ],
    ),
  ];
  const channelIcons: Record<string, LucideIcon> = {
    linkedin: Linkedin,
    email: Mail,
    whatsapp: MessageCircle,
    instagram: Instagram,
    telegram: Send,
    sms: PhoneCall,
    messenger: MessageCircle,
    twitter: MessageSquare,
  };
  const HeaderChannelIcon =
    campaignChannels.length > 1
      ? GitBranch
      : channelIcons[campaignChannels[0]] || Send;
  const channelNames: Record<string, string> = {
    linkedin: "LinkedIn",
    email: "Email",
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    telegram: "Telegram",
    sms: "SMS",
    messenger: "Messenger",
    twitter: "X",
  };
  const channelLabel =
    campaignChannels.length > 1
      ? "Multi-channel outreach"
      : `${channelNames[campaignChannels[0]] || "Campaign"} outreach`;
  const pendingReviewCount =
    pendingSequences?.length ?? stats?.pendingReview ?? 0;
  const totalEnrolled = stats?.total ?? campaign.total_leads ?? 0;
  const reached = stats?.reached ?? campaign.contacted_leads ?? 0;
  const replied = stats?.replied ?? campaign.replied_count ?? 0;
  const replyRate = reached > 0 ? (replied / reached) * 100 : 0;
  const runningCount = stats
    ? stats.pending + stats.inProgress + stats.waiting
    : null;
  const launchBlocker =
    allSenderIds.length === 0
      ? "Choose a sender in Settings before starting."
      : actionCount === 0
        ? "Add an action to your sequence before starting."
        : null;
  const changeSender = (senderId: string, checked: boolean) => {
    const current = draftRef.current;
    const senderIds = checked
      ? [...new Set([...current.senderIds, senderId])]
      : current.senderIds.filter((id) => id !== senderId);
    const senderAccounts = { ...current.senderAccounts, linkedin: senderIds };
    updateDraft({ senderIds, senderAccounts });
    savePatch({
      sender_account_ids: senderIds,
      sender_accounts: senderAccounts,
    });
  };
  const saveRate = (field: "min" | "max") => {
    const current = draftRef.current.rateSettings;
    const value = Number(rateInputs[field]);
    const fallback =
      field === "min"
        ? (current.min_delay_seconds ?? 60)
        : (current.max_delay_seconds ?? 180);
    const bounded = Math.max(
      10,
      Math.min(
        field === "min" ? 300 : 600,
        Number.isFinite(value) && rateInputs[field].trim() ? value : fallback,
      ),
    );
    const min =
      field === "min"
        ? bounded
        : Math.min(current.min_delay_seconds ?? 60, bounded);
    const max =
      field === "max"
        ? bounded
        : Math.max(current.max_delay_seconds ?? 180, bounded);
    const rateSettings = {
      ...current,
      min_delay_seconds: Math.round(min),
      max_delay_seconds: Math.round(max),
    };
    setRateInputs({
      min: String(rateSettings.min_delay_seconds),
      max: String(rateSettings.max_delay_seconds),
    });
    if (
      min !== current.min_delay_seconds ||
      max !== current.max_delay_seconds
    ) {
      updateDraft({ rateSettings });
      savePatch({ rate_settings: rateSettings });
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
      >
        <Link
          to="/campaigns"
          onClick={savedLink("/campaigns")}
          className="inline-flex shrink-0 items-center gap-1.5 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Campaigns
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate" title={campaign.name}>
          {campaign.name}
        </span>
      </nav>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              className="min-w-0 max-w-full break-words text-xl font-semibold tracking-tight sm:text-2xl"
              title={campaign.name}
            >
              {campaign.name}
            </h1>
            <CampaignStatusBadge status={campaign.status} />
            {isActive && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <HeaderChannelIcon className="h-3.5 w-3.5" />
              {channelLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {totalEnrolled.toLocaleString()} enrolled
            </span>
            <span>
              {allSenderIds.length} sender{allSenderIds.length === 1 ? "" : "s"}
            </span>
            {campaign.description && (
              <span className="max-w-xl truncate" title={campaign.description}>
                {campaign.description}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs sm:text-sm"
              onClick={editSequence}
              disabled={busy}
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit sequence
            </Button>
          )}
          {campaign.status !== "completed" && (
            <Button
              variant={isActive ? "outline" : "cta"}
              size="sm"
              className="text-xs sm:text-sm"
              disabled={busy || (!isActive && !!launchBlocker)}
              title={!isActive ? launchBlocker || undefined : undefined}
              onClick={async () => {
                if (isActive) {
                  pauseCampaign.mutate(campaign.id);
                  return;
                }
                setNavigationPending(true);
                try {
                  await flushSave();
                  startCampaign.mutate(campaign.id);
                } catch {
                  /* Save failure is displayed above. */
                } finally {
                  setNavigationPending(false);
                }
              }}
            >
              {busy ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : isActive ? (
                <Pause className="mr-2 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-2 h-3.5 w-3.5" />
              )}
              {isActive
                ? "Pause campaign"
                : campaign.status === "paused"
                  ? "Resume campaign"
                  : "Start campaign"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label="More campaign actions"
                disabled={busy || duplicateCampaign.isPending}
              >
                {duplicateCampaign.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  setTimeout(() => {
                    void flushSave()
                      .then(() =>
                        duplicateCampaign.mutate(campaign.id, {
                          onSuccess: (copy) =>
                            navigate(`/campaigns/${copy.id}`),
                        }),
                      )
                      .catch(() => {});
                  }, 0)
                }
              >
                <Copy className="mr-2 h-4 w-4" />
                Duplicate campaign
              </DropdownMenuItem>
              {canDraft && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      setTimeout(() => draftCampaign.mutate(campaign.id), 0)
                    }
                  >
                    <FileEdit className="mr-2 h-4 w-4" />
                    Move to draft
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {refreshFailed && (
        <Notice
          icon={RefreshCw}
          title="Campaign updates are temporarily unavailable"
          description="Showing the last saved campaign. Your current edits are preserved."
          action="Retry"
          onAction={onRetry}
          tone="info"
        />
      )}
      {saveStatus !== "idle" && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs",
            saveStatus === "error"
              ? "border-destructive/25 bg-destructive/5 text-destructive"
              : "border-border/60 bg-card text-muted-foreground",
          )}
        >
          {saveStatus === "saving" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saveStatus === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          )}
          <span>
            {saveStatus === "saving"
              ? "Saving changes…"
              : saveStatus === "error"
                ? "Your changes are still here, but have not been saved."
                : "All changes saved"}
          </span>
          {saveStatus === "error" && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 text-xs"
              onClick={() => {
                setSaveStatus("saving");
                void flushSave().catch(() => {});
              }}
            >
              Retry save
            </Button>
          )}
        </div>
      )}
      {launchBlocker && campaign.status === "draft" && (
        <Notice
          icon={GitBranch}
          title="Finish campaign setup"
          description={launchBlocker}
          action="Complete setup"
          onAction={editSequence}
        />
      )}
      {stats && stats.filteredOut > 0 && (
        <Notice
          icon={ListFilter}
          title={`${stats.filteredOut.toLocaleString()} contacts exited an unconnected branch`}
          description={
            stats.topFilteredReason
              ? `At “${stats.topFilteredReason}”. Review the routing before continuing outreach.`
              : "These contacts reached an outcome with no next step configured."
          }
          action="Review sequence"
          onAction={() => changeTab("sequence")}
          secondaryAction="View contacts"
          onSecondaryAction={() => changeTab("leads", "filtered")}
        />
      )}
      {unavailableSenderCount > 0 && (
        <Notice
          icon={Unplug}
          title={`${unavailableSenderCount} sender${unavailableSenderCount === 1 ? " is" : "s are"} unavailable`}
          description="Reconnect the sender or choose an available account to keep outreach moving."
          action="Review senders"
          onAction={() => changeTab("settings")}
        />
      )}
      {pendingReviewCount > 0 && activeTab !== "review" && (
        <Notice
          icon={ShieldCheck}
          title={`${pendingReviewCount.toLocaleString()} email sequence${pendingReviewCount === 1 ? " is" : "s are"} awaiting approval`}
          description="Review the generated content before it is passed to your email tool."
          action="Review emails"
          onAction={() => changeTab("review")}
          tone="info"
        />
      )}
      <Tabs
        value={activeTab}
        onValueChange={(value) => changeTab(value)}
        className="min-w-0"
      >
        <div className="min-w-0 overflow-x-auto border-b">
          <TabsList
            aria-label="Campaign workspace"
            className="h-12 w-max justify-start gap-5 rounded-none bg-transparent p-0"
          >
            <WorkspaceTab value="leads" icon={Users}>
              Leads
            </WorkspaceTab>
            <WorkspaceTab value="sequence" icon={GitBranch}>
              Sequence
            </WorkspaceTab>
            <WorkspaceTab value="triggers" icon={Activity}>Triggers</WorkspaceTab>
            <WorkspaceTab value="review" icon={MessageSquare}>
              Review
              {pendingReviewCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-2 h-5 min-w-5 justify-center rounded-md px-1 text-[10px]"
                >
                  {pendingReviewCount}
                </Badge>
              )}
            </WorkspaceTab>
            <WorkspaceTab value="settings" icon={Settings2}>
              Settings
            </WorkspaceTab>
          </TabsList>
        </div>
        <TabsContent value="leads" className="mt-4 space-y-4">
          {(campaign.sequence_nodes || []).some((n) => n.type === "smsMessage" || n.type === "whatsappTemplate") && (
            <MessagingFunnelCard campaignId={campaign.id} />
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              icon={Users}
              label="Enrolled"
              value={totalEnrolled.toLocaleString()}
              detail={
                runningCount === null
                  ? "Contacts in this campaign"
                  : `${runningCount.toLocaleString()} queued or in sequence`
              }
            />
            <Metric
              icon={Send}
              label="Reached"
              value={reached.toLocaleString()}
              detail="Sent an invitation or a message"
            />
            <Metric
              icon={UserCheck}
              label="Connections accepted"
              value={
                stats?.connectionsSent
                  ? `${stats.connectionRate.toFixed(1)}%`
                  : "—"
              }
              detail={
                stats
                  ? `${stats.connectionsAccepted.toLocaleString()} accepted / ${stats.connectionsSent.toLocaleString()} invitations`
                  : statsError ? "Invitation results unavailable" : "Invitation results are loading"
              }
            />
            <Metric
              icon={MessageSquare}
              label="Replies"
              value={replied.toLocaleString()}
              detail={
                reached > 0
                  ? `${replyRate.toFixed(1)}% of ${reached.toLocaleString()} reached contacts`
                  : "Reply rate appears after outreach"
              }
            />
          </div>
          {statsError && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-xs text-muted-foreground">
              <span>
                Live progress could not be refreshed. Saved campaign totals are
                shown.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => refetchStats()}
              >
                Retry metrics
              </Button>
            </div>
          )}
          <CampaignLeadTable
            campaignId={campaign.id}
            leadListId={campaign.lead_list_id}
            leadListIds={campaign.lead_list_ids}
            leadListName={campaign.lead_list?.name}
            sequenceNodes={campaign.sequence_nodes || []}
            sequenceEdges={campaign.sequence_edges || []}
            isActive={isActive}
            totalEnrolled={totalEnrolled}
            stats={stats}
            statusFilter={statusFilter}
            onStatusFilterChange={(filter) => changeTab("leads", filter)}
          />
        </TabsContent>
        <TabsContent value="sequence" className="mt-5">
          <CampaignSequencePreview
            nodes={campaign.sequence_nodes || []}
            edges={campaign.sequence_edges || []}
            onEdit={canEdit ? editSequence : undefined}
          />
        </TabsContent>
        <TabsContent value="review" className="mt-5">
          <CampaignSequenceReview campaignId={campaign.id} />
        </TabsContent>
        <TabsContent value="triggers" className="mt-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Campaign entry</h2>
              <p className="mt-1 text-sm text-muted-foreground">Qualification decisions and people entering from incoming events.</p>
            </div>
            {canEdit && <Button variant="outline" asChild><Link to={`/campaigns/${campaign.id}/edit?section=triggers`}>Configure triggers</Link></Button>}
          </div>
          {normalizeEntryRules(campaign.entry_triggers).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {normalizeEntryRules(campaign.entry_triggers).map(rule => (
                <div key={rule.id} className="rounded-lg border bg-card px-3 py-2">
                  <p className="text-xs font-medium">{rule.name}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{rule.enabled ? entryRuleSummary(rule) : "Paused"}</p>
                </div>
              ))}
            </div>
          )}
          <CampaignTriggerActivity campaignId={campaign.id} rules={normalizeEntryRules(campaign.entry_triggers)} active={campaign.status === "active"} />
        </TabsContent>
        <TabsContent value="settings" className="mt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Campaign settings</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {canEdit
                  ? "Changes save automatically. Sender schedules and daily limits are shared across campaigns."
                  : "Completed campaigns are read-only. Duplicate this campaign to reuse its setup."}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              Created {format(new Date(campaign.created_at), "MMM d, yyyy")}
            </span>
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <SettingsSection
                icon={Users}
                title="Sender accounts"
                description={`${allSenderIds.length} account${allSenderIds.length === 1 ? "" : "s"} assigned to this campaign`}
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      to="/settings?tab=senders"
                      onClick={savedLink("/settings?tab=senders")}
                    >
                      Manage senders
                      <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                }
              >
                {accountsLoading ? (
                  <Skeleton className="h-24 rounded-lg" />
                ) : accountsError ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Sender accounts could not be loaded.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchAccounts()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {allSenderIds.length > 0 && (
                      <div className="space-y-2">
                        {allSenderIds.map((senderId) => {
                          const account = selectedAccounts.find(
                            (sender) => sender.id === senderId,
                          );
                          return (
                            <div
                              key={senderId}
                              className="flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3"
                            >
                              <Avatar className="h-8 w-8">
                                <AvatarImage
                                  src={account?.avatar_url || undefined}
                                />
                                <AvatarFallback className="text-xs">
                                  {(account?.display_name || "?")
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-xs font-medium">
                                    {account?.display_name ||
                                      account?.username ||
                                      "Unavailable account"}
                                  </p>
                                  <span
                                    className={cn(
                                      "text-[10px]",
                                      account?.status === "active"
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-amber-600 dark:text-amber-400",
                                    )}
                                  >
                                    {account?.status === "active"
                                      ? "Connected"
                                      : account?.status || "Unavailable"}
                                  </span>
                                </div>
                                {account?.provider === "LINKEDIN" && (
                                  <>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      {account.limits.connection_requests}{" "}
                                      invitations · {account.limits.messages}{" "}
                                      messages / day
                                    </p>
                                    <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {account.channel_limits?.some(
                                        (limit) => limit.business_hours_only,
                                      )
                                        ? `${account.schedule.business_hours_start.slice(0, 5)}–${account.schedule.business_hours_end.slice(0, 5)} · ${account.schedule.timezone}`
                                        : "No business-hours restriction"}
                                    </p>
                                  </>
                                )}
                                {account && account.provider !== "LINKEDIN" && (
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    {account.provider.charAt(0) + account.provider.slice(1).toLowerCase()} sender
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <fieldset
                      disabled={!canEdit}
                      className="rounded-lg border p-3"
                    >
                      <legend className="px-1 text-xs font-medium">
                        LinkedIn senders
                      </legend>
                      {accountsData?.linkedinAccounts.length ? (
                        <div className="max-h-48 space-y-3 overflow-y-auto pr-1">
                          {accountsData.linkedinAccounts.map((account) => (
                            <label
                              key={account.id}
                              className="flex cursor-pointer items-center gap-2.5 text-xs"
                            >
                              <Checkbox
                                checked={draft.senderIds.includes(account.id)}
                                onCheckedChange={(checked) =>
                                  changeSender(account.id, checked === true)
                                }
                                disabled={
                                  !canEdit ||
                                  (account.status !== "active" &&
                                    !draft.senderIds.includes(account.id))
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {account.display_name ||
                                  account.username ||
                                  "LinkedIn account"}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {account.status === "active"
                                  ? "Connected"
                                  : "Disconnected"}
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Connect a LinkedIn account in sender settings.
                        </p>
                      )}
                    </fieldset>
                  </div>
                )}
              </SettingsSection>
              <SettingsSection
                icon={Gauge}
                title="Sending pace"
                description="Random delay between actions from the same sender account."
              >
                <fieldset
                  disabled={!canEdit}
                  className="grid grid-cols-2 gap-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="campaign-min-delay" className="text-xs">
                      Minimum delay
                    </Label>
                    <div className="relative">
                      <Input
                        id="campaign-min-delay"
                        type="number"
                        min={10}
                        max={300}
                        value={rateInputs.min}
                        onChange={(event) =>
                          setRateInputs((current) => ({
                            ...current,
                            min: event.target.value,
                          }))
                        }
                        onBlur={() => saveRate("min")}
                        className="pr-12"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        sec
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="campaign-max-delay" className="text-xs">
                      Maximum delay
                    </Label>
                    <div className="relative">
                      <Input
                        id="campaign-max-delay"
                        type="number"
                        min={10}
                        max={600}
                        value={rateInputs.max}
                        onChange={(event) =>
                          setRateInputs((current) => ({
                            ...current,
                            max: event.target.value,
                          }))
                        }
                        onBlur={() => saveRate("max")}
                        className="pr-12"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        sec
                      </span>
                    </div>
                  </div>
                </fieldset>
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                  Saved when you leave the field. This pacing applies across
                  campaigns sharing the same sender.
                </p>
              </SettingsSection>
              <SettingsSection
                icon={ListFilter}
                title="Audience & exclusions"
                description="Manage where contacts enter and avoid overlapping outreach."
                action={
                  canEdit ? (
                    <Button variant="outline" size="sm" onClick={editSequence}>
                      Edit audience
                    </Button>
                  ) : undefined
                }
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    {sourceLists.length > 0 && (
                      <p className="text-[11px] font-medium text-muted-foreground">
                        Direct source lists
                      </p>
                    )}
                    {sourceLists.length ? (
                      sourceLists.map((list) => (
                        <Link
                          key={list.id}
                          to={`/leads/lists/${list.id}`}
                          onClick={savedLink(`/leads/lists/${list.id}`)}
                          className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs hover:bg-muted/40"
                        >
                          <span className="truncate font-medium">
                            {list.name}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-2 text-muted-foreground">
                            {list.lead_count !== null &&
                              `${list.lead_count.toLocaleString()} contacts`}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No direct source list is assigned. Contacts can also
                        enter through list workflows or manual enrollment.
                      </p>
                    )}
                    {!!pipelineInflows?.length && (
                      <div className="space-y-2 pt-2">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          List workflow inflows
                        </p>
                        {pipelineInflows.map((inflow) => (
                          <Link
                            key={inflow.list_id}
                            to={`/leads/lists/${inflow.list_id}`}
                            onClick={savedLink(
                              `/leads/lists/${inflow.list_id}`,
                            )}
                            className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-xs hover:bg-muted/40"
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {inflow.list_name}
                            </span>
                            <Badge variant="secondary" className="text-[10px]">
                              {inflow.enabled
                                ? "Active workflow"
                                : "Workflow off"}
                            </Badge>
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </Link>
                        ))}
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          These lists qualify contacts through their saved
                          workflow before enrolling them here.
                        </p>
                      </div>
                    )}
                    {campaign.exclusion_list_ids?.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {campaign.exclusion_list_ids.length} additional
                        exclusion list
                        {campaign.exclusion_list_ids.length === 1
                          ? ""
                          : "s"}{" "}
                        configured.
                      </p>
                    )}
                  </div>
                  <div className="divide-y">
                    <SettingToggle
                      id="campaign-exclude-other"
                      label="Exclude contacts in other campaigns"
                      description="Avoid enrolling someone already in another outreach campaign."
                      checked={draft.excludeOtherCampaigns}
                      disabled={!canEdit}
                      onChange={(value) => {
                        updateDraft({ excludeOtherCampaigns: value });
                        savePatch({ exclude_other_campaigns: value });
                      }}
                    />
                    <SettingToggle
                      id="campaign-exclude-sender"
                      label="Exclude contacts previously reached by this sender"
                      description="Skip contacts already contacted by a selected sender."
                      checked={draft.excludeSameSender}
                      disabled={!canEdit}
                      onChange={(value) => {
                        updateDraft({ excludeSameSender: value });
                        savePatch({ exclude_same_sender: value });
                      }}
                    />
                    <SettingToggle
                      id="campaign-auto-enroll"
                      label="Enroll new list members automatically"
                      description="New contacts added to the source lists can enter this campaign."
                      checked={draft.autoEnrollNewMembers}
                      disabled={!canEdit}
                      onChange={(value) => {
                        updateDraft({ autoEnrollNewMembers: value });
                        savePatch({ auto_enroll_new_members: value });
                      }}
                    />
                  </div>
                </div>
              </SettingsSection>
            </div>
            <SettingsSection
              icon={Bot}
              title="Replies & automation"
              description="Stopping rules, follow-ups, the reply agent, and AI lead filtering."
            >
              <CampaignPowerSettings
                campaignId={campaign.id}
                disabled={!canEdit}
                settings={draft.settings}
                stopOnReply={draft.stopOnReply}
                autopilotConfig={draft.autopilotConfig}
                agentProfileId={draft.agentProfileId}
                onChange={(update) => {
                  if (!canEdit) return;
                  const settings = { ...draftRef.current.settings, ...update };
                  updateDraft({ settings });
                  savePatch({ campaign_settings: settings });
                }}
                onStopOnReplyChange={(checked) => {
                  if (!canEdit) return;
                  updateDraft({ stopOnReply: checked });
                  savePatch({ stop_on_reply: checked });
                }}
                onAutopilotChange={(config) => {
                  if (!canEdit) return;
                  updateDraft({ autopilotConfig: config });
                  if (!draftRef.current.agentProfileId)
                    savePatch({ autopilot_config: config }, true);
                }}
                onAgentProfileChange={(profileId, config) => {
                  if (!canEdit) return;
                  updateDraft({
                    agentProfileId: profileId,
                    autopilotConfig: config,
                  });
                  savePatch(
                    profileId
                      ? { agent_profile_id: profileId }
                      : { agent_profile_id: null, autopilot_config: config },
                  );
                }}
                className="[&_button]:max-w-full"
              />
            </SettingsSection>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorkspaceTab({
  value,
  icon: Icon,
  children,
}: {
  value: DetailTab;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className="relative h-12 gap-2 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:text-sm"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </TabsTrigger>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          {label}
        </span>
        <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}
function Notice({
  icon: Icon,
  title,
  description,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
  tone = "warning",
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  tone?: "warning" | "info";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-xl border px-4 py-3 sm:grid-cols-[16px_minmax(0,1fr)_auto]",
        tone === "warning"
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-blue-500/20 bg-blue-500/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "warning"
            ? "text-amber-600 dark:text-amber-400"
            : "text-blue-600 dark:text-blue-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap gap-2 sm:col-start-3 sm:row-start-1">
        {secondaryAction && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={onSecondaryAction}
          >
            {secondaryAction}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 bg-card text-xs"
          onClick={onAction}
        >
          {action}
          <ArrowUpRight className="ml-1.5 h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
function SettingsSection({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
function SettingToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-medium leading-5">
          {label}
        </Label>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
