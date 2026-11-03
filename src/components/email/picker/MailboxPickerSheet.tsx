import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, X, Filter, Sparkles, Save, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmailMailboxes, useMailboxTags } from "@/hooks/useEmailMailboxes";
import { useEmailSendingDomains } from "@/hooks/useEmailSendingDomains";
import { useMailboxAssignments, type MailboxAssignment } from "@/hooks/useMailboxAssignments";
import { MailboxRow } from "./MailboxRow";
import { MailboxSetSelector } from "./MailboxSetSelector";
import { SaveMailboxSetDialog } from "./SaveMailboxSetDialog";
import { getMailboxStatusInfo } from "@/lib/mailbox-status";
import type { EmailMailbox } from "@/types/email";

type GroupBy = "none" | "workspace" | "domain" | "tag" | "health";

type StatusFacet = "ready" | "unhealthy" | "warming" | "paused" | "burned" | "available" | "in_use" | "unused";

interface MailboxPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "single" | "multi";
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  title?: string;
  description?: string;
  showPresets?: boolean;
  /** Sequence being edited — its own pool is not counted as "in use". */
  excludeSequenceId?: string;
}

interface VirtualItem {
  kind: "header" | "row";
  key: string;
  groupKey?: string;
  groupLabel?: string;
  groupCount?: number;
  groupSelectedCount?: number;
  mailbox?: EmailMailbox;
  isUnhealthy?: boolean;
  unhealthyReason?: string;
  workspaceName?: string | null;
  domain?: string | null;
  inUseBy?: MailboxAssignment[];
}

const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 40;

function getWorkspaceName(m: EmailMailbox): string | null {
  const meta = m.metadata as Record<string, unknown> | null;
  return (meta?.zapmail_workspace_name as string | undefined) ?? null;
}

function isUnhealthyMailbox(m: EmailMailbox): { unhealthy: boolean; reason?: string } {
  const { unhealthy, reason } = getMailboxStatusInfo(m);
  return { unhealthy, reason };
}

function healthBucket(m: EmailMailbox): "healthy" | "watch" | "risky" {
  if (m.health_score >= 80) return "healthy";
  if (m.health_score >= 50) return "watch";
  return "risky";
}

export function MailboxPickerSheet({
  open,
  onOpenChange,
  mode,
  selectedIds,
  onChange,
  title,
  description,
  showPresets = true,
  excludeSequenceId,
}: MailboxPickerSheetProps) {
  const { data: allMailboxes = [], isLoading } = useEmailMailboxes();
  const { data: sendingDomains = [] } = useEmailSendingDomains();
  const { data: assignmentMap } = useMailboxAssignments();
  const availableTags = useMailboxTags();

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFacet[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [showUnhealthy, setShowUnhealthy] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Reset transient state when the sheet closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedOnly(false);
      setAvailableOnly(false);
    }
  }, [open]);

  // Auto-default group-by to "domain" when many distinct domains are present
  useEffect(() => {
    if (!open) return;
    if (groupBy !== "none") return;
    const domains = new Set<string>();
    for (const m of allMailboxes) {
      const dom = m.email_address.split("@")[1];
      if (dom) domains.add(dom);
    }
    if (domains.size > 10) setGroupBy("domain");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allMailboxes.length]);

  // Quick-lookup maps
  const domainNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of sendingDomains) m.set(d.id, d.domain);
    return m;
  }, [sendingDomains]);

  const decoratedMailboxes = useMemo(() => {
    return allMailboxes.map((m) => {
      const { unhealthy, reason } = isUnhealthyMailbox(m);
      const allAssignments = assignmentMap?.get(m.id) ?? [];
      // "In use" means an ACTIVE sequence (other than the one being edited)
      // sends from this mailbox — paused/draft/completed sequences keep their
      // pool config but release the mailbox. "Unused" means assigned to no
      // sequence at all, in any status.
      const otherAssignments = excludeSequenceId
        ? allAssignments.filter((a) => a.sequenceId !== excludeSequenceId)
        : allAssignments;
      const inUseBy = otherAssignments.filter((a) => a.status === "active");
      return {
        mailbox: m,
        isUnhealthy: unhealthy,
        unhealthyReason: reason,
        workspaceName: getWorkspaceName(m),
        domain:
          (m.sending_domain_id && domainNameById.get(m.sending_domain_id)) ||
          m.email_address.split("@")[1] ||
          null,
        inUseBy,
        isInUse: inUseBy.length > 0,
        isUnused: allAssignments.length === 0,
      };
    });
  }, [allMailboxes, domainNameById, assignmentMap, excludeSequenceId]);

  // Distinct facet options
  const workspaceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of decoratedMailboxes) {
      if (d.workspaceName) set.add(d.workspaceName);
    }
    return Array.from(set).sort();
  }, [decoratedMailboxes]);

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of decoratedMailboxes) {
      if (d.domain) set.add(d.domain);
    }
    return Array.from(set).sort();
  }, [decoratedMailboxes]);

  const unhealthyCount = useMemo(
    () => decoratedMailboxes.filter((d) => d.isUnhealthy).length,
    [decoratedMailboxes]
  );

  const inUseCount = useMemo(
    () => decoratedMailboxes.filter((d) => d.isInUse).length,
    [decoratedMailboxes]
  );

  // Filtering pipeline
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decoratedMailboxes.filter((d) => {
      if (!showUnhealthy && d.isUnhealthy) return false;
      if (availableOnly && d.isInUse) return false;
      if (statusFilter.length > 0) {
        const ok = statusFilter.some((s) => {
          if (s === "ready") return d.mailbox.status === "ready" && d.mailbox.imap_connected;
          if (s === "unhealthy") return d.isUnhealthy;
          if (s === "available") return !d.isInUse;
          if (s === "in_use") return d.isInUse;
          if (s === "unused") return d.isUnused;
          return d.mailbox.status === s;
        });
        if (!ok) return false;
      }
      if (tagFilter.length > 0) {
        const tags = d.mailbox.tags || [];
        if (!tagFilter.some((t) => tags.includes(t))) return false;
      }
      if (workspaceFilter.length > 0) {
        if (!d.workspaceName || !workspaceFilter.includes(d.workspaceName)) return false;
      }
      if (domainFilter.length > 0) {
        if (!d.domain || !domainFilter.includes(d.domain)) return false;
      }
      if (selectedOnly && !selectedIds.includes(d.mailbox.id)) return false;
      if (q) {
        const hay = [
          d.mailbox.email_address,
          d.mailbox.display_name || "",
          d.workspaceName || "",
          d.domain || "",
          ...(d.mailbox.tags || []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    decoratedMailboxes,
    search,
    tagFilter,
    workspaceFilter,
    domainFilter,
    statusFilter,
    selectedOnly,
    showUnhealthy,
    availableOnly,
    selectedIds,
  ]);

  // Build virtualized item list (with optional group headers)
  const items = useMemo<VirtualItem[]>(() => {
    if (groupBy === "none") {
      return filtered.map((d) => ({
        kind: "row" as const,
        key: d.mailbox.id,
        mailbox: d.mailbox,
        isUnhealthy: d.isUnhealthy,
        unhealthyReason: d.unhealthyReason,
        workspaceName: d.workspaceName,
        domain: d.domain,
        inUseBy: d.inUseBy,
      }));
    }

    const groups = new Map<
      string,
      { label: string; entries: typeof filtered }
    >();

    for (const d of filtered) {
      const keys: { key: string; label: string }[] = [];
      if (groupBy === "workspace") {
        const k = d.workspaceName || "__none__";
        keys.push({ key: k, label: d.workspaceName || "No workspace" });
      } else if (groupBy === "domain") {
        const k = d.domain || "__none__";
        keys.push({ key: k, label: d.domain || "No domain" });
      } else if (groupBy === "tag") {
        const tags = d.mailbox.tags || [];
        if (tags.length === 0) keys.push({ key: "__none__", label: "No tags" });
        else for (const t of tags) keys.push({ key: t, label: t });
      } else if (groupBy === "health") {
        const b = healthBucket(d.mailbox);
        const labels = {
          healthy: "Healthy (80+)",
          watch: "Watch (50-79)",
          risky: "Risky (<50)",
        } as const;
        keys.push({ key: b, label: labels[b] });
      }
      for (const { key, label } of keys) {
        if (!groups.has(key)) groups.set(key, { label, entries: [] });
        groups.get(key)!.entries.push(d);
      }
    }

    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    const out: VirtualItem[] = [];
    for (const [key, { label, entries }] of sorted) {
      const selectedInGroup = entries.filter((e) =>
        selectedIds.includes(e.mailbox.id)
      ).length;
      out.push({
        kind: "header",
        key: `__h_${key}`,
        groupKey: key,
        groupLabel: label,
        groupCount: entries.length,
        groupSelectedCount: selectedInGroup,
      });
      for (const d of entries) {
        out.push({
          kind: "row",
          key: `${key}_${d.mailbox.id}`,
          mailbox: d.mailbox,
          isUnhealthy: d.isUnhealthy,
          unhealthyReason: d.unhealthyReason,
          workspaceName: d.workspaceName,
          domain: d.domain,
          inUseBy: d.inUseBy,
        });
      }
    }
    return out;
  }, [filtered, groupBy, selectedIds]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (i) => (items[i]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 8,
  });

  // Handlers
  const toggleId = (id: string) => {
    if (mode === "single") {
      onChange([id]);
      onOpenChange(false);
      return;
    }
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
    setLoadedPresetId(null);
  };

  const selectableFiltered = useMemo(
    () => filtered.filter((d) => !d.isUnhealthy),
    [filtered]
  );

  const selectAllVisible = () => {
    const ids = selectableFiltered.map((d) => d.mailbox.id);
    const merged = Array.from(new Set([...selectedIds, ...ids]));
    onChange(merged);
    setLoadedPresetId(null);
  };

  const deselectVisible = () => {
    const idsInView = new Set(filtered.map((d) => d.mailbox.id));
    onChange(selectedIds.filter((id) => !idsInView.has(id)));
    setLoadedPresetId(null);
  };

  const clearSelection = () => {
    onChange([]);
    setLoadedPresetId(null);
  };

  const selectGroup = (groupKey: string) => {
    const ids = items
      .filter(
        (it) =>
          it.kind === "row" &&
          it.mailbox &&
          !isUnhealthyMailbox(it.mailbox).unhealthy &&
          it.key.startsWith(`${groupKey}_`)
      )
      .map((it) => it.mailbox!.id);
    if (ids.length === 0) return;
    const allAlready = ids.every((id) => selectedIds.includes(id));
    if (allAlready) {
      const set = new Set(ids);
      onChange(selectedIds.filter((id) => !set.has(id)));
    } else {
      onChange(Array.from(new Set([...selectedIds, ...ids])));
    }
    setLoadedPresetId(null);
  };

  const smartSelectTopByHealth = (n: number, availableOnlySelect = false) => {
    const top = decoratedMailboxes
      .filter((d) => !d.isUnhealthy && (!availableOnlySelect || !d.isInUse))
      .sort((a, b) => b.mailbox.health_score - a.mailbox.health_score)
      .slice(0, n)
      .map((d) => d.mailbox.id);
    onChange(top);
    setLoadedPresetId(null);
  };

  const availableHealthy = useMemo(
    () => decoratedMailboxes.filter((d) => !d.isUnhealthy && !d.isInUse),
    [decoratedMailboxes]
  );
  const availableHealthyCount = availableHealthy.length;
  const availableHealthyCapacity = useMemo(
    () => availableHealthy.reduce((s, d) => s + (d.mailbox.daily_limit || 0), 0),
    [availableHealthy]
  );
  const selectAllAvailable = () => {
    onChange(Array.from(new Set([...selectedIds, ...availableHealthy.map((d) => d.mailbox.id)])));
    setLoadedPresetId(null);
  };

  // Selection summary
  const selected = useMemo(
    () => allMailboxes.filter((m) => selectedIds.includes(m.id)),
    [allMailboxes, selectedIds]
  );
  const totalCapacity = selected.reduce((s, m) => s + (m.daily_limit || 0), 0);
  const selectedDisconnected = selected.filter((m) => isUnhealthyMailbox(m).unhealthy).length;
  const selectedInUse = selected.filter((m) => {
    const a = assignmentMap?.get(m.id) ?? [];
    return a.some(
      (x) => x.status === "active" && x.sequenceId !== excludeSequenceId
    );
  }).length;
  const selectedWorkspaces = new Set(selected.map(getWorkspaceName).filter(Boolean) as string[]).size;
  const selectedDomains = new Set(
    selected.map((m) => m.email_address.split("@")[1]).filter(Boolean)
  ).size;

  const activeFiltersCount =
    tagFilter.length +
    workspaceFilter.length +
    domainFilter.length +
    statusFilter.length;

  // Keyboard: "/" to focus search inside the sheet
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col gap-0"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-3 border-b text-left space-y-1">
          <SheetTitle className="flex items-center gap-2">
            {title || (mode === "single" ? "Select mailbox" : "Select mailbox pool")}
            {mode === "multi" && selectedIds.length > 0 && (
              <Badge variant="secondary" className="ml-2 font-normal">
                {selectedIds.length} selected · {totalCapacity.toLocaleString()}/day
              </Badge>
            )}
          </SheetTitle>
          {description && (
            <SheetDescription>{description}</SheetDescription>
          )}
          {mode === "multi" && selected.length > 0 && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
              <span>{selectedWorkspaces} workspace{selectedWorkspaces !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span>{selectedDomains} domain{selectedDomains !== 1 ? "s" : ""}</span>
              {selectedDisconnected > 0 && (
                <>
                  <span>·</span>
                  <span className="text-orange-600 dark:text-orange-400">
                    {selectedDisconnected} unhealthy will be skipped
                  </span>
                </>
              )}
              {selectedInUse > 0 && (
                <>
                  <span>·</span>
                  <span className="text-sky-600 dark:text-sky-400">
                    {selectedInUse} shared with another active campaign
                  </span>
                </>
              )}
            </div>
          )}
        </SheetHeader>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email, tag, workspace, domain"
                className="pl-8 h-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9">
                  <Filter className="h-3.5 w-3.5" />
                  Filters
                  {activeFiltersCount > 0 && (
                    <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
                      {activeFiltersCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[320px] max-h-[min(70vh,520px)] overflow-y-auto p-3"
                align="end"
                collisionPadding={16}
              >
                <FilterPanel
                  tagFilter={tagFilter}
                  setTagFilter={setTagFilter}
                  workspaceFilter={workspaceFilter}
                  setWorkspaceFilter={setWorkspaceFilter}
                  domainFilter={domainFilter}
                  setDomainFilter={setDomainFilter}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  availableTags={availableTags}
                  workspaceOptions={workspaceOptions}
                  domainOptions={domainOptions}
                />
              </PopoverContent>
            </Popover>

            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-9 w-[150px]">
                <Layers className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="workspace">Group by workspace</SelectItem>
                <SelectItem value="domain">Group by domain</SelectItem>
                <SelectItem value="tag">Group by tag</SelectItem>
                <SelectItem value="health">Group by health</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs">
            {mode === "multi" && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <Checkbox
                  checked={selectedOnly}
                  onCheckedChange={(v) => setSelectedOnly(!!v)}
                  className="h-3.5 w-3.5"
                />
                <span>Selected only</span>
              </label>
            )}
            {unhealthyCount > 0 && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground">
                <Checkbox
                  checked={showUnhealthy}
                  onCheckedChange={(v) => setShowUnhealthy(!!v)}
                  className="h-3.5 w-3.5"
                />
                <span>
                  Show {unhealthyCount} unhealthy
                </span>
              </label>
            )}
            {inUseCount > 0 && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground">
                <Checkbox
                  checked={availableOnly}
                  onCheckedChange={(v) => setAvailableOnly(!!v)}
                  className="h-3.5 w-3.5"
                />
                <span>
                  Available only · hide {inUseCount} shared
                </span>
              </label>
            )}

            {/* Active filter chips */}
            {tagFilter.length > 0 && (
              <FilterChip
                label={`Tags: ${tagFilter.length}`}
                onClear={() => setTagFilter([])}
              />
            )}
            {workspaceFilter.length > 0 && (
              <FilterChip
                label={`Workspaces: ${workspaceFilter.length}`}
                onClear={() => setWorkspaceFilter([])}
              />
            )}
            {domainFilter.length > 0 && (
              <FilterChip
                label={`Domains: ${domainFilter.length}`}
                onClear={() => setDomainFilter([])}
              />
            )}
            {statusFilter.length > 0 && (
              <FilterChip
                label={`Status: ${statusFilter.length}`}
                onClear={() => setStatusFilter([])}
              />
            )}
            {activeFiltersCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setTagFilter([]);
                  setWorkspaceFilter([]);
                  setDomainFilter([]);
                  setStatusFilter([]);
                }}
              >
                Clear all
              </Button>
            )}

            <span className="ml-auto text-muted-foreground tabular-nums">
              {filtered.length}/{decoratedMailboxes.length} shown
            </span>
          </div>
        </div>

        {/* Preset bar (multi only) */}
        {mode === "multi" && showPresets && (
          <div className="px-6 py-2 border-b flex items-center gap-2 bg-muted/20">
            <MailboxSetSelector
              selectedSetId={loadedPresetId}
              onSelect={(set) => {
                if (set === null) {
                  setLoadedPresetId(null);
                  return;
                }
                onChange(set.mailbox_ids);
                setLoadedPresetId(set.id);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              disabled={selectedIds.length === 0}
              onClick={() => setSavePresetOpen(true)}
            >
              <Save className="h-3.5 w-3.5" />
              {loadedPresetId ? "Update preset" : "Save as preset"}
            </Button>
          </div>
        )}

        {/* One-click max-throughput setup when the pool is empty */}
        {mode === "multi" && selectedIds.length === 0 && availableHealthyCount > 0 && (
          <div className="px-6 py-2.5 border-b flex items-center justify-between gap-3 bg-emerald-500/[0.06]">
            <div className="text-xs min-w-0">
              <p className="font-medium">Fastest setup: use every free mailbox</p>
              <p className="text-muted-foreground tabular-nums truncate">
                {availableHealthyCount} healthy, not in another active campaign ·{" "}
                {availableHealthyCapacity.toLocaleString()} emails/day
              </p>
            </div>
            <Button variant="cta" size="sm" className="shrink-0" onClick={selectAllAvailable}>
              Add all {availableHealthyCount}
            </Button>
          </div>
        )}

        {/* Virtualized list */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto py-2 relative">
          {isLoading ? (
            <div className="px-6 py-8 text-sm text-muted-foreground text-center">
              Loading mailboxes...
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              hasMailboxes={allMailboxes.length > 0}
              hasFilters={activeFiltersCount > 0 || !!search || selectedOnly}
              onClearFilters={() => {
                setSearch("");
                setTagFilter([]);
                setWorkspaceFilter([]);
                setDomainFilter([]);
                setStatusFilter([]);
                setSelectedOnly(false);
              }}
            />
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const item = items[vItem.index];
                if (!item) return null;
                return (
                  <div
                    key={item.key}
                    data-index={vItem.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: vItem.size,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    {item.kind === "header" ? (
                      <GroupHeader
                        label={item.groupLabel || ""}
                        total={item.groupCount || 0}
                        selected={item.groupSelectedCount || 0}
                        mode={mode}
                        onToggle={() => item.groupKey && selectGroup(item.groupKey)}
                      />
                    ) : (
                      item.mailbox && (
                        <MailboxRow
                          mailbox={item.mailbox}
                          isSelected={selectedIds.includes(item.mailbox.id)}
                          isUnhealthy={item.isUnhealthy}
                          unhealthyReason={item.unhealthyReason}
                          workspaceName={item.workspaceName}
                          domain={item.domain}
                          inUseBy={item.inUseBy}
                          mode={mode}
                          disabled={mode === "multi" && item.isUnhealthy}
                          onToggle={toggleId}
                        />
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer (multi only) */}
        {mode === "multi" && (
          <div className="border-t px-6 py-3 flex flex-wrap items-center gap-2 bg-background">
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllVisible}
              disabled={selectableFiltered.length === 0}
            >
              Select all visible ({selectableFiltered.length})
            </Button>
            {selectedIds.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={deselectVisible}>
                  Deselect visible
                </Button>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Clear all
                </Button>
              </>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Smart select
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel className="text-xs">Available &amp; healthy</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => smartSelectTopByHealth(10, true)}>
                  Top 10 available
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => smartSelectTopByHealth(25, true)}>
                  Top 25 available
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const ids = decoratedMailboxes
                      .filter((d) => !d.isUnhealthy && !d.isInUse)
                      .map((d) => d.mailbox.id);
                    onChange(ids);
                    setLoadedPresetId(null);
                  }}
                  disabled={availableHealthyCount === 0}
                >
                  All available &amp; healthy ({availableHealthyCount})
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">By health score</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => smartSelectTopByHealth(10)}>
                  Top 10 healthiest
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => smartSelectTopByHealth(25)}>
                  Top 25 healthiest
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => smartSelectTopByHealth(50)}>
                  Top 50 healthiest
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">By status</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    const ids = decoratedMailboxes
                      .filter((d) => !d.isUnhealthy)
                      .map((d) => d.mailbox.id);
                    onChange(ids);
                    setLoadedPresetId(null);
                  }}
                >
                  All ready mailboxes ({decoratedMailboxes.filter((d) => !d.isUnhealthy).length})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground tabular-nums leading-tight text-right">
                {selectedIds.length} selected
                <br />
                {totalCapacity.toLocaleString()}/day
              </span>
              <Button
                variant="cta"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Save preset dialog */}
        {mode === "multi" && (
          <SaveMailboxSetDialog
            open={savePresetOpen}
            onOpenChange={setSavePresetOpen}
            mailboxIds={selectedIds}
            existingSetId={loadedPresetId}
            onSaved={(set) => setLoadedPresetId(set.id)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="hover:opacity-70"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function GroupHeader({
  label,
  total,
  selected,
  mode,
  onToggle,
}: {
  label: string;
  total: number;
  selected: number;
  mode: "single" | "multi";
  onToggle: () => void;
}) {
  const allChecked = total > 0 && selected === total;
  const someChecked = selected > 0 && selected < total;

  return (
    <div
      className="sticky top-0 z-[1] flex items-center gap-2 px-3 py-1.5 mx-2 bg-muted/60 backdrop-blur rounded-md border-b text-xs font-medium uppercase tracking-wide"
      onClick={mode === "multi" ? onToggle : undefined}
      role={mode === "multi" ? "button" : undefined}
      tabIndex={mode === "multi" ? 0 : undefined}
      onKeyDown={
        mode === "multi"
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
    >
      {mode === "multi" && (
        <Checkbox
          checked={allChecked ? true : someChecked ? "indeterminate" : false}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5"
        />
      )}
      <span className="truncate">{label}</span>
      <span className="text-muted-foreground font-normal normal-case ml-auto tabular-nums">
        {selected}/{total}
      </span>
    </div>
  );
}

function FilterPanel({
  tagFilter,
  setTagFilter,
  workspaceFilter,
  setWorkspaceFilter,
  domainFilter,
  setDomainFilter,
  statusFilter,
  setStatusFilter,
  availableTags,
  workspaceOptions,
  domainOptions,
}: {
  tagFilter: string[];
  setTagFilter: (v: string[]) => void;
  workspaceFilter: string[];
  setWorkspaceFilter: (v: string[]) => void;
  domainFilter: string[];
  setDomainFilter: (v: string[]) => void;
  statusFilter: StatusFacet[];
  setStatusFilter: (v: StatusFacet[]) => void;
  availableTags: string[];
  workspaceOptions: string[];
  domainOptions: string[];
}) {
  const toggle = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const STATUSES: { value: StatusFacet; label: string }[] = [
    { value: "available", label: "Available" },
    { value: "unused", label: "Unused" },
    { value: "in_use", label: "Shared" },
    { value: "ready", label: "Ready" },
    { value: "warming", label: "Warming" },
    { value: "paused", label: "Paused" },
    { value: "burned", label: "Burned" },
    { value: "unhealthy", label: "Unhealthy" },
  ];

  return (
    <div className="space-y-4 max-h-[420px] overflow-y-auto">
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</Label>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => {
            const active = statusFilter.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(toggle(statusFilter, s.value))}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[11px] border transition-colors",
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-muted/30 border-transparent hover:border-border"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {availableTags.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tags</Label>
          <div className="flex flex-wrap gap-1 max-h-[140px] overflow-y-auto">
            {availableTags.map((t) => {
              const active = tagFilter.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(toggle(tagFilter, t))}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] border transition-colors",
                    active
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-muted/30 border-transparent hover:border-border"
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {workspaceOptions.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Workspaces</Label>
          <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
            {workspaceOptions.map((w) => {
              const active = workspaceFilter.includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWorkspaceFilter(toggle(workspaceFilter, w))}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] border transition-colors max-w-[180px] truncate",
                    active
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-muted/30 border-transparent hover:border-border"
                  )}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {domainOptions.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Domains</Label>
          <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
            {domainOptions.map((d) => {
              const active = domainFilter.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDomainFilter(toggle(domainFilter, d))}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] border transition-colors max-w-[180px] truncate",
                    active
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-muted/30 border-transparent hover:border-border"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  hasMailboxes,
  hasFilters,
  onClearFilters,
}: {
  hasMailboxes: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  if (!hasMailboxes) {
    return (
      <div className="px-6 py-12 text-sm text-muted-foreground text-center space-y-2">
        <p>No mailboxes connected yet.</p>
        <a
          href="/settings?tab=mailboxes"
          className="text-primary underline underline-offset-2"
        >
          Connect mailboxes in Settings
        </a>
      </div>
    );
  }
  if (hasFilters) {
    return (
      <div className="px-6 py-12 text-sm text-muted-foreground text-center space-y-3">
        <p>No mailboxes match your filters.</p>
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }
  return (
    <div className="px-6 py-12 text-sm text-muted-foreground text-center">
      No matching mailboxes.
    </div>
  );
}
