import { useEffect, useRef, useState } from "react";
import {
  Magnet,
  Plus,
  Settings2,
  ArrowLeft,
  AlertCircle,
  LinkIcon,
  RefreshCw,
  BarChart3,
  Download,
  LayoutGrid,
  List,
  HelpCircle,
  Users,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CampaignList } from "@/components/leads/CampaignList";
import { CampaignForm } from "@/components/leads/CampaignForm";
import { CampaignDetail } from "@/components/leads/CampaignDetail";
import { LeadsHeader } from "@/components/leads/LeadsHeader";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { LeadsPipeline } from "@/components/leads/LeadsPipeline";
import { LeadsAnalytics } from "@/components/leads/LeadsAnalytics";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import {
  useUnipileCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useToggleCampaignStatus,
  useSetCampaignStatus,
  type UnipileCampaign,
  type CreateCampaignInput,
  useRetryLeadDm,
} from "@/hooks/useUnipileCampaigns";
import {
  useLeadsWithCrm,
  useLeadStats,
  useBulkUpdateLeadStatus,
  useDeleteLeads,
  useExportLeads,
  type LeadsFilters,
  type LeadWithCrmContact,
} from "@/hooks/leads/useLeadsSync";
import { Link } from "react-router-dom";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { LeadMagnetsShowcase } from "@/components/showcase/LeadMagnetsShowcase";
import { useAuth } from "@/contexts/AuthContext";

type TabValue = "campaigns" | "leads" | "analytics";
type LeadsViewMode = "table" | "pipeline";

export default function Leads() {
  const { currentOrganization } = useAuth();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseLeadMagnets = hasFeature("lead_magnets");

  const [activeTab, setActiveTab] = useState<TabValue>("campaigns");
  const [leadsViewMode, setLeadsViewMode] = useState<LeadsViewMode>("table");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCampaign, setEditingCampaign] =
    useState<UnipileCampaign | null>(null);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [editRefreshing, setEditRefreshing] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const campaignHeadingRef = useRef<HTMLHeadingElement>(null);

  // Leads filters state
  const [leadsFilters, setLeadsFilters] = useState<LeadsFilters>({
    page: 1,
    pageSize: 50,
    sortBy: "captured_at",
    sortDirection: "desc",
  });
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(
    new Set(),
  );

  // Data hooks
  const {
    data: accountsData,
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useUnipileAccounts();
  const {
    data: campaigns,
    isLoading: campaignsLoading,
    isError: campaignsError,
    refetch: refetchCampaigns,
  } = useUnipileCampaigns();
  const {
    data: leadsData,
    isLoading: leadsLoading,
    isError: leadsError,
    refetch: refetchLeads,
  } = useLeadsWithCrm(leadsFilters);
  const {
    data: leadStats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useLeadStats();

  // Mutation hooks
  const createMutation = useCreateCampaign();
  const updateMutation = useUpdateCampaign();
  const deleteMutation = useDeleteCampaign();
  const toggleStatusMutation = useToggleCampaignStatus();
  const setStatusMutation = useSetCampaignStatus();
  const bulkUpdateStatusMutation = useBulkUpdateLeadStatus();
  const deleteLeadsMutation = useDeleteLeads();
  const exportLeadsMutation = useExportLeads();
  const retryDmMutation = useRetryLeadDm();

  const selectedCampaign =
    campaigns?.find((campaign) => campaign.id === selectedCampaignId) || null;
  const selectCampaign = (campaign: UnipileCampaign) =>
    setSelectedCampaignId(campaign.id);
  useEffect(() => {
    setSelectedCampaignId(null);
    setEditingCampaign(null);
    setShowCreateDialog(false);
    setSelectedLeadIds(new Set());
    setLeadsFilters({
      page: 1,
      pageSize: 50,
      sortBy: "captured_at",
      sortDirection: "desc",
    });
  }, [currentOrganization?.id]);
  useEffect(() => {
    setEditSaveError(null);
  }, [editingCampaign?.id]);
  useEffect(() => {
    if (selectedCampaignId && activeTab === "campaigns")
      campaignHeadingRef.current?.focus();
  }, [selectedCampaignId, activeTab]);

  // Feature gating
  if (!canUseLeadMagnets && showUpgradePrompts) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <LeadMagnetsShowcase />
        </div>
      </AppLayout>
    );
  }

  if (!canUseLeadMagnets) {
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

  const eligibleAccounts = (accountsData?.accounts || []).filter(
    (account) =>
      account.status === "active" &&
      (account.provider === "LINKEDIN" || account.provider === "INSTAGRAM"),
  );
  const hasAccounts = eligibleAccounts.length > 0;
  const hasAccess =
    (accountsData?.limits?.linkedin ?? 0) > 0 ||
    (accountsData?.limits?.instagram ?? 0) > 0 ||
    accountsData?.hasBYOK;

  // Campaign handlers
  const handleCreate = (data: CreateCampaignInput) => {
    createMutation.mutate(data, {
      onSuccess: () => {
        setShowCreateDialog(false);
      },
    });
  };

  const handleUpdate = (data: CreateCampaignInput) => {
    if (!editingCampaign) return;
    setEditSaveError(null);
    updateMutation.mutate(
      { id: editingCampaign.id, ...data },
      {
        onSuccess: async () => {
          setEditRefreshing(true);
          await refetchCampaigns();
          setEditingCampaign(null);
          setDetailRevision((revision) => revision + 1);
          setEditRefreshing(false);
        },
        onError: () =>
          setEditSaveError("Your changes couldn’t be saved. Please try again."),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
    if (selectedCampaign?.id === id) {
      setSelectedCampaignId(null);
    }
  };

  const handleToggleStatus = (id: string, is_active: boolean) => {
    toggleStatusMutation.mutate({ id, is_active });
  };

  const handleSetStatus = (
    id: string,
    status: "draft" | "active" | "paused",
  ) => {
    setStatusMutation.mutate({ id, status });
  };

  // Lead handlers
  const handleUpdateLeadStatus = (status: string) => {
    if (selectedLeadIds.size === 0) return;
    bulkUpdateStatusMutation.mutate(
      {
        leadIds: Array.from(selectedLeadIds),
        status: status as LeadWithCrmContact["status"],
      },
      {
        onSuccess: () => {
          setSelectedLeadIds(new Set());
        },
      },
    );
  };

  const handleDeleteSelected = () => {
    if (selectedLeadIds.size === 0) return;
    deleteLeadsMutation.mutate(Array.from(selectedLeadIds), {
      onSuccess: () => {
        setSelectedLeadIds(new Set());
      },
    });
  };

  const handleExportSelected = () => {
    const ids =
      selectedLeadIds.size > 0 ? Array.from(selectedLeadIds) : undefined;
    exportLeadsMutation.mutate(ids);
  };

  const isLoading = accountsLoading || campaignsLoading;

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="max-w-[1600px] mx-auto space-y-5">
          {/* Header */}
          <PageHeader
            icon={Magnet}
            title="Lead Magnets"
            description="Deliver resources automatically from LinkedIn and Instagram comments."
            actions={
              <>
                {activeTab === "leads" && (
                  <Button
                    variant="outline"
                    onClick={handleExportSelected}
                    disabled={exportLeadsMutation.isPending}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {exportLeadsMutation.isPending
                      ? "Exporting…"
                      : selectedLeadIds.size > 0
                        ? "Export selected"
                        : "Export all"}
                  </Button>
                )}
                {(hasAccess || !accountsLoading) && (
                  <Button variant="outline" asChild>
                    <Link
                      to={
                        hasAccess
                          ? "/settings?tab=senders"
                          : "/settings?tab=integrations"
                      }
                    >
                      <LinkIcon className="h-4 w-4 mr-2" />
                      {hasAccess ? "Manage accounts" : "Set up integration"}
                    </Link>
                  </Button>
                )}
                {hasAccess && hasAccounts && activeTab === "campaigns" && (
                  <Button
                    variant="cta"
                    onClick={() => setShowCreateDialog(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New Campaign
                  </Button>
                )}
              </>
            }
          />

          {/* Keep historical campaigns and leads accessible when senders disconnect. */}
          {!accountsLoading &&
            !accountsError &&
            (!hasAccess || !hasAccounts) && (
              <Alert className="border-amber-500/20 bg-amber-500/5">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  <span className="font-medium">
                    {hasAccess
                      ? "Connect a social account to start capturing leads."
                      : "Set up your Unipile integration to send lead magnets."}
                  </span>{" "}
                  {hasAccess
                    ? "Choose an active LinkedIn or Instagram account in "
                    : "Add your Unipile API key in "}
                  <Link
                    to={
                      hasAccess
                        ? "/settings?tab=senders"
                        : "/settings?tab=integrations"
                    }
                    className="font-medium underline underline-offset-2"
                  >
                    {hasAccess
                      ? "social account settings"
                      : "integration settings"}
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            )}
          {accountsError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                We couldn’t load your connected accounts.
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchAccounts()}
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as TabValue)}
          >
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
              <TabsTrigger
                value="campaigns"
                className="gap-2 rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Settings2 className="hidden h-4 w-4 sm:block" />
                Campaigns
                {campaigns && (
                  <span className="text-xs text-muted-foreground">
                    {campaigns.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="leads"
                className="gap-2 rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Users className="hidden h-4 w-4 sm:block" />
                Captured leads
                {leadStats && (
                  <span className="text-xs text-muted-foreground">
                    {leadStats.total_leads.toLocaleString()}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="analytics"
                className="gap-2 rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <BarChart3 className="hidden h-4 w-4 sm:block" />
                Analytics
              </TabsTrigger>
            </TabsList>
            <TabsContent value="campaigns" className="mt-5">
              {campaignsError ? (
                <div className="rounded-xl border bg-card p-10 text-center">
                  <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" />
                  <h2 className="font-semibold">Campaigns couldn’t load</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Try again to see your campaigns and their latest results.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => refetchCampaigns()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                </div>
              ) : selectedCampaign ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCampaignId(null)}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      All campaigns
                    </Button>
                    <h2
                      ref={campaignHeadingRef}
                      tabIndex={-1}
                      className="min-w-0 break-words text-sm text-muted-foreground outline-none"
                    >
                      {selectedCampaign.name}
                    </h2>
                  </div>
                  <CampaignDetail
                    key={`${selectedCampaign.id}:${detailRevision}`}
                    campaign={selectedCampaign}
                    onEdit={() => setEditingCampaign(selectedCampaign)}
                  />
                </div>
              ) : (
                <CampaignList
                  campaigns={campaigns || []}
                  isLoading={isLoading}
                  onSelect={selectCampaign}
                  onEdit={setEditingCampaign}
                  onDelete={handleDelete}
                  onToggleStatus={handleToggleStatus}
                  onSetStatus={handleSetStatus}
                  onCreate={
                    hasAccess && hasAccounts
                      ? () => setShowCreateDialog(true)
                      : undefined
                  }
                  isUpdating={
                    toggleStatusMutation.isPending ||
                    setStatusMutation.isPending ||
                    deleteMutation.isPending
                  }
                />
              )}
            </TabsContent>

            {/* Leads Tab */}
            <TabsContent value="leads" className="mt-6 space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <LeadsHeader stats={leadStats} isLoading={statsLoading} />

                {/* View Toggle */}
                <div className="flex items-center gap-0.5 border rounded-lg p-0.5 flex-shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={
                          leadsViewMode === "table" ? "secondary" : "ghost"
                        }
                        size="icon"
                        className="h-10 w-10"
                        aria-label="Table view"
                        aria-pressed={leadsViewMode === "table"}
                        onClick={() => setLeadsViewMode("table")}
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Table view</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={
                          leadsViewMode === "pipeline" ? "secondary" : "ghost"
                        }
                        size="icon"
                        className="h-10 w-10"
                        aria-label="Pipeline view"
                        aria-pressed={leadsViewMode === "pipeline"}
                        onClick={() => setLeadsViewMode("pipeline")}
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Pipeline view</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <details className="text-sm text-muted-foreground">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <HelpCircle className="h-4 w-4" />
                  How lead capture works
                </summary>
                <p className="max-w-3xl pb-3 leading-relaxed">
                  Comments matching your keywords are captured here. Delivery
                  follows each campaign’s connection and message settings. You
                  can also manage captured contacts in your{" "}
                  <Link to="/contacts" className="underline underline-offset-2">
                    Contacts
                  </Link>{" "}
                  list.
                </p>
              </details>
              {leadsError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                    Captured leads couldn’t load.
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchLeads()}
                    >
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : leadsViewMode === "table" ? (
                <LeadsTable
                  leadsData={leadsData}
                  campaigns={campaigns || []}
                  isLoading={leadsLoading}
                  filters={leadsFilters}
                  onFiltersChange={setLeadsFilters}
                  selectedIds={selectedLeadIds}
                  onSelectionChange={setSelectedLeadIds}
                  onUpdateStatus={handleUpdateLeadStatus}
                  onDeleteSelected={handleDeleteSelected}
                  onExportSelected={handleExportSelected}
                  isDeleting={deleteLeadsMutation.isPending}
                  isExporting={exportLeadsMutation.isPending}
                  onRetryDm={(leadId) =>
                    retryDmMutation.mutate({ leadIds: [leadId] })
                  }
                  onBulkRetryDm={(ids) =>
                    retryDmMutation.mutate({ leadIds: ids })
                  }
                  isRetryingDm={retryDmMutation.isPending}
                />
              ) : (
                <LeadsPipeline
                  leads={leadsData?.data || []}
                  isLoading={leadsLoading}
                />
              )}
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="mt-6">
              {statsError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                    Analytics couldn’t load.
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchStats()}
                    >
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <LeadsAnalytics
                  stats={leadStats}
                  campaigns={campaigns || []}
                  isLoading={statsLoading}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Create Campaign Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() =>
              document.getElementById("name")?.focus(),
            );
          }}
          className="flex h-[min(740px,92dvh)] w-[calc(100%-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl p-0"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-5 text-left sm:px-6">
            <DialogTitle>Create Campaign</DialogTitle>
            <DialogDescription>
              Set up a new campaign to automatically DM users who comment on
              your posts.
            </DialogDescription>
          </DialogHeader>
          <CampaignForm
            accounts={eligibleAccounts}
            onSubmit={handleCreate}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Campaign Dialog */}
      <Dialog
        open={!!editingCampaign}
        onOpenChange={(open) => !open && setEditingCampaign(null)}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() =>
              document.getElementById("name")?.focus(),
            );
          }}
          className="flex h-[min(740px,92dvh)] w-[calc(100%-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl p-0"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-5 pr-12 text-left sm:px-6 sm:pr-12">
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>{editingCampaign?.name}</DialogDescription>
          </DialogHeader>
          {editingCampaign && (
            <CampaignForm
              accounts={eligibleAccounts}
              initialData={editingCampaign}
              onSubmit={handleUpdate}
              onCancel={() => setEditingCampaign(null)}
              isLoading={updateMutation.isPending || editRefreshing}
              submitError={editSaveError}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
