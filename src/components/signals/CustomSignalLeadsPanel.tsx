import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Globe, Linkedin, ListPlus, Mail, Search, X } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SignalTypeBadge, humanizeSignalType } from "@/components/signals/SignalTypeBadge";
import { SortableHeader, nextSortState, type SortDir } from "@/components/signals/SortableHeader";
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
import { LeadProfileSheet, isInteractiveClick, type LeadProfile } from "@/components/signals/LeadProfileSheet";

const PAGE_SIZE = 50;

/**
 * Recency windows filter on the signal's real-world event date (when the
 * funding / hire / post happened), which typically lags discovery by weeks —
 * hence a 90-day option rather than the 24-hour one the public feed offers.
 */
const AGE_OPTIONS: Array<{ value: string; label: string; days: number | null }> = [
  { value: "all", label: "Any date", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
];

/** Sort keys the RPC accepts — sorting runs before the LIMIT, not per page. */
type SortKey = "name" | "email" | "company" | "signal_date" | "employees" | "revenue" | "industry" | "country";

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  email: "asc",
  company: "asc",
  signal_date: "desc",
  employees: "desc",
  revenue: "desc",
  industry: "asc",
  country: "asc",
};

type CustomLead = FirmographicFields & { id: string; name: string; title: string | null; company: string | null; website_url: string | null; email: string | null; email_status: string | null; linkedin_url: string | null; signal_type: string; signal_name: string; signal_date: string | null; source_url: string | null };

/** These rows carry a website URL, not a bare domain like the public library. */
function domainOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** These leads are CRM contacts, so the drawer can link to the full record. */
const toProfile = (lead: CustomLead): LeadProfile => ({
  key: lead.id,
  name: lead.name,
  title: lead.title,
  email: lead.email,
  emailStatus: lead.email_status,
  linkedinUrl: lead.linkedin_url,
  company: lead.company,
  domain: domainOf(lead.website_url),
  websiteUrl: lead.website_url,
  signalType: lead.signal_type,
  signalLabel: lead.signal_name,
  signalDate: lead.signal_date,
  sourceUrl: lead.source_url,
  contactId: lead.id,
  firmographics: lead,
});

/** "2 months ago" for scanning; the exact date rides along as a tooltip. */
function signalDateParts(value: string | null): { relative: string; absolute: string } | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return {
      // Floor so a date-only signal never reads one day older than the
      // recency filter that just matched it (see PublicSignalLibraryPanel).
      relative: formatDistanceToNowStrict(parsed, { addSuffix: true, roundingMethod: "floor" }),
      absolute: format(parsed, "d MMM yyyy"),
    };
  } catch {
    return null;
  }
}

export function CustomSignalLeadsPanel() {
  const { currentOrganization } = useAuth();
  const [search, setSearch] = useState("");
  const [emailOnly, setEmailOnly] = useState(false);
  const [type, setType] = useState("all");
  const [age, setAge] = useState("all");
  const [firmographics, setFirmographics] = useState<FirmographicFilterState>(EMPTY_FIRMOGRAPHIC_FILTERS);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("signal_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** The lead whose profile drawer is open, if any. */
  const [activeLead, setActiveLead] = useState<CustomLead | null>(null);
  const maxAgeDays = AGE_OPTIONS.find((option) => option.value === age)?.days ?? null;
  const query = useQuery({
    queryKey: ["custom-signal-leads", currentOrganization?.id, search, emailOnly, type, age, firmographics, sortKey, sortDir, page],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      // @ts-expect-error Generated Supabase types update alongside the migration.
      const { data, error } = await supabase.rpc("get_custom_signal_leads", { p_org_id: currentOrganization!.id, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE, p_search: search || null, p_signal_types: type === "all" ? null : [type], p_has_email: emailOnly || null, p_max_age_days: maxAgeDays, p_sort_by: sortKey, p_sort_dir: sortDir, ...firmographicParams(firmographics) });
      if (error) throw error;
      return data as { ok: boolean; total: number; leads: CustomLead[] };
    },
  });

  // Re-sorting reshuffles the whole result set, so page 2 of the old order is
  // meaningless — go back to the first page and drop the selection with it.
  const handleSort = (key: string) => {
    const next = nextSortState(key as SortKey, sortKey, sortDir, (k) => DEFAULT_DIR[k]);
    setSortKey(next.key);
    setSortDir(next.dir);
    setPage(0);
    setSelected(new Set());
  };
  const listsQuery = useQuery({ queryKey: ["custom-signal-target-lists"], queryFn: async () => { const { data, error } = await supabase.from("lead_lists").select("id,name").eq("status", "active").order("name"); if (error) throw error; return data ?? []; } });
  const leads = query.data?.leads ?? [];
  const total = query.data?.total ?? 0;
  const types = useMemo(() => Array.from(new Set(leads.map((lead) => lead.signal_type))).sort(), [leads]);
  const selectedRows = leads.filter((lead) => selected.has(lead.id));
  const bulkAdd = useMutation({
    // Takes the ids explicitly so the profile drawer can add a single lead
    // without going through the table's selection.
    mutationFn: async ({ contactIds, listId }: { contactIds: string[]; listId: string }) => {
      // @ts-expect-error Generated Supabase types update alongside the migration.
      const { data, error } = await supabase.rpc("add_existing_signal_leads_to_list", { p_contact_ids: contactIds, p_list_id: listId });
      if (error) throw error;
      const result = data as { ok: boolean; added?: number; error?: string };
      if (!result.ok) throw new Error(result.error ?? "Unable to add leads");
      return result;
    },
    onSuccess: (result) => { toast.success(`${result.added ?? 0} lead${(result.added ?? 0) === 1 ? "" : "s"} added to the list`); setSelected(new Set()); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to add leads"),
  });
  // ---- Columns ------------------------------------------------------------
  // Descriptors rather than hardcoded cells, so the Columns picker can hide any
  // of them and the firmographics match the public library's rendering.
  const columns = useMemo<Array<SignalColumn<CustomLead>>>(() => [
    {
      id: "lead",
      label: "Lead",
      defaultVisible: true,
      sortKey: "name",
      tdClassName: "max-w-[240px]",
      cell: (lead) => (
        <>
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium">{lead.name}</p>
            {lead.linkedin_url && (
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
            )}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground" title={lead.title || undefined}>{lead.title || "\u2014"}</p>
        </>
      ),
    },
    {
      id: "email",
      label: "Email",
      defaultVisible: true,
      sortKey: "email",
      cell: (lead) => (lead.email
        ? <a href={`mailto:${lead.email}`} className="block max-w-[210px] truncate text-foreground hover:underline" title={lead.email}>{lead.email}</a>
        : <span className="text-muted-foreground/50" title="No verified email yet">&mdash;</span>),
    },
    {
      id: "company",
      label: "Company",
      defaultVisible: true,
      sortKey: "company",
      tdClassName: "max-w-[200px]",
      cell: (lead) => (
        <div className="flex items-center gap-1.5">
          <p className="truncate">{lead.company || "\u2014"}</p>
          {lead.website_url && (
            <a
              href={lead.website_url}
              target="_blank"
              rel="noreferrer"
              title="Open website"
              aria-label={`Open ${lead.company ?? "company"} website`}
              className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      ),
    },
    ...firmographicColumns<CustomLead>(),
    {
      id: "signal",
      label: "Signal",
      defaultVisible: true,
      sortKey: "signal_date",
      cell: (lead) => {
        const date = signalDateParts(lead.signal_date);
        const name = humanizeSignalType(lead.signal_name);
        return (
          <>
            <SignalTypeBadge type={lead.signal_type} />
            <p
              className="mt-1 line-clamp-1 max-w-[200px] text-xs text-muted-foreground"
              title={date ? `${date.absolute} \u00b7 ${lead.signal_name}` : lead.signal_name}
            >
              {date ? `${date.relative} \u00b7 ${name}` : name}
            </p>
          </>
        );
      },
    },
    {
      id: "source",
      label: "Source",
      defaultVisible: true,
      cell: (lead) => (lead.source_url ? (
        <a href={lead.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Source <ExternalLink className="h-3 w-3" />
        </a>
      ) : <span className="text-muted-foreground/50">&mdash;</span>),
    },
  ], []);

  const columnView = useColumnVisibility("signals.columns.custom-leads", columns);

  const allChecked = leads.length > 0 && leads.every((lead) => selected.has(lead.id));
  const toggle = (id: string, checked: boolean) => setSelected((previous) => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  const resetFilters = (nextType?: string) => { setType(nextType ?? "all"); setPage(0); setSelected(new Set()); };
  const showPagination = total > PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-label="Custom signal leads" className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-xl font-semibold">Signal leads</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {total > 0 ? `${total.toLocaleString()} lead${total === 1 ? "" : "s"} discovered by your signals.` : "Leads discovered by your signals land here."}{" "}
          Emails come from your verified CRM contact records.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-56 pl-8" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search leads, company, email" />
        </div>
        <Select value={type} onValueChange={(value) => resetFilters(value)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All signal types</SelectItem>
            {types.map((value) => (
              <SelectItem key={value} value={value}>{humanizeSignalType(value)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={age} onValueChange={(value) => { setAge(value); setPage(0); setSelected(new Set()); }}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant={emailOnly ? "secondary" : "outline"} className="h-9 select-none" onClick={() => { setEmailOnly((value) => !value); setPage(0); }}>
          <Mail className="mr-1.5 h-3.5 w-3.5" /> Has email
        </Button>
        <FirmographicFilters
          value={firmographics}
          onChange={(next) => { setFirmographics(next); setPage(0); setSelected(new Set()); }}
        />
        {/* Auto-add retired — use Smart Segments + Active Campaign instead. */}
      </div>

      {/* Bulk actions live with the selection, not as a permanently-disabled
          button in the filter bar. */}
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium tabular-nums">{selectedRows.length}</span>
          <span className="text-muted-foreground">lead{selectedRows.length === 1 ? "" : "s"} selected</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => setSelected(new Set())}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="cta" className="h-8" disabled={bulkAdd.isPending}>
                  <ListPlus className="mr-2 h-4 w-4" />
                  Add to list ({selectedRows.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                <DropdownMenuLabel>Add selected leads to…</DropdownMenuLabel>
                {(listsQuery.data ?? []).length
                  ? (listsQuery.data ?? []).map((list) => (
                      <DropdownMenuItem
                        key={list.id}
                        onClick={() => bulkAdd.mutate({ contactIds: selectedRows.map((lead) => lead.id), listId: list.id })}
                      >
                        {list.name}
                      </DropdownMenuItem>
                    ))
                  : <DropdownMenuItem disabled>No active lists available</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <ColumnPicker
          columns={columns}
          visibleIds={columnView.visibleIds}
          onToggle={columnView.toggle}
          onReset={columnView.reset}
        />
      </div>

      {query.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : leads.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No custom-signal leads match these filters.</CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-11 px-4 py-2.5">
                  <Checkbox checked={allChecked} onCheckedChange={(checked) => setSelected(checked === true ? new Set(leads.map((lead) => lead.id)) : new Set())} aria-label="Select all leads on this page" />
                </th>
                {columnView.visibleColumns.map((column) => (
                  column.sortKey
                    ? (
                      <SortableHeader
                        key={column.id}
                        label={column.label}
                        sortKey={column.sortKey}
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        className={column.thClassName}
                      />
                    )
                    : <th key={column.id} className={`px-3 py-2.5 font-medium ${column.thClassName ?? ""}`}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((lead) => (
                <tr
                  key={lead.id}
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
                    <Checkbox checked={selected.has(lead.id)} onCheckedChange={(checked) => toggle(lead.id, checked === true)} aria-label={`Select ${lead.name}`} />
                  </td>
                  {columnView.visibleColumns.map((column) => (
                    <td key={column.id} className={`px-3 py-2.5 ${column.tdClassName ?? ""}`}>
                      {column.cell(lead)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPagination && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage((value) => value - 1); setSelected(new Set()); }}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => { setPage((value) => value + 1); setSelected(new Set()); }}>Next</Button>
        </div>
      )}

      <LeadProfileSheet
        lead={activeLead ? toProfile(activeLead) : null}
        onOpenChange={(open) => { if (!open) setActiveLead(null); }}
        lists={listsQuery.data ?? []}
        addPending={bulkAdd.isPending}
        onAddToList={(listId) => {
          if (!activeLead) return;
          bulkAdd.mutate({ contactIds: [activeLead.id], listId });
        }}
      />
    </section>
  );
}
