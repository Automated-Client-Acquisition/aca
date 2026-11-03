import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useSearchParams } from "react-router-dom";
import { useDebounce } from "use-debounce";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";
import { Inbox as InboxIcon, Search, Filter, RefreshCw, Bot, User, Star, Plus, ThumbsUp, Zap, ArrowUpDown, HelpCircle, Flame, X, Trash2, Send, MailCheck, Mail, Upload, Reply, ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { ContactDetails } from "@/components/inbox/ContactDetails";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { FeatureGate } from "@/components/UpgradePrompt";
import {
  useConversationsInfinite,
  useFavoriteConversations,
  useCloseConversation,
  useReopenConversation,
  useBatchConversationActions,
  useSentConversationCount,
  useUnreadConversationCount,
  useAllMatchingConversationIds,
  matchesExclusionKeywords,
  type ConversationFilters,
  type ConversationChannel,
  type ConversationStatus,
} from "@/hooks/crm/useConversations";
import { normalizeExclusionKeywords, useExclusionKeywords, useSaveExclusionKeywords } from "@/hooks/useExclusionKeywords";
import { useWarmupKeywordSuggestions, type WarmupKeywordSuggestion } from "@/hooks/useWarmupKeywordSuggestions";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useFavoriteConversationIds, useToggleFavorite, useToggleMute } from "@/hooks/crm/useConversationPreferences";
import { NewConversationDialog } from "@/components/inbox/NewConversationDialog";
import { useServerSearch } from "@/hooks/useServerSearch";
import { useSearchConversations } from "@/hooks/useSearchConversations";
import { LEAD_INTENT_LABELS, type LeadIntent } from "@/types/classification";
import { TriageMode } from "@/components/inbox/TriageMode";
import { CommandPalette } from "@/components/inbox/CommandPalette";
import { BatchSelectionBar } from "@/components/inbox/BatchSelectionBar";
import { BatchEnrollDialog } from "@/components/inbox/BatchEnrollDialog";
import { KeyboardShortcutsHelp } from "@/components/inbox/KeyboardShortcutsHelp";
import { SLAWidget } from "@/components/inbox/SLAWidget";
import { AutopilotQueuePanel } from "@/components/inbox/AutopilotQueuePanel";
import { ConversationAgentPanel } from "@/components/inbox/ConversationAgentPanel";
import { useSnoozeConversation, useAssignConversation } from "@/hooks/crm/useConversations";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";

const RESPONSE_QUEUE_INTENTS: LeadIntent[] = ["interested", "meeting_booked", "neutral"];

function needsHumanReply(intent: string | null) {
  return RESPONSE_QUEUE_INTENTS.includes(intent as LeadIntent);
}

export default function Inbox() {
  const { hasFeature } = useFeatureAccess();
  const hasMessagingAccess = hasFeature("messaging");
  const { currentOrganization, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Get contact ID from URL params (for deep linking from Contacts page)
  const contactIdFromUrl = searchParams.get("contact");

  // Tab state — primary: inbox/sent/all, secondary: favorites/mine
  const [activeTab, setActiveTab] = useState<"inbox" | "sent" | "all" | "favorites" | "mine">("inbox");

  // Exclusion keywords are saved per organization in Postgres. localStorage is
  // only used inside the hook as a one-time fallback for old browser-only lists.
  const persistedExclusionKeywords = useExclusionKeywords();
  const saveExclusionKeywords = useSaveExclusionKeywords();
  const [exclusionKeywords, setExclusionKeywords] = useState<string[]>(persistedExclusionKeywords);
  const [exclusionKeywordInput, setExclusionKeywordInput] = useState("");
  const [exclusionImportMode, setExclusionImportMode] = useState(false);
  const [exclusionImportText, setExclusionImportText] = useState("");

  // Warmup-token suggestions. Kept as a separate review step rather than folded
  // into the list: the detector also surfaces ordinary compounds like
  // "long-term", so nothing is excluded until it is ticked here.
  const suggestWarmupKeywords = useWarmupKeywordSuggestions();
  const [warmupSuggestions, setWarmupSuggestions] = useState<WarmupKeywordSuggestion[] | null>(null);
  const [pickedSuggestions, setPickedSuggestions] = useState<Set<string>>(new Set());

  // Parse a comma- or newline-separated list of keywords, dedupe against the existing set, return the merged list.
  const mergeImportedKeywords = useCallback(
    (raw: string, existing: string[]) => {
      const incoming = raw
        .split(/[\n,]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      const have = new Set(existing.map((k) => k.toLowerCase()));
      const merged = [...existing];
      for (const kw of incoming) {
        if (!have.has(kw.toLowerCase())) {
          merged.push(kw);
          have.add(kw.toLowerCase());
        }
      }
      return merged;
    },
    [],
  );

  useEffect(() => {
    setExclusionKeywords(persistedExclusionKeywords);
  }, [persistedExclusionKeywords]);

  const saveKeywordList = useCallback((nextKeywords: string[]) => {
    const normalized = normalizeExclusionKeywords(nextKeywords);
    setExclusionKeywords(normalized);
    saveExclusionKeywords.mutate(normalized);
  }, [saveExclusionKeywords]);

  // Filters
  const [filters, setFilters] = useState<ConversationFilters>({
    status: ["open", "snoozed"],
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showContactDetails, setShowContactDetails] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [singlePane, setSinglePane] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [conversationFocused, setConversationFocused] = useState(false);
  const conversationListRef = useRef<ImperativePanelHandle>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setSinglePane(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const openConversation = useCallback((id: string) => {
    setSelectedConversationId(id);
    setMobileThreadOpen(true);
  }, []);

  // New feature states
  const [triageActive, setTriageActive] = useState(false);
  const [responseQueueActive, setResponseQueueActive] = useState(false);
  const [responseQueueRestoreFilters, setResponseQueueRestoreFilters] = useState<ConversationFilters | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchDeletePending, setBatchDeletePending] = useState(false);
  const [batchEnrollDialogOpen, setBatchEnrollDialogOpen] = useState(false);

  // Server-side search
  const [debouncedSearchQuery] = useDebounce(searchQuery.trim(), 250);
  const serverSearchActive = searchQuery.trim().length >= 3;
  const searchQueryResult = useServerSearch(debouncedSearchQuery);
  const { data: searchResults } = searchQueryResult;

  // Fetch full conversation records for server search results
  const searchConversationIds = useMemo(() => {
    if (serverSearchActive && searchResults?.length) {
      return [...new Set(searchResults.map((r) => r.conversation_id))];
    }
    return undefined;
  }, [serverSearchActive, searchResults]);
  const searchRecordsQuery = useSearchConversations(searchConversationIds);
  const { data: searchConversations } = searchRecordsQuery;

  // Data fetching — infinite pagination
  const infiniteFilters = useMemo(() => ({
    ...filters,
    // Direction: Inbox = has inbound messages; Sent = has outbound messages
    ...(activeTab === "inbox" ? { direction_filter: "inbox" as const } :
        activeTab === "sent" ? { direction_filter: "sent_only" as const } : {}),
    // Mine tab: server-side filter by assigned_to_user_id
    ...(activeTab === "mine" ? { assigned_to_user_id: "mine" as const } : {}),
    exclude_keywords: exclusionKeywords.length > 0 ? exclusionKeywords : undefined,
  }), [filters, exclusionKeywords, activeTab]);

  const {
    data: infiniteData,
    isLoading,
    refetch,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    error: conversationsError,
  } = useConversationsInfinite(infiniteFilters, 30);

  const { data: favoriteIds } = useFavoriteConversationIds();
  const { data: favoriteConversations, isLoading: isFavoritesLoading, error: favoritesError, refetch: refetchFavorites } = useFavoriteConversations(
    favoriteIds,
    true, // always loaded so the tab badge matches the list
    {
      status: filters.status ? (Array.isArray(filters.status) ? filters.status : [filters.status]) : undefined,
      channel: filters.channel ? (Array.isArray(filters.channel) ? filters.channel : [filters.channel]) : undefined,
      exclude_keywords: exclusionKeywords.length > 0 ? exclusionKeywords : undefined,
    },
  );
  const { data: sentCount } = useSentConversationCount(
    Array.isArray(filters.status) ? filters.status : filters.status ? [filters.status] : undefined
  );
  const { data: unreadCount } = useUnreadConversationCount(
    ['open', 'snoozed'],
    { excludeSent: true },
  );

  // Fetch all matching IDs when "Select All" mode is active
  const { data: allMatchingIds, isFetching: isFetchingAllIds, error: matchingIdsError, refetch: retryMatchingIds } = useAllMatchingConversationIds(
    infiniteFilters,
    selectAllMode,
  );

  // Flatten pages into a single array
  const conversations = useMemo(() => {
    if (!infiniteData?.pages) return [];
    return infiniteData.pages.flatMap((p) => p.conversations);
  }, [infiniteData]);

  const totalCount = infiniteData?.pages?.[0]?.total ?? 0;

  // Apply the same visible constraints to search and favorites as the paginated view.
  const filteredConversations = useMemo(() => {
    const source = serverSearchActive ? searchConversations ?? []
      : activeTab === "favorites" ? favoriteConversations ?? [] : conversations;
    const matchesValue = (value: string | null, filter?: string | string[]) =>
      !filter || (Array.isArray(filter) ? filter.includes(value ?? "") : value === filter);
    const result = source.filter((conversation) => {
      if (conversation.is_system || !matchesValue(conversation.status, filters.status) ||
          !matchesValue(conversation.channel, filters.channel) ||
          !matchesValue(conversation.lead_intent, filters.lead_intent)) return false;
      if (activeTab === "inbox" && !conversation.has_inbound_message) return false;
      if (activeTab === "sent" && !conversation.has_outbound_message) return false;
      if (activeTab === "favorites" && !favoriteIds?.has(conversation.id)) return false;
      const assignment = activeTab === "mine" ? "mine" : filters.assigned_to_user_id;
      if (assignment !== undefined && conversation.assigned_to_user_id !== (assignment === "mine" ? user?.id : assignment)) return false;
      if (filters.assigned_to_type && conversation.assigned_to_type !== filters.assigned_to_type) return false;
      if (filters.has_unread && !conversation.unread_count) return false;
      if (filters.ai_enabled !== undefined && conversation.ai_enabled !== filters.ai_enabled) return false;
      if (matchesExclusionKeywords(conversation, exclusionKeywords)) return false;
      if (!serverSearchActive && searchQuery.trim()) {
        const haystack = [conversation.contact?.display_name, conversation.contact?.primary_email,
          conversation.last_message_subject, conversation.last_message_preview].join(" ").toLowerCase();
        if (!haystack.includes(searchQuery.trim().toLowerCase())) return false;
      }
      return !responseQueueActive || needsHumanReply(conversation.lead_intent);
    });
    if (filters.sort_by === "priority_score" || filters.sort_by === "momentum_score") {
      const key = filters.sort_by;
      result.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
    }
    return result;
  }, [conversations, activeTab, favoriteConversations, searchQuery, serverSearchActive,
    searchConversations, responseQueueActive, filters, exclusionKeywords, favoriteIds, user?.id]);

  const specialView = activeTab === "favorites" || searchQuery.trim().length > 0;
  const viewTotal = specialView ? filteredConversations.length : totalCount;
  const viewLoading = serverSearchActive
    ? debouncedSearchQuery !== searchQuery.trim() || searchQueryResult.isLoading || (!!searchConversationIds?.length && searchRecordsQuery.isLoading)
    : activeTab === "favorites" ? isFavoritesLoading : isLoading;
  const viewError = serverSearchActive ? searchQueryResult.error || (searchConversationIds?.length ? searchRecordsQuery.error : null)
    : activeTab === "favorites" ? favoritesError : conversationsError;
  const viewRefreshing = serverSearchActive ? searchQueryResult.isFetching || searchRecordsQuery.isFetching : activeTab === "favorites" ? isFavoritesLoading : isRefetching;
  const refreshView = () => {
    if (serverSearchActive) { searchQueryResult.refetch(); searchRecordsQuery.refetch(); }
    else if (activeTab === "favorites") refetchFavorites();
    else refetch();
  };
  const activeFilterCount = [filters.status, filters.channel, filters.assigned_to_type || filters.assigned_to_user_id,
    filters.lead_intent, exclusionKeywords.length > 0].filter(Boolean).length;
  const resetView = () => {
    setSearchQuery("");
    setFilters({ status: ["open", "snoozed"] });
    setResponseQueueActive(false);
    setResponseQueueRestoreFilters(null);
  };

  const favoritesCount = useMemo(() => {
    // Same server-fetched set the Favorites tab renders, not the paginated inbox page
    if (!favoriteIds || favoriteIds.size === 0) return 0;
    return favoriteConversations?.length ?? 0;
  }, [favoriteConversations, favoriteIds]);

  // Get selected conversation — check loaded lists first, then fallback fetch
  const selectedFromList = filteredConversations?.find(
    (c) => c.id === selectedConversationId
  ) || conversations?.find(
    (c) => c.id === selectedConversationId
  );
  // Fallback: fetch conversation by ID when not in the loaded list (e.g. autopilot queue deep-link)
  const fallbackConversationIds = useMemo(() => {
    if (selectedConversationId && !selectedFromList) return [selectedConversationId];
    return undefined;
  }, [selectedConversationId, selectedFromList]);
  const { data: fallbackConversations } = useSearchConversations(fallbackConversationIds);
  const selectedConversation = selectedFromList || fallbackConversations?.[0] || undefined;

  // Look up conversation ID for a deep-linked contact (may not be in the loaded list)
  const { data: contactConversationId } = useQuery({
    queryKey: ["conversation-by-contact", currentOrganization?.id, contactIdFromUrl],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_conversations")
        .select("id")
        .eq("contact_id", contactIdFromUrl!)
        .eq("organization_id", currentOrganization!.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    enabled: !!contactIdFromUrl && !!currentOrganization,
    staleTime: 60_000,
  });

  // Auto-select conversation based on contact ID from URL
  useEffect(() => {
    if (!contactIdFromUrl) return;

    // Try loaded list first
    const fromList = conversations?.find((c) => c.contact_id === contactIdFromUrl);
    const conversationId = fromList?.id ?? contactConversationId;

    if (conversationId) {
      openConversation(conversationId);
      setSearchParams({}, { replace: true });
      setShowContactDetails(true);
    }
  }, [contactIdFromUrl, conversations, contactConversationId, setSearchParams, openConversation]);

  // Selection belongs to this folder, search, filters and organization.
  useEffect(() => {
    setSelectedConversationIds(new Set());
    setSelectAllMode(false);
    setBatchDeleteDialogOpen(false);
    setBatchEnrollDialogOpen(false);
  }, [activeTab, filters, searchQuery, exclusionKeywords, currentOrganization?.id]);

  // Auto-select first conversation on load or tab change
  useEffect(() => {
    if (!singlePane && !selectedConversationId && !contactIdFromUrl && filteredConversations.length > 0) {
      setSelectedConversationId(filteredConversations[0].id);
    }
  }, [filteredConversations, selectedConversationId, contactIdFromUrl, singlePane]);

  const handleStatusFilter = (value: string) => {
    if (value === "all") {
      setFilters((prev) => ({ ...prev, status: undefined }));
    } else if (value === "open") {
      setFilters((prev) => ({ ...prev, status: ["open", "snoozed"] }));
    } else {
      setFilters((prev) => ({
        ...prev,
        status: value as ConversationStatus,
      }));
    }
  };

  const handleChannelFilter = (value: string) => {
    if (value === "all") {
      setFilters((prev) => ({ ...prev, channel: undefined }));
    } else {
      setFilters((prev) => ({
        ...prev,
        channel: value as ConversationChannel,
      }));
    }
  };

  const handleIntentFilter = (value: string) => {
    setResponseQueueActive(false);
    setResponseQueueRestoreFilters(null);
    if (value === "all") {
      setFilters((prev) => ({ ...prev, lead_intent: undefined }));
    } else {
      setFilters((prev) => ({
        ...prev,
        lead_intent: value,
      }));
    }
  };

  const handleAssignmentFilter = (value: string) => {
    if (value === "all") {
      setFilters((prev) => ({
        ...prev,
        assigned_to_type: undefined,
        assigned_to_user_id: undefined,
      }));
    } else if (value === "mine") {
      setFilters((prev) => ({
        ...prev,
        assigned_to_user_id: "mine",
        assigned_to_type: undefined,
      }));
    } else if (value === "ai") {
      setFilters((prev) => ({
        ...prev,
        assigned_to_type: "ai",
        assigned_to_user_id: undefined,
      }));
    } else if (value === "human") {
      setFilters((prev) => ({
        ...prev,
        assigned_to_type: "user",
        assigned_to_user_id: undefined,
      }));
    } else if (value === "unassigned") {
      setFilters((prev) => ({
        ...prev,
        assigned_to_type: "unassigned",
        assigned_to_user_id: undefined,
      }));
    }
  };

  const toggleResponseQueue = useCallback(() => {
    if (responseQueueActive) {
      setFilters(responseQueueRestoreFilters ?? { status: ["open", "snoozed"] });
      setResponseQueueRestoreFilters(null);
      setResponseQueueActive(false);
      return;
    }

    setResponseQueueRestoreFilters(filters);
    setActiveTab("inbox");
    setSelectedConversationId(null);
    setFilters((previous) => ({
      ...previous,
      status: "open",
      lead_intent: RESPONSE_QUEUE_INTENTS,
      sort_by: "priority_score",
    }));
    setResponseQueueActive(true);
  }, [filters, responseQueueActive, responseQueueRestoreFilters]);

  // Mutation hooks for keyboard shortcuts
  const closeConversation = useCloseConversation();
  const reopenConversation = useReopenConversation();
  const toggleFavorite = useToggleFavorite();
  const toggleMute = useToggleMute();
  const snoozeConversation = useSnoozeConversation();
  const assignConversation = useAssignConversation();
  const batch = useBatchConversationActions();
  const { data: orgMembers } = useOrganizationMembers();

  // Batch selection handlers
  const displayedSelectedIds = useMemo(() => selectAllMode
    ? new Set(allMatchingIds ?? selectedConversationIds) : selectedConversationIds,
  [selectAllMode, allMatchingIds, selectedConversationIds]);

  const handleToggleSelect = useCallback((id: string) => {
    // A manual change returns to explicit selection of the loaded rows.
    setSelectAllMode(false);
    setSelectedConversationIds((previous) => {
      const next = selectAllMode
        ? new Set(filteredConversations.filter((conversation) => displayedSelectedIds.has(conversation.id)).map((conversation) => conversation.id))
        : new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [selectAllMode, filteredConversations, displayedSelectedIds]);

  const handleSelectAll = useCallback(() => {
    const allIds = filteredConversations.map((conversation) => conversation.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => displayedSelectedIds.has(id));
    setSelectAllMode(false);
    setSelectedConversationIds(new Set(allSelected ? [] : allIds));
  }, [filteredConversations, displayedSelectedIds]);

  const handleSelectAllMatching = useCallback(() => {
    if (!specialView) setSelectAllMode(true);
  }, [specialView]);

  const handleClearSelection = useCallback(() => {
    setSelectedConversationIds(new Set());
    setSelectAllMode(false);
  }, []);

  // Effective IDs for batch actions: select-all mode uses server IDs, otherwise manual selection
  const effectiveBatchIds = useMemo(() => {
    if (selectAllMode) return allMatchingIds ?? [];
    return Array.from(selectedConversationIds);
  }, [selectAllMode, allMatchingIds, selectedConversationIds]);

  // Sort toggle handler
  const handleSortChange = (value: string) => {
    if (value === 'recent') {
      setFilters((prev) => ({ ...prev, sort_by: 'last_message_at' }));
    } else if (value === 'priority') {
      setFilters((prev) => ({ ...prev, sort_by: 'priority_score' }));
    } else if (value === 'momentum') {
      setFilters((prev) => ({ ...prev, sort_by: 'momentum_score' }));
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K: command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Skip if user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest("[role=dialog], [role=menu], [role=listbox], [role=combobox], [role=tablist]") ||
        (target.closest("button, a, [role=checkbox]") && !target.closest("[data-inbox-conversation]"))
      ) {
        return;
      }

      const currentIndex = filteredConversations.findIndex(
        (c) => c.id === selectedConversationId
      );

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = Math.min(currentIndex + 1, filteredConversations.length - 1);
          if (filteredConversations[nextIndex]) {
            openConversation(filteredConversations[nextIndex].id);
          }
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          if (filteredConversations[prevIndex]) {
            openConversation(filteredConversations[prevIndex].id);
          }
          break;
        }
        case "e": {
          if (!selectedConversation) break;
          if (selectedConversation.status === "open") {
            closeConversation.mutate(selectedConversation.id);
          } else {
            reopenConversation.mutate(selectedConversation.id);
          }
          break;
        }
        case "f": {
          if (!selectedConversationId) break;
          toggleFavorite.mutate({ conversationId: selectedConversationId });
          break;
        }
        case "m": {
          if (!selectedConversationId) break;
          toggleMute.mutate({ conversationId: selectedConversationId });
          break;
        }
        case "i": {
          if (!selectedConversationId) break;
          setShowContactDetails((prev) => !prev);
          break;
        }
        case "x": {
          if (!selectedConversationId) break;
          handleToggleSelect(selectedConversationId);
          break;
        }
        case "Escape": {
          if (selectedConversationIds.size > 0 || selectAllMode) {
            handleClearSelection();
          }
          if (triageActive) {
            setTriageActive(false);
          }
          break;
        }
        case "?": {
          setKeyboardHelpOpen(true);
          break;
        }
        case "t": {
          if (!triageActive && !responseQueueActive) toggleResponseQueue();
          setTriageActive((prev) => !prev);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    filteredConversations,
    selectedConversationId,
    selectedConversation,
    closeConversation,
    reopenConversation,
    toggleFavorite,
    toggleMute,
    handleToggleSelect,
    selectedConversationIds,
    triageActive,
    responseQueueActive,
    toggleResponseQueue,
    openConversation,
    handleClearSelection,
    selectAllMode,
  ]);

  const { data: hasAnyConversations } = useQuery({
    queryKey: ["inbox-has-conversations", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_conversations").select("id")
        .eq("organization_id", currentOrganization!.id).eq("is_system", false).limit(1).maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!currentOrganization && !viewLoading && filteredConversations.length === 0,
  });
  const onboardingEmpty = hasAnyConversations === false && !searchQuery && !responseQueueActive && activeTab === "inbox";

  const listPanel = (
    <ConversationList conversations={filteredConversations} isLoading={viewLoading}
      selectedId={selectedConversationId} onSelect={openConversation}
      selectedIds={displayedSelectedIds} onToggleSelect={handleToggleSelect} onSelectAll={handleSelectAll}
      totalCount={viewTotal} countLabel={serverSearchActive ? `${filteredConversations.length} search results · up to 50 matches, filtered` : searchQuery.trim() ? `${filteredConversations.length} matches in loaded conversations` : undefined} hasNextPage={!specialView && hasNextPage}
      isFetchingNextPage={isFetchingNextPage} onLoadMore={() => fetchNextPage()}
      emptyTitle={onboardingEmpty ? undefined : searchQuery ? "No matching conversations" : responseQueueActive ? "No replies needing action" : "No conversations in this view"}
      emptyDescription={onboardingEmpty ? undefined : searchQuery ? "Try a different name, email or message, or adjust your filters." : "Try another folder or adjust your filters to find a conversation."}
      onResetView={onboardingEmpty ? undefined : () => { resetView(); setActiveTab("all"); setFilters({}); }} errorMessage={viewError ? "Conversations could not be loaded. Please try again." : undefined} onRetry={refreshView}
    />
  );
  useEffect(() => {
    if (!selectedConversation && conversationFocused) conversationListRef.current?.expand();
  }, [selectedConversation, conversationFocused]);
  const threadPanel = (
    <ConversationThread conversation={selectedConversation || null} isActive={!singlePane || mobileThreadOpen}
      isFocused={conversationFocused} onToggleFocus={singlePane ? undefined : () => {
        if (conversationFocused) conversationListRef.current?.expand();
        else conversationListRef.current?.collapse();
      }}
      onToggleContactDetails={() => { setShowAgentPanel(false); setShowContactDetails((show) => !show); }}
      showContactDetails={showContactDetails} onSwitchConversation={openConversation}
      onConversationDeleted={() => { setSelectedConversationId(null); setMobileThreadOpen(false); }}
      onToggleAgentPanel={() => { setShowAgentPanel(true); setShowContactDetails(true); }} showAgentPanel={showAgentPanel && showContactDetails}
    />
  );

  return (
    <AppLayout
      hideActivationChecklist={singlePane && mobileThreadOpen}
      disableScroll
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <FeatureGate feature="messaging">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className={cn("shrink-0 border-b bg-background", (singlePane && mobileThreadOpen || conversationFocused && !singlePane) && "hidden")}>
            {/* Row 1: Title + Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
              <div className="flex w-full items-center gap-3 sm:w-auto">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <InboxIcon className="h-5 w-5" />
                </div>
                <h1 className="text-xl font-bold">Inbox</h1>
                {(unreadCount ?? 0) > 0 && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                    {(unreadCount ?? 0) > 99 ? "99+" : unreadCount}
                  </Badge>
                )}
                <Button variant="cta" size="sm" className="ml-auto gap-1.5 sm:hidden" onClick={() => setNewConversationOpen(true)}>
                  <Plus className="h-4 w-4" /> New Message
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={responseQueueActive ? "secondary" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={toggleResponseQueue}
                  aria-pressed={responseQueueActive}
                  title="Focus on replies that need a human response"
                >
                  <Reply className="h-4 w-4 mr-1.5" />
                  {responseQueueActive ? "All received" : <><span className="sm:hidden">Reply queue</span><span className="hidden sm:inline">Response queue</span></>}
                </Button>

                {/* Triage Mode */}
                <Button
                  variant={triageActive ? "secondary" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    if (!triageActive && !responseQueueActive) toggleResponseQueue();
                    setTriageActive((active) => !active);
                  }}
                  aria-pressed={triageActive}
                  title="Review replies that need a human response"
                >
                  <Zap className="h-4 w-4 mr-1.5" />
                  <span className="sm:hidden">Triage</span><span className="hidden sm:inline">Triage replies</span>
                </Button>

                {/* Autopilot Queue */}
                <AutopilotQueuePanel
                  onSelectConversation={(conversationId) => {
                    openConversation(conversationId);
                    setShowAgentPanel(true);
                    setShowContactDetails(true);
                  }}
                />

                {/* SLA Widget */}
                <SLAWidget />

                {/* New Conversation */}
                <Button
                  variant="cta"
                  size="sm"
                  className="hidden h-8 sm:inline-flex"
                  onClick={() => setNewConversationOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Message
                </Button>

              </div>
            </div>

            {/* Folders, search and filter disclosure */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
              <Tabs className="max-w-full overflow-x-auto"
                value={activeTab}
                onValueChange={(v) => {
                  setActiveTab(v as typeof activeTab);
                  setMobileThreadOpen(false);
                  if (v !== "inbox") {
                    if (responseQueueActive) {
                      setFilters(responseQueueRestoreFilters ?? { status: ["open", "snoozed"] });
                    }
                    setResponseQueueActive(false);
                    setResponseQueueRestoreFilters(null);
                  }
                }}
              >
                <TabsList className="h-9">
                  <TabsTrigger value="inbox" className="text-xs px-3">
                    <MailCheck className="h-3 w-3 mr-1" />
                    Received
                    {(unreadCount ?? 0) > 0 && (
                      <Badge variant="default" className="ml-1.5 h-4 px-1 text-[10px] bg-blue-500">
                        {(unreadCount ?? 0) > 99 ? "99+" : unreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="sent" className="text-xs px-3">
                    <Send className="h-3 w-3 mr-1" />
                    Sent
                    {(sentCount ?? 0) > 0 && (
                      <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                        {sentCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="all" className="text-xs px-3">
                    All
                  </TabsTrigger>
                  <div className="w-px h-4 bg-border mx-1" />
                  <TabsTrigger value="favorites" className="text-xs px-3">
                    <Star className="h-3 w-3 mr-1" />
                    Favorites
                    {favoritesCount > 0 && (
                      <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                        {favoritesCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="mine" className="text-xs px-3">
                    <User className="h-3 w-3 mr-1" />
                    Mine

                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex w-full min-w-0 items-center justify-end gap-2 lg:w-auto">
                {/* Search */}
                <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search conversations..."
                    className="h-9 pl-9 pr-9"
                    aria-label="Search conversations"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-9 w-9" aria-label="Clear search" onClick={() => setSearchQuery("")}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <Button
                  variant={filters.has_unread ? "secondary" : "outline"} size="sm" className="h-9 gap-1.5"
                  aria-pressed={!!filters.has_unread}
                  onClick={() => setFilters((prev) => ({ ...prev, has_unread: prev.has_unread ? undefined : true }))}
                >
                  <Mail className="h-3.5 w-3.5" /> Unread
                </Button>
                <Button
                  variant={filtersOpen ? "secondary" : "outline"} size="sm" className="h-9 gap-1.5"
                  aria-expanded={filtersOpen} aria-controls="inbox-filters" onClick={() => setFiltersOpen((open) => !open)}
                >
                  <Filter className="h-3.5 w-3.5" /> Filters
                  {activeFilterCount > 0 && <Badge variant="secondary" className="h-5 px-1.5">{activeFilterCount}</Badge>}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={refreshView}
                  disabled={viewRefreshing}
                  aria-label="Refresh conversations"
                  title="Refresh conversations"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${viewRefreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
            </div>

            {/* Row 3: Filters */}
            <div id="inbox-filters" className={cn("flex flex-wrap items-center gap-2 border-t px-4 py-3", !filtersOpen && "hidden")}>
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {responseQueueActive && (
                <span className="text-xs font-medium text-foreground whitespace-nowrap">
                  Replies needing action
                </span>
              )}
              <Select
                value={Array.isArray(filters.status) ? "open" : filters.status ?? "all"}
                onValueChange={handleStatusFilter}
              >
                <SelectTrigger aria-label="Status" className="w-[110px] h-9 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="snoozed">Snoozed</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>

              <Select value={Array.isArray(filters.channel) ? filters.channel[0] : filters.channel ?? "all"} onValueChange={handleChannelFilter}>
                <SelectTrigger aria-label="Channel" className="w-[120px] h-9 text-xs">
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="messenger">Messenger</SelectItem>
                  <SelectItem value="twitter">X (Twitter)</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.assigned_to_user_id === "mine" ? "mine" : filters.assigned_to_type === "user" ? "human" : filters.assigned_to_type ?? "all"}
                onValueChange={handleAssignmentFilter}
              >
                <SelectTrigger aria-label="Assignment" className="w-[120px] h-9 text-xs">
                  <SelectValue placeholder="Assignment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any assignment</SelectItem>
                  <SelectItem value="mine" textValue="Assigned to Me">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> Assigned to Me
                    </span>
                  </SelectItem>
                  <SelectItem value="ai" textValue="AI Handling">
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3" /> AI Handling
                    </span>
                  </SelectItem>
                  <SelectItem value="human" textValue="Human">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> Human
                    </span>
                  </SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>

              <Select value={Array.isArray(filters.lead_intent) ? "response_queue" : filters.lead_intent ?? "all"} onValueChange={handleIntentFilter}>
                <SelectTrigger aria-label="Intent" className="w-[120px] h-9 text-xs">
                  <SelectValue placeholder="Intent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Intents</SelectItem>
                  {responseQueueActive && <SelectItem value="response_queue">Needs a reply</SelectItem>}
                  {Object.entries(LEAD_INTENT_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Keyword Exclusion Filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={exclusionKeywords.length > 0 ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 text-xs px-2.5 gap-1.5"
                  >
                    <Flame className="h-3 w-3" />
                    {exclusionKeywords.length > 0
                      ? `Excluded (${exclusionKeywords.length})`
                      : "Exclude Keywords"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] max-h-[70dvh] overflow-y-auto p-3" align="start">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Exclude by keyword</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2 gap-1"
                        onClick={() => setExclusionImportMode((v) => !v)}
                      >
                        <Upload className="h-3 w-3" />
                        {exclusionImportMode ? "Cancel" : "Import list"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Saved per organization. Matching email conversations are removed from the inbox and their contacts are archived out of People.
                    </p>

                    {/* Warmup scan. Only useful where an external warmup network
                        runs on the sending mailboxes, so it stays a manual
                        action rather than something that runs on open. */}
                    <div className="rounded-md border border-dashed p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Inbox full of warmup mail? Scan for the filler terms it uses.
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 text-[11px] px-2 shrink-0"
                          disabled={suggestWarmupKeywords.isPending}
                          onClick={() => {
                            setPickedSuggestions(new Set());
                            suggestWarmupKeywords.mutate(undefined, {
                              onSuccess: (rows) => {
                                setWarmupSuggestions(rows);
                                // Nothing pre-ticked, deliberately. Sender
                                // spread does NOT separate warmup filler from
                                // ordinary business jargon -- on real data the
                                // highest-spread terms were "cutting-edge"
                                // (428 senders), "data-driven", "real-time".
                                // Excluding those would hide genuine replies.
                                // Only a human can tell the two apart.
                                setPickedSuggestions(new Set());
                              },
                              onError: (err) =>
                                toast({
                                  title: "Scan failed",
                                  description: err instanceof Error ? err.message : "Please try again.",
                                  variant: "destructive",
                                }),
                            });
                          }}
                        >
                          {suggestWarmupKeywords.isPending ? "Scanning..." : "Scan"}
                        </Button>
                      </div>

                      {warmupSuggestions?.length === 0 && (
                        <p className="text-[11px] text-muted-foreground italic">
                          Nothing found — no repeated filler terms in the last 30 days.
                        </p>
                      )}

                      {!!warmupSuggestions?.length && (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            Each term appeared across that many separate senders. Warmup filler reads as
                            nonsense — <span className="font-mono">suitable-pottery</span>. Ordinary
                            phrases like <span className="font-mono">real-time</span> show up here too and
                            are usually near the top: tick those and you'll hide genuine replies.
                          </p>
                          <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
                            {warmupSuggestions.map((s) => (
                              <label
                                key={s.keyword}
                                className="flex items-center gap-2 text-[11px] cursor-pointer rounded px-1 py-0.5 hover:bg-muted"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3"
                                  checked={pickedSuggestions.has(s.keyword)}
                                  onChange={(e) => {
                                    const next = new Set(pickedSuggestions);
                                    if (e.target.checked) next.add(s.keyword);
                                    else next.delete(s.keyword);
                                    setPickedSuggestions(next);
                                  }}
                                />
                                <span className="font-mono truncate">{s.keyword}</span>
                                <span className="ml-auto text-muted-foreground shrink-0">
                                  {s.sender_count} senders
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[11px] px-2"
                              onClick={() => {
                                setWarmupSuggestions(null);
                                setPickedSuggestions(new Set());
                              }}
                            >
                              Dismiss
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] px-2"
                              disabled={pickedSuggestions.size === 0 || saveExclusionKeywords.isPending}
                              onClick={() => {
                                saveKeywordList([...exclusionKeywords, ...pickedSuggestions]);
                                setWarmupSuggestions(null);
                                setPickedSuggestions(new Set());
                              }}
                            >
                              Add {pickedSuggestions.size} term{pickedSuggestions.size === 1 ? "" : "s"}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                    {exclusionImportMode ? (
                      <form
                        className="space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveKeywordList(mergeImportedKeywords(exclusionImportText, exclusionKeywords));
                          setExclusionImportText("");
                          setExclusionImportMode(false);
                        }}
                      >
                        <Textarea
                          placeholder={"Paste keywords (one per line or comma-separated)\nsmartlead\nDMARC\n[MW"}
                          className="text-xs h-24 resize-none"
                          value={exclusionImportText}
                          onChange={(e) => setExclusionImportText(e.target.value)}
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2.5"
                            onClick={() => {
                              setExclusionImportText("");
                              setExclusionImportMode(false);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2.5"
                            disabled={exclusionImportText.trim().length === 0 || saveExclusionKeywords.isPending}
                          >
                            {saveExclusionKeywords.isPending ? "Saving..." : "Import"}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const kw = exclusionKeywordInput.trim();
                          if (kw && !exclusionKeywords.includes(kw)) {
                            saveKeywordList([...exclusionKeywords, kw]);
                          }
                          setExclusionKeywordInput("");
                        }}
                      >
                        <Input
                          placeholder="e.g. smartlead, DMARC, [MW..."
                          className="h-7 text-xs"
                          value={exclusionKeywordInput}
                          onChange={(e) => setExclusionKeywordInput(e.target.value)}
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2.5"
                          disabled={saveExclusionKeywords.isPending}
                        >
                          {saveExclusionKeywords.isPending ? "Saving..." : "Add"}
                        </Button>
                      </form>
                    )}
                    {exclusionKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {exclusionKeywords.map((kw) => (
                          <Badge
                            key={kw}
                            variant="secondary"
                            className="text-[11px] gap-1 pr-1"
                          >
                            {kw}
                            <button
                              onClick={() =>
                                saveKeywordList(exclusionKeywords.filter((k) => k !== kw))
                              }
                              aria-label={`Remove excluded keyword ${kw}`}
                              className="hover:text-destructive"
                              disabled={saveExclusionKeywords.isPending}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {exclusionKeywords.length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic">
                        No keywords yet. Add keywords to hide matching conversations from the inbox.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <div className="w-px h-4 bg-border mx-1" />

              {/* Sort Toggle */}
              <Select value={filters.sort_by === "priority_score" ? "priority" : filters.sort_by === "momentum_score" ? "momentum" : "recent"} onValueChange={handleSortChange}>
                <SelectTrigger aria-label="Sort conversations" className="w-[120px] h-9 text-xs">
                  <ArrowUpDown className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Recent</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="momentum">Momentum</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={resetView}>Reset filters</Button>
              {/* Keyboard help */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 ml-auto"
                onClick={() => setKeyboardHelpOpen(true)}
                aria-label="Show keyboard shortcuts"
                title="Show keyboard shortcuts"
              >
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>

          {/* Batch Selection Bar */}
          {(selectedConversationIds.size > 0 || selectAllMode) && (
            <BatchSelectionBar
              selectedCount={selectAllMode ? (allMatchingIds?.length ?? totalCount) : selectedConversationIds.size}
              totalCount={viewTotal}
              loadedCount={filteredConversations.length}
              selectAllMode={selectAllMode}
              isFetchingAll={isFetchingAllIds || (selectAllMode && !allMatchingIds && !matchingIdsError)}
              selectionError={selectAllMode && matchingIdsError ? "Could not select all matching conversations." : undefined}
              onRetrySelection={() => retryMatchingIds()}
              onClearSelection={handleClearSelection}
              onSelectAll={handleSelectAll}
              onSelectAllMatching={specialView ? undefined : handleSelectAllMatching}
              onBatchClose={async () => {
                const ids = effectiveBatchIds;
                handleClearSelection();
                await batch.batchClose(ids);
              }}
              onBatchSnooze={async () => {
                const ids = effectiveBatchIds;
                const until = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
                handleClearSelection();
                await batch.batchSnooze(ids, until);
              }}
              onBatchMute={async () => {
                const ids = effectiveBatchIds;
                handleClearSelection();
                await batch.batchMute(ids);
              }}
              onBatchMarkRead={async () => {
                const ids = effectiveBatchIds;
                handleClearSelection();
                await batch.batchMarkRead(ids);
              }}
              onBatchDelete={() => setBatchDeleteDialogOpen(true)}
              onBatchEnroll={selectAllMode ? undefined : () => setBatchEnrollDialogOpen(true)}
              onBatchAssign={async (userId) => {
                const ids = effectiveBatchIds;
                handleClearSelection();
                for (const id of ids) {
                  await assignConversation.mutateAsync({
                    conversationId: id,
                    userId,
                    type: userId ? "user" : "unassigned",
                  });
                }
              }}
              members={orgMembers}
            />
          )}

          {/* Workspace */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {triageActive ? (
              <TriageMode
                conversations={filteredConversations}
                onExit={() => setTriageActive(false)}
                onConversationAction={(action, conversationId) => {
                  if (action === 'close') {
                    closeConversation.mutate(conversationId);
                  } else if (action === 'snooze') {
                    const until = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
                    snoozeConversation.mutate({ conversationId, until });
                  }
                  // 'skip' just advances — handled internally by TriageMode
                }}
              />
            ) : singlePane ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className={cn("min-h-0 flex-1", mobileThreadOpen && "hidden")}>{listPanel}</div>
                <div className={cn("flex min-h-0 flex-1 flex-col", !mobileThreadOpen && "hidden")}>
                  <div className="shrink-0 border-b px-3 py-2">
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setMobileThreadOpen(false)}>
                      <ArrowLeft className="h-4 w-4" /> Back to conversations
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1">{threadPanel}</div>
                </div>
              </div>
            ) : (
              <ResizablePanelGroup direction="horizontal">
                <ResizablePanel ref={conversationListRef} collapsible collapsedSize={0} onCollapse={() => setConversationFocused(true)} onExpand={() => setConversationFocused(false)} id="conversation-list" order={1} defaultSize={36} minSize={28} maxSize={48} className="min-w-0 overflow-hidden">
                  {listPanel}
                </ResizablePanel>
                <ResizableHandle withHandle className={conversationFocused ? "hidden" : undefined} />
                <ResizablePanel id="message-thread" order={2} defaultSize={64} minSize={45} className="min-w-0">
                  {threadPanel}
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </div>

        <Sheet open={showContactDetails} onOpenChange={setShowContactDetails}>
          <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md [&>button]:hidden">
            <SheetTitle className="sr-only">{showAgentPanel ? "Conversation AI agent" : "Contact details"}</SheetTitle>
            <SheetDescription className="sr-only">Details and activity for the selected conversation.</SheetDescription>
            <div className="min-h-0 flex-1">
              {showAgentPanel && selectedConversation?.ai_enabled ? (
                <ConversationAgentPanel key={selectedConversation.id} conversation={selectedConversation}
                  contact={selectedConversation.contact || null} onClose={() => setShowContactDetails(false)} defaultTab="agent" />
              ) : (
                <ContactDetails contact={selectedConversation?.contact || null} conversation={selectedConversation || null}
                  onClose={() => setShowContactDetails(false)} />
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* New Conversation Dialog */}
        <NewConversationDialog
          open={newConversationOpen}
          onOpenChange={setNewConversationOpen}
          onConversationCreated={(id) => {
            openConversation(id);
            refetch();
          }}
        />

        {/* Batch Enroll in Sequence Dialog */}
        <BatchEnrollDialog
          open={batchEnrollDialogOpen}
          onOpenChange={setBatchEnrollDialogOpen}
          conversations={filteredConversations.filter((c) =>
            selectAllMode
              ? allMatchingIds?.includes(c.id)
              : selectedConversationIds.has(c.id)
          )}
          onComplete={handleClearSelection}
        />

        {/* Batch Delete Confirmation Dialog */}
        <Dialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {effectiveBatchIds.length} conversation{effectiveBatchIds.length !== 1 ? 's' : ''}?</DialogTitle>
              <DialogDescription>
                This will permanently delete the selected conversation{effectiveBatchIds.length !== 1 ? 's' : ''} and all their messages. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBatchDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={batchDeletePending}
                onClick={async () => {
                  setBatchDeletePending(true);
                  const ids = effectiveBatchIds;
                  // Clear selection and deselect current if it's being deleted
                  if (selectedConversationId && ids.includes(selectedConversationId)) {
                    setSelectedConversationId(null);
                  }
                  handleClearSelection();
                  setBatchDeleteDialogOpen(false);
                  await batch.batchDelete(ids);
                  setBatchDeletePending(false);
                }}
              >
                {batchDeletePending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Command Palette */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          conversations={filteredConversations}
          selectedConversation={selectedConversation || null}
          onAction={(action) => {
            if (action.type === 'navigate') {
              if (action.conversationId === '__new__') {
                setNewConversationOpen(true);
              } else {
                openConversation(action.conversationId);
              }
            } else if (action.type === 'close' && selectedConversationId) {
              closeConversation.mutate(selectedConversationId);
            } else if (action.type === 'reopen' && selectedConversationId) {
              reopenConversation.mutate(selectedConversationId);
            } else if (action.type === 'snooze' && selectedConversationId) {
              const until = new Date(Date.now() + action.hours * 60 * 60 * 1000).toISOString();
              snoozeConversation.mutate({ conversationId: selectedConversationId, until });
            } else if (action.type === 'favorite' && selectedConversationId) {
              toggleFavorite.mutate({ conversationId: selectedConversationId });
            } else if (action.type === 'mute' && selectedConversationId) {
              toggleMute.mutate({ conversationId: selectedConversationId });
            }
          }}
        />

        {/* Keyboard Shortcuts Help */}
        <KeyboardShortcutsHelp
          open={keyboardHelpOpen}
          onOpenChange={setKeyboardHelpOpen}
        />
      </FeatureGate>
    </AppLayout>
  );
}
