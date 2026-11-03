import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  AlertTriangle,
  Target,
  X,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import {
  loadPendingSignalSelection,
  clearPendingSignalSelection,
  type PendingSignalSelection,
} from "@/lib/signalSelection";
import { CampaignWizard } from "@/components/campaign-builder/CampaignWizard";
import {
  useCampaignBuilder,
  WIZARD_STEPS,
  type WizardStep,
  type CampaignBuilderState,
} from "@/hooks/useCampaignBuilder";
import { useCampaign } from "@/hooks/useCampaigns";
import { Skeleton } from "@/components/ui/skeleton";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeEntryRules } from "@/lib/campaign-entry";
import { LinkedInCampaignsShowcase } from "@/components/showcase/LinkedInCampaignsShowcase";

function resolveSection(value: string | null, isEditing: boolean): WizardStep {
  return WIZARD_STEPS.includes(value as WizardStep)
    ? (value as WizardStep)
    : isEditing
      ? "sequence"
      : "name";
}

export default function CampaignBuilder() {
  const { id } = useParams<{ id?: string }>();
  const { currentOrganization } = useAuth();
  // A new campaign or organization gets its own draft, save queue and undo history.
  return (
    <CampaignEditorWorkspace
      key={`${currentOrganization?.id ?? "none"}:${id ?? "new"}`}
      id={id}
    />
  );
}

function CampaignEditorWorkspace({ id }: { id?: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentOrganization } = useAuth();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseLinkedIn = hasFeature("linkedin_campaigns");
  const isEditing = !!id;
  const sectionParam = searchParams.get("section");
  const [signalDraft, setSignalDraft] = useState<PendingSignalSelection | null>(
    null,
  );
  const [hydrated, setHydrated] = useState(!isEditing);
  const {
    data: existingCampaign,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useCampaign(id);
  const builder = useCampaignBuilder(undefined, {
    campaignId: id,
    initialStep: resolveSection(sectionParam, isEditing),
  });
  const { goToStep: builderGoToStep, loadCampaign } = builder;
  const loadedCampaignIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isEditing) return;
    const pending = loadPendingSignalSelection();
    if (pending) {
      setSignalDraft(pending);
      clearPendingSignalSelection();
    }
  }, [isEditing]);

  useEffect(() => {
    builderGoToStep(resolveSection(sectionParam, isEditing));
  }, [sectionParam, isEditing, builderGoToStep]);

  useEffect(() => {
    if (
      !existingCampaign ||
      existingCampaign.organization_id !== currentOrganization?.id ||
      loadedCampaignIdRef.current === existingCampaign.id
    )
      return;
    loadedCampaignIdRef.current = existingCampaign.id;
    const linkedinSenders = existingCampaign.sender_accounts?.linkedin?.length
      ? existingCampaign.sender_accounts.linkedin
      : existingCampaign.sender_account_ids || [];
    loadCampaign({
      name: existingCampaign.name,
      description: existingCampaign.description || "",
      leadListIds:
        existingCampaign.lead_list_ids ??
        (existingCampaign.lead_list_id ? [existingCampaign.lead_list_id] : []),
      exclusionListIds: existingCampaign.exclusion_list_ids || [],
      excludeOtherCampaigns: existingCampaign.exclude_other_campaigns,
      excludeSameSender: existingCampaign.exclude_same_sender,
      autoEnrollNewMembers: existingCampaign.auto_enroll_new_members ?? false,
      enrollFilterCriteria: existingCampaign.enroll_filter_criteria ?? {},
      entryTriggers: normalizeEntryRules(existingCampaign.entry_triggers),
      senderAccountIds: linkedinSenders,
      senderAccounts: {
        ...existingCampaign.sender_accounts,
        ...(linkedinSenders.length ? { linkedin: linkedinSenders } : {}),
      },
      campaignType: existingCampaign.campaign_type || "linkedin_only",
      primaryChannel: (existingCampaign.primary_channel ||
        "linkedin") as CampaignBuilderState["primaryChannel"],
      channelFallbackEnabled:
        existingCampaign.channel_fallback_enabled ?? false,
      fallbackOrder: existingCampaign.fallback_order as
        | CampaignBuilderState["fallbackOrder"]
        | undefined,
      icpProductId: existingCampaign.icp_product_id || "",
      minIcpScore: existingCampaign.min_icp_score ?? null,
      sequenceNodes: existingCampaign.sequence_nodes || [],
      sequenceEdges: existingCampaign.sequence_edges || [],
      stopOnReply: existingCampaign.stop_on_reply,
      campaignSettings: existingCampaign.campaign_settings,
      rateSettings: existingCampaign.rate_settings,
      autopilotConfig: existingCampaign.autopilot_config,
      agentProfileId: existingCampaign.agent_profile_id || null,
    });
    // Mount autosave only after hydration, so opening the editor never writes.
    setHydrated(true);
  }, [existingCampaign, currentOrganization?.id, loadCampaign]);

  const goToSection = (step: WizardStep) => {
    builder.goToStep(step);
    const next = new URLSearchParams(searchParams);
    next.set("section", step);
    setSearchParams(next);
  };
  const editorBuilder = {
    ...builder,
    goToStep: goToSection,
    goToNextStep: () =>
      goToSection(
        WIZARD_STEPS[
          Math.min(builder.currentStepIndex + 1, WIZARD_STEPS.length - 1)
        ],
      ),
    goToPreviousStep: () =>
      goToSection(WIZARD_STEPS[Math.max(builder.currentStepIndex - 1, 0)]),
  };

  if (!canUseLinkedIn) {
    return (
      <AppLayout header={<UserProfileMenu />}>
        <div className="p-6">
          {showUpgradePrompts ? (
            <LinkedInCampaignsShowcase />
          ) : (
            <p className="py-12 text-center text-muted-foreground">
              This feature is not available for your organization.
            </p>
          )}
        </div>
      </AppLayout>
    );
  }

  if (isEditing && (isLoading || (!error && existingCampaign && !hydrated))) {
    return (
      <AppLayout disableScroll hideActivationChecklist>
        <div
          className="flex h-full min-h-0 flex-col gap-5 p-4 sm:p-6"
          aria-label="Loading campaign editor"
          aria-busy="true"
        >
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="min-h-0 flex-1 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  const missing =
    (error as { code?: string } | null)?.code === "PGRST116" ||
    (isEditing && !error && !existingCampaign);
  if (isEditing && (error || missing)) {
    return (
      <AppLayout hideActivationChecklist>
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h1 className="text-xl font-semibold">
            {missing ? "Campaign not found" : "Couldn’t load this campaign"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {missing
              ? "This campaign may have been removed or belong to a different workspace."
              : "Your campaign hasn’t been changed. Try loading it again."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="outline" onClick={() => navigate("/campaigns")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Campaigns
            </Button>
            {!missing && (
              <Button
                variant="cta"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                />
                Retry
              </Button>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (existingCampaign?.status === "completed") {
    return (
      <AppLayout hideActivationChecklist>
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <CheckCircle2 className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h1 className="text-xl font-semibold">This campaign is complete</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review its sequence and results, or duplicate it to start a new
            campaign.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => navigate(`/campaigns/${id}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            View campaign
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      disableScroll
      hideActivationChecklist
      header={<UserProfileMenu />}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {signalDraft && (
          <Alert className="m-4 w-auto shrink-0 border-amber-500/30 bg-amber-500/5">
            <Target className="h-4 w-4" />
            <AlertTitle className="flex items-center justify-between gap-2">
              <span>
                {signalDraft.signals.length.toLocaleString()} companies from the
                Signals tracker
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSignalDraft(null)}
                aria-label="Dismiss Signals selection"
              >
                <X className="h-4 w-4" />
              </Button>
            </AlertTitle>
            <AlertDescription>
              {signalDraft.signals
                .slice(0, 6)
                .map((s) => s.company)
                .join(", ")}
              {signalDraft.signals.length > 6
                ? `, +${signalDraft.signals.length - 6} more`
                : ""}
              . Add these companies to a lead list to source and enrich your
              contacts.
            </AlertDescription>
          </Alert>
        )}
        <CampaignWizard
          builder={editorBuilder}
          campaignId={id}
          campaignStatus={existingCampaign?.status}
          existingCampaign={existingCampaign}
        />
      </div>
    </AppLayout>
  );
}
