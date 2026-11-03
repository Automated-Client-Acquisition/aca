import { useState, useEffect, useMemo } from "react";
import {
  Users,
  Search,
  Plus,
  Download,
  Upload,
  MoreVertical,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Linkedin,
  ListIcon,
  ListPlus,
  Sparkles,
  Database,
  User,
  UserCheck,
  UserPlus,
  Ban,
  Activity,
  ExternalLink,
  MessageCircle,
  MessageCircleOff,
  Reply,
  Brain,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Target,
  Mail,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeatureGate } from "@/components/UpgradePrompt";
import { LeadListsTable } from "@/components/lead-lists/LeadListsTable";
import { CreateListDialog } from "@/components/lead-lists/CreateListDialog";
import { CreateSmartListDialog } from "@/components/lead-lists/CreateSmartListDialog";
import { EditListDialog } from "@/components/lead-lists/EditListDialog";
import { DeleteListDialog } from "@/components/lead-lists/DeleteListDialog";
import { MergeListsDialog } from "@/components/lead-lists/MergeListsDialog";
import { BulkDeleteListsDialog } from "@/components/lead-lists/BulkDeleteListsDialog";
import { AddContactDialog } from "@/components/contacts/AddContactDialog";
import { ExportContactsDialog } from "@/components/contacts/ExportContactsDialog";
import { SendConnectionRequestDialog } from "@/components/contacts/SendConnectionRequestDialog";
import {
  useLeadLists,
  useCreateLeadList,
  useCreateSmartList,
  useUpdateLeadList,
  useDeleteLeadList,
  useArchiveLeadList,
  useBulkDeleteLeadLists,
  useContactListMemberships,
  type LeadList,
  type SmartListFilterCriteria,
  type ContactListMembership,
} from "@/hooks/useLeadLists";
import {
  useContacts,
  useUpdateContact,
  useCreateContact,
  useAddContactTag,
  useRemoveContactTag,
  useDeleteContact,
  useBulkDeleteContacts,
  useBulkSetContactCustomField,
  useFetchAllFilteredContactIds,
  type CrmContact,
  type ContactSortField,
  type SortDirection,
  type PaginatedContacts,
  type ContactType,
  type CreateContactInput,
  type OutreachStatus,
  type AiAnalysisStatus,
} from "@/hooks/crm/useContacts";
import { useStartConversation } from "@/hooks/crm/useConversations";
import { useExportContacts } from "@/hooks/useExportContacts";
import { useUnipileAccounts, useSyncUnipileConnections } from "@/hooks/useUnipileAccounts";
import { useSendConnectionRequest } from "@/hooks/useLinkedInInvitations";

import { cn } from "@/lib/utils";
import { useColumnResize } from "@/hooks/useColumnResize";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ColumnSelector, type ColumnConfig } from "@/components/ColumnSelector";
import {
  EditableTextCell,
  EditableTagsCell,
  EditableStatusCell,
  EditableLocationCell,
} from "@/components/editable-cells";
import { ContactCell } from "@/components/contacts/ContactCell";
import { ContactsBulkActionsBar } from "@/components/contacts/ContactsBulkActionsBar";
import { Checkbox } from "@/components/ui/checkbox";
import { AdvancedFilters, type EnrichmentFilters } from "@/components/contacts/AdvancedFilters";
import { ListFilterDropdown, type ListFilter } from "@/components/contacts/ListFilterDropdown";
import { TagFilterDropdown } from "@/components/contacts/TagFilterDropdown";
import { AnalyzeCompaniesDialog } from "@/components/lead-lists/AnalyzeCompaniesDialog";
import { useActiveCompanyAnalysisJobs } from "@/hooks/useCompanyAnalysisJobs";
import { GenerateEmailSequenceDialog } from "@/components/lead-lists/GenerateEmailSequenceDialog";
import { GenerateAndSendDialog } from "@/components/lead-lists/GenerateAndSendDialog";
import { PushSequencesToEmailToolDialog } from "@/components/lead-lists/PushSequencesToEmailToolDialog";
import { BulkEnrollEmailSequenceDialog } from "@/components/email/BulkEnrollEmailSequenceDialog";
import { GenerateNotionPagesDialog } from "@/components/lead-lists/GenerateNotionPagesDialog";
import { FindEmailsDialog } from "@/components/lead-lists/FindEmailsDialog";
import { VerifyEmailsDialog } from "@/components/lead-lists/VerifyEmailsDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useAddLeadListMember, useBulkAddLeadListMembers } from "@/hooks/useLeadListMembers";
import { useContactScoresForProduct, type ContactProductScore } from "@/hooks/useContactProductScores";
import { useProducts } from "@/hooks/useProducts";
import { useEmailSequencesCounts, useBulkClearSequences, useBulkDeleteNotionPages, useCheckFirewalls, useVerifyEmails, type SequenceCountInfo } from "@/hooks/useEmailSequences";
import { useCustomFieldDefs, type CustomFieldDef } from "@/hooks/useCustomFieldDefs";
import { SetCustomFieldDialog } from "@/components/contacts/SetCustomFieldDialog";

import { Link, useSearchParams, useNavigate } from "react-router-dom";

// Column configuration for the contacts table
const CONTACT_COLUMNS: ColumnConfig[] = [
  { key: 'contact', label: 'Contact', alwaysVisible: true },
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Job Title' },
  { key: 'website', label: 'Website' },
  { key: 'phone', label: 'Phone' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'location', label: 'Location' },
  { key: 'tags', label: 'Tags' },
  { key: 'lists', label: 'Lists' },
  { key: 'linked_accounts', label: 'Linked Accounts' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'ai_analyzed', label: 'AI Analyzed' },
  { key: 'ai_insights', label: 'AI Insights' },
  { key: 'icp_score', label: 'ICP Score' },
  { key: 'dm_score', label: 'DM Fit' },
  { key: 'source', label: 'Source' },
  { key: 'score', label: 'Score' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'seg_firewall', label: 'Email Firewall' },
  { key: 'notion_url', label: 'Notion URL' },
  { key: 'last_activity', label: 'Last Activity' },
  { key: 'connected', label: 'Connected' },
];

const DEFAULT_VISIBLE_COLUMNS = ['contact', 'company', 'lists', 'type', 'outreach', 'ai_analyzed', 'score', 'sequences', 'seg_firewall', 'notion_url', 'last_activity'];

// Default column widths in pixels for resizable columns
const CONTACT_DEFAULT_WIDTHS: Record<string, number> = {
  _checkbox: 48,
  contact: 280,
  company: 200,
  job_title: 150,
  website: 130,
  phone: 140,
  location: 130,
  tags: 150,
  lists: 150,
  linked_accounts: 160,
  type: 100,
  status: 110,
  outreach: 110,
  ai_analyzed: 120,
  ai_insights: 200,
  icp_score: 90,
  source: 110,
  score: 90,
  sequences: 110,
  seg_firewall: 130,
  notion_url: 120,
  last_activity: 120,
  connected: 120,
  _actions: 50,
};

// LocalStorage key for column preferences
const COLUMN_PREFS_KEY = 'contacts-table-columns';

type ContactStatus = CrmContact['status'];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

type SourceFilter = "all" | "linkedin_connection" | "linkedin_comment" | "instagram_comment" | "manual" | "import";

const VALID_SOURCES: SourceFilter[] = ["all", "linkedin_connection", "linkedin_comment", "instagram_comment", "manual", "import"];

type TabValue = "all" | "lists" | "network";

export default function Contacts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize tab from URL params (for redirects from old routes)
  const initialTab = searchParams.get("tab") as TabValue | null;
  const validInitialTab: TabValue = initialTab && ["all", "lists", "network"].includes(initialTab) ? initialTab : "all";
  const [activeTab, setActiveTab] = useState<TabValue>(validInitialTab);

  // Initialize source filter from URL params (for redirect from /network)
  const initialSource = searchParams.get("source") as SourceFilter | null;
  const validInitialSource = initialSource && VALID_SOURCES.includes(initialSource) ? initialSource : "all";

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContactStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(validInitialSource);
  const [typeFilter, setTypeFilter] = useState<ContactType | "all">("all");
  const [outreachFilter, setOutreachFilter] = useState<OutreachStatus | "all">("all");
  const [aiAnalysisFilter, setAiAnalysisFilter] = useState<AiAnalysisStatus | "all">("all");
  const [linkedAccountFilter, setLinkedAccountFilter] = useState<string | "all">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<ContactSortField>("first_seen_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [advancedFilters, setAdvancedFilters] = useState<EnrichmentFilters>({});
  const [listFilter, setListFilter] = useState<ListFilter | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const hasActiveFilters = !!(
    searchQuery ||
    statusFilter !== "all" ||
    sourceFilter !== "all" ||
    typeFilter !== "all" ||
    outreachFilter !== "all" ||
    aiAnalysisFilter !== "all" ||
    linkedAccountFilter !== "all" ||
    listFilter ||
    tagFilter.length > 0 ||
    Object.values(advancedFilters).some(v => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0))
  );

  // Org custom fields become extra, user-toggleable table columns
  const { data: customFieldDefsForColumns } = useCustomFieldDefs();
  const allColumns = useMemo<ColumnConfig[]>(() => {
    const customCols: ColumnConfig[] = (customFieldDefsForColumns || []).map((def) => ({
      key: `custom_${def.field_key}`,
      label: def.display_name,
    }));
    return [...CONTACT_COLUMNS, ...customCols];
  }, [customFieldDefsForColumns]);

  // Column visibility state - load from localStorage
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_PREFS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (!parsed.includes('seg_firewall')) {
          const insertIdx = parsed.indexOf('last_activity');
          if (insertIdx !== -1) {
            parsed.splice(insertIdx, 0, 'seg_firewall');
          } else {
            parsed.push('seg_firewall');
          }
        }
        return parsed;
      }
    } catch {}
    return DEFAULT_VISIBLE_COLUMNS;
  });

  // Save column preferences to localStorage
  const handleColumnVisibilityChange = (columns: string[]) => {
    setVisibleColumns(columns);
    localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(columns));
  };

  // Clear URL params after initial load (keep URL clean)
  useEffect(() => {
    let shouldUpdate = false;
    if (searchParams.has("source")) {
      searchParams.delete("source");
      shouldUpdate = true;
    }
    if (searchParams.has("tab")) {
      searchParams.delete("tab");
      shouldUpdate = true;
    }
    if (shouldUpdate) {
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  // Detect active analysis jobs to enable row-level status polling
  const { data: activeAnalysisJobs } = useActiveCompanyAnalysisJobs();
  const hasActiveAnalysisJobs = (activeAnalysisJobs?.length ?? 0) > 0;

  // Data fetching — poll every 3s while analysis jobs are running so row badges update in real time
  const { data: contactsData, isLoading } = useContacts({
    // Enrichment filters first (spread), then explicit overrides after
    ...advancedFilters,
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: searchQuery || undefined,
    linkedinOnly: sourceFilter === "linkedin_connection",
    source: sourceFilter !== "all" && sourceFilter !== "linkedin_connection" ? sourceFilter : undefined,
    contactType: typeFilter !== "all" ? typeFilter : undefined,
    outreachStatus: outreachFilter !== "all" ? outreachFilter : undefined,
    // Inline dropdown wins when set; otherwise fall back to the advanced
    // panel's value (an unconditional override would clobber the spread above
    // with undefined whenever the dropdown sits at "all")
    aiAnalysisStatus: aiAnalysisFilter !== "all" ? aiAnalysisFilter : advancedFilters.aiAnalysisStatus,
    linkedAccountId: linkedAccountFilter !== "all" ? linkedAccountFilter : undefined,
    page: currentPage,
    pageSize,
    sortBy,
    sortDirection,
    // List membership filters
    inListIds: listFilter?.inListIds,
    notInListIds: listFilter?.notInListIds,
    // Tag filter
    tags: tagFilter.length > 0 ? tagFilter : undefined,
    // Live polling during active analysis
    refetchInterval: hasActiveAnalysisJobs ? 3000 : undefined,
  });

  // Unipile accounts for LinkedIn sync
  const { data: unipileData } = useUnipileAccounts();
  const [syncProgress, setSyncProgress] = useState<{ total: number; isComplete: boolean } | null>(null);
  const syncConnections = useSyncUnipileConnections((progress) => {
    setSyncProgress({ total: progress.totalProcessed, isComplete: progress.isComplete });
  });

  // Lead Lists data and mutations
  const { leadLists, isLoading: listsLoading } = useLeadLists();
  const createListMutation = useCreateLeadList();
  const createSmartListMutation = useCreateSmartList();
  const updateListMutation = useUpdateLeadList();
  const deleteListMutation = useDeleteLeadList();
  const archiveListMutation = useArchiveLeadList();
  const bulkDeleteListsMutation = useBulkDeleteLeadLists();
  const [showCreateListDialog, setShowCreateListDialog] = useState(false);
  const [showCreateSmartListDialog, setShowCreateSmartListDialog] = useState(false);
  const [editingList, setEditingList] = useState<LeadList | null>(null);
  const [deletingList, setDeletingList] = useState<LeadList | null>(null);
  const [mergingLists, setMergingLists] = useState<LeadList[] | null>(null);
  const [deletingLists, setDeletingLists] = useState<LeadList[] | null>(null);

  // Add Contact and Export dialogs
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "filtered" | "all">("all");
  const createContactMutation = useCreateContact();
  const exportContactsMutation = useExportContacts();

  // Auto-correct page when current page is beyond available data
  // (e.g. after bulk delete leaves the current page empty)
  useEffect(() => {
    if (contactsData && contactsData.total > 0 && contactsData.data.length === 0 && currentPage > 1) {
      const lastPage = Math.max(1, Math.ceil(contactsData.total / pageSize));
      setCurrentPage(Math.min(currentPage, lastPage));
    }
  }, [contactsData, currentPage, pageSize]);

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Select all (or first N) across pages
  const fetchAllIds = useFetchAllFilteredContactIds();
  const currentFilters = {
    ...advancedFilters,
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: searchQuery || undefined,
    linkedinOnly: sourceFilter === "linkedin_connection",
    source: sourceFilter !== "all" && sourceFilter !== "linkedin_connection" ? sourceFilter : undefined,
    contactType: typeFilter !== "all" ? typeFilter : undefined,
    outreachStatus: outreachFilter !== "all" ? outreachFilter : undefined,
    aiAnalysisStatus: aiAnalysisFilter !== "all" ? aiAnalysisFilter : advancedFilters.aiAnalysisStatus,
    linkedAccountId: linkedAccountFilter !== "all" ? linkedAccountFilter : undefined,
    inListIds: listFilter?.inListIds,
    notInListIds: listFilter?.notInListIds,
    tags: tagFilter.length > 0 ? tagFilter : undefined,
  };
  const handleSelectAllPages = () => {
    fetchAllIds.mutate(currentFilters, {
      onSuccess: (ids) => setSelectedIds(new Set(ids)),
    });
  };
  const handleSelectFirstN = (n: number) => {
    fetchAllIds.mutate(currentFilters, {
      onSuccess: (ids) => setSelectedIds(new Set(ids.slice(0, n))),
    });
  };

  // Action dialogs state
  const [showAnalyzeDialog, setShowAnalyzeDialog] = useState(false);
  const [showGenerateSequenceDialog, setShowGenerateSequenceDialog] = useState(false);
  const [showGenerateAndSendDialog, setShowGenerateAndSendDialog] = useState(false);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [showEnrollEmailSequenceDialog, setShowEnrollEmailSequenceDialog] = useState(false);
  const [showNotionPagesDialog, setShowNotionPagesDialog] = useState(false);
  const [showRegenerateNotionDialog, setShowRegenerateNotionDialog] = useState(false);
  const [singleRegenerateContactId, setSingleRegenerateContactId] = useState<string | null>(null);
  const [showFindEmailsDialog, setShowFindEmailsDialog] = useState(false);
  const [showVerifyEmailsDialog, setShowVerifyEmailsDialog] = useState(false);
  const [showSetCustomFieldDialog, setShowSetCustomFieldDialog] = useState(false);
  const bulkSetCustomField = useBulkSetContactCustomField();
  // Firewall check (async toast-based)
  const { run: runFirewallCheck } = useCheckFirewalls();
  const { run: runVerifyEmails } = useVerifyEmails();

  // Bulk add to list mutation
  const bulkAddToList = useBulkAddLeadListMembers();
  const addToListMutation = useAddLeadListMember();

  // Delete mutations
  const deleteContact = useDeleteContact();
  const bulkDeleteContacts = useBulkDeleteContacts();
  const bulkClearSequences = useBulkClearSequences();
  const bulkDeleteNotionPages = useBulkDeleteNotionPages();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string } | null>(null);

  // Get static lists only (can't manually add to smart lists)
  const staticLists = leadLists?.filter(list => !list.is_smart) || [];

  const handleSyncLinkedInConnections = async () => {
    const linkedinAccount = unipileData?.linkedinAccount;
    if (!linkedinAccount) {
      toast.error("No LinkedIn account connected. Go to Settings > Integrations to connect your LinkedIn.");
      return;
    }

    const toastId = toast.loading("Starting LinkedIn sync...");
    setSyncProgress({ total: 0, isComplete: false });

    try {
      const data = await syncConnections.mutateAsync(linkedinAccount.id);
      const stats = data?.stats;
      toast.success(
        `Synced ${stats?.contactsImported || 0} new contacts, updated ${stats?.contactsUpdated || 0} (${stats?.totalProcessed || 0} total)`,
        { id: toastId }
      );
    } catch (err) {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`, { id: toastId });
    } finally {
      setSyncProgress(null);
    }
  };

  // Handle sort
  const handleSort = (field: ContactSortField) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDirection("desc");
    }
    setCurrentPage(1); // Reset to first page on sort change
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Handle page size change
  const handlePageSizeChange = (size: string) => {
    setPageSize(Number(size));
    setCurrentPage(1); // Reset to first page
  };

  // Reset page when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: ContactStatus | "all") => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handleSourceChange = (value: SourceFilter) => {
    setSourceFilter(value);
    setCurrentPage(1);
  };

  // Lead List handlers
  const handleCreateList = (data: { name: string; description?: string }) => {
    createListMutation.mutate(data, {
      onSuccess: () => setShowCreateListDialog(false),
    });
  };

  const handleCreateSmartList = (data: {
    name: string;
    description?: string;
    filter_criteria: SmartListFilterCriteria;
  }) => {
    createSmartListMutation.mutate(data, {
      onSuccess: (created) => {
        setShowCreateSmartListDialog(false);
        navigate(`/leads/lists/${created.id}`);
      },
    });
  };

  const handleEditList = (data: { id: string; name?: string; description?: string }) => {
    updateListMutation.mutate(data, {
      onSuccess: () => setEditingList(null),
    });
  };

  const handleDeleteList = () => {
    if (!deletingList) return;
    deleteListMutation.mutate(deletingList.id, {
      onSuccess: () => setDeletingList(null),
    });
  };

  const handleBulkDeleteLists = () => {
    if (!deletingLists) return;
    bulkDeleteListsMutation.mutate(
      deletingLists.map((l) => l.id),
      { onSuccess: () => setDeletingLists(null) }
    );
  };

  const handleArchiveList = (list: LeadList) => {
    archiveListMutation.mutate(list.id);
  };

  // Add Contact handler
  const handleAddContact = (data: CreateContactInput) => {
    createContactMutation.mutate(data, {
      onSuccess: () => setShowAddContactDialog(false),
    });
  };

  // Export handler
  const handleExportContacts = (data: { email: string; format: "csv" | "json"; columns: string[] }) => {
    const runExport = (contactIds?: string[]) => {
      exportContactsMutation.mutate({
        email: data.email,
        format: data.format,
        columns: data.columns,
        contactIds,
      }, {
        onSuccess: () => {
          setShowExportDialog(false);
          // Clear selection after exporting selected contacts
          if (exportMode === "selected") {
            setSelectedIds(new Set());
          }
        },
      });
    };

    if (exportMode === "selected") {
      runExport(Array.from(selectedIds));
    } else if (exportMode === "filtered") {
      // Resolve the exact on-screen filtered set (incl. advanced filters, tags,
      // list membership, outreach/AI status — the edge function only understands
      // a handful of filter keys, so exporting by explicit IDs is what keeps
      // "export filtered" identical to what the table shows).
      fetchAllIds.mutate(currentFilters, {
        onSuccess: (ids) => {
          if (ids.length === 0) {
            toast.error("No contacts match the current filters");
            return;
          }
          runExport(ids);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to resolve filtered contacts");
        },
      });
    } else {
      // "all" — export the whole org, no filters
      runExport(undefined);
    }
  };

  // Tab change handler
  const handleTabChange = (value: string) => {
    setActiveTab(value as TabValue);
    // Reset filters when switching tabs
    if (value === "network") {
      setSourceFilter("linkedin_connection");
    } else if (value === "all") {
      setSourceFilter("all");
    }
    setCurrentPage(1);
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <FeatureGate feature="messaging">
        <div className="flex-1 p-6 space-y-6">
          {/* Header */}
          <PageHeader
            icon={Users}
            title="People"
            description="Contacts, lead lists, and LinkedIn network in one place"
            meta={
              <>
                {contactsData && activeTab !== "lists" && (
                  <Badge variant="secondary" className="text-sm font-medium">
                    {contactsData.total.toLocaleString()} {activeTab === "network" ? "connections" : "contacts"}
                  </Badge>
                )}
                {contactsData?.searchCapped && activeTab !== "lists" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="text-xs font-normal text-muted-foreground cursor-default">
                        top 1,000 matches
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      Search returned more than 1,000 contacts — showing the best 1,000 matches. Refine the search to see the rest.
                    </TooltipContent>
                  </Tooltip>
                )}
                {activeTab === "lists" && leadLists && (
                  <Badge variant="secondary" className="text-sm font-medium">
                    {leadLists.length} lists
                  </Badge>
                )}
              </>
            }
            actions={
              <>
                {activeTab === "network" && unipileData?.linkedinAccount && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        onClick={handleSyncLinkedInConnections}
                        disabled={syncConnections.isPending}
                      >
                        {syncConnections.isPending ? (
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Linkedin className="h-4 w-4 mr-2" />
                        )}
                        {syncConnections.isPending && syncProgress
                          ? `Syncing... ${syncProgress.total}`
                          : "Sync LinkedIn"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {syncConnections.isPending
                        ? `Syncing contacts... ${syncProgress?.total || 0} processed`
                        : "Import all your LinkedIn connections as contacts"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {activeTab === "lists" && (
                  <>
                    <Button variant="outline" onClick={() => navigate("/list-building/search")}>
                      <Database className="h-4 w-4 mr-2" />
                      Search Lead Pool
                    </Button>
                    <Button variant="outline" onClick={() => navigate("/leads/import")}>
                      <Upload className="h-4 w-4 mr-2" />
                      Import Leads
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="cta">
                          <Plus className="h-4 w-4 mr-2" />
                          Create List
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => setShowCreateListDialog(true)}>
                          <ListIcon className="h-4 w-4 mr-2 shrink-0" />
                          <div className="flex flex-col">
                            <span>Static List</span>
                            <span className="text-xs text-muted-foreground">
                              Add contacts manually
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setShowCreateSmartListDialog(true)}>
                          <Sparkles className="h-4 w-4 mr-2 shrink-0 text-primary" />
                          <div className="flex flex-col">
                            <span>Smart Segment</span>
                            <span className="text-xs text-muted-foreground">
                              Auto-update by filters
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate("/list-building/search")}>
                          <Database className="h-4 w-4 mr-2 shrink-0 text-amber-600" />
                          <div className="flex flex-col">
                            <span>From Lead Pool</span>
                            <span className="text-xs text-muted-foreground">
                              Search 123M-row B2B database
                            </span>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                {activeTab !== "lists" && (
                  <>
                    <Button variant="outline" onClick={() => navigate("/leads/import")}>
                      <Upload className="h-4 w-4 mr-2" />
                      Import
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setExportMode("filtered");
                        setShowExportDialog(true);
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                    <Button variant="cta" onClick={() => setShowAddContactDialog(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Contact
                    </Button>
                  </>
                )}
              </>
            }
          />

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="all" className="gap-2">
                <Users className="h-4 w-4" />
                All People
              </TabsTrigger>
              <TabsTrigger value="lists" className="gap-2">
                <ListIcon className="h-4 w-4" />
                Lists
              </TabsTrigger>
              <TabsTrigger value="network" className="gap-2">
                <Linkedin className="h-4 w-4" />
                LinkedIn Network
              </TabsTrigger>
            </TabsList>

            {/* All People Tab */}
            <TabsContent value="all" className="mt-6 space-y-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search contacts..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>

                {/* Type Filter */}
                  <Select
                    value={typeFilter}
                    onValueChange={(v) => {
                      setTypeFilter(v as ContactType | "all");
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="prospect">Prospects</SelectItem>
                      <SelectItem value="lead">Leads</SelectItem>
                      <SelectItem value="contact">Contacts</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Source Filter */}
                  <Select
                    value={sourceFilter}
                    onValueChange={(v) => handleSourceChange(v as SourceFilter)}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="linkedin_connection">LinkedIn Connections</SelectItem>
                      <SelectItem value="linkedin_comment">LinkedIn Leads</SelectItem>
                      <SelectItem value="instagram_comment">Instagram Leads</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="import">Import</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Status Filter */}
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => handleStatusChange(v as ContactStatus | "all")}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                      <SelectItem value="bounced">Bounced</SelectItem>
                      <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                      <SelectItem value="do_not_contact">Do Not Contact</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Outreach Filter */}
                  <Select
                    value={outreachFilter}
                    onValueChange={(v) => {
                      setOutreachFilter(v as OutreachStatus | "all");
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Outreach" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Outreach</SelectItem>
                      <SelectItem value="unreached">Unreached</SelectItem>
                      <SelectItem value="reached">Reached</SelectItem>
                      <SelectItem value="replied">Replied</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* AI Analysis Filter */}
                  <Select
                    value={aiAnalysisFilter}
                    onValueChange={(v) => {
                      setAiAnalysisFilter(v as AiAnalysisStatus | "all");
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="AI Analysis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Analysis</SelectItem>
                      <SelectItem value="not_analyzed">Not Analyzed</SelectItem>
                      <SelectItem value="analyzing">Analyzing</SelectItem>
                      <SelectItem value="analyzed">Analyzed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* List Filter */}
                  <ListFilterDropdown
                    lists={staticLists}
                    filter={listFilter}
                    onChange={(f) => {
                      setListFilter(f);
                      setCurrentPage(1);
                    }}
                  />

                  {/* Tag Filter */}
                  <TagFilterDropdown
                    selected={tagFilter}
                    onChange={(tags) => {
                      setTagFilter(tags);
                      setCurrentPage(1);
                    }}
                  />

                  {/* Sort By */}
                  <Select
                    value={`${sortBy}-${sortDirection}`}
                    onValueChange={(v) => {
                      const [field, dir] = v.split("-") as [ContactSortField, SortDirection];
                      setSortBy(field);
                      setSortDirection(dir);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[170px]">
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last_activity_at-desc">Latest Activity</SelectItem>
                      <SelectItem value="last_activity_at-asc">Oldest Activity</SelectItem>
                      <SelectItem value="first_seen_at-desc">Recently Connected</SelectItem>
                      <SelectItem value="first_seen_at-asc">First Connected</SelectItem>
                      <SelectItem value="display_name-asc">Name (A-Z)</SelectItem>
                      <SelectItem value="display_name-desc">Name (Z-A)</SelectItem>
                      <SelectItem value="lead_score-desc">Highest Score</SelectItem>
                      <SelectItem value="lead_score-asc">Lowest Score</SelectItem>
                      <SelectItem value="created_at-desc">Recently Added</SelectItem>
                      <SelectItem value="created_at-asc">First Added</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Column Selector */}
                  <ColumnSelector
                    columns={allColumns}
                    visibleColumns={visibleColumns}
                    onVisibilityChange={handleColumnVisibilityChange}
                  />
              </div>

              {/* Advanced Filters */}
              <AdvancedFilters
                filters={advancedFilters}
                onChange={(filters) => {
                  setAdvancedFilters(filters);
                  setCurrentPage(1);
                }}
              />

              {/* DM Fit quick filter — visible when a product is selected */}
              {advancedFilters.icpProductId && (
                <DmFitQuickFilter
                  minDmScore={advancedFilters.minDmScore}
                  maxDmScore={advancedFilters.maxDmScore}
                  onChange={(min, max) => { setAdvancedFilters(f => ({ ...f, minDmScore: min, maxDmScore: max })); setCurrentPage(1); }}
                />
              )}

              {/* Content */}
              <ContactsTable
                contactsData={contactsData}
                isLoading={isLoading}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={handleSort}
                currentPage={currentPage}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                visibleColumns={visibleColumns}
                onAddContact={() => setShowAddContactDialog(true)}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                staticLists={staticLists}
                onAddToList={(listId, contactId) => {
                  addToListMutation.mutate(
                    { list_id: listId, contact_id: contactId },
                    {
                      onSuccess: () => {
                        const list = staticLists.find(l => l.id === listId);
                        toast.success(`Added to ${list?.name || 'list'}`);
                      },
                    }
                  );
                }}
                linkedInAccountId={unipileData?.linkedinAccount?.id || null}
                linkedinAccounts={unipileData?.linkedinAccounts || []}
                onDeleteContact={(id, name) => setContactToDelete({ id, name })}
                onRegenerateNotionPage={(contactId) => setSingleRegenerateContactId(contactId)}
                onSelectAllPages={handleSelectAllPages}
                onSelectFirstN={handleSelectFirstN}
                isSelectingAllPages={fetchAllIds.isPending}
                hasActiveFilters={hasActiveFilters}
                icpProductId={advancedFilters.icpProductId || null}
                onIcpProductIdChange={(id) => { setAdvancedFilters(f => ({ ...f, icpProductId: id || undefined, minDmScore: undefined, maxDmScore: undefined })); setCurrentPage(1); }}
              />
            </TabsContent>

            {/* Lists Tab */}
            <TabsContent value="lists" className="mt-6">
              <LeadListsTable
                lists={leadLists}
                isLoading={listsLoading}
                onEdit={setEditingList}
                onDelete={setDeletingList}
                onArchive={handleArchiveList}
                onMerge={setMergingLists}
                onBulkDelete={setDeletingLists}
              />
            </TabsContent>

            {/* LinkedIn Network Tab */}
            <TabsContent value="network" className="mt-6 space-y-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search LinkedIn connections..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>

                {/* LinkedIn Account Filter - show when any accounts exist */}
                  {unipileData?.linkedinAccounts && unipileData.linkedinAccounts.length > 0 && (
                    <Select
                      value={linkedAccountFilter}
                      onValueChange={(v) => {
                        setLinkedAccountFilter(v);
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <Linkedin className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="LinkedIn Account" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Accounts</SelectItem>
                        {unipileData.linkedinAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id} textValue={account.display_name || account.username || 'LinkedIn Account'}>
                            <div className="flex items-center gap-2">
                              {account.avatar_url && (
                                <img
                                  src={account.avatar_url}
                                  alt=""
                                  className="h-4 w-4 rounded-full"
                                />
                              )}
                              <span className="truncate">
                                {account.display_name || account.username || 'LinkedIn Account'}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Outreach Filter */}
                  <Select
                    value={outreachFilter}
                    onValueChange={(v) => {
                      setOutreachFilter(v as OutreachStatus | "all");
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Outreach" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Outreach</SelectItem>
                      <SelectItem value="unreached">Unreached</SelectItem>
                      <SelectItem value="reached">Reached</SelectItem>
                      <SelectItem value="replied">Replied</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* AI Analysis Filter */}
                  <Select
                    value={aiAnalysisFilter}
                    onValueChange={(v) => {
                      setAiAnalysisFilter(v as AiAnalysisStatus | "all");
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="AI Analysis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Analysis</SelectItem>
                      <SelectItem value="not_analyzed">Not Analyzed</SelectItem>
                      <SelectItem value="analyzing">Analyzing</SelectItem>
                      <SelectItem value="analyzed">Analyzed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* List Filter */}
                  <ListFilterDropdown
                    lists={staticLists}
                    filter={listFilter}
                    onChange={(f) => {
                      setListFilter(f);
                      setCurrentPage(1);
                    }}
                  />

                  {/* Tag Filter */}
                  <TagFilterDropdown
                    selected={tagFilter}
                    onChange={(tags) => {
                      setTagFilter(tags);
                      setCurrentPage(1);
                    }}
                  />

                  {/* Sort By */}
                  <Select
                    value={`${sortBy}-${sortDirection}`}
                    onValueChange={(v) => {
                      const [field, dir] = v.split("-") as [ContactSortField, SortDirection];
                      setSortBy(field);
                      setSortDirection(dir);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[170px]">
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first_seen_at-desc">Recently Connected</SelectItem>
                      <SelectItem value="first_seen_at-asc">First Connected</SelectItem>
                      <SelectItem value="display_name-asc">Name (A-Z)</SelectItem>
                      <SelectItem value="display_name-desc">Name (Z-A)</SelectItem>
                      <SelectItem value="last_activity_at-desc">Latest Activity</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Column Selector */}
                  <ColumnSelector
                    columns={allColumns}
                    visibleColumns={visibleColumns}
                    onVisibilityChange={handleColumnVisibilityChange}
                  />
              </div>

              {/* Advanced Filters */}
              <AdvancedFilters
                filters={advancedFilters}
                onChange={(filters) => {
                  setAdvancedFilters(filters);
                  setCurrentPage(1);
                }}
              />

              {/* DM Fit quick filter — visible when a product is selected */}
              {advancedFilters.icpProductId && (
                <DmFitQuickFilter
                  minDmScore={advancedFilters.minDmScore}
                  maxDmScore={advancedFilters.maxDmScore}
                  onChange={(min, max) => { setAdvancedFilters(f => ({ ...f, minDmScore: min, maxDmScore: max })); setCurrentPage(1); }}
                />
              )}

              {/* Network Table */}
              <ContactsTable
                contactsData={contactsData}
                isLoading={isLoading}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={handleSort}
                currentPage={currentPage}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                visibleColumns={visibleColumns}
                onAddContact={() => setShowAddContactDialog(true)}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                staticLists={staticLists}
                onAddToList={(listId, contactId) => {
                  addToListMutation.mutate(
                    { list_id: listId, contact_id: contactId },
                    {
                      onSuccess: () => {
                        const list = staticLists.find(l => l.id === listId);
                        toast.success(`Added to ${list?.name || 'list'}`);
                      },
                    }
                  );
                }}
                linkedInAccountId={unipileData?.linkedinAccount?.id || null}
                linkedinAccounts={unipileData?.linkedinAccounts || []}
                onDeleteContact={(id, name) => setContactToDelete({ id, name })}
                onRegenerateNotionPage={(contactId) => setSingleRegenerateContactId(contactId)}
                onSelectAllPages={handleSelectAllPages}
                onSelectFirstN={handleSelectFirstN}
                isSelectingAllPages={fetchAllIds.isPending}
                hasActiveFilters={hasActiveFilters}
                icpProductId={advancedFilters.icpProductId || null}
                onIcpProductIdChange={(id) => { setAdvancedFilters(f => ({ ...f, icpProductId: id || undefined, minDmScore: undefined, maxDmScore: undefined })); setCurrentPage(1); }}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Lead List Dialogs */}
        <CreateListDialog
          open={showCreateListDialog}
          onOpenChange={setShowCreateListDialog}
          onSubmit={handleCreateList}
          isLoading={createListMutation.isPending}
        />

        <CreateSmartListDialog
          open={showCreateSmartListDialog}
          onOpenChange={setShowCreateSmartListDialog}
          onSubmit={handleCreateSmartList}
          isLoading={createSmartListMutation.isPending}
        />

        <EditListDialog
          list={editingList}
          open={!!editingList}
          onOpenChange={(open) => !open && setEditingList(null)}
          onSubmit={handleEditList}
          isLoading={updateListMutation.isPending}
        />

        <DeleteListDialog
          list={deletingList}
          open={!!deletingList}
          onOpenChange={(open) => !open && setDeletingList(null)}
          onConfirm={handleDeleteList}
          isLoading={deleteListMutation.isPending}
        />

        <MergeListsDialog
          lists={mergingLists ?? []}
          allLists={leadLists}
          open={!!mergingLists}
          onOpenChange={(open) => !open && setMergingLists(null)}
          onMerged={() => setMergingLists(null)}
        />

        <BulkDeleteListsDialog
          lists={deletingLists ?? []}
          open={!!deletingLists}
          onOpenChange={(open) => !open && setDeletingLists(null)}
          onConfirm={handleBulkDeleteLists}
          isLoading={bulkDeleteListsMutation.isPending}
        />

        {/* Add Contact Dialog */}
        <AddContactDialog
          open={showAddContactDialog}
          onOpenChange={setShowAddContactDialog}
          onSubmit={handleAddContact}
          isLoading={createContactMutation.isPending}
        />

        {/* Export Contacts Dialog */}
        <ExportContactsDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          onSubmit={handleExportContacts}
          isLoading={exportContactsMutation.isPending}
          contactCount={contactsData?.total}
          selectedCount={selectedIds.size}
          mode={exportMode}
        />

        {/* Analyze Companies Dialog */}
        <AnalyzeCompaniesDialog
          contactIds={Array.from(selectedIds)}
          open={showAnalyzeDialog}
          onOpenChange={setShowAnalyzeDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Generate Email Sequence Dialog */}
        <GenerateEmailSequenceDialog
          contactIds={Array.from(selectedIds)}
          open={showGenerateSequenceDialog}
          onOpenChange={setShowGenerateSequenceDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Generate & Send Dialog */}
        <GenerateAndSendDialog
          contactIds={Array.from(selectedIds)}
          open={showGenerateAndSendDialog}
          onOpenChange={setShowGenerateAndSendDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Push Sequences to Email Tool Dialog */}
        <PushSequencesToEmailToolDialog
          contactIds={Array.from(selectedIds)}
          open={showPushDialog}
          onOpenChange={setShowPushDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Enroll in Email Sequence Dialog */}
        <BulkEnrollEmailSequenceDialog
          contactIds={Array.from(selectedIds)}
          open={showEnrollEmailSequenceDialog}
          onOpenChange={setShowEnrollEmailSequenceDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Generate Notion Pages Dialog */}
        <GenerateNotionPagesDialog
          contactIds={Array.from(selectedIds)}
          open={showNotionPagesDialog}
          onOpenChange={setShowNotionPagesDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Regenerate Notion Pages Dialog (bulk) */}
        <GenerateNotionPagesDialog
          contactIds={Array.from(selectedIds)}
          open={showRegenerateNotionDialog}
          onOpenChange={setShowRegenerateNotionDialog}
          onComplete={() => setSelectedIds(new Set())}
          regenerate
        />

        {/* Regenerate Notion Page Dialog (single contact) */}
        <GenerateNotionPagesDialog
          contactIds={singleRegenerateContactId ? [singleRegenerateContactId] : []}
          open={!!singleRegenerateContactId}
          onOpenChange={(open) => { if (!open) setSingleRegenerateContactId(null); }}
          regenerate
        />

        {/* Find Emails Dialog */}
        <FindEmailsDialog
          contactIds={Array.from(selectedIds)}
          open={showFindEmailsDialog}
          onOpenChange={setShowFindEmailsDialog}
          onComplete={() => setSelectedIds(new Set())}
        />

        {/* Verify Emails Dialog */}
        <VerifyEmailsDialog
          contactIds={Array.from(selectedIds)}
          open={showVerifyEmailsDialog}
          onOpenChange={setShowVerifyEmailsDialog}
          onConfirm={(provider) => {
            runVerifyEmails(Array.from(selectedIds), provider);
          }}
        />

        {/* Floating Bulk Actions Bar */}
        <ContactsBulkActionsBar
          selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          staticLists={staticLists}
          onAddToList={(listId, listName) => {
            const count = selectedIds.size;
            const toastId = toast.loading(`Adding contacts to ${listName}... 0 / ${count}`);
            bulkAddToList.mutate(
              {
                list_id: listId,
                contact_ids: Array.from(selectedIds),
                onProgress: (processed, total) => {
                  toast.loading(`Adding contacts to ${listName}... ${processed} / ${total}`, { id: toastId });
                },
              },
              {
                onSuccess: () => {
                  toast.dismiss(toastId);
                  toast.success(`Added ${count} contacts to ${listName}`);
                  setSelectedIds(new Set());
                },
                onError: () => {
                  toast.dismiss(toastId);
                },
              }
            );
          }}
          isAddingToList={bulkAddToList.isPending}
          onFindEmails={() => setShowFindEmailsDialog(true)}
          onAnalyzeCompanies={() => setShowAnalyzeDialog(true)}
          onCheckFirewalls={() => runFirewallCheck(Array.from(selectedIds))}
          onVerifyEmails={() => setShowVerifyEmailsDialog(true)}
          onGenerateSequences={() => setShowGenerateSequenceDialog(true)}
          onGenerateAndSend={() => setShowGenerateAndSendDialog(true)}
          onPushToEmailTool={() => setShowPushDialog(true)}
          onEnrollInEmailSequence={() => setShowEnrollEmailSequenceDialog(true)}
          onClearSequences={() => {
            const count = selectedIds.size;
            const toastId = toast.loading(`Clearing sequences for ${count} contact${count === 1 ? '' : 's'}...`);
            bulkClearSequences.mutate(Array.from(selectedIds), {
              onSettled: () => toast.dismiss(toastId),
            });
          }}
          isClearingSequences={bulkClearSequences.isPending}
          onGenerateNotionPages={() => setShowNotionPagesDialog(true)}
          onRegenerateNotionPages={() => setShowRegenerateNotionDialog(true)}
          onDeleteNotionPages={() => {
            const count = selectedIds.size;
            const toastId = toast.loading(`Deleting Notion pages for ${count} contact${count === 1 ? '' : 's'}...`);
            bulkDeleteNotionPages.mutate(Array.from(selectedIds), {
              onSettled: () => toast.dismiss(toastId),
            });
          }}
          isDeletingNotionPages={bulkDeleteNotionPages.isPending}
          onAddToExclusionList={() => {
            toast.info("Add to Exclusion List feature coming soon");
          }}
          onSetCustomField={() => setShowSetCustomFieldDialog(true)}
          onExport={() => {
            setExportMode("selected");
            setShowExportDialog(true);
          }}
          onDelete={() => setShowDeleteDialog(true)}
          isDeleting={bulkDeleteContacts.isPending}
        />

        {/* Set Custom Field Dialog */}
        <SetCustomFieldDialog
          open={showSetCustomFieldDialog}
          onOpenChange={setShowSetCustomFieldDialog}
          selectedCount={selectedIds.size}
          isLoading={bulkSetCustomField.isPending}
          onSubmit={(fieldKey, value) => {
            bulkSetCustomField.mutate(
              { contactIds: Array.from(selectedIds), fieldKey, value },
              { onSuccess: () => setShowSetCustomFieldDialog(false) }
            );
          }}
        />

        {/* Bulk Delete Confirmation Dialog */}
        <DeleteConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={() => {
            bulkDeleteContacts.mutate(Array.from(selectedIds), {
              onSettled: () => {
                setSelectedIds(new Set());
                setCurrentPage(1);
              },
            });
          }}
          itemName={`${selectedIds.size} contact${selectedIds.size === 1 ? '' : 's'}`}
          itemType="contacts"
          description={`Are you sure you want to delete ${selectedIds.size} contact${selectedIds.size === 1 ? '' : 's'}? This action cannot be undone and will remove them from all lists.`}
        />

        {/* Single Delete Confirmation Dialog */}
        <DeleteConfirmDialog
          open={!!contactToDelete}
          onOpenChange={(open) => !open && setContactToDelete(null)}
          onConfirm={() => {
            if (contactToDelete) {
              deleteContact.mutate(contactToDelete.id);
              setContactToDelete(null);
            }
          }}
          itemName={contactToDelete?.name || ''}
          itemType="contact"
        />
      </FeatureGate>
    </AppLayout>
  );
}

// ============================================================================
// Table View
// ============================================================================

interface ContactsTableProps {
  contactsData: PaginatedContacts | undefined;
  isLoading: boolean;
  sortBy: ContactSortField;
  sortDirection: SortDirection;
  onSort: (field: ContactSortField) => void;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: string) => void;
  visibleColumns: string[];
  onAddContact?: () => void;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  staticLists: LeadList[];
  onAddToList: (listId: string, contactId: string) => void;
  linkedInAccountId: string | null;
  linkedinAccounts?: import("@/hooks/useUnipileAccounts").UnipileAccount[];
  onDeleteContact: (id: string, name: string) => void;
  onRegenerateNotionPage: (contactId: string) => void;
  onSelectAllPages?: () => void;
  onSelectFirstN?: (n: number) => void;
  isSelectingAllPages?: boolean;
  hasActiveFilters?: boolean;
  icpProductId: string | null;
  onIcpProductIdChange: (id: string | null) => void;
}

function ContactsTable({
  contactsData,
  isLoading,
  sortBy,
  sortDirection,
  onSort,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  visibleColumns,
  onAddContact,
  selectedIds,
  setSelectedIds,
  staticLists,
  onAddToList,
  linkedInAccountId,
  linkedinAccounts = [],
  onDeleteContact,
  onRegenerateNotionPage,
  onSelectAllPages,
  onSelectFirstN,
  isSelectingAllPages,
  hasActiveFilters,
  icpProductId,
  onIcpProductIdChange,
}: ContactsTableProps) {
  const contacts = contactsData?.data || [];
  const total = contactsData?.total || 0;
  const totalPages = contactsData?.totalPages || 1;

  // Org custom field definitions — rendered as dynamic, user-toggleable columns
  const { data: customFieldDefsData } = useCustomFieldDefs();
  const customFieldDefs = customFieldDefsData || [];

  // "Select first N" input state (must be before early returns)
  const [selectNValue, setSelectNValue] = useState("");

  // Column resize hook
  const { getTableProps, getHeaderProps, getResizeHandleProps } = useColumnResize({
    tableId: 'contacts-table',
    defaultWidths: CONTACT_DEFAULT_WIDTHS,
  });

  // Build the list of visible column keys (including fixed columns) for table width calculation
  const visibleColumnKeys = [
    '_checkbox',
    'contact',
    ...visibleColumns.filter(k => k !== 'contact'),
    '_actions',
  ];

  // Mutation hooks for inline editing
  const updateContact = useUpdateContact();
  const addTag = useAddContactTag();
  const removeTag = useRemoveContactTag();

  // Fetch list memberships for current contacts
  const contactIds = contacts.map(c => c.id);
  const { data: listMemberships } = useContactListMemberships(contactIds);

  // ICP per-product score support (icpProductId is lifted to parent for server-side filtering)
  const { products } = useProducts();
  const { data: productScoreMap } = useContactScoresForProduct(contactIds, icpProductId);

  // Fetch email sequence counts for visible contacts
  const { data: sequenceCounts } = useEmailSequencesCounts(contactIds);

  // Check if a column is visible
  const isVisible = (key: string) => visibleColumns.includes(key);

  const SortIcon = ({ field }: { field: ContactSortField }) => {
    if (sortBy !== field) return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    return sortDirection === "asc"
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  if (isLoading) {
    return (
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="[&>th]:h-9 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:border-b-2 [&>th]:border-foreground/70 bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-[300px]">Contact</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Last Activity</TableHead>
              <TableHead>Connected</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(8)].map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-8 w-8" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  }

  if (contacts.length === 0 && !isLoading) {
    return (
      <Card className="flex flex-col items-center justify-center py-16">
        <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="font-medium text-lg">
          {hasActiveFilters ? "No contacts match your filters" : "No contacts yet"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {hasActiveFilters
            ? "Try adjusting or clearing your filters"
            : "Add your first contact to get started"}
        </p>
        {!hasActiveFilters && (
          <Button variant="cta" className="mt-4" onClick={onAddContact}>
            <Plus className="h-4 w-4 mr-2" />
            Add Contact
          </Button>
        )}
      </Card>
    );
  }

  // Calculate page range display
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, total);

  // "Select all across pages" banner logic
  const allPageSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const hasMorePages = total > contacts.length;
  const allPagesAlreadySelected = selectedIds.size === total;
  const showSelectAllBanner = allPageSelected && hasMorePages && !allPagesAlreadySelected;

  return (
    <div className="space-y-4">
      <Card className="overflow-x-auto">
        {showSelectAllBanner && (
          <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm flex items-center justify-center gap-2 flex-wrap">
            <span>All {contacts.length} contacts on this page are selected.</span>
            <button
              className="text-primary font-medium hover:underline disabled:opacity-50"
              onClick={onSelectAllPages}
              disabled={isSelectingAllPages}
            >
              {isSelectingAllPages ? "Selecting..." : `Select all ${total.toLocaleString()}`}
            </button>
            {onSelectFirstN && total > contacts.length && (
              <>
                <span className="text-muted-foreground">or select first</span>
                <input
                  type="number"
                  min={1}
                  max={total}
                  placeholder="e.g. 1000"
                  value={selectNValue}
                  onChange={(e) => setSelectNValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(selectNValue);
                      if (n > 0) onSelectFirstN(n);
                    }
                  }}
                  disabled={isSelectingAllPages}
                  className="w-24 h-7 px-2 text-sm border rounded bg-background text-foreground disabled:opacity-50"
                />
                <button
                  className="text-primary font-medium hover:underline disabled:opacity-50"
                  disabled={isSelectingAllPages || !selectNValue || parseInt(selectNValue) < 1}
                  onClick={() => {
                    const n = parseInt(selectNValue);
                    if (n > 0) onSelectFirstN(n);
                  }}
                >
                  Go
                </button>
              </>
            )}
          </div>
        )}
        {allPagesAlreadySelected && selectedIds.size > contacts.length && (
          <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm">
            All {total.toLocaleString()} contacts are selected.{" "}
            <button
              className="text-primary font-medium hover:underline"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
          </div>
        )}
        <Table style={getTableProps(visibleColumnKeys).style}>
          <TableHeader>
            <TableRow className="[&>th]:h-9 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:border-b-2 [&>th]:border-foreground/70 bg-muted/30 hover:bg-muted/30">
              {/* Selection checkbox */}
              <TableHead style={getHeaderProps('_checkbox').style}>
                <Checkbox
                  checked={
                    contacts.length > 0 &&
                    contacts.every((c) => selectedIds.has(c.id))
                  }
                  onCheckedChange={(checked) => {
                    if (checked) {
                      const merged = new Set(selectedIds);
                      contacts.forEach((c) => merged.add(c.id));
                      setSelectedIds(merged);
                    } else {
                      const remaining = new Set(selectedIds);
                      contacts.forEach((c) => remaining.delete(c.id));
                      setSelectedIds(remaining);
                    }
                  }}
                />
              </TableHead>
              {/* Contact - always visible */}
              <TableHead
                className="relative cursor-pointer hover:bg-muted/50 transition-colors"
                style={getHeaderProps('contact').style}
                onClick={() => onSort("display_name")}
              >
                <div className="flex items-center">
                  Contact
                  <SortIcon field="display_name" />
                </div>
                <ResizeHandle {...getResizeHandleProps('contact')} />
              </TableHead>
              {isVisible('company') && (
                <TableHead className="relative" style={getHeaderProps('company').style}>
                  Company
                  <ResizeHandle {...getResizeHandleProps('company')} />
                </TableHead>
              )}
              {isVisible('job_title') && (
                <TableHead className="relative" style={getHeaderProps('job_title').style}>
                  Job Title
                  <ResizeHandle {...getResizeHandleProps('job_title')} />
                </TableHead>
              )}
              {isVisible('website') && (
                <TableHead className="relative" style={getHeaderProps('website').style}>
                  Website
                  <ResizeHandle {...getResizeHandleProps('website')} />
                </TableHead>
              )}
              {isVisible('phone') && (
                <TableHead className="relative" style={getHeaderProps('phone').style}>
                  Phone
                  <ResizeHandle {...getResizeHandleProps('phone')} />
                </TableHead>
              )}
              {isVisible('instagram') && (
                <TableHead className="relative" style={getHeaderProps('instagram').style}>
                  Instagram
                  <ResizeHandle {...getResizeHandleProps('instagram')} />
                </TableHead>
              )}
              {isVisible('location') && (
                <TableHead className="relative" style={getHeaderProps('location').style}>
                  Location
                  <ResizeHandle {...getResizeHandleProps('location')} />
                </TableHead>
              )}
              {isVisible('tags') && (
                <TableHead className="relative" style={getHeaderProps('tags').style}>
                  Tags
                  <ResizeHandle {...getResizeHandleProps('tags')} />
                </TableHead>
              )}
              {isVisible('lists') && (
                <TableHead className="relative" style={getHeaderProps('lists').style}>
                  Lists
                  <ResizeHandle {...getResizeHandleProps('lists')} />
                </TableHead>
              )}
              {isVisible('linked_accounts') && (
                <TableHead className="relative" style={getHeaderProps('linked_accounts').style}>
                  Linked Accounts
                  <ResizeHandle {...getResizeHandleProps('linked_accounts')} />
                </TableHead>
              )}
              {isVisible('type') && (
                <TableHead className="relative" style={getHeaderProps('type').style}>
                  Type
                  <ResizeHandle {...getResizeHandleProps('type')} />
                </TableHead>
              )}
              {isVisible('status') && (
                <TableHead className="relative" style={getHeaderProps('status').style}>
                  Status
                  <ResizeHandle {...getResizeHandleProps('status')} />
                </TableHead>
              )}
              {isVisible('outreach') && (
                <TableHead className="relative" style={getHeaderProps('outreach').style}>
                  Outreach
                  <ResizeHandle {...getResizeHandleProps('outreach')} />
                </TableHead>
              )}
              {isVisible('ai_analyzed') && (
                <TableHead className="relative" style={getHeaderProps('ai_analyzed').style}>
                  AI Analyzed
                  <ResizeHandle {...getResizeHandleProps('ai_analyzed')} />
                </TableHead>
              )}
              {isVisible('ai_insights') && (
                <TableHead className="relative" style={getHeaderProps('ai_insights').style}>
                  AI Insights
                  <ResizeHandle {...getResizeHandleProps('ai_insights')} />
                </TableHead>
              )}
              {isVisible('icp_score') && (
                <TableHead className="relative" style={getHeaderProps('icp_score').style}>
                  <div className="flex items-center gap-1">
                    <Target className="h-3 w-3 shrink-0" />
                    {products && products.length > 0 ? (
                      <Select
                        value={icpProductId || "_overall"}
                        onValueChange={(v) => onIcpProductIdChange(v === "_overall" ? null : v)}
                      >
                        <SelectTrigger className="h-6 text-xs border-none shadow-none px-1 min-w-0 w-auto bg-transparent">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_overall">ICP (Overall)</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              ICP: {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span>ICP Score</span>
                    )}
                  </div>
                  <ResizeHandle {...getResizeHandleProps('icp_score')} />
                </TableHead>
              )}
              {isVisible('dm_score') && (
                <TableHead className="relative" style={getHeaderProps('dm_score').style}>
                  <div className="flex items-center gap-1">
                    <UserCheck className="h-3 w-3 shrink-0 text-violet-500" />
                    {products && products.length > 0 ? (
                      <Select
                        value={icpProductId || "_overall"}
                        onValueChange={(v) => onIcpProductIdChange(v === "_overall" ? null : v)}
                      >
                        <SelectTrigger className="h-6 text-xs border-none shadow-none px-1 min-w-0 w-auto bg-transparent">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_overall">DM Fit (Overall)</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              DM: {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span>DM Fit</span>
                    )}
                  </div>
                  <ResizeHandle {...getResizeHandleProps('dm_score')} />
                </TableHead>
              )}
              {isVisible('source') && (
                <TableHead className="relative" style={getHeaderProps('source').style}>
                  Source
                  <ResizeHandle {...getResizeHandleProps('source')} />
                </TableHead>
              )}
              {isVisible('score') && (
                <TableHead
                  className="relative cursor-pointer hover:bg-muted/50 transition-colors text-right"
                  style={getHeaderProps('score').style}
                  onClick={() => onSort("lead_score")}
                >
                  <div className="flex items-center justify-end">
                    Score
                    <SortIcon field="lead_score" />
                  </div>
                  <ResizeHandle {...getResizeHandleProps('score')} />
                </TableHead>
              )}
              {isVisible('sequences') && (
                <TableHead className="relative" style={getHeaderProps('sequences').style}>
                  Sequences
                  <ResizeHandle {...getResizeHandleProps('sequences')} />
                </TableHead>
              )}
              {isVisible('seg_firewall') && (
                <TableHead className="relative" style={getHeaderProps('seg_firewall').style}>
                  Email Firewall
                  <ResizeHandle {...getResizeHandleProps('seg_firewall')} />
                </TableHead>
              )}
              {isVisible('notion_url') && (
                <TableHead className="relative" style={getHeaderProps('notion_url').style}>
                  Notion URL
                  <ResizeHandle {...getResizeHandleProps('notion_url')} />
                </TableHead>
              )}
              {isVisible('last_activity') && (
                <TableHead
                  className="relative cursor-pointer hover:bg-muted/50 transition-colors"
                  style={getHeaderProps('last_activity').style}
                  onClick={() => onSort("last_activity_at")}
                >
                  <div className="flex items-center">
                    Last Activity
                    <SortIcon field="last_activity_at" />
                  </div>
                  <ResizeHandle {...getResizeHandleProps('last_activity')} />
                </TableHead>
              )}
              {isVisible('connected') && (
                <TableHead
                  className="relative cursor-pointer hover:bg-muted/50 transition-colors"
                  style={getHeaderProps('connected').style}
                  onClick={() => onSort("first_seen_at")}
                >
                  <div className="flex items-center">
                    Connected
                    <SortIcon field="first_seen_at" />
                  </div>
                  <ResizeHandle {...getResizeHandleProps('connected')} />
                </TableHead>
              )}
              {customFieldDefs
                .filter((def) => isVisible(`custom_${def.field_key}`))
                .map((def) => (
                  <TableHead key={def.id} className="relative" style={getHeaderProps(`custom_${def.field_key}`).style}>
                    {def.display_name}
                    <ResizeHandle {...getResizeHandleProps(`custom_${def.field_key}`)} />
                  </TableHead>
                ))}
              <TableHead style={getHeaderProps('_actions').style}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <ContactTableRow
                key={contact.id}
                contact={contact}
                visibleColumns={visibleColumns}
                listMemberships={listMemberships?.[contact.id] || []}
                isSelected={selectedIds.has(contact.id)}
                onSelectChange={(checked) => {
                  const newSet = new Set(selectedIds);
                  if (checked) {
                    newSet.add(contact.id);
                  } else {
                    newSet.delete(contact.id);
                  }
                  setSelectedIds(newSet);
                }}
                onUpdateContact={async (field, value) => {
                  await updateContact.mutateAsync({ id: contact.id, [field]: value });
                }}
                onAddTag={async (tag) => {
                  await addTag.mutateAsync({ contactId: contact.id, tag });
                }}
                onRemoveTag={async (tag) => {
                  await removeTag.mutateAsync({ contactId: contact.id, tag });
                }}
                staticLists={staticLists}
                onAddToList={onAddToList}
                linkedInAccountId={linkedInAccountId}
                linkedinAccounts={linkedinAccounts}
                onDeleteContact={onDeleteContact}
                onRegenerateNotionPage={onRegenerateNotionPage}
                productScoreMap={productScoreMap}
                icpProductId={icpProductId}
                sequenceInfo={sequenceCounts?.get(contact.id)}
                customFieldDefs={customFieldDefs}
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            Showing {startItem.toLocaleString()} - {endItem.toLocaleString()} of {total.toLocaleString()} contacts
          </span>
          <div className="flex items-center gap-2">
            <span>Show</span>
            <Select value={String(pageSize)} onValueChange={onPageSizeChange}>
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>per page</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground mr-4">
            Page {currentPage} of {totalPages}
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Page numbers */}
          <div className="flex items-center gap-1">
            {generatePageNumbers(currentPage, totalPages).map((page, idx) => (
              page === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">...</span>
              ) : (
                <Button
                  key={page}
                  variant={currentPage === page ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onPageChange(page as number)}
                >
                  {page}
                </Button>
              )
            ))}
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Generate page numbers with ellipsis
function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | string)[] = [];

  if (current <= 4) {
    // Near start
    pages.push(1, 2, 3, 4, 5, '...', total);
  } else if (current >= total - 3) {
    // Near end
    pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    // Middle
    pages.push(1, '...', current - 1, current, current + 1, '...', total);
  }

  return pages;
}

/** Compact inline bar for DM Fit score preset filtering. Shown when a product is selected. */
function DmFitQuickFilter({
  minDmScore,
  maxDmScore,
  onChange,
}: {
  minDmScore: number | undefined;
  maxDmScore: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  const presets = [
    { label: 'Any', min: undefined as number | undefined, max: undefined as number | undefined },
    { label: '80+', min: 80, max: undefined as number | undefined },
    { label: '60+', min: 60, max: undefined as number | undefined },
    { label: '40+', min: 40, max: undefined as number | undefined },
    { label: '<40', min: undefined as number | undefined, max: 39 },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <UserCheck className="h-3.5 w-3.5 text-violet-500" />
      <span className="text-xs font-medium text-muted-foreground">DM Fit:</span>
      <div className="flex gap-0.5">
        {presets.map((preset) => {
          const isActive = preset.min === minDmScore && preset.max === maxDmScore;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.min, preset.max)}
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                isActive
                  ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      {(minDmScore !== undefined || maxDmScore !== undefined) && !(minDmScore === undefined && maxDmScore === undefined) && (
        <Badge variant="secondary" className="text-[10px] gap-1">
          {presets.find(p => p.min === minDmScore && p.max === maxDmScore)?.label || `${minDmScore ?? 0}–${maxDmScore ?? 100}`}
          <button
            type="button"
            className="ml-0.5 hover:text-destructive"
            onClick={() => onChange(undefined, undefined)}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
    </div>
  );
}

/** Renders a color-coded ICP score badge with optional reasoning tooltip. */
function IcpScoreBadge({ score, reasoning }: { score: number; reasoning: string | null }) {
  const label =
    score >= 80 ? "Perfect Fit" :
    score >= 60 ? "Good Fit" :
    score >= 40 ? "Moderate" : "Poor Fit";

  const colorClass =
    score >= 80 ? "bg-green-100 text-green-700" :
    score >= 60 ? "bg-blue-100 text-blue-700" :
    score >= 40 ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";

  const badge = (
    <Badge variant="secondary" className={`text-[11px] px-2 py-0.5 whitespace-nowrap ${colorClass}`}>
      {score} — {label}
    </Badge>
  );

  if (reasoning) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {reasoning}
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}

/**
 * Renders ICP score in table cells.
 * When a product is selected: shows only that product's score (dash if unscored).
 * When "Overall" is selected: shows the enrichment-level ICP score.
 */
function IcpScoreCell({
  contactId,
  enrichmentData,
  productScoreMap,
  icpProductId,
}: {
  contactId: string;
  enrichmentData: Record<string, unknown> | null;
  productScoreMap?: Map<string, { icp_score: number | null; icp_score_reasoning?: string | null }>;
  icpProductId: string | null;
}) {
  // Product selected → only show that product's score, no fallback
  if (icpProductId) {
    const productScore = productScoreMap?.get(contactId);
    if (!productScore || productScore.icp_score == null) {
      return <span className="text-muted-foreground">—</span>;
    }
    return <IcpScoreBadge score={productScore.icp_score} reasoning={productScore.icp_score_reasoning ?? null} />;
  }

  // No product selected → show overall enrichment ICP score
  const score = (enrichmentData?.icp_score as number | undefined) ?? null;
  const reasoning = (enrichmentData?.icp_score_reasoning as string | undefined) ?? null;

  if (score == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <IcpScoreBadge score={score} reasoning={reasoning} />;
}

/**
 * Renders DM Fit score in table cells.
 * Only shown when a product is selected (DM scores are per-product).
 */
function DmScoreCell({
  contactId,
  productScoreMap,
  icpProductId,
}: {
  contactId: string;
  productScoreMap?: Map<string, ContactProductScore>;
  icpProductId: string | null;
}) {
  if (!icpProductId) {
    return <span className="text-muted-foreground">—</span>;
  }

  const productScore = productScoreMap?.get(contactId);
  if (!productScore || productScore.decision_maker_score == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const score = productScore.decision_maker_score;
  const reasoning = productScore.decision_maker_reasoning;
  const source = productScore.decision_maker_source;

  const color =
    score >= 80 ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300' :
    score >= 60 ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
    score >= 40 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="secondary" className={`text-[11px] px-2 py-0.5 font-semibold ${color}`}>
          {score}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">DM Fit: {score}/100</p>
        {reasoning && <p className="text-xs text-muted-foreground mt-1 break-words">{reasoning}</p>}
        {source && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {source === 'ai' ? 'AI-verified' : 'Estimated from title'}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Helper component for displaying email sequence indicator
function SequenceIndicator({
  count,
  status,
  pushedToTool,
}: {
  count?: number;
  status?: 'draft' | 'generating' | 'ready' | 'pushed' | 'failed' | 'archived';
  pushedToTool?: string | null;
}) {
  if (!count) {
    return <span className="text-muted-foreground">—</span>;
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    generating: 'bg-yellow-100 text-yellow-700',
    ready: 'bg-green-100 text-green-700',
    pushed: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    archived: 'bg-gray-100 text-gray-500',
  };

  const colorClass = status ? statusColors[status] || statusColors.ready : statusColors.ready;
  const isPushed = status === 'pushed';

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="secondary" className={`gap-1 text-[11px] px-2 py-0.5 ${colorClass}`}>
          {isPushed ? <Send className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
          {count}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {isPushed
          ? `Pushed to ${pushedToTool || 'email tool'}`
          : status === 'ready'
          ? 'Sequence ready'
          : status === 'generating'
          ? 'Generating...'
          : status === 'failed'
          ? 'Generation failed'
          : `${count} sequence${count !== 1 ? 's' : ''}`}
      </TooltipContent>
    </Tooltip>
  );
}

interface ContactTableRowProps {
  contact: CrmContact;
  visibleColumns: string[];
  listMemberships: ContactListMembership[];
  isSelected: boolean;
  onSelectChange: (checked: boolean) => void;
  onUpdateContact: (field: string, value: unknown) => Promise<void>;
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  staticLists: LeadList[];
  onAddToList: (listId: string, contactId: string) => void;
  linkedInAccountId: string | null;
  linkedinAccounts: import("@/hooks/useUnipileAccounts").UnipileAccount[];
  onDeleteContact: (id: string, name: string) => void;
  onRegenerateNotionPage: (contactId: string) => void;
  productScoreMap?: Map<string, ContactProductScore>;
  icpProductId: string | null;
  sequenceInfo?: SequenceCountInfo;
  customFieldDefs?: CustomFieldDef[];
}

function ContactTableRow({
  contact,
  visibleColumns,
  listMemberships,
  isSelected,
  onSelectChange,
  onUpdateContact,
  onAddTag,
  onRemoveTag,
  staticLists,
  onAddToList,
  linkedInAccountId,
  linkedinAccounts,
  onDeleteContact,
  onRegenerateNotionPage,
  productScoreMap,
  icpProductId,
  sequenceInfo,
  customFieldDefs = [],
}: ContactTableRowProps) {
  const navigate = useNavigate();
  const isVisible = (key: string) => visibleColumns.includes(key);
  const startConversation = useStartConversation();
  const sendConnectionRequest = useSendConnectionRequest();
  const [showConnectionRequestDialog, setShowConnectionRequestDialog] = useState(false);

  // Get LinkedIn identity avatar as fallback (in case contact.avatar_url is expired)
  const linkedinIdentity = contact.identities?.find(
    (i) => i.channel === "linkedin"
  );
  const fallbackAvatarUrl = linkedinIdentity?.platform_avatar_url;

  // Get source badge label
  const getSourceLabel = (source: string | null) => {
    if (!source) return null;
    const labels: Record<string, string> = {
      linkedin_connection: "LinkedIn",
      linkedin_comment: "LinkedIn Lead",
      instagram_comment: "Instagram",
      manual: "Manual",
      import: "Import",
      api: "API",
    };
    return labels[source] || source;
  };

  return (
    <TableRow className="group [&>td]:py-2 [&>td]:px-3 [&>td]:text-[13px] even:bg-muted/20 hover:bg-muted/40">
      {/* Selection checkbox */}
      <TableCell>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onSelectChange}
        />
      </TableCell>
      {/* Contact - always visible */}
      <TableCell>
        <ContactCell
          contactId={contact.id}
          displayName={contact.display_name}
          avatarUrl={contact.avatar_url}
          fallbackAvatarUrl={fallbackAvatarUrl}
          email={contact.primary_email}
          avatarClassName="h-7 w-7 rounded-md"
          fallbackClassName="rounded-md bg-primary/10 text-primary font-semibold"
        />
      </TableCell>

      {/* Company - editable */}
      {isVisible('company') && (
        <TableCell>
          <EditableTextCell
            value={contact.company}
            onSave={(value) => onUpdateContact('company', value)}
            placeholder="Add company"
          />
        </TableCell>
      )}

      {/* Job Title - editable */}
      {isVisible('job_title') && (
        <TableCell>
          <EditableTextCell
            value={contact.job_title}
            onSave={(value) => onUpdateContact('job_title', value)}
            placeholder="Add job title"
          />
        </TableCell>
      )}

      {/* Website - editable */}
      {isVisible('website') && (
        <TableCell>
          <EditableTextCell
            value={contact.company_website}
            onSave={(value) => onUpdateContact('company_website', value)}
            placeholder="Add website"
            type="url"
          />
        </TableCell>
      )}

      {/* Phone - editable */}
      {isVisible('phone') && (
        <TableCell>
          <EditableTextCell
            value={contact.primary_phone}
            onSave={(value) => onUpdateContact('primary_phone', value)}
            placeholder="Add phone"
            type="tel"
          />
        </TableCell>
      )}

      {/* Instagram - editable (profile URL or @handle) */}
      {isVisible('instagram') && (
        <TableCell>
          <EditableTextCell
            value={contact.instagram_url}
            onSave={(value) => onUpdateContact('instagram_url', value)}
            placeholder="Add Instagram"
          />
        </TableCell>
      )}

      {/* Location - editable */}
      {isVisible('location') && (
        <TableCell>
          <EditableLocationCell
            city={contact.city}
            state={contact.state}
            country={contact.country}
            onSave={async (location) => {
              await onUpdateContact('city', location.city);
              await onUpdateContact('state', location.state);
              await onUpdateContact('country', location.country);
            }}
          />
        </TableCell>
      )}

      {/* Tags - editable */}
      {isVisible('tags') && (
        <TableCell>
          <EditableTagsCell
            tags={contact.tags || []}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
          />
        </TableCell>
      )}

      {/* Lists - read only */}
      {isVisible('lists') && (
        <TableCell>
          <ListMembershipTags lists={listMemberships} />
        </TableCell>
      )}

      {/* Linked Accounts - shows which LinkedIn accounts this contact is connected to */}
      {isVisible('linked_accounts') && (
        <TableCell>
          <LinkedAccountsDisplay
            contact={contact}
            linkedinAccounts={linkedinAccounts}
          />
        </TableCell>
      )}

      {/* Type - read only */}
      {isVisible('type') && (
        <TableCell>
          <ContactTypeBadge contact={contact} />
        </TableCell>
      )}

      {/* Status - editable dropdown */}
      {isVisible('status') && (
        <TableCell>
          <EditableStatusCell
            status={contact.status}
            onSave={(value) => onUpdateContact('status', value)}
          />
        </TableCell>
      )}

      {/* Outreach Status - read only */}
      {isVisible('outreach') && (
        <TableCell>
          <OutreachStatusBadge status={contact.outreach_status} />
        </TableCell>
      )}

      {/* AI Analysis Status - read only */}
      {isVisible('ai_analyzed') && (
        <TableCell>
          <AiAnalysisStatusBadge status={contact.ai_analysis_status} />
        </TableCell>
      )}

      {/* AI Insights - primary need from analysis */}
      {isVisible('ai_insights') && (
        <TableCell>
          {contact.enrichment_data && (contact.enrichment_data as { primary_need?: string }).primary_need ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm break-words line-clamp-2 cursor-help">
                  {(contact.enrichment_data as { primary_need?: string }).primary_need}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[350px]">
                <p className="font-medium mb-1">Primary Need</p>
                <p className="break-words">{(contact.enrichment_data as { primary_need?: string }).primary_need}</p>
                {(contact.enrichment_data as { primary_need_reasoning?: string }).primary_need_reasoning && (
                  <>
                    <p className="font-medium mt-2 mb-1">Reasoning</p>
                    <p className="break-words text-muted-foreground">{(contact.enrichment_data as { primary_need_reasoning?: string }).primary_need_reasoning}</p>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      )}

      {/* ICP Score (per-product or overall) */}
      {isVisible('icp_score') && (
        <TableCell>
          <IcpScoreCell
            contactId={contact.id}
            enrichmentData={contact.enrichment_data as Record<string, unknown> | null}
            productScoreMap={productScoreMap}
            icpProductId={icpProductId}
          />
        </TableCell>
      )}

      {/* DM Fit Score (per-product only) */}
      {isVisible('dm_score') && (
        <TableCell>
          <DmScoreCell
            contactId={contact.id}
            productScoreMap={productScoreMap}
            icpProductId={icpProductId}
          />
        </TableCell>
      )}

      {/* Source - read only */}
      {isVisible('source') && (
        <TableCell>
          {contact.source ? (
            <Badge variant="outline" className="text-[11px] px-2 py-0.5 whitespace-nowrap">
              {getSourceLabel(contact.source)}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      )}

      {/* Score - read only */}
      {isVisible('score') && (
        <TableCell className="text-right">
          <ScoreBarCell score={contact.lead_score} />
        </TableCell>
      )}

      {/* Sequences - read only */}
      {isVisible('sequences') && (
        <TableCell>
          <SequenceIndicator
            count={sequenceInfo?.count}
            status={sequenceInfo?.latestStatus}
            pushedToTool={sequenceInfo?.pushedToTool}
          />
        </TableCell>
      )}

      {/* Email Firewall (SEG) */}
      {isVisible('seg_firewall') && (
        <TableCell>
          {contact.seg_provider ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1 text-[10px] bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-400">
                  <ShieldAlert className="h-3 w-3" />
                  {contact.seg_provider}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">This domain routes through {contact.seg_provider} email firewall</p>
              </TooltipContent>
            </Tooltip>
          ) : contact.seg_checked_at ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1 text-[10px] bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400">
                  <ShieldCheck className="h-3 w-3" />
                  Clear
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">No email firewall detected</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      )}

      {/* Notion URL - read only */}
      {isVisible('notion_url') && (
        <TableCell>
          {contact.notion_preview_url ? (
            <a
              href={contact.notion_preview_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Badge variant="outline" className="text-[11px] px-2 py-0.5 gap-1 cursor-pointer hover:bg-accent">
                <ExternalLink className="h-3 w-3" />
                Notion
              </Badge>
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      )}

      {/* Last Activity - read only */}
      {isVisible('last_activity') && (
        <TableCell>
          {contact.last_activity_at ? (
            <span className="text-muted-foreground text-sm">
              {formatDistanceToNow(new Date(contact.last_activity_at), {
                addSuffix: true,
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">Never</span>
          )}
        </TableCell>
      )}

      {/* Connected - read only */}
      {isVisible('connected') && (
        <TableCell>
          {contact.first_seen_at ? (
            <span className="text-muted-foreground text-sm">
              {formatDistanceToNow(new Date(contact.first_seen_at), {
                addSuffix: true,
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </TableCell>
      )}

      {customFieldDefs
        .filter((def) => isVisible(`custom_${def.field_key}`))
        .map((def) => {
          const rawValue = (contact.custom_fields as Record<string, unknown> | null)?.[def.field_key];
          const value = rawValue != null && rawValue !== '' ? String(rawValue) : def.default_value;
          return (
            <TableCell key={def.id}>
              {value ? (
                <span className="text-sm truncate block max-w-[200px]">{value}</span>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
          );
        })}

      {/* Actions */}
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link to={`/people/${contact.id}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Contact
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Activity className="h-4 w-4 mr-2" />
              View Activity
            </DropdownMenuItem>
            {contact.primary_linkedin_url && (
              <DropdownMenuItem asChild>
                <a
                  href={contact.primary_linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  LinkedIn Profile
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {/* For connections: navigate to inbox */}
            {contact.is_linkedin_connection ? (
              <DropdownMenuItem
                disabled={startConversation.isPending}
                onClick={async () => {
                  const result = await startConversation.mutateAsync({ contact });
                  if (result.success && result.conversationId) {
                    navigate(`/inbox?contact=${contact.id}`);
                  } else {
                    // Show appropriate error message
                    if (result.error === 'no_linkedin_identity') {
                      toast.error("Cannot message: No LinkedIn profile linked to this contact");
                    } else if (result.error === 'no_channel_account') {
                      toast.error("Cannot message: Please connect a LinkedIn account first", {
                        action: {
                          label: "Connect",
                          onClick: () => navigate("/settings/accounts"),
                        },
                      });
                    } else {
                      toast.error(result.errorMessage || "Failed to start conversation");
                    }
                  }
                }}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                {startConversation.isPending ? "Starting..." : "Send message"}
              </DropdownMenuItem>
            ) : (
              /* For non-connections: show connection request dialog */
              <DropdownMenuItem
                onClick={() => {
                  // Check if contact has LinkedIn identity
                  const linkedinIdentity = contact.identities?.find(
                    (i) => i.channel === "linkedin"
                  );
                  if (!linkedinIdentity) {
                    toast.error("Cannot connect: No LinkedIn profile linked to this contact");
                    return;
                  }
                  if (!linkedInAccountId) {
                    toast.error("Cannot connect: Please connect a LinkedIn account first", {
                      action: {
                        label: "Connect",
                        onClick: () => navigate("/settings/accounts"),
                      },
                    });
                    return;
                  }
                  setShowConnectionRequestDialog(true);
                }}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Send connection request
              </DropdownMenuItem>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ListPlus className="h-4 w-4 mr-2" />
                Add to List
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {staticLists.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <span className="text-muted-foreground">No lists available</span>
                  </DropdownMenuItem>
                ) : (
                  staticLists.map((list) => (
                    <DropdownMenuItem
                      key={list.id}
                      onClick={() => onAddToList(list.id, contact.id)}
                    >
                      {list.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem>
              <Ban className="h-4 w-4 mr-2" />
              Add to Exclusion List
            </DropdownMenuItem>
            {contact.notion_preview_url && (
              <DropdownMenuItem onClick={() => onRegenerateNotionPage(contact.id)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate Notion Page
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDeleteContact(contact.id, contact.display_name || 'Contact')}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>

      {/* Connection Request Dialog */}
      <SendConnectionRequestDialog
        open={showConnectionRequestDialog}
        onOpenChange={setShowConnectionRequestDialog}
        contact={contact}
        accountId={linkedInAccountId}
        onSubmit={async (message) => {
          const linkedinIdentity = contact.identities?.find(
            (i) => i.channel === "linkedin"
          );
          if (!linkedinIdentity || !linkedInAccountId) return;

          const result = await sendConnectionRequest.mutateAsync({
            accountId: linkedInAccountId,
            recipientId: linkedinIdentity.platform_user_id,
            message,
            contactId: contact.id,
          });

          if (result.success) {
            setShowConnectionRequestDialog(false);
          }
        }}
        isLoading={sendConnectionRequest.isPending}
      />
    </TableRow>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Minimal dot + label status indicator — used in place of a bordered Badge
 * for single-value enum statuses (Type, Outreach, AI Analyzed) so they read
 * lighter next to the table's denser rows.
 */
function StatusFlag({
  label,
  dotClassName,
  textClassName,
  dotPulse = false,
}: {
  label: string;
  dotClassName: string;
  textClassName: string;
  dotPulse?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", textClassName)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClassName, dotPulse && "animate-pulse")} />
      {label}
    </span>
  );
}

/**
 * Right-aligned tabular score with an inline progress bar (0-100).
 * Local to the People table's Score column (LeadListDetail.tsx has its own
 * duplicate of this component for its two contact tables).
 */
function ScoreBarCell({ score }: { score: number | null }) {
  if (score === null || score === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="flex items-center justify-end gap-2 tabular-nums">
      <div className="h-1 w-10 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-semibold text-xs w-5 text-right">{score}</span>
    </div>
  );
}

/**
 * Displays contact type badge based on stored contact_type field
 * - Prospect: Cold list (CSV import, manual entry, LinkedIn search) - no interaction yet
 * - Lead: Showed intent (commented on lead magnet, replied to outreach)
 * - Contact: Established relationship (LinkedIn connection, ongoing conversation)
 */
function ContactTypeBadge({ contact }: { contact: CrmContact }) {
  // Use stored contact_type, fallback to computed value for backward compatibility
  const contactType = contact.contact_type || (
    contact.is_linkedin_connection || contact.source === 'linkedin_connection'
      ? 'contact'
      : contact.source === 'linkedin_comment' || contact.source === 'instagram_comment'
        ? 'lead'
        : 'prospect'
  );

  const config = {
    prospect: {
      label: 'Prospect',
      dotClassName: 'bg-gray-400 dark:bg-gray-500',
      textClassName: 'text-gray-600 dark:text-gray-400',
    },
    lead: {
      label: 'Lead',
      dotClassName: 'bg-primary',
      textClassName: 'text-primary',
    },
    contact: {
      label: 'Contact',
      dotClassName: 'bg-blue-500',
      textClassName: 'text-blue-700 dark:text-blue-400',
    },
  };

  const { label, dotClassName, textClassName } = config[contactType] || config.prospect;

  return <StatusFlag label={label} dotClassName={dotClassName} textClassName={textClassName} />;
}

function StatusBadge({ status }: { status: ContactStatus }) {
  const config: Record<ContactStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-green-100 text-green-700 border-green-200" },
    archived: { label: "Archived", className: "bg-gray-100 text-gray-700 border-gray-200" },
    bounced: { label: "Bounced", className: "bg-red-100 text-red-700 border-red-200" },
    unsubscribed: { label: "Unsubscribed", className: "bg-orange-100 text-orange-700 border-orange-200" },
    do_not_contact: { label: "Do Not Contact", className: "bg-red-100 text-red-700 border-red-200" },
  };

  const { label, className } = config[status] || config.active;

  return (
    <Badge variant="outline" className={cn("capitalize", className)}>
      {label}
    </Badge>
  );
}

/**
 * Displays outreach status badge
 * - Unreached: No messages sent yet (gray)
 * - Reached: At least one message sent (blue)
 * - Replied: Contact has replied (green)
 */
function OutreachStatusBadge({ status }: { status: OutreachStatus | undefined }) {
  const config: Record<OutreachStatus, { label: string; dotClassName: string; textClassName: string }> = {
    unreached: {
      label: 'Unreached',
      dotClassName: 'bg-gray-400 dark:bg-gray-500',
      textClassName: 'text-gray-600 dark:text-gray-400',
    },
    reached: {
      label: 'Reached',
      dotClassName: 'bg-blue-500',
      textClassName: 'text-blue-700 dark:text-blue-400',
    },
    replied: {
      label: 'Replied',
      dotClassName: 'bg-green-500',
      textClassName: 'text-green-700 dark:text-green-400',
    },
  };

  const effectiveStatus = status || 'unreached';
  const { label, dotClassName, textClassName } = config[effectiveStatus];

  return <StatusFlag label={label} dotClassName={dotClassName} textClassName={textClassName} />;
}

/**
 * Displays AI analysis status badge
 * - Not Analyzed: No AI analysis done (gray)
 * - Analyzing: AI analysis in progress (yellow/amber)
 * - Analyzed: AI analysis complete (green)
 * - Failed: AI analysis failed (red)
 */
function AiAnalysisStatusBadge({ status }: { status: AiAnalysisStatus | undefined }) {
  const config: Record<AiAnalysisStatus, { label: string; dotClassName: string; textClassName: string; dotPulse?: boolean; tooltip?: string }> = {
    not_analyzed: {
      label: 'Not Analyzed',
      dotClassName: 'bg-gray-400 dark:bg-gray-500',
      textClassName: 'text-gray-600 dark:text-gray-400',
    },
    analyzing: {
      label: 'Analyzing',
      dotClassName: 'bg-amber-500',
      textClassName: 'text-amber-700 dark:text-amber-400',
      dotPulse: true,
    },
    analyzed: {
      label: 'Analyzed',
      dotClassName: 'bg-green-500',
      textClassName: 'text-green-700 dark:text-green-400',
    },
    failed: {
      label: 'No Data',
      dotClassName: 'bg-orange-500',
      textClassName: 'text-orange-600 dark:text-orange-400',
      tooltip: 'Could not gather enough information — the website may be unreachable or blocked. You can retry or select a LinkedIn account for fallback.',
    },
  };

  const effectiveStatus = status || 'not_analyzed';
  const { label, dotClassName, textClassName, dotPulse, tooltip } = config[effectiveStatus];

  const badge = (
    <StatusFlag label={label} dotClassName={dotClassName} textClassName={textClassName} dotPulse={dotPulse} />
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px]">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}

/**
 * Displays list memberships as colored tags
 * Smart lists get a special primary style, static lists get teal
 */
function ListMembershipTags({ lists }: { lists: ContactListMembership[] }) {
  const navigate = useNavigate();

  if (!lists || lists.length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  // Show first 2 lists, with overflow indicator
  const visibleLists = lists.slice(0, 2);
  const overflowCount = lists.length - 2;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleLists.map((list) => (
        <Tooltip key={list.list_id}>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] px-2 py-0.5 cursor-pointer hover:opacity-80 transition-opacity",
                list.is_smart
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-teal-50 text-teal-700 border-teal-200"
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(`/leads/lists/${list.list_id}`);
              }}
            >
              {list.is_smart && <Sparkles className="h-3 w-3 mr-1" />}
              {list.list_name.length > 12
                ? `${list.list_name.slice(0, 12)}...`
                : list.list_name}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{list.list_name}</p>
            <p className="text-xs text-muted-foreground">
              {list.is_smart ? "Smart list" : "Static list"}
            </p>
          </TooltipContent>
        </Tooltip>
      ))}
      {overflowCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[11px] px-2 py-0.5 bg-gray-50 text-gray-600">
              +{overflowCount}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              {lists.slice(2).map((list) => (
                <p key={list.list_id} className="text-sm">
                  {list.is_smart && "✨ "}
                  {list.list_name}
                </p>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Displays which LinkedIn accounts a contact is connected to
 * Shows avatars of the linked accounts with tooltips
 */
function LinkedAccountsDisplay({
  contact,
  linkedinAccounts,
}: {
  contact: CrmContact;
  linkedinAccounts: import("@/hooks/useUnipileAccounts").UnipileAccount[];
}) {
  // Get the LinkedIn identity to find linked account IDs
  const linkedinIdentity = contact.identities?.find(
    (i) => i.channel === "linkedin"
  ) as { linked_account_ids?: string[] | null } | undefined;

  const linkedAccountIds = linkedinIdentity?.linked_account_ids || [];

  // Find the matching accounts
  const matchingAccounts = linkedinAccounts.filter((account) =>
    linkedAccountIds.includes(account.id)
  );

  if (matchingAccounts.length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {matchingAccounts.map((account) => (
        <Tooltip key={account.id}>
          <TooltipTrigger asChild>
            <div className="relative">
              {account.avatar_url ? (
                <img
                  src={account.avatar_url}
                  alt={account.display_name || "LinkedIn account"}
                  className="h-6 w-6 rounded-full border-2 border-white shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-6 w-6 rounded-full bg-[#0A66C2] flex items-center justify-center border-2 border-white shadow-sm">
                  <Linkedin className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">
              {account.display_name || account.username || "LinkedIn Account"}
            </p>
            {account.username && account.display_name && (
              <p className="text-xs text-muted-foreground">@{account.username}</p>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
