import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Users,
  Send,
  GitBranch,
  Settings2,
  Bot,
  Pencil,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useAccountsWithLimits } from "@/hooks/useAccountsWithLimits";
import { useEnrollmentInflows } from "@/hooks/useEnrollmentInflows";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import type {
  CampaignBuilderReturn,
  WizardStep,
} from "@/hooks/useCampaignBuilder";
import { STEP_LABELS } from "@/hooks/useCampaignBuilder";
import { useEligibleLeadsPreview } from "@/hooks/useEligibleLeadsPreview";
import { unavailableCampaignSenderChannels } from "@/lib/campaign-persistence";
import { entryRuleSummary } from "@/lib/campaign-entry";
import {
  getSequenceStats,
  NODE_TYPE_CONFIGS,
  type SequenceNodeType,
} from "@/lib/sequence-utils";

interface StepReviewProps {
  builder: CampaignBuilderReturn;
  campaignId?: string;
  campaignStatus?: string;
}

export function StepReview({
  builder,
  campaignId,
  campaignStatus,
}: StepReviewProps) {
  const { state, validation, goToStep, selectNode } = builder;
  const {
    leadLists,
    error: listsError,
    isLoading: listsLoading,
  } = useLeadLists();
  const {
    data: accountsData,
    error: accountsError,
    isLoading: accountsLoading,
  } = useAccountsWithLimits();
  const { data: inflows, error: inflowsError } = useEnrollmentInflows(
    "linkedin_campaign",
    campaignId,
  );
  const { data: agentProfiles } = useAgentProfiles();
  const {
    data: preview,
    error: previewError,
    isLoading: previewLoading,
  } = useEligibleLeadsPreview({
    leadListIds: state.leadListIds,
    exclusionListIds: state.exclusionListIds,
    excludeOtherCampaigns: state.excludeOtherCampaigns,
    excludeSameSender: state.excludeSameSender,
    senderAccountIds: state.senderAccountIds,
    campaignId,
  });
  const selectedLists = leadLists.filter((list) =>
    state.leadListIds.includes(list.id),
  );
  const activeInflows = (inflows ?? []).filter((inflow) => inflow.enabled);
  const allSenderIds = [...new Set(Object.values(state.senderAccounts).flat())];
  const senderIds = allSenderIds.length ? allSenderIds : state.senderAccountIds;
  const selectedAccounts = (accountsData?.accounts ?? []).filter((account) =>
    senderIds.includes(account.id),
  );
  const activeAccounts = selectedAccounts.filter(
    (account) => account.status === "active",
  );
  const unavailableSenders = accountsData
    ? senderIds.length - activeAccounts.length
    : 0;
  const stats = getSequenceStats(state.sequenceNodes);
  const agent = agentProfiles?.find(
    (profile) => profile.id === state.agentProfileId,
  );
  const agentConfig = state.agentProfileId
    ? agent?.config
    : state.autopilotConfig;
  const isLive = campaignStatus === "active" || campaignStatus === "paused";
  const unavailableChannels = accountsData
    ? unavailableCampaignSenderChannels(
        { ...state.senderAccounts },
        state.senderAccountIds,
        accountsData.accounts,
      )
    : [];
  const ready =
    unavailableChannels.length === 0 &&
    validation.valid &&
    !accountsError &&
    !accountsLoading &&
    activeAccounts.length > 0;
  const errors = (["name", "leads", "triggers", "senders", "sequence"] as const)
    .filter((step) => validation.steps[step].errors.length)
    .map((step) => ({ step, errors: validation.steps[step].errors }));

  function editButton(step: WizardStep) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => goToStep(step)}
        aria-label={`Edit ${STEP_LABELS[step].toLowerCase()}`}
        className="h-8 gap-1.5 px-2 text-xs"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
    );
  }

  return (
    <section
      className="mx-auto w-full max-w-5xl space-y-6"
      aria-labelledby="campaign-review-heading"
    >
      <div>
        <h2
          id="campaign-review-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Review your campaign
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your audience, triggers, senders and sequence together. Jump into any
          section to make a change.
        </p>
      </div>
      <div
        className={`flex items-start gap-3 rounded-xl border p-4 ${ready ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
      >
        {ready ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div className="min-w-0">
          <p className="font-medium">
            {ready
              ? isLive
                ? "Configuration is complete"
                : "Ready for launch"
              : "A few things need attention"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLive
              ? "Edits apply on the next processing cycle. Previously contacted leads keep their sender."
              : ready
                ? "Launch when you’re ready to start sending."
                : "Resolve the issues below before launching. You can still save a draft."}
          </p>
        </div>
      </div>
      <Card className="shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4" />Entry triggers</CardTitle>
          {editButton("triggers")}
        </CardHeader>
        <CardContent className="space-y-3">
          {state.entryTriggers.length ? state.entryTriggers.map(rule => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{rule.name}</span>
              <span className="text-xs text-muted-foreground">{rule.enabled ? entryRuleSummary(rule) : "Paused"}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">No event triggers. Entry uses your audience lists and lead-processing routes.</p>}
          <p className="text-xs text-muted-foreground">Triggers listen while the campaign is active. Missing qualification goes to review; suppressed and duplicate contacts are excluded.</p>
        </CardContent>
      </Card>
      {(errors.length > 0 || accountsError || unavailableSenders > 0) && (
        <div className="divide-y rounded-xl border bg-card">
          {errors.map(({ step, errors: issues }) => (
            <button
              key={step}
              type="button"
              onClick={() => goToStep(step)}
              className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{STEP_LABELS[step]}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {issues.join(". ")}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          ))}
          {(accountsError || unavailableSenders > 0) && (
            <button
              type="button"
              onClick={() => goToStep("senders")}
              className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40"
            >
              <p className="flex-1 text-sm">
                {accountsError
                  ? "Sender availability couldn’t be checked. Retry in Senders."
                  : `${unavailableSenders} selected sender${unavailableSenders === 1 ? " is" : "s are"} unavailable. Review your sending accounts.`}
              </p>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          )}
        </div>
      )}
      {validation.summary.warnings.length > 0 && (
        <div className="space-y-2 text-sm text-amber-700 dark:text-amber-400">
          {validation.summary.warnings.map((warning, index) => (
            <p key={index} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">Campaign</CardTitle>
            {editButton("name")}
          </CardHeader>
          <CardContent>
            <p className="break-words text-lg font-semibold">
              {state.name || "Untitled campaign"}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {state.description || "No internal notes added."}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4" />
              Audience
            </CardTitle>
            {editButton("leads")}
          </CardHeader>
          <CardContent className="space-y-2">
            {listsError ? (
              <p className="text-sm text-destructive">
                Couldn’t load audience lists.
              </p>
            ) : listsLoading ? (
              <p className="text-sm text-muted-foreground">Loading audience…</p>
            ) : selectedLists.length ? (
              <>
                <p className="font-semibold">
                  {selectedLists.length} source list
                  {selectedLists.length === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedLists.map((list) => list.name).join(" · ")}
                </p>
                {previewError ? (
                  <p className="text-xs text-muted-foreground">
                    Eligibility preview unavailable. Review audience filters
                    before launch.
                  </p>
                ) : previewLoading ? (
                  <p className="text-xs text-muted-foreground">
                    Checking eligibility…
                  </p>
                ) : (
                  preview && (
                    <p className="text-sm">
                      {preview.eligibleCount.toLocaleString()} eligible in
                      source lists{" "}
                      <span className="text-xs text-muted-foreground">
                        before enrollment filter and ICP checks
                      </span>
                    </p>
                  )
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No direct list attached.
              </p>
            )}
            {activeInflows.length > 0 && (
              <p className="text-sm">
                Pipeline:{" "}
                {activeInflows.map((inflow) => inflow.list_name).join(" · ")}
              </p>
            )}
            {inflowsError && (
              <p className="text-xs text-muted-foreground">
                Pipeline sources couldn’t be checked.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {state.autoEnrollNewMembers
                ? "New list members enroll automatically."
                : "Automatic enrollment of new list members is off."}
            </p>
            {campaignId && (
              <p className="text-xs text-muted-foreground">
                Existing enrolled leads stay in the campaign.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Send className="h-4 w-4" />
              Senders
            </CardTitle>
            {editButton("senders")}
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {accountsLoading
                ? "Checking senders…"
                : accountsError
                  ? "Availability unknown"
                  : `${activeAccounts.length} connected sender${activeAccounts.length === 1 ? "" : "s"}`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedAccounts.map((account) => (
                <Badge
                  key={account.id}
                  variant="outline"
                  className="max-w-full gap-1.5"
                >
                  <span className="truncate">
                    {account.display_name ||
                      account.username ||
                      "Unnamed account"}
                  </span>
                  {account.status !== "active" && (
                    <span className="text-amber-700 dark:text-amber-400">
                      Unavailable
                    </span>
                  )}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Each sender uses its own sending limits and schedule.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Settings2 className="h-4 w-4" />
              Sending behavior
            </CardTitle>
            {editButton("settings")}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              {state.stopOnReply
                ? "Stop outreach when a lead replies"
                : "Continue outreach after a reply"}
            </p>
            <p>
              {state.rateSettings.min_delay_seconds}–
              {state.rateSettings.max_delay_seconds} seconds between LinkedIn
              actions
            </p>
            <p className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              {state.agentProfileId
                ? agent
                  ? `${agent.name} · ${agentConfig?.enabled ? "Enabled" : "Off"}`
                  : "Linked agent · configuration loading"
                : `Reply autopilot ${agentConfig?.enabled ? "enabled" : "off"}`}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card className="shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" />
            Sequence{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {stats.actionCount} actions
            </span>
          </CardTitle>
          {editButton("sequence")}
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.sequenceNodes.map((node, index) => {
              const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
              return (
                <button
                  type="button"
                  key={node.id}
                  onClick={() => {
                    goToStep("sequence");
                    selectNode(node.id);
                  }}
                  className="flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {node.data.customLabel || config?.label || node.type}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Branches control which steps a lead follows. Open the sequence to
            review each path.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
