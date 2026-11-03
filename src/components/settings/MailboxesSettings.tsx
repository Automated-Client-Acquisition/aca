import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MailboxTable } from "@/components/email/MailboxTable";
import { ConnectMailboxDialog } from "@/components/email/ConnectMailboxDialog";
import { MailboxEditSheet } from "@/components/email/MailboxEditSheet";
import { BulkMailboxEditDialog } from "@/components/email/BulkMailboxEditDialog";
import { BulkSignatureDialog } from "@/components/email/BulkSignatureDialog";
import { MailboxBulkActionsBar } from "@/components/email/MailboxBulkActionsBar";
import { MailboxTagFilterPopover } from "@/components/email/MailboxTagFilterPopover";
import { MailboxDomainFilterPopover } from "@/components/email/MailboxDomainFilterPopover";
import { MailboxWorkspaceFilterPopover } from "@/components/email/MailboxWorkspaceFilterPopover";
import { BulkTagDialog } from "@/components/email/BulkTagDialog";
import { BulkSetAvatarDialog } from "@/components/email/BulkSetAvatarDialog";
import { MailboxExportSkippedDialog } from "@/components/email/MailboxExportSkippedDialog";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import {
  useEmailMailboxes,
  useEmailMailboxStats,
  useUpdateMailboxStatus,
  useDisconnectMailbox,
  useDeleteMailboxes,
  useBulkRetestConnection,
  useBulkUpdateMailboxes,
  useUpdateMailboxOwner,
  useBulkUpdateMailboxOwner,
  useExportMailboxesForMailflow,
  type MailboxExportSkipped,
} from "@/hooks/useEmailMailboxes";
import { useWatchMailboxAvatarSyncCompletion } from "@/hooks/useM365Mailboxes";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Mail, Plus, Inbox, Shield, Pause, Unplug, ExternalLink, Download, Loader2, Flame } from "lucide-react";
import { isStillWarming, WARMUP_GRADUATION_DAY } from "@/lib/mailbox-status";
import { cn } from "@/lib/utils";
import type { EmailMailbox, MailboxStatus } from "@/types/email";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useEmailSendingDomains } from "@/hooks/useEmailSendingDomains";
import { EmailCampaignsShowcase } from "@/components/showcase/EmailCampaignsShowcase";

type StatusFilter = "all" | MailboxStatus;

// "Ready" means ready to take campaign mail. A warmup mailbox keeps
// status='ready' while it warms, so it is counted under "Warming" instead.
function matchesStatusFilter(mailbox: EmailMailbox, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "ready") return mailbox.status === "ready" && !isStillWarming(mailbox);
  if (filter === "warming") {
    return mailbox.status === "warming" || (mailbox.status === "ready" && isStillWarming(mailbox));
  }
  return mailbox.status === filter;
}

function getMailboxWorkspaceName(mailbox: EmailMailbox): string | undefined {
  const value = mailbox.metadata?.zapmail_workspace_name;
  return typeof value === "string" ? value : undefined;
}

// Mailbox table, health and bulk actions. Lives in Settings > Sending;
// /email/mailboxes redirects here. Detail pages stay at /email/mailboxes/:id.
export function MailboxesSettings() {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseEmail = hasFeature("email_campaigns");
  const { data: mailboxes, isLoading } = useEmailMailboxes();
  const { data: stats } = useEmailMailboxStats();
  const updateStatusMutation = useUpdateMailboxStatus();
  const disconnectMutation = useDisconnectMailbox();
  const bulkRetestConnection = useBulkRetestConnection();
  const bulkUpdateMailboxes = useBulkUpdateMailboxes();
  const updateOwnerMutation = useUpdateMailboxOwner();
  const bulkUpdateOwnerMutation = useBulkUpdateMailboxOwner();
  const deleteMailboxes = useDeleteMailboxes();
  const { data: orgMembers } = useOrganizationMembers();
  const [skippedExport, setSkippedExport] = useState<MailboxExportSkipped[]>([]);
  const [skippedDialogOpen, setSkippedDialogOpen] = useState(false);
  const exportMailflow = useExportMailboxesForMailflow({
    onSkipped: (skipped) => {
      setSkippedExport(skipped);
      setSkippedDialogOpen(true);
    },
  });
  const { data: sendingDomains } = useEmailSendingDomains();

  const [connectOpen, setConnectOpen] = useState(false);
  // ?status=disconnected|paused lands here pre-filtered from the
  // sending-health alerts on Automations / Sequences.
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const status = searchParams.get("status");
    return status === "disconnected" || status === "paused" ? status : "all";
  });
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [editMailbox, setEditMailbox] = useState<EmailMailbox | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkSignatureOpen, setBulkSignatureOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkSetAvatarOpen, setBulkSetAvatarOpen] = useState(false);
  const [avatarSyncJobId, setAvatarSyncJobId] = useState<string | null>(null);
  const { job: avatarSyncJob } = useWatchMailboxAvatarSyncCompletion(avatarSyncJobId, () => setAvatarSyncJobId(null));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Derive unique workspace names from mailbox metadata
  const workspaceNames = (() => {
    if (!mailboxes) return [];
    const names = new Set<string>();
    for (const m of mailboxes) {
      const wsName = getMailboxWorkspaceName(m);
      if (wsName) names.add(wsName);
    }
    return Array.from(names).sort();
  })();

  const domainMap = useMemo(() => {
    const map = new Map<string, string>();
    sendingDomains?.forEach((d) => map.set(d.id, d.domain));
    return map;
  }, [sendingDomains]);

  // Carry the explicit domain hold into each mailbox row.
  const domainBlockMap = useMemo(() => {
    const map = new Map<string, { domain: string; pausedAt: string | null; reason: string | null }>();
    sendingDomains?.forEach((d) => {
      map.set(d.id, {
        domain: d.domain,
        pausedAt: d.sending_paused_at ?? null,
        reason: d.sending_pause_reason ?? null,
      });
    });
    return map;
  }, [sendingDomains]);

  const domainOptions = useMemo(() => {
    if (!mailboxes || !sendingDomains) return [];
    const usedDomainIds = new Set(
      mailboxes.map((m) => m.sending_domain_id).filter(Boolean)
    );
    return sendingDomains
      .filter((d) => usedDomainIds.has(d.id))
      .map((d) => ({ id: d.id, domain: d.domain }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }, [mailboxes, sendingDomains]);

  const domainMailboxCounts = useMemo(() => {
    if (!mailboxes) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const m of mailboxes) {
      if (m.sending_domain_id) {
        counts.set(m.sending_domain_id, (counts.get(m.sending_domain_id) || 0) + 1);
      }
    }
    return counts;
  }, [mailboxes]);

  const workspaceMailboxCounts = useMemo(() => {
    if (!mailboxes) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const m of mailboxes) {
      const ws = getMailboxWorkspaceName(m);
      if (ws) counts.set(ws, (counts.get(ws) || 0) + 1);
    }
    return counts;
  }, [mailboxes]);

  const filtered = useMemo(() => mailboxes?.filter((m) => {
    if (!matchesStatusFilter(m, statusFilter)) return false;
    if (selectedTags.length > 0 && (!m.tags || !selectedTags.every((tag) => m.tags.includes(tag)))) return false;
    if (selectedWorkspaces.length > 0 && !selectedWorkspaces.includes(getMailboxWorkspaceName(m) || "")) return false;
    if (selectedDomains.length > 0 && (!m.sending_domain_id || !selectedDomains.includes(m.sending_domain_id))) return false;
    return true;
  }), [mailboxes, selectedDomains, selectedTags, selectedWorkspaces, statusFilter]);

  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } =
    useTablePagination("email-mailboxes", 50);

  const totalFiltered = filtered?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));

  // Reset to page 1 whenever the underlying filter set shrinks past the current page.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [currentPage, totalPages, setCurrentPage]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    resetPage();
  }, [statusFilter, selectedTags, selectedWorkspaces, selectedDomains, resetPage]);

  const paginated = useMemo(() => {
    if (!filtered) return [];
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const visibleMailboxIds = useMemo(
    () => new Set((filtered || []).map((m) => m.id)),
    [filtered]
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;

      const next = new Set(
        Array.from(prev).filter((id) => visibleMailboxIds.has(id))
      );

      return next.size === prev.size ? prev : next;
    });
  }, [visibleMailboxIds]);

  const statusFilters: { key: StatusFilter; label: string; count: number; icon: React.ElementType; title?: string }[] = [
    { key: "all", label: "All", count: stats?.total || 0, icon: Mail },
    {
      key: "ready",
      label: "Ready",
      count: stats?.readySending || 0,
      icon: Shield,
      title: "Connected and done warming: these take campaign mail today",
    },
    ...(stats?.warming || statusFilter === "warming"
      ? [{
          key: "warming" as StatusFilter,
          label: "Warming",
          count: stats?.warming || 0,
          icon: Flame,
          title: `Still building reputation: auto sending pools skip these until warmup day ${WARMUP_GRADUATION_DAY}`,
        }]
      : []),
    { key: "paused", label: "Paused", count: stats?.paused || 0, icon: Pause },
    // Only worth a pill when there is something to reconnect.
    ...(stats?.disconnected || statusFilter === "disconnected"
      ? [{ key: "disconnected" as StatusFilter, label: "Disconnected", count: stats?.disconnected || 0, icon: Unplug }]
      : []),
  ];

  const handlePause = (id: string) => {
    updateStatusMutation.mutate({ id, status: "paused" });
  };

  const handleResume = (id: string) => {
    updateStatusMutation.mutate({ id, status: "ready" });
  };

  const handleDisconnect = (id: string) => {
    setDisconnectTarget(id);
  };

  const confirmDisconnect = () => {
    if (disconnectTarget) {
      disconnectMutation.mutate(disconnectTarget);
      setDisconnectTarget(null);
    }
  };

  // Both bulk paths record WHY, same as the single-mailbox ones. A manual pause
  // has to be distinguishable from an automatic one — email-warmup-tick releases
  // automatic pauses and must never touch one the operator set.
  const handleBulkPause = () => {
    bulkUpdateMailboxes.mutate(
      {
        ids: Array.from(selectedIds),
        columnUpdates: { status: "paused" },
        metadataUpdates: { paused_reason: "manual", paused_at: new Date().toISOString() },
      },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkResume = () => {
    bulkUpdateMailboxes.mutate(
      {
        ids: Array.from(selectedIds),
        columnUpdates: { status: "ready", last_error: null },
        // bulk_update_mailboxes merges metadata, so null the keys rather than
        // trying to unset them — a stale reason on a live mailbox misleads.
        metadataUpdates: { paused_reason: null, paused_at: null, paused_stats: null },
      },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkTestConnection = () => {
    bulkRetestConnection.mutate(Array.from(selectedIds));
  };

  // Warmup is the `warmup_enabled` flag, not the `status` column. The warmup
  // engine (email-warmup-send-tick) only reads warmup_enabled; writing
  // status='warming' produced a badge and no warmup mail, and the status then
  // drifted back to 'ready' on the next connectivity write. Leave status alone —
  // a mailbox warms in the background while it keeps sending campaigns.
  const handleBulkStartWarming = () => {
    bulkUpdateMailboxes.mutate(
      { ids: Array.from(selectedIds), columnUpdates: { warmup_enabled: true } },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkStopWarming = () => {
    bulkUpdateMailboxes.mutate(
      { ids: Array.from(selectedIds), columnUpdates: { warmup_enabled: false } },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkAssignOwner = (userId: string | null) => {
    bulkUpdateOwnerMutation.mutate(
      { ids: Array.from(selectedIds), userId },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkDelete = () => {
    deleteMailboxes.mutate(Array.from(selectedIds), {
      onSuccess: () => {
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
      },
    });
  };

  if (!canUseEmail && showUpgradePrompts) {
    return <EmailCampaignsShowcase />;
  }

  if (!canUseEmail) {
    return (
      <p className="text-muted-foreground text-center py-12">
        This feature is not available for your organization.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Mailboxes</h2>
            <p className="text-muted-foreground">
              Every mailbox your sequences send from, with its health, warmup and limits.
            </p>
          </div>
          <Button variant="cta" className="shrink-0" onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Connect Mailbox
          </Button>
        </div>

        {/* Status Filter Pills + Tag Filter */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {statusFilters.map((filter) => (
              <button
                key={filter.key}
                title={filter.title}
                onClick={() => setStatusFilter(filter.key)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5",
                  statusFilter === filter.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {filter.label}
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    statusFilter === filter.key ? "opacity-80" : "opacity-60"
                  )}
                >
                  {filter.count}
                </span>
              </button>
            ))}
          </div>
          <MailboxTagFilterPopover
            selectedTags={selectedTags}
            onSelectedTagsChange={setSelectedTags}
          />
          <MailboxDomainFilterPopover
            selectedDomainIds={selectedDomains}
            onSelectedDomainsChange={setSelectedDomains}
            domainOptions={domainOptions}
            domainMailboxCounts={domainMailboxCounts}
          />
          {workspaceNames.length > 1 && (
            <MailboxWorkspaceFilterPopover
              selectedWorkspaces={selectedWorkspaces}
              onSelectedWorkspacesChange={setSelectedWorkspaces}
              workspaceOptions={workspaceNames}
              workspaceMailboxCounts={workspaceMailboxCounts}
            />
          )}
        </div>

        {/* Mailflow Recommendation Banner */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Warm up your mailboxes with Mailflow</p>
            <p className="text-xs text-muted-foreground">
              Free for up to 100 mailboxes. Warm up your domains before sending campaigns for better deliverability.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={exportMailflow.isPending || !mailboxes?.length}
              onClick={() =>
                exportMailflow.mutate(
                  selectedIds.size > 0 ? Array.from(selectedIds) : undefined
                )
              }
            >
              {exportMailflow.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {selectedIds.size > 0
                ? `Export ${selectedIds.size} selected`
                : "Export all CSV"}
            </Button>
            <a
              href="https://www.mailflow.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Mailflow
              </Button>
            </a>
          </div>
        </div>

        {/* Microsoft 365 avatar sync progress */}
        {avatarSyncJob && (avatarSyncJob.status === "pending" || avatarSyncJob.status === "running") && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                Syncing avatars to Microsoft 365...
              </span>
              <span className="font-medium text-blue-400">
                {avatarSyncJob.processed_index}/{avatarSyncJob.total}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${(avatarSyncJob.processed_index / avatarSyncJob.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Mailbox Table */}
        {isLoading ? (
          <div className="border rounded-lg">
            <div className="space-y-0">
              {/* Header skeleton */}
              <div className="flex items-center gap-4 px-4 py-3 border-b bg-muted/30">
                {[40, 260, 110, 140, 160, 80, 80, 80, 120, 50].map((w, i) => (
                  <Skeleton key={i} className="h-4" style={{ width: w * 0.4 }} />
                ))}
              </div>
              {/* Row skeletons */}
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4 border-b last:border-0">
                  <Skeleton className="w-4 h-4 rounded" />
                  <div className="flex items-center gap-3 w-[260px]">
                    <Skeleton className="w-8 h-8 rounded-md" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-2 w-24 rounded-full" />
                  <Skeleton className="h-2 w-28 rounded-full" />
                  <Skeleton className="h-4 w-10 ml-auto" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              ))}
            </div>
          </div>
        ) : filtered && filtered.length > 0 ? (
          <>
            <MailboxTable
              mailboxes={paginated}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onEditSettings={setEditMailbox}
              onPause={handlePause}
              onResume={handleResume}
              onDisconnect={handleDisconnect}
              onReconnect={(id) => bulkRetestConnection.mutate([id])}
              onOwnerChange={(mailboxId, userId) =>
                updateOwnerMutation.mutate({ mailboxId, userId })
              }
              connectionTestStatuses={bulkRetestConnection.testStatuses}
              domainMap={domainMap}
              domainBlockMap={domainBlockMap}
              totalFilteredCount={totalFiltered}
              onSelectAllFiltered={() =>
                setSelectedIds(new Set((filtered || []).map((m) => m.id)))
              }
            />
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={totalFiltered}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        ) : (
          <div className="text-center py-20 bg-gradient-to-b from-muted/30 to-muted/10 rounded-2xl border border-dashed">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-muted/50 flex items-center justify-center">
              <Inbox className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {statusFilter !== "all"
                ? `No ${statusFilter} mailboxes`
                : "No mailboxes connected"}
            </h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
              {statusFilter !== "all"
                ? "Try changing your filter to see other mailboxes"
                : "Connect your first mailbox via SMTP or ZapMail to start sending emails with automatic warmup"}
            </p>
            {statusFilter === "all" && (
              <Button
                variant="cta"
                onClick={() => setConnectOpen(true)}
                size="lg"
                className="shadow-lg"
              >
                <Plus className="h-4 w-4 mr-2" />
                Connect First Mailbox
              </Button>
            )}
          </div>
        )}
      </div>

      <ConnectMailboxDialog open={connectOpen} onOpenChange={setConnectOpen} />

      <DeleteConfirmDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        onConfirm={confirmDisconnect}
        itemName="this mailbox"
        itemType="mailbox"
      />

      <MailboxEditSheet
        mailbox={editMailbox}
        open={!!editMailbox}
        onOpenChange={(open) => !open && setEditMailbox(null)}
      />

      <BulkMailboxEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedIds={Array.from(selectedIds)}
      />

      <BulkSignatureDialog
        open={bulkSignatureOpen}
        onOpenChange={setBulkSignatureOpen}
        selectedIds={Array.from(selectedIds)}
        selectedEmails={
          mailboxes
            ?.filter((m) => selectedIds.has(m.id))
            .map((m) => m.email_address) || []
        }
        selectedMailboxes={
          mailboxes?.filter((m) => selectedIds.has(m.id)) || []
        }
      />

      <BulkTagDialog
        open={bulkTagOpen}
        onOpenChange={setBulkTagOpen}
        selectedIds={Array.from(selectedIds)}
        selectedEmails={
          mailboxes
            ?.filter((m) => selectedIds.has(m.id))
            .map((m) => m.email_address) || []
        }
      />

      <BulkSetAvatarDialog
        open={bulkSetAvatarOpen}
        onOpenChange={setBulkSetAvatarOpen}
        selectedIds={Array.from(selectedIds)}
        selectedEmails={
          mailboxes
            ?.filter((m) => selectedIds.has(m.id))
            .map((m) => m.email_address) || []
        }
        onJobStarted={setAvatarSyncJobId}
      />

      <MailboxBulkActionsBar
        selectedCount={selectedIds.size}
        onClearSelection={() => { setSelectedIds(new Set()); bulkRetestConnection.clearTestStatuses(); }}
        onBulkEdit={() => setBulkEditOpen(true)}
        onBulkSignature={() => setBulkSignatureOpen(true)}
        onBulkTag={() => setBulkTagOpen(true)}
        onBulkSetAvatar={() => setBulkSetAvatarOpen(true)}
        onBulkPause={handleBulkPause}
        onBulkResume={handleBulkResume}
        onBulkStartWarming={handleBulkStartWarming}
        onBulkStopWarming={handleBulkStopWarming}
        onBulkTestConnection={handleBulkTestConnection}
        isTestingConnection={bulkRetestConnection.isPending}
        onBulkExportMailflow={() => exportMailflow.mutate(Array.from(selectedIds))}
        isExporting={exportMailflow.isPending}
        onBulkDelete={() => setBulkDeleteOpen(true)}
        onBulkAssignOwner={handleBulkAssignOwner}
        members={orgMembers}
      />

      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={handleBulkDelete}
        itemName={`${selectedIds.size} mailbox${selectedIds.size > 1 ? "es" : ""}`}
        itemType="mailbox"
      />

      <MailboxExportSkippedDialog
        open={skippedDialogOpen}
        onOpenChange={setSkippedDialogOpen}
        skipped={skippedExport}
      />
    </>
  );
}
