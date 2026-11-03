import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, ExternalLink, Linkedin, ListPlus, Search, Users, X } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { signalDateAnchor } from "@/lib/signals";
import { SignalTypeBadge } from "@/components/signals/SignalTypeBadge";
import { ColumnPicker } from "@/components/signals/ColumnPicker";
import {
  EMPTY_FIRMOGRAPHIC_FILTERS,
  FirmographicFilters,
  firmographicParams,
  type FirmographicFilterState,
} from "@/components/signals/FirmographicFilters";
import {
  firmographicColumns,
  useColumnVisibility,
  type FirmographicFields,
  type SignalColumn,
} from "@/components/signals/signal-columns";
import { SortableHeader, nextSortState, type SortDir } from "@/components/signals/SortableHeader";
import { LeadProfileSheet, isInteractiveClick, type LeadProfile } from "@/components/signals/LeadProfileSheet";

const COMPANY_LIMIT = 50;
const PEOPLE_LIMIT = 50;

/**
 * Recency windows supported natively by the library RPCs (p_window), so
 * filtering and pagination stay server-side and totals stay correct.
 */
const WINDOW_OPTIONS: Array<{ value: "all" | "day" | "week" | "month"; label: string }> = [
  { value: "all", label: "Any date" },
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];

/** The panel's recency vocabulary as day counts, so an auto-add rule seeded
 *  from the toolbar inherits the window the user is already looking at.
 *  0 = "Any date" → leave each branch's default window alone. */
const WINDOW_DAYS: Record<"all" | "day" | "week" | "month", number> = {
  all: 0,
  day: 1,
  week: 7,
  month: 30,
};

const SIGNAL_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "funding", label: "Funding" },
  { value: "hiring", label: "Hiring" },
  { value: "hiring_demand", label: "Hiring demand" },
  { value: "executive_hire", label: "Executive hire" },
  { value: "acquisition", label: "Acquisition" },
  { value: "growth", label: "Growth" },
];

/**
 * One (signal, person) pair from the library. The same person surfaced by two
 * signals is two rows, each with its own signal context — so rows are keyed on
 * both ids, never on person_id alone.
 */
type LeadRow = FirmographicFields & {
  signal_id: string;
  person_id: string;
  name: string;
  title: string | null;
  linkedin_url: string;
  photo_url: string | null;
  email: string | null;
  email_status: string | null;
  company: string;
  domain: string | null;
  signal_type: string;
  signal_date: string;
  source_url: string;
};

/** One company from the library, carrying its most recent signal. */
type CompanyRow = FirmographicFields & {
  id: string;
  company_id: string;
  company: string;
  domain: string | null;
  type: string;
  type_label: string;
  title: string | null;
  summary: string | null;
  date: string;
  source: string | null;
  source_url: string;
  verified: boolean;
  signal_count: number;
  lead_count: number;
};

const rowKey = (lead: LeadRow) => `${lead.signal_id}:${lead.person_id}`;

/** The row already carries everything the library knows about this person. */
const toProfile = (lead: LeadRow): LeadProfile => ({
  key: rowKey(lead),
  name: lead.name,
  title: lead.title,
  photoUrl: lead.photo_url,
  email: lead.email,
  emailStatus: lead.email_status,
  linkedinUrl: lead.linkedin_url,
  company: lead.company,
  domain: lead.domain,
  signalType: lead.signal_type,
  signalDate: lead.signal_date,
  sourceUrl: lead.source_url,
  firmographics: lead,
});

type PeopleSortKey = "name" | "title" | "email" | "company" | "date" | "employees" | "revenue" | "industry" | "country";
type CompanySortKey = "company" | "date" | "leads" | "employees" | "revenue" | "industry" | "country";

const PEOPLE_DEFAULT_DIR: Record<PeopleSortKey, SortDir> = {
  name: "asc", title: "asc", email: "asc", company: "asc", date: "desc",
  employees: "desc", revenue: "desc", industry: "asc", country: "asc",
};
const COMPANY_DEFAULT_DIR: Record<CompanySortKey, SortDir> = {
  company: "asc", date: "desc", leads: "desc",
  employees: "desc", revenue: "desc", industry: "asc", country: "asc",
};

/**
 * Signal dates are date-only, so the default (rounding) distance reports a
 * signal from exactly N days ago as "N+1 days ago" once the clock passes
 * midday — which reads as off-by-one against the recency filter's label.
 * Flooring reports whole elapsed days and keeps the two consistent.
 */
function relativeDate(date: string) {
  try {
    // signalDateAnchor, not `new Date(date)`: a bare date string parses to UTC
    // midnight while the public feed anchors the same value to noon, which made
    // every same-day signal read 12h older here than on /signals.
    const anchor = signalDateAnchor(date);
    if (!anchor) return "recently";
    return formatDistanceToNowStrict(anchor, { addSuffix: true, roundingMethod: "floor" });
  } catch {
    return "recently";
  }
}

export function PublicSignalLibraryPanel() {
  const [search, setSearch] = useState("");
  const [signalType, setSignalType] = useState("all");
  const [signalWindow, setSignalWindow] = useState<"all" | "day" | "week" | "month">("all");
  const [emailOnly, setEmailOnly] = useState(false);
  const [firmographics, setFirmographics] = useState<FirmographicFilterState>(EMPTY_FIRMOGRAPHIC_FILTERS);
  const [page, setPage] = useState(0);
  const [peoplePage, setPeoplePage] = useState(0);
  const [peopleSort, setPeopleSort] = useState<{ key: PeopleSortKey; dir: SortDir }>({ key: "date", dir: "desc" });
  const [companySort, setCompanySort] = useState<{ key: CompanySortKey; dir: SortDir }>({ key: "date", dir: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /** The row whose profile drawer is open, if any. */
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null);
  const listsQuery = useQuery({
    queryKey: ["public-signal-library-lists"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_lists").select("id,name").eq("status", "active").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Companies get their own authenticated RPC: filters, sorting and the total
  // all run in the database, so the order is not merely page-local (and the
  // firmographics stay off the public marketing feed).
  const companiesQuery = useQuery({
    queryKey: ["public-signal-library-companies", search, signalType, signalWindow, firmographics, companySort.key, companySort.dir, page],
    queryFn: async () => {
      // @ts-expect-error Generated Supabase types update alongside the migration.
      const { data, error } = await supabase.rpc("get_public_signal_library_companies_page", {
        p_limit: COMPANY_LIMIT,
        p_offset: page * COMPANY_LIMIT,
        p_search: search || null,
        p_type: signalType === "all" ? null : signalType,
        p_window: signalWindow,
        p_sort_by: companySort.key,
        p_sort_dir: companySort.dir,
        ...firmographicParams(firmographics),
      });
      if (error) throw error;
      return data as { ok: boolean; total: number; companies: CompanyRow[] };
    },
    staleTime: 60_000,
  });

  const signals = useMemo<CompanyRow[]>(() => companiesQuery.data?.companies ?? [], [companiesQuery.data]);
  const totalCompanies = companiesQuery.data?.total ?? 0;

  // People are their own collection — filtered, sorted and paged on the server,
  // reporting a true total. They used to be a by-product of the company page,
  // which made the count a page subtotal and sorting page-local.
  const peopleQuery = useQuery({
    queryKey: ["public-signal-library-people", search, signalType, signalWindow, emailOnly, firmographics, peopleSort.key, peopleSort.dir, peoplePage],
    queryFn: async () => {
      // @ts-expect-error Generated Supabase types update alongside the migration.
      const { data, error } = await supabase.rpc("get_public_signal_library_people_page", {
        p_limit: PEOPLE_LIMIT,
        p_offset: peoplePage * PEOPLE_LIMIT,
        p_search: search || null,
        p_type: signalType === "all" ? null : signalType,
        p_window: signalWindow,
        p_has_email: emailOnly || null,
        p_sort_by: peopleSort.key,
        p_sort_dir: peopleSort.dir,
        ...firmographicParams(firmographics),
      });
      if (error) throw error;
      return data as { ok: boolean; total: number; people: LeadRow[] };
    },
    staleTime: 60_000,
  });
  const leads = useMemo<LeadRow[]>(() => peopleQuery.data?.people ?? [], [peopleQuery.data]);
  const totalPeople = peopleQuery.data?.total ?? 0;
  // Only leads whose company resolved to a domain can be enrolled.
  const selectableLeads = useMemo(() => leads.filter((lead) => Boolean(lead.domain)), [leads]);
  const selectedLeads = useMemo(() => leads.filter((lead) => selectedIds.has(rowKey(lead))), [leads, selectedIds]);
  const allSelectableChecked = selectableLeads.length > 0 && selectableLeads.every((lead) => selectedIds.has(rowKey(lead)));

  const bulkAdd = useMutation({
    mutationFn: async ({ rows, listId }: { rows: LeadRow[]; listId: string }) => {
      let added = 0;
      let alreadyInList = 0;
      for (const lead of rows) {
        // @ts-expect-error Generated Supabase types update alongside the migration.
        const { data, error } = await supabase.rpc("add_public_signal_lead_to_list", {
          p_signal_id: lead.signal_id,
          p_person_id: lead.person_id,
          p_list_id: listId,
        });
        if (error) throw error;
        const result = data as { ok: boolean; added?: boolean; error?: string };
        if (!result.ok) throw new Error(result.error ?? `Unable to add ${lead.name}`);
        if (result.added) added += 1;
        else alreadyInList += 1;
      }
      return { added, alreadyInList };
    },
    onSuccess: ({ added, alreadyInList }) => {
      toast.success(`${added} lead${added === 1 ? "" : "s"} added${alreadyInList ? ` · ${alreadyInList} already in this list` : ""}`);
      setSelectedIds(new Set());
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to add selected leads"),
  });

  const toggleLead = (key: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectableLeads.map(rowKey)) : new Set());
  };

  // ---- Columns ------------------------------------------------------------
  // Every column, old and new, is a descriptor so the picker can hide any of
  // them and the firmographics render the same here as in the custom table.
  const peopleColumns = useMemo<Array<SignalColumn<LeadRow>>>(() => [
    {
      id: "lead",
      label: "Lead",
      defaultVisible: true,
      sortKey: "name",
      cell: (lead) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {lead.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate font-medium">{lead.name}</p>
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noreferrer"
              title="Open LinkedIn profile"
              aria-label={`Open ${lead.name} on LinkedIn`}
              className="shrink-0 text-muted-foreground/60 transition-colors hover:text-[#0A66C2]"
            >
              <Linkedin className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ),
    },
    {
      id: "title",
      label: "Title",
      defaultVisible: true,
      sortKey: "title",
      tdClassName: "max-w-[280px]",
      cell: (lead) => (
        <span className="line-clamp-2 text-muted-foreground" title={lead.title || undefined}>
          {lead.title || "Decision maker"}
        </span>
      ),
    },
    {
      id: "email",
      label: "Email",
      defaultVisible: true,
      sortKey: "email",
      cell: (lead) => (lead.email
        ? <a href={`mailto:${lead.email}`} className="block max-w-[210px] truncate text-foreground hover:underline" title={lead.email}>{lead.email}</a>
        : <span className="text-muted-foreground/50" title="No verified email yet">—</span>),
    },
    {
      id: "company",
      label: "Company",
      defaultVisible: true,
      sortKey: "company",
      cell: (lead) => (
        <>
          <p className="font-medium">{lead.company}</p>
          <p className="text-xs text-muted-foreground">{lead.domain || "Domain pending"}</p>
        </>
      ),
    },
    ...firmographicColumns<LeadRow>(),
    {
      id: "signal",
      label: "Signal",
      defaultVisible: true,
      sortKey: "date",
      cell: (lead) => (
        <>
          <SignalTypeBadge type={lead.signal_type} />
          <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{relativeDate(lead.signal_date)}</p>
        </>
      ),
    },
    {
      id: "source",
      label: "Source",
      defaultVisible: true,
      cell: (lead) => (
        <a href={lead.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Verified <ExternalLink className="h-3 w-3" />
        </a>
      ),
    },
  ], []);

  const companyColumns = useMemo<Array<SignalColumn<CompanyRow>>>(() => [
    {
      id: "company",
      label: "Company",
      defaultVisible: true,
      sortKey: "company",
      thClassName: "px-4",
      tdClassName: "px-4",
      cell: (signal) => (
        <>
          <p className="font-medium">{signal.company}</p>
          <p className="text-xs text-muted-foreground">{signal.domain || "Domain pending"}</p>
        </>
      ),
    },
    {
      id: "signal",
      label: "Signal",
      defaultVisible: true,
      sortKey: "date",
      cell: (signal) => (
        <>
          <SignalTypeBadge type={signal.type} label={signal.type_label} />
          <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{relativeDate(signal.date)}</p>
        </>
      ),
    },
    {
      id: "why",
      label: "Why now",
      defaultVisible: true,
      tdClassName: "max-w-md",
      cell: (signal) => (
        <span className="line-clamp-2 text-muted-foreground" title={signal.summary || signal.title || undefined}>
          {signal.summary || signal.title || "Curated public signal"}
        </span>
      ),
    },
    ...firmographicColumns<CompanyRow>(),
    {
      id: "leads",
      label: "Vetted leads",
      defaultVisible: true,
      sortKey: "leads",
      cell: (signal) => (
        <>
          <span className="font-medium tabular-nums">{signal.lead_count}</span>{" "}
          <span className="text-muted-foreground">{signal.lead_count === 1 ? "lead" : "leads"}</span>
        </>
      ),
    },
    {
      id: "source",
      label: "Source",
      defaultVisible: true,
      cell: (signal) => (
        <a href={signal.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Verified <ExternalLink className="h-3 w-3" />
        </a>
      ),
    },
  ], []);

  const peopleView = useColumnVisibility("signals.columns.public-people", peopleColumns);
  const companyView = useColumnVisibility("signals.columns.public-companies", companyColumns);

  // Re-sorting reorders the whole result set, so page 2 of the old order is
  // meaningless — return to the first page and drop the selection with it.
  const handlePeopleSort = (key: string) => {
    setPeopleSort((current) => nextSortState(key as PeopleSortKey, current.key, current.dir, (k) => PEOPLE_DEFAULT_DIR[k]));
    setPeoplePage(0);
    setSelectedIds(new Set());
  };
  const handleCompanySort = (key: string) => {
    setCompanySort((current) => nextSortState(key as CompanySortKey, current.key, current.dir, (k) => COMPANY_DEFAULT_DIR[k]));
    setPage(0);
  };

  /** Any filter change invalidates both pagers and the current selection. */
  const resetPaging = () => {
    setPage(0);
    setPeoplePage(0);
    setSelectedIds(new Set());
  };

  const loading = peopleQuery.isLoading;
  const showPagination = totalCompanies > COMPANY_LIMIT;
  const pageCount = Math.max(1, Math.ceil(totalCompanies / COMPANY_LIMIT));
  const showPeoplePagination = totalPeople > PEOPLE_LIMIT;
  const peoplePageCount = Math.max(1, Math.ceil(totalPeople / PEOPLE_LIMIT));

  const addToListMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="cta" className="h-8" disabled={bulkAdd.isPending}>
          <ListPlus className="mr-2 h-4 w-4" />
          Add to list ({selectedLeads.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Add selected leads to…</DropdownMenuLabel>
        {(listsQuery.data ?? []).length
          ? (listsQuery.data ?? []).map((list) => (
              <DropdownMenuItem key={list.id} onClick={() => bulkAdd.mutate({ rows: selectedLeads, listId: list.id })}>
                {list.name}
              </DropdownMenuItem>
            ))
          : <DropdownMenuItem disabled>No active lists available</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <section aria-label="Public signal library" className="space-y-4">
      <Tabs defaultValue="people">
        {/* Auto-add is an action, not a filter, so it sits with the tabs and
            leaves the filters a row they actually fit on. That row is always
            full-width (never squeezed into the gap beside the tabs), and the
            search box absorbs its slack, so the controls compress to fit
            instead of overflowing the page. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="people" className="gap-2">
              <Users className="h-4 w-4" /> People
              <Badge variant="secondary" className="ml-1 px-1.5 font-normal tabular-nums">{totalPeople}</Badge>
            </TabsTrigger>
            <TabsTrigger value="companies" className="gap-2">
              <Building2 className="h-4 w-4" /> Companies
              <Badge variant="secondary" className="ml-1 px-1.5 font-normal tabular-nums">{totalCompanies}</Badge>
            </TabsTrigger>
          </TabsList>
          {/* Auto-add retired — signals are now Smart Segment selectors. Create a Smart Segment from the current filters, then attach it to any Active Campaign/Sequence. */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 [&>*]:shrink-0">
            <div className="relative min-w-[7rem] max-w-[13rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => { setSearch(event.target.value); resetPaging(); }}
                className="h-9 w-full pl-8"
                placeholder="Search companies…"
              />
            </div>
            <Select value={signalType} onValueChange={(value) => { setSignalType(value); resetPaging(); }}>
              <SelectTrigger className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIGNAL_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={signalWindow}
              onValueChange={(value) => { setSignalWindow(value as typeof signalWindow); resetPaging(); }}
            >
              <SelectTrigger className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FirmographicFilters
              value={firmographics}
              onChange={(next) => { setFirmographics(next); resetPaging(); }}
            />
            <Button size="sm" variant={emailOnly ? "secondary" : "outline"} className="h-9 select-none" onClick={() => { setEmailOnly((value) => !value); resetPaging(); }}>
              Has email
            </Button>
          </div>
        </div>

        {/* Bulk actions appear with the selection instead of sitting disabled
            in the filter bar (which also kept the toolbar from fitting). */}
        {selectedLeads.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium tabular-nums">{selectedLeads.length}</span>
            <span className="text-muted-foreground">lead{selectedLeads.length === 1 ? "" : "s"} selected</span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
            <div className="ml-auto">{addToListMenu}</div>
          </div>
        )}

        <TabsContent value="people" className="mt-4">
          <div className="mb-3 flex justify-end">
            <ColumnPicker
              columns={peopleColumns}
              visibleIds={peopleView.visibleIds}
              onToggle={peopleView.toggle}
              onReset={peopleView.reset}
            />
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : leads.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No vetted leads match this view yet.</CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-11 px-4 py-2.5">
                      <Checkbox checked={allSelectableChecked} onCheckedChange={(checked) => toggleAll(checked === true)} aria-label="Select all eligible leads" />
                    </th>
                    {peopleView.visibleColumns.map((column) => (
                      column.sortKey
                        ? (
                          <SortableHeader
                            key={column.id}
                            label={column.label}
                            sortKey={column.sortKey}
                            activeKey={peopleSort.key}
                            dir={peopleSort.dir}
                            onSort={handlePeopleSort}
                            className={column.thClassName}
                          />
                        )
                        : <th key={column.id} className={`px-3 py-2.5 font-medium ${column.thClassName ?? ""}`}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => {
                    const key = rowKey(lead);
                    const selectable = Boolean(lead.domain);
                    return (
                      <tr
                        key={key}
                        className="cursor-pointer align-middle transition-colors hover:bg-muted/30"
                        tabIndex={0}
                        aria-label={`Open ${lead.name}'s profile`}
                        onClick={(event) => { if (!isInteractiveClick(event)) setActiveLead(lead); }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            if (event.target !== event.currentTarget) return;
                            event.preventDefault();
                            setActiveLead(lead);
                          }
                        }}
                      >
                        <td className="px-4 py-2.5">
                          <Checkbox checked={selectedIds.has(key)} disabled={!selectable} onCheckedChange={(checked) => toggleLead(key, checked === true)} aria-label={`Select ${lead.name}`} />
                        </td>
                        {peopleView.visibleColumns.map((column) => (
                          <td key={column.id} className={`px-3 py-2.5 ${column.tdClassName ?? ""}`}>
                            {column.cell(lead)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {showPeoplePagination && (
            <div className="mt-4 flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={peoplePage === 0} onClick={() => { setPeoplePage((value) => value - 1); setSelectedIds(new Set()); }}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {peoplePage + 1} of {peoplePageCount}</span>
              <Button variant="outline" size="sm" disabled={(peoplePage + 1) * PEOPLE_LIMIT >= totalPeople} onClick={() => { setPeoplePage((value) => value + 1); setSelectedIds(new Set()); }}>Next</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="companies" className="mt-4">
          <div className="mb-3 flex justify-end">
            <ColumnPicker
              columns={companyColumns}
              visibleIds={companyView.visibleIds}
              onToggle={companyView.toggle}
              onReset={companyView.reset}
            />
          </div>
          {companiesQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : signals.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No public companies match this view.</CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {companyView.visibleColumns.map((column) => (
                      column.sortKey
                        ? (
                          <SortableHeader
                            key={column.id}
                            label={column.label}
                            sortKey={column.sortKey}
                            activeKey={companySort.key}
                            dir={companySort.dir}
                            onSort={handleCompanySort}
                            className={column.thClassName}
                          />
                        )
                        : <th key={column.id} className={`px-3 py-2.5 font-medium ${column.thClassName ?? ""}`}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {signals.map((signal) => (
                    <tr key={signal.id} className="align-middle transition-colors hover:bg-muted/30">
                      {companyView.visibleColumns.map((column) => (
                        <td key={column.id} className={`px-3 py-2.5 ${column.tdClassName ?? ""}`}>
                          {column.cell(signal)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showPagination && (
            <div className="mt-4 flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page + 1} of {pageCount}</span>
              <Button variant="outline" size="sm" disabled={(page + 1) * COMPANY_LIMIT >= totalCompanies} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <LeadProfileSheet
        lead={activeLead ? toProfile(activeLead) : null}
        onOpenChange={(open) => { if (!open) setActiveLead(null); }}
        // Same rule as the row checkbox: only a lead whose company resolved to
        // a domain can be enrolled, so a domainless lead gets no add action.
        lists={activeLead?.domain ? listsQuery.data ?? [] : undefined}
        addPending={bulkAdd.isPending}
        onAddToList={activeLead?.domain
          ? (listId) => bulkAdd.mutate({ rows: [activeLead], listId })
          : undefined}
      />
    </section>
  );
}
