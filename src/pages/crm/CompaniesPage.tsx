import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2, Search, Globe, Linkedin, Sparkles, Users, ChevronUp, ChevronDown,
  ExternalLink, X,
} from "lucide-react";
import {
  useCrmCompanies,
  useCrmCompaniesStats,
  useUpdateCrmCompany,
  ACCOUNT_STAGE_OPTIONS,
  type CrmAccountStage,
  type CrmCompanyRow,
} from "@/hooks/useCrmCompanies";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE = 50;

function fmtRel(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return "—"; }
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "—";
}

function stageLabel(s: CrmAccountStage): string {
  return ACCOUNT_STAGE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

// Compact pipeline pill — shows count + label, click filters the table.
// Border highlights when active.
function PipelinePill({
  label,
  count,
  active,
  color,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-md border text-left transition shrink-0 ${
        active
          ? "border-primary ring-1 ring-primary/30 bg-primary/5"
          : color ?? "border-border hover:border-primary/50"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums leading-tight">
        {count.toLocaleString()}
      </div>
    </button>
  );
}

type SortKey = "last_signal_at" | "name" | "contact_count" | "first_seen_at";

function SortHeader({
  label,
  field,
  current,
  dir,
  onChange,
  align = "left",
}: {
  label: string;
  field: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onChange: (f: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = current === field;
  return (
    <button
      type="button"
      onClick={() => onChange(field)}
      className={`flex items-center gap-1 text-xs uppercase tracking-wide font-medium hover:text-foreground transition ${
        isActive ? "text-foreground" : "text-muted-foreground"
      } ${align === "right" ? "justify-end w-full" : ""}`}
    >
      {label}
      {isActive ? (
        dir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
      ) : null}
    </button>
  );
}

function CompanyRow({
  company,
  selected,
  onToggleSelect,
}: {
  company: CrmCompanyRow;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const opt = ACCOUNT_STAGE_OPTIONS.find((o) => o.value === company.account_stage);
  const loc = [company.city, company.country].filter(Boolean).join(", ");

  return (
    <tr
      className={`group border-b last:border-b-0 hover:bg-muted/40 transition ${
        selected ? "bg-primary/5" : ""
      }`}
    >
      {/* Checkbox */}
      <td className="px-3 py-2.5 w-10">
        <Checkbox
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={onToggleSelect}
        />
      </td>

      {/* Company (logo + name + domain) — link to detail page */}
      <td className="py-2.5">
        <Link to={`/crm/companies/${company.id}`} className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 overflow-hidden text-xs font-semibold text-primary">
            {company.logo_url ? (
              <img src={company.logo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              initials(company.name)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate group-hover:underline">
                {company.name}
              </span>
              {company.enrichment_data && (
                <Sparkles className="h-3 w-3 text-amber-600 shrink-0" />
              )}
            </div>
            {company.domain && (
              <div className="text-xs text-muted-foreground truncate">{company.domain}</div>
            )}
          </div>
        </Link>
      </td>

      {/* Industry */}
      <td className="py-2.5 text-sm text-muted-foreground hidden md:table-cell">
        {company.industry || "—"}
      </td>

      {/* Location */}
      <td className="py-2.5 text-sm text-muted-foreground hidden lg:table-cell">
        {loc || "—"}
      </td>

      {/* Headcount */}
      <td className="py-2.5 text-sm tabular-nums text-right hidden lg:table-cell">
        {company.employee_count?.toLocaleString() ?? "—"}
      </td>

      {/* Lifecycle */}
      <td className="py-2.5">
        <Badge variant="outline" className={`text-[10px] py-0 h-5 font-medium ${opt?.color ?? ""}`}>
          {opt?.label ?? company.account_stage}
        </Badge>
      </td>

      {/* Contacts count */}
      <td className="py-2.5 text-sm tabular-nums text-right">
        <span className={company.contact_count === 0 ? "text-muted-foreground" : "font-medium"}>
          {company.contact_count}
        </span>
      </td>

      {/* Last signal */}
      <td className="py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap pr-2 hidden xl:table-cell">
        {fmtRel(company.last_signal_at ?? company.last_contact_at ?? company.first_seen_at)}
      </td>

      {/* Hover actions */}
      <td className="py-2.5 pr-3 text-right w-20">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
          {company.website_url && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              asChild
              onClick={(e) => e.stopPropagation()}
            >
              <a href={company.website_url} target="_blank" rel="noreferrer" aria-label="Website">
                <Globe className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {company.linkedin_url && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              asChild
              onClick={(e) => e.stopPropagation()}
            >
              <a href={company.linkedin_url} target="_blank" rel="noreferrer" aria-label="LinkedIn">
                <Linkedin className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <Link to={`/crm/companies/${company.id}`}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function CompaniesPage() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<CrmAccountStage | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("last_signal_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const stats = useCrmCompaniesStats();
  const update = useUpdateCrmCompany();
  const qc = useQueryClient();

  const query = useCrmCompanies({
    search,
    stage,
    sortBy,
    sortDir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const togglePageSelection = () => {
    const next = new Set(selected);
    if (allOnPageSelected) {
      rows.forEach((r) => next.delete(r.id));
    } else {
      rows.forEach((r) => next.add(r.id));
    }
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const onSort = (f: SortKey) => {
    if (f === sortBy) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortBy(f); setSortDir("desc"); }
    setPage(0);
  };

  // Bulk lifecycle change. Optimistic — server updates each row, then we
  // invalidate the list query so it refetches with new statuses.
  const bulkSetStage = async (next: CrmAccountStage) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("crm_companies")
      .update({ account_stage: next })
      .in("id", ids);
    if (error) {
      toast.error(`Bulk update failed: ${error.message}`);
      return;
    }
    toast.success(`Updated ${ids.length} ${ids.length === 1 ? "company" : "companies"} to ${stageLabel(next)}`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["crm_companies"] });
    qc.invalidateQueries({ queryKey: ["crm_companies_stats"] });
  };

  const statsCounts = stats.data?.counts;
  const statsTotal = stats.data?.total ?? 0;

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="container mx-auto py-6 space-y-5">
        {/* Hero — compact, no marketing copy */}
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Companies</h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {statsTotal.toLocaleString()}
          </span>
        </div>

        {/* Pipeline pills — count per lifecycle stage, click to filter */}
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
          <PipelinePill
            label="All"
            count={statsTotal}
            active={stage === "all"}
            onClick={() => { setStage("all"); setPage(0); }}
          />
          {ACCOUNT_STAGE_OPTIONS.map((o) => (
            <PipelinePill
              key={o.value}
              label={o.label}
              count={statsCounts?.[o.value] ?? 0}
              active={stage === o.value}
              color={stage === o.value ? undefined : o.color}
              onClick={() => { setStage(o.value); setPage(0); }}
            />
          ))}
        </div>

        {/* Sticky toolbar — search + sort */}
        <Card className="sticky top-0 z-10">
          <CardContent className="py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[20rem] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name or domain…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={`${sortBy}|${sortDir}`} onValueChange={(v) => {
                const [f, d] = v.split("|");
                setSortBy(f as SortKey);
                setSortDir(d as "asc" | "desc");
                setPage(0);
              }}>
                <SelectTrigger className="w-52 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_signal_at|desc">Latest signal first</SelectItem>
                  <SelectItem value="contact_count|desc">Most contacts</SelectItem>
                  <SelectItem value="first_seen_at|desc">Recently added</SelectItem>
                  <SelectItem value="name|asc">Name (A → Z)</SelectItem>
                  <SelectItem value="name|desc">Name (Z → A)</SelectItem>
                </SelectContent>
              </Select>
              {selected.size > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground">
                    {selected.size} selected
                  </span>
                  <Select onValueChange={(v) => bulkSetStage(v as CrmAccountStage)}>
                    <SelectTrigger className="w-44 h-8 text-xs">
                      <SelectValue placeholder="Set stage…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_STAGE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="p-6 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <Skeleton className="w-8 h-8 rounded-md" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-1/4" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center space-y-2">
                <Users className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {search ? `No companies match "${search}".` :
                   stage !== "all" ? `No companies in stage "${stageLabel(stage)}".` :
                   "No companies yet — they'll appear as Signals discover them."}
                </p>
                {(search || stage !== "all") && (
                  <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStage("all"); }}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-2 w-10">
                        <Checkbox checked={allOnPageSelected} onCheckedChange={togglePageSelection} />
                      </th>
                      <th className="py-2 pr-3">
                        <SortHeader label="Company" field="name" current={sortBy} dir={sortDir} onChange={onSort} />
                      </th>
                      <th className="py-2 pr-3 hidden md:table-cell">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Industry</span>
                      </th>
                      <th className="py-2 pr-3 hidden lg:table-cell">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Location</span>
                      </th>
                      <th className="py-2 pr-3 hidden lg:table-cell text-right">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Employees</span>
                      </th>
                      <th className="py-2 pr-3">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Stage</span>
                      </th>
                      <th className="py-2 pr-3 text-right">
                        <SortHeader label="Contacts" field="contact_count" current={sortBy} dir={sortDir} onChange={onSort} align="right" />
                      </th>
                      <th className="py-2 pr-3 hidden xl:table-cell">
                        <SortHeader label="Last signal" field="last_signal_at" current={sortBy} dir={sortDir} onChange={onSort} />
                      </th>
                      <th className="py-2 pr-3 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <CompanyRow
                        key={r.id}
                        company={r}
                        selected={selected.has(r.id)}
                        onToggleSelect={() => toggleOne(r.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
