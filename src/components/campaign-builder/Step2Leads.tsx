import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignSetupSlider as Slider } from "@/components/campaign-builder/CampaignSetupSlider";
import { Input } from "@/components/ui/input";
import { CampaignSetupSection } from "@/components/campaign-builder/CampaignSetupSection";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Plus,
  AlertCircle,
  Sparkles,
  RefreshCw,
  BarChart3,
  Target,
  Activity,
} from "lucide-react";
import {
  useLeadLists,
  useCreateLeadList,
  useCreateSmartList,
  isLivingLeadList,
} from "@/hooks/useLeadLists";
import { CreateSmartListDialog } from "@/components/lead-lists/CreateSmartListDialog";
import { CreateListDialog } from "@/components/lead-lists/CreateListDialog";
import { EnrollmentModeSelector } from "@/components/lead-lists/EnrollmentModeSelector";
import { EnrollmentFilterStep } from "@/components/lead-lists/EnrollmentFilterStep";
import { EnrollmentSources } from "@/components/lead-lists/EnrollmentSources";
import {
  activeInflowListIds,
  useEnrollmentInflows,
} from "@/hooks/useEnrollmentInflows";
import { useListsAwaitingProcessing } from "@/hooks/useListsAwaitingProcessing";
import { useState } from "react";
import {
  useAggregatedChannelStats,
  useRefreshChannelStats,
} from "@/hooks/useLeadListChannelStats";
import { useLeadListIcpDistribution } from "@/hooks/useLeadListIcpDistribution";
import { useProducts } from "@/hooks/useProducts";
import { ChannelReachabilityBadge } from "@/components/channel-reachability";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";
import {
  describeExclusions,
  useEligibleLeadsPreview,
} from "@/hooks/useEligibleLeadsPreview";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Step2LeadsProps {
  builder: CampaignBuilderReturn;
  campaignId?: string;
}

export function Step2Leads({ builder, campaignId }: Step2LeadsProps) {
  const { state, updateField, updateFields, validation } = builder;
  const { leadLists, isLoading, error: listsError } = useLeadLists();
  const queryClient = useQueryClient();
  const listsRefreshing = useIsFetching({ queryKey: ["lead-lists"] }) > 0;
  const { products, error: productsError } = useProducts();
  const navigate = useNavigate();
  const createLeadList = useCreateLeadList();
  const [createListOpen, setCreateListOpen] = useState(false);
  const [createSegmentOpen, setCreateSegmentOpen] = useState(false);
  const createSegment = useCreateSmartList();
  const [listSearch, setListSearch] = useState("");

  // Attach a list. Auto-enroll default is derived from list type only when the
  // FIRST list is added (living lists keep gaining members → default ON;
  // fixed-cohort → OFF); later adds preserve the user's current choice.
  // The other half of "who gets contacted": lead lists whose processing
  // pipeline routes its approved leads into this campaign. Those lists own
  // their leads — attaching one directly would pull it ungated.
  const { data: pipelineInflows } = useEnrollmentInflows(
    "linkedin_campaign",
    campaignId,
  );
  const pipelineOwnedListIds = activeInflowListIds(pipelineInflows);
  const { data: awaitingProcessing } = useListsAwaitingProcessing(
    state.leadListIds,
  );

  const addLeadList = (listId: string) => {
    if (state.leadListIds.includes(listId) || pipelineOwnedListIds.has(listId))
      return;
    const next = [...state.leadListIds, listId];
    if (state.leadListIds.length === 0) {
      updateFields({
        leadListIds: next,
        autoEnrollNewMembers: isLivingLeadList(
          leadLists.find((l) => l.id === listId),
        ),
      });
    } else {
      updateField("leadListIds", next);
    }
  };

  const removeLeadList = (listId: string) => {
    updateField(
      "leadListIds",
      state.leadListIds.filter((id) => id !== listId),
    );
  };

  // Aggregated channel stats across all attached lists
  const {
    data: channelStats,
    isLoading: isLoadingStats,
    error: channelStatsError,
    refetch: retryChannelStats,
  } = useAggregatedChannelStats(state.leadListIds);
  const refreshStats = useRefreshChannelStats();
  const refreshAllStats = () =>
    state.leadListIds.forEach((id) => refreshStats.mutate(id));

  // Aggregated ICP score distribution when a product is selected
  const {
    data: icpDistribution,
    isLoading: isLoadingIcp,
    error: icpError,
    refetch: retryIcp,
  } = useLeadListIcpDistribution(
    state.leadListIds.length ? state.leadListIds : undefined,
    state.icpProductId || undefined,
  );

  // Preview eligible leads (union of all lists) after exclusion filters
  const {
    data: eligiblePreview,
    isLoading: isLoadingEligible,
    error: eligibleError,
    refetch: retryEligiblePreview,
  } = useEligibleLeadsPreview({
    leadListIds: state.leadListIds,
    exclusionListIds: state.exclusionListIds,
    excludeOtherCampaigns: state.excludeOtherCampaigns,
    excludeSameSender: state.excludeSameSender,
    senderAccountIds: state.senderAccounts.linkedin ?? state.senderAccountIds,
    campaignId,
  });

  const errors = validation.steps.leads.errors;
  const warnings = validation.steps.leads.warnings;

  // Selected lead lists + derived aggregates
  const selectedLists = leadLists.filter((l) =>
    state.leadListIds.includes(l.id),
  );
  const hasLists = selectedLists.length > 0;
  const totalListLeadCount = selectedLists.reduce(
    (sum, l) => sum + (l.lead_count || 0),
    0,
  );
  const primaryList = selectedLists[0];
  const firstListId = state.leadListIds[0];
  // Any attached list backed by a signal pipeline → show the signal-context help.
  const signalList = selectedLists.find(
    (l) =>
      l.source_type === "signal" ||
      l.source_type === "discovery_pack" ||
      (l.is_smart && (l.filter_criteria?.signal_types?.length ?? 0) > 0),
  );

  // Available lists to add (exclude ones already picked)
  const searchedLeadLists = leadLists.filter(
    (list) =>
      state.leadListIds.includes(list.id) ||
      list.name.toLowerCase().includes(listSearch.trim().toLowerCase()),
  );

  // Filter available exclusion lists (exclude the selected main lists)
  const availableExclusionLists = leadLists.filter(
    (l) => !state.leadListIds.includes(l.id),
  );

  // Add exclusion list
  const addExclusionList = (listId: string) => {
    if (!state.exclusionListIds.includes(listId)) {
      updateField("exclusionListIds", [...state.exclusionListIds, listId]);
    }
  };

  // Remove exclusion list
  const removeExclusionList = (listId: string) => {
    updateField(
      "exclusionListIds",
      state.exclusionListIds.filter((id) => id !== listId),
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Audience</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose your sources, then define which leads can enter this campaign.
        </p>
      </div>
      {campaignId && (
        <p
          className="rounded-lg border bg-muted/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground"
          role="note"
        >
          Audience changes apply to future enrollments. Existing leads stay
          enrolled; manage them in the campaign’s Leads tab.
        </p>
      )}
      {/* Who enters this campaign — every inflow in one stack, each row stating
          its own gate: an attached list is pulled whole, a lead-processing route
          delivers only leads that passed qualify → enrich → verify. */}
      <CampaignSetupSection
        title="Lead sources"
        description="Attach lists directly or receive approved leads from a list’s processing workflow."
      >
        {listsError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
          >
            <p className="flex-1 text-sm">
              Couldn’t load lead lists. Saved sources are retained.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={listsRefreshing}
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: ["lead-lists"] })
              }
            >
              Retry
            </Button>
          </div>
        )}
        {leadLists.length > 8 && (
          <div className="space-y-1.5">
            <Label htmlFor="campaign-list-search">Find a list to add</Label>
            <Input
              id="campaign-list-search"
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
              placeholder="Search list names…"
            />
            {listSearch && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setListSearch("")}
              >
                Clear list search
              </Button>
            )}
          </div>
        )}

        <EnrollmentSources
          destination="campaign"
          autoEnroll={state.autoEnrollNewMembers}
          availableLists={searchedLeadLists}
          attachedListIds={state.leadListIds}
          inflows={pipelineInflows ?? []}
          pipelineOwnedListIds={pipelineOwnedListIds}
          onAttach={addLeadList}
          onDetach={removeLeadList}
          isLoading={isLoading}
          invalid={errors.length > 0}
          pickerFooter={<div className="grid gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreateSegmentOpen(true)}><Plus className="mr-2 h-4 w-4" />Create smart segment</Button>
            <Button variant="outline" size="sm" onClick={() => setCreateListOpen(true)}>Create static list</Button>
          </div>}

        />

        {errors.map((error, i) => (
          <p key={i} className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ))}

        {leadLists.length === 0 && !isLoading && !listsError && (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No lead lists found.{" "}
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => navigate("/leads/import")}
              >
                Import leads
              </Button>{" "}
              to get started.
            </p>
          </div>
        )}

        {/* Signal context callout — shown when any attached list is backed by a
            signal pipeline. Surfaces the available {{ai_signal_*}} variables so
            they know what context they can reference in messages. */}
        {signalList && (
          <details className="rounded-lg border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Signal context for personalization
            </summary>
            <div className="mt-3">
              <div className="flex items-start gap-2">
                <Activity className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs space-y-1">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    This list comes from a signal — use the signal context in
                    your messages.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Core:{" "}
                    <code className="text-[11px]">{`{{ai_signal_detail}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_type}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_date}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_context}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_source_url}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_pack_source}}`}</code>
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Funding:{" "}
                    <code className="text-[11px]">{`{{ai_signal_amount}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_investors}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_company_industry}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_company_website}}`}</code>
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Hiring:{" "}
                    <code className="text-[11px]">{`{{ai_signal_new_role}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_role_location}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_seniority}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_employment_type}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_num_applicants}}`}</code>
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Leadership change:{" "}
                    <code className="text-[11px]">{`{{ai_signal_person}}`}</code>{" "}
                    <code className="text-[11px]">{`{{ai_signal_new_role}}`}</code>
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Example:{" "}
                    <em>
                      "Hey {`{{first_name}}`}, saw you're hiring a{" "}
                      {`{{ai_signal_new_role}}`} in{" "}
                      {`{{ai_signal_role_location}}`} — happy to share how we
                      shortened time-to-fill for similar roles."
                    </em>
                  </p>
                </div>
              </div>
            </div>
          </details>
        )}

        {hasLists && (
          <p className="text-sm text-muted-foreground">
            {isLoadingEligible ? (
              <Skeleton
                as="span"
                className="h-5 w-56 inline-block align-middle"
              />
            ) : eligiblePreview ? (
              <>
                <strong className="text-foreground">
                  {eligiblePreview.eligibleCount}
                </strong>{" "}
                of {eligiblePreview.totalInList} list members pass exclusion
                checks
                {selectedLists.length > 1 && (
                  <span className="ml-1">
                    across {selectedLists.length} lists
                  </span>
                )}
                {eligiblePreview.eligibleCount <
                  eligiblePreview.totalInList && (
                  <span className="text-amber-700 dark:text-amber-400 ml-1">
                    (
                    {eligiblePreview.totalInList -
                      eligiblePreview.eligibleCount}{" "}
                    excluded)
                  </span>
                )}
              </>
            ) : (
              <>
                {totalListLeadCount.toLocaleString()} list memberships ·
                checking exclusions
              </>
            )}
          </p>
        )}
        {eligibleError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Audience exclusion checks are unavailable.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void retryEligiblePreview()}
            >
              Retry preview
            </Button>
          </div>
        )}
        {eligiblePreview && describeExclusions(eligiblePreview).length > 0 && (
          <p className="text-xs text-muted-foreground">
            {describeExclusions(eligiblePreview).join(" · ")}
          </p>
        )}
        {hasLists && (
          <p className="text-xs text-muted-foreground">
            Enrollment filters and ICP rules can narrow the audience further.
          </p>
        )}

        {/* Enrollment mode — Active Campaign (auto_enroll_new_members=true) keeps the
            campaign in sync via a cron every ~15 min; One-time send contacts only
            who's in the lists now. The list type only picks which is recommended. */}
        {hasLists && primaryList && (
          <EnrollmentModeSelector
            context="campaign"
            value={state.autoEnrollNewMembers}
            leadCount={eligiblePreview?.totalInList ?? totalListLeadCount}
            list={{ is_smart: selectedLists.some((source) => source.is_smart), source_type: selectedLists.some(isLivingLeadList) ? "smart" : "manual" }}
            awaitingProcessing={awaitingProcessing ?? 0}
            onChange={(ongoing) => updateField("autoEnrollNewMembers", ongoing)}
          />
        )}

        {/* Filter step — narrows who actually gets contacted, applied to the
            initial fill AND the ongoing cron by the same server-side gate. */}
        {hasLists && (
          <EnrollmentFilterStep
            context="campaign"
            criteria={state.enrollFilterCriteria ?? {}}
            listIds={state.leadListIds}
            onChange={(next) => updateField("enrollFilterCriteria", next)}
          />
        )}

        <CreateSmartListDialog
          open={createSegmentOpen}
          attachTo="campaign"
          onOpenChange={setCreateSegmentOpen}
          isLoading={createSegment.isPending}
          onSubmit={(input) => createSegment.mutate(input, { onSuccess: (created) => {
            updateFields({ leadListIds: [...state.leadListIds, created.id], autoEnrollNewMembers: state.leadListIds.length === 0 ? true : state.autoEnrollNewMembers });
            setCreateSegmentOpen(false);
          } })}
        />
        <CreateListDialog
          open={createListOpen}
          onOpenChange={setCreateListOpen}
          isLoading={createLeadList.isPending}
          onSubmit={(data) =>
            createLeadList.mutate(data, {
              onSuccess: (list) => {
                addLeadList(list.id);
                setCreateListOpen(false);
              },
            })
          }
        />
      </CampaignSetupSection>

      {/* Channel Reachability Stats (aggregated across attached lists) */}
      {hasLists && (
        <Card className="rounded-xl shadow-none">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">
                  Channel coverage
                  {selectedLists.length > 1 && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      · {selectedLists.length} lists
                    </span>
                  )}
                </h4>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshAllStats}
                disabled={refreshStats.isPending}
                aria-label="Refresh channel coverage"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshStats.isPending ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {isLoadingStats ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : channelStatsError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Channel coverage could not be loaded.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void retryChannelStats()}
                >
                  Retry coverage
                </Button>
              </div>
            ) : channelStats ? (
              <>
                <ChannelReachabilityBadge
                  stats={channelStats}
                  channels={["linkedin", "email"]}
                  className="mb-3"
                />
                {selectedLists.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Coverage counts list memberships; contacts in more than one
                    list appear in each.
                  </p>
                )}

                {/* Low coverage warnings */}
                {channelStats.email_pct < 30 && (
                  <Alert
                    variant="default"
                    className="mt-3 border-status-warning/30 bg-status-warning/10"
                  >
                    <AlertCircle className="h-4 w-4 text-status-warning" />
                    <AlertDescription className="text-sm text-muted-foreground">
                      Only {Math.round(channelStats.email_pct)}% of leads have
                      email addresses.{" "}
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-status-warning underline"
                        onClick={() =>
                          firstListId && navigate("/leads/lists/" + firstListId)
                        }
                      >
                        Enrich missing emails
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-2">
                  No channel stats available yet
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshAllStats}
                  disabled={refreshStats.isPending}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {refreshStats.isPending ? "Computing..." : "Compute Stats"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ICP Score Targeting */}
      {hasLists &&
        ((products?.length ?? 0) > 0 ||
          state.icpProductId ||
          !!productsError) && (
          <Card className="rounded-xl shadow-none">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Product fit</h3>
                <span className="text-xs text-muted-foreground">
                  (optional)
                </span>
              </div>
              {productsError && (
                <div
                  role="alert"
                  className="mb-4 flex flex-wrap items-center gap-3"
                >
                  <p className="text-sm text-muted-foreground">
                    Products could not be loaded. Your saved targeting is
                    retained.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void queryClient.invalidateQueries({
                        queryKey: ["products"],
                      })
                    }
                  >
                    Retry products
                  </Button>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-icp-product" className="text-sm">
                    Filter by product fit
                  </Label>
                  <Select
                    value={state.icpProductId || "_none"}
                    onValueChange={(v) => {
                      if (v === "_none") {
                        updateField("icpProductId", "");
                        updateField("minIcpScore", null);
                      } else {
                        updateField("icpProductId", v);
                      }
                    }}
                  >
                    <SelectTrigger
                      id="campaign-icp-product"
                      className="w-full h-10"
                    >
                      <SelectValue placeholder="Select product..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">
                        <span className="text-muted-foreground">
                          No ICP filter
                        </span>
                      </SelectItem>
                      {state.icpProductId &&
                        !products?.some(
                          (product) => product.id === state.icpProductId,
                        ) && (
                          <SelectItem value={state.icpProductId}>
                            Saved product unavailable
                          </SelectItem>
                        )}
                      {(products ?? []).map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {state.icpProductId && (
                  <>
                    {/* Min score slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Minimum ICP score</Label>
                        <span className="text-sm font-medium">
                          {state.minIcpScore ?? 0}
                        </span>
                      </div>
                      <Slider
                        value={[state.minIcpScore ?? 0]}
                        onValueChange={([v]) =>
                          updateField("minIcpScore", v > 0 ? v : null)
                        }
                        max={100}
                        step={5}
                        aria-label="Minimum ICP score"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>0 (all)</span>
                        <span>40</span>
                        <span>60</span>
                        <span>80</span>
                        <span>100</span>
                      </div>
                    </div>

                    {/* ICP Distribution */}
                    {isLoadingIcp ? (
                      <Skeleton className="h-16 w-full" />
                    ) : icpError ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-3"
                      >
                        <p className="text-sm text-muted-foreground">
                          ICP score distribution could not be loaded.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void retryIcp()}
                        >
                          Retry scores
                        </Button>
                      </div>
                    ) : icpDistribution && icpDistribution.scored > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {icpDistribution.scored} of {icpDistribution.total}{" "}
                          leads scored for this product
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div
                            className={cn(
                              "text-center p-2 rounded-md border",
                              "bg-muted/30",
                            )}
                          >
                            <p className="text-lg font-semibold tabular-nums">
                              {icpDistribution.perfectFit}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Perfect 80+
                            </p>
                          </div>
                          <div
                            className={cn(
                              "text-center p-2 rounded-md border",
                              "bg-muted/30",
                            )}
                          >
                            <p className="text-lg font-semibold tabular-nums">
                              {icpDistribution.goodFit}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Good 60-79
                            </p>
                          </div>
                          <div
                            className={cn(
                              "text-center p-2 rounded-md border",
                              "bg-muted/30",
                            )}
                          >
                            <p className="text-lg font-semibold tabular-nums">
                              {icpDistribution.moderateFit}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Moderate 40-59
                            </p>
                          </div>
                          <div
                            className={cn(
                              "text-center p-2 rounded-md border",
                              "bg-muted/30",
                            )}
                          >
                            <p className="text-lg font-semibold tabular-nums">
                              {icpDistribution.poorFit}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Poor &lt;40
                            </p>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          These score ranges show audience quality. Enrollment
                          checks each lead’s exact score against your minimum.
                        </p>
                      </div>
                    ) : icpDistribution && icpDistribution.scored === 0 ? (
                      <Alert
                        variant="default"
                        className="border-status-warning/30 bg-status-warning/10"
                      >
                        <AlertCircle className="h-4 w-4 text-status-warning" />
                        <AlertDescription className="text-sm text-muted-foreground">
                          No leads in these lists have been scored for the
                          selected product.{" "}
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-status-warning underline"
                            onClick={() =>
                              firstListId &&
                              navigate("/leads/lists/" + firstListId)
                            }
                          >
                            Analyze companies
                          </Button>{" "}
                          to generate ICP scores.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Exclusion Lists */}
      <CampaignSetupSection
        title="Exclusions & duplicate protection"
        description="Keep opted-out contacts and existing outreach out of this campaign."
      >
        <Label>
          Exclusion lists{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          Members of these lists will be excluded from the audience.
        </p>

        {/* Selected exclusion lists */}
        {state.exclusionListIds.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {state.exclusionListIds.map((listId) => {
              const list = leadLists.find((l) => l.id === listId);
              return (
                <Badge
                  key={listId}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {list?.name || "Unavailable list"}
                  <button
                    type="button"
                    onClick={() => removeExclusionList(listId)}
                    aria-label={`Remove ${list?.name || "unavailable list"} from exclusions`}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}

        {/* Add exclusion list dropdown */}
        {availableExclusionLists.length > 0 && (
          <Select value="" onValueChange={addExclusionList}>
            <SelectTrigger className="w-full" aria-label="Add exclusion list">
              <SelectValue placeholder="Add exclusion list..." />
            </SelectTrigger>
            <SelectContent>
              {availableExclusionLists
                .filter((l) => !state.exclusionListIds.includes(l.id))
                .map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      <span>{list.name}</span>
                      <Badge variant="secondary" className="ml-auto">
                        {list.lead_count}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <div className="space-y-4 border-t pt-4">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="exclude-other-campaigns"
              checked={state.excludeOtherCampaigns}
              onCheckedChange={(checked) =>
                updateField("excludeOtherCampaigns", checked === true)
              }
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="exclude-other-campaigns"
                className="text-sm font-medium cursor-pointer"
              >
                Exclude leads from other campaigns
              </label>
              <p className="text-xs text-muted-foreground">
                Don't contact leads that are already in another active campaign
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="exclude-same-sender"
              checked={state.excludeSameSender}
              onCheckedChange={(checked) =>
                updateField("excludeSameSender", checked === true)
              }
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="exclude-same-sender"
                className="text-sm font-medium cursor-pointer"
              >
                Exclude leads contacted by the same sender
              </label>
              <p className="text-xs text-muted-foreground">
                Don't use a sender account that has already contacted a lead
              </p>
            </div>
          </div>

          {warnings.map((warning, i) => (
            <p
              key={i}
              className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1"
            >
              <AlertCircle className="h-4 w-4" />
              {warning}
            </p>
          ))}
        </div>
      </CampaignSetupSection>
    </div>
  );
}
