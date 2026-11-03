import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown, X, Filter, Check, Loader2, Target, Building2, UserCheck, Cpu, Mail, ShieldAlert, Megaphone, HelpCircle, Plus, ListPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFilterOptions,
  formatSeniority,
  formatDepartment,
  COMPANY_SIZE_OPTIONS,
} from "@/hooks/useFilterOptions";
import { useProducts } from "@/hooks/useProducts";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import { Input } from "@/components/ui/input";

export const REVENUE_MODEL_OPTIONS = [
  { value: "SaaS", label: "SaaS" },
  { value: "Services", label: "Services" },
  { value: "Product", label: "Product" },
  { value: "Marketplace", label: "Marketplace" },
  { value: "Hybrid", label: "Hybrid" },
];

import type {
  EmailQuality,
  EmailType,
  EnrichmentFilters,
} from "@/types/enrichment-filters";

// Re-export so existing imports from this file keep working. The canonical
// definitions live in src/types/enrichment-filters.ts (shared by both filter
// engines — see the drift-guard note there).
export type { EmailQuality, EmailType, EnrichmentFilters };

export const EMAIL_QUALITY_OPTIONS: Array<{
  value: EmailQuality;
  label: string;
  description: string;
}> = [
  { value: 'clean', label: 'Clean', description: 'Verified valid, deliverable' },
  { value: 'risky', label: 'Risky', description: 'Catch-all, role, or free' },
  { value: 'failed', label: 'Failed', description: 'Invalid, disposable, spam-trap' },
  { value: 'unverified', label: 'Unverified', description: 'Never checked' },
];

export const EMAIL_TYPE_OPTIONS: Array<{ value: EmailType; label: string }> = [
  { value: 'business', label: 'Business' },
  { value: 'personal', label: 'Personal' },
];

interface AdvancedFiltersProps {
  filters: EnrichmentFilters;
  onChange: (filters: EnrichmentFilters) => void;
  className?: string;
  /** Expand the panel on mount (e.g. lead-list outreach flow where the filter IS the audience). */
  defaultOpen?: boolean;
  /** Hide specific fields' controls/chips — used by the smart-list builder,
   *  whose membership engine only evaluates a subset of the enrichment fields.
   *  A field left in here never renders and is excluded from the active count. */
  hiddenFields?: ReadonlyArray<keyof EnrichmentFilters>;
}

export function AdvancedFilters({
  filters,
  onChange,
  className,
  defaultOpen = false,
  hiddenFields,
}: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { data: filterOptions, isLoading } = useFilterOptions();
  const { products } = useProducts();
  const { data: customFieldDefs } = useCustomFieldDefs();

  const hidden = useMemo(() => new Set(hiddenFields ?? []), [hiddenFields]);
  const isHidden = useCallback((f: keyof EnrichmentFilters) => hidden.has(f), [hidden]);
  // A section renders only if at least one of its fields is still visible.
  const showWebsiteSignals = !isHidden("runsAds") || !isHidden("detectedTechnologies") || !isHidden("excludedTechnologies");
  const showCustomQuestions = !isHidden("customQuestions");
  const showCustomFields = !isHidden("customFieldConditions");
  // Reachability section also hosts the enrichment/Notion/SEG/AI-status controls.
  const showReachability =
    !isHidden("hasEmail") || !isHidden("emailVerified") || !isHidden("emailQuality") ||
    !isHidden("emailType") || !isHidden("minEmailConfidence") || !isHidden("hasEnrichmentData") ||
    !isHidden("hasNotionUrl") || !isHidden("segFirewall") || !isHidden("aiAnalysisStatus");
  const showQualSwitches = !isHidden("isB2b") || !isHidden("hasOutboundMotion") || !isHidden("hiringSalesRoles");

  // Local slider state to avoid firing a query on every drag step
  const [localMinIcp, setLocalMinIcp] = useState(filters.minIcpScore ?? 0);
  const [localMaxIcp, setLocalMaxIcp] = useState(filters.maxIcpScore ?? 100);
  const [localMinDm, setLocalMinDm] = useState(filters.minDmScore ?? 0);
  const [localMaxDm, setLocalMaxDm] = useState(filters.maxDmScore ?? 100);
  const [localMinConfidence, setLocalMinConfidence] = useState(filters.minEmailConfidence ?? 0);

  // Deduped union of every product's custom analysis questions (answers are stored by question text)
  const customQuestionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products || []) {
      for (const q of p.analysis_questions || []) {
        const t = q?.trim();
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [products]);

  // Sync local state when filters change externally (e.g. clear all)
  useEffect(() => { setLocalMinIcp(filters.minIcpScore ?? 0); }, [filters.minIcpScore]);
  useEffect(() => { setLocalMaxIcp(filters.maxIcpScore ?? 100); }, [filters.maxIcpScore]);
  useEffect(() => { setLocalMinDm(filters.minDmScore ?? 0); }, [filters.minDmScore]);
  useEffect(() => { setLocalMaxDm(filters.maxDmScore ?? 100); }, [filters.maxDmScore]);
  useEffect(() => { setLocalMinConfidence(filters.minEmailConfidence ?? 0); }, [filters.minEmailConfidence]);

  // ── Custom-question condition helpers (multiple, AND-combined) ──
  const customQuestionConds = filters.customQuestions || [];
  const updateCq = (idx: number, patch: Partial<{ question: string; minScore?: number }>) => {
    const list = customQuestionConds.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ ...filters, customQuestions: list });
  };
  const removeCq = (idx: number) => {
    const list = customQuestionConds.filter((_, i) => i !== idx);
    onChange({ ...filters, customQuestions: list.length ? list : undefined });
  };
  const addCq = () => {
    const used = new Set(customQuestionConds.map((c) => c.question));
    const next = customQuestionOptions.find((q) => !used.has(q)) || customQuestionOptions[0];
    if (!next) return;
    onChange({ ...filters, customQuestions: [...customQuestionConds, { question: next, minScore: 75 }] });
  };

  // ── Custom-field condition helpers (multiple, AND-combined) ──
  const customFieldConds = filters.customFieldConditions || [];
  const updateCfc = (
    idx: number,
    patch: Partial<{ fieldKey: string; operator: "equals" | "contains" | "has_value" | "is_empty"; value?: string }>
  ) => {
    const list = customFieldConds.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ ...filters, customFieldConditions: list });
  };
  const removeCfc = (idx: number) => {
    const list = customFieldConds.filter((_, i) => i !== idx);
    onChange({ ...filters, customFieldConditions: list.length ? list : undefined });
  };
  const addCfc = () => {
    const used = new Set(customFieldConds.map((c) => c.fieldKey));
    const next = (customFieldDefs || []).find((f) => !used.has(f.field_key));
    if (!next) return;
    onChange({
      ...filters,
      customFieldConditions: [...customFieldConds, { fieldKey: next.field_key, operator: "has_value" }],
    });
  };

  // Debounced filter update to avoid flooding queries during rapid slider interaction
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const debouncedUpdateFilter = useCallback(<K extends keyof EnrichmentFilters>(
    key: K,
    value: EnrichmentFilters[K],
    delay = 400
  ) => {
    if (debounceRef.current[key as string]) clearTimeout(debounceRef.current[key as string]);
    debounceRef.current[key as string] = setTimeout(() => {
      onChange({ ...filtersRef.current, [key]: value });
    }, delay);
  }, [onChange]);

  // Count active filters
  const activeFilterCount = [
    filters.industries?.length,
    filters.companySizes?.length,
    filters.minEmployeeCount !== undefined || filters.maxEmployeeCount !== undefined ? 1 : 0,
    filters.seniorities?.length,
    filters.departments?.length,
    filters.technologies?.length,
    filters.emailVerified !== undefined ? 1 : 0,
    filters.emailQuality?.length,
    filters.minEmailConfidence && filters.minEmailConfidence > 0 ? 1 : 0,
    filters.emailType ? 1 : 0,
    filters.countries?.length,
    filters.cities?.length,
    filters.hasEnrichmentData !== undefined ? 1 : 0,
    filters.icpProductId ? 1 : 0,
    (filters.minDmScore !== undefined && filters.minDmScore > 0) || (filters.maxDmScore !== undefined && filters.maxDmScore < 100) ? 1 : 0,
    filters.isB2b !== undefined ? 1 : 0,
    filters.revenueModels?.length,
    filters.hasOutboundMotion !== undefined ? 1 : 0,
    filters.hiringSalesRoles !== undefined ? 1 : 0,
    filters.runsAds !== undefined ? 1 : 0,
    filters.detectedTechnologies?.length,
    filters.excludedTechnologies?.length,
    filters.customQuestions?.length,
    filters.customFieldConditions?.length,
    filters.hasEmail !== undefined ? 1 : 0,
    filters.hasNotionUrl !== undefined ? 1 : 0,
    filters.segFirewall ? 1 : 0,
    filters.aiAnalysisStatus ? 1 : 0,
  ].reduce((acc, val) => acc + (val || 0), 0);

  const clearAllFilters = () => {
    onChange({});
  };

  const updateFilter = <K extends keyof EnrichmentFilters>(
    key: K,
    value: EnrichmentFilters[K]
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleArrayFilter = (
    key: keyof Pick<
      EnrichmentFilters,
      | "industries"
      | "companySizes"
      | "seniorities"
      | "departments"
      | "technologies"
      | "detectedTechnologies"
      | "excludedTechnologies"
      | "countries"
      | "cities"
      | "revenueModels"
    >,
    value: string
  ) => {
    const current = filters[key] || [];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateFilter(key, updated.length > 0 ? updated : undefined);
  };

  const updateEmployeeMinimum = (raw: string) => {
    if (raw === "") {
      updateFilter("minEmployeeCount", undefined);
      return;
    }
    const min = Math.max(0, Math.trunc(Number(raw)));
    onChange({
      ...filters,
      minEmployeeCount: min,
      maxEmployeeCount: filters.maxEmployeeCount !== undefined && filters.maxEmployeeCount < min
        ? min
        : filters.maxEmployeeCount,
    });
  };

  const updateEmployeeMaximum = (raw: string) => {
    if (raw === "") {
      updateFilter("maxEmployeeCount", undefined);
      return;
    }
    const max = Math.max(0, Math.trunc(Number(raw)));
    onChange({
      ...filters,
      minEmployeeCount: filters.minEmployeeCount !== undefined && filters.minEmployeeCount > max
        ? max
        : filters.minEmployeeCount,
      maxEmployeeCount: max,
    });
  };

  const removeFilter = (key: keyof EnrichmentFilters, value?: string) => {
    if (key === "icpProductId") {
      onChange({ ...filters, icpProductId: undefined, minIcpScore: undefined, maxIcpScore: undefined, minDmScore: undefined, maxDmScore: undefined });
    } else if (key === "customQuestions") {
      const list = (filters.customQuestions || []).filter((c) => c.question !== value);
      onChange({ ...filters, customQuestions: list.length ? list : undefined });
    } else if (key === "customFieldConditions") {
      const list = (filters.customFieldConditions || []).filter((c) => c.fieldKey !== value);
      onChange({ ...filters, customFieldConditions: list.length ? list : undefined });
    } else if (key === "minDmScore" || key === "maxDmScore") {
      onChange({ ...filters, minDmScore: undefined, maxDmScore: undefined });
    } else if (key === "minEmployeeCount" || key === "maxEmployeeCount") {
      onChange({ ...filters, minEmployeeCount: undefined, maxEmployeeCount: undefined });
    } else if (value && Array.isArray(filters[key])) {
      const updated = (filters[key] as string[]).filter((v) => v !== value);
      updateFilter(key, updated.length > 0 ? updated : undefined);
    } else {
      updateFilter(key, undefined);
    }
  };

  // Build list of active filter pills
  const activeFilters: Array<{
    key: keyof EnrichmentFilters;
    value: string;
    label: string;
  }> = [];

  filters.industries?.forEach((v) =>
    activeFilters.push({ key: "industries", value: v, label: v })
  );
  filters.companySizes?.forEach((v) =>
    activeFilters.push({ key: "companySizes", value: v, label: `Legacy size: ${v}` })
  );
  if (filters.minEmployeeCount !== undefined || filters.maxEmployeeCount !== undefined) {
    const min = filters.minEmployeeCount;
    const max = filters.maxEmployeeCount;
    const range = min !== undefined && max !== undefined
      ? `${min.toLocaleString()}–${max.toLocaleString()}`
      : min !== undefined ? `${min.toLocaleString()}+` : `up to ${max!.toLocaleString()}`;
    activeFilters.push({ key: "minEmployeeCount", value: range, label: `Employees: ${range}` });
  }
  filters.seniorities?.forEach((v) =>
    activeFilters.push({
      key: "seniorities",
      value: v,
      label: formatSeniority(v),
    })
  );
  filters.departments?.forEach((v) =>
    activeFilters.push({
      key: "departments",
      value: v,
      label: formatDepartment(v),
    })
  );
  filters.technologies?.forEach((v) =>
    activeFilters.push({ key: "technologies", value: v, label: v })
  );
  filters.countries?.forEach((v) =>
    activeFilters.push({ key: "countries", value: v, label: v })
  );
  filters.cities?.forEach((v) =>
    activeFilters.push({ key: "cities", value: v, label: v })
  );
  if (filters.emailVerified !== undefined) {
    activeFilters.push({
      key: "emailVerified",
      value: String(filters.emailVerified),
      label: filters.emailVerified ? "Email Verified" : "Email Not Verified",
    });
  }
  filters.emailQuality?.forEach((q) => {
    const opt = EMAIL_QUALITY_OPTIONS.find((o) => o.value === q);
    activeFilters.push({
      key: "emailQuality",
      value: q,
      label: `Email: ${opt?.label ?? q}`,
    });
  });
  if (filters.minEmailConfidence && filters.minEmailConfidence > 0) {
    activeFilters.push({
      key: "minEmailConfidence",
      value: String(filters.minEmailConfidence),
      label: `≥${filters.minEmailConfidence}% confidence`,
    });
  }
  if (filters.emailType) {
    const opt = EMAIL_TYPE_OPTIONS.find((o) => o.value === filters.emailType);
    activeFilters.push({
      key: "emailType",
      value: filters.emailType,
      label: `Email Type: ${opt?.label ?? filters.emailType}`,
    });
  }
  if (filters.hasEnrichmentData !== undefined) {
    activeFilters.push({
      key: "hasEnrichmentData",
      value: String(filters.hasEnrichmentData),
      label: filters.hasEnrichmentData ? "Has Enrichment Data" : "No Enrichment Data",
    });
  }
  if (filters.icpProductId) {
    const productName = products?.find((p) => p.id === filters.icpProductId)?.name || "Product";
    const scoreLabel = filters.minIcpScore || filters.maxIcpScore
      ? ` (${filters.minIcpScore ?? 0}–${filters.maxIcpScore ?? 100})`
      : "";
    activeFilters.push({
      key: "icpProductId",
      value: filters.icpProductId,
      label: `ICP: ${productName}${scoreLabel}`,
    });
    if ((filters.minDmScore !== undefined && filters.minDmScore > 0) || (filters.maxDmScore !== undefined && filters.maxDmScore < 100)) {
      activeFilters.push({
        key: "minDmScore",
        value: `${filters.minDmScore ?? 0}-${filters.maxDmScore ?? 100}`,
        label: `DM Fit: ${filters.minDmScore ?? 0}–${filters.maxDmScore ?? 100}`,
      });
    }
  }
  if (filters.isB2b !== undefined) {
    activeFilters.push({
      key: "isB2b",
      value: String(filters.isB2b),
      label: filters.isB2b ? "B2B Only" : "B2C Only",
    });
  }
  filters.revenueModels?.forEach((v) =>
    activeFilters.push({ key: "revenueModels", value: v, label: `Revenue: ${v}` })
  );
  if (filters.hasOutboundMotion !== undefined) {
    activeFilters.push({
      key: "hasOutboundMotion",
      value: "true",
      label: "Has Outbound Motion",
    });
  }
  if (filters.hiringSalesRoles !== undefined) {
    activeFilters.push({
      key: "hiringSalesRoles",
      value: "true",
      label: "Hiring Sales Roles",
    });
  }
  if (filters.runsAds !== undefined) {
    activeFilters.push({
      key: "runsAds",
      value: String(filters.runsAds),
      label: filters.runsAds ? "Runs Paid Ads" : "No Paid Ads",
    });
  }
  filters.detectedTechnologies?.forEach((v, i) =>
    activeFilters.push({
      key: "detectedTechnologies",
      value: v,
      label: i === 0 && filters.detectedTechMatchAll ? `${v} (all)` : v,
    })
  );
  filters.excludedTechnologies?.forEach((v) =>
    activeFilters.push({ key: "excludedTechnologies", value: v, label: `Excludes: ${v}` })
  );
  filters.customQuestions?.forEach((c) => {
    const q = c.question.length > 28 ? c.question.slice(0, 28) + "…" : c.question;
    const scoreLabel = c.minScore && c.minScore > 0 ? ` ≥${c.minScore}` : "";
    activeFilters.push({ key: "customQuestions", value: c.question, label: `Q: ${q}${scoreLabel}` });
  });
  filters.customFieldConditions?.forEach((c) => {
    const def = customFieldDefs?.find((f) => f.field_key === c.fieldKey);
    const label = def?.display_name || c.fieldKey;
    const opLabel =
      c.operator === "has_value" ? "has value" :
      c.operator === "is_empty" ? "is empty" :
      c.operator === "contains" ? `contains "${c.value}"` :
      `= "${c.value}"`;
    activeFilters.push({ key: "customFieldConditions", value: c.fieldKey, label: `${label} ${opLabel}` });
  });
  if (filters.hasEmail !== undefined) {
    activeFilters.push({
      key: "hasEmail",
      value: String(filters.hasEmail),
      label: filters.hasEmail ? "Has Email" : "No Email",
    });
  }
  if (filters.hasNotionUrl !== undefined) {
    activeFilters.push({
      key: "hasNotionUrl",
      value: String(filters.hasNotionUrl),
      label: filters.hasNotionUrl ? "Has Notion URL" : "No Notion URL",
    });
  }
  if (filters.segFirewall) {
    activeFilters.push({
      key: "segFirewall",
      value: filters.segFirewall,
      label: filters.segFirewall === 'behind' ? "Behind Firewall" : filters.segFirewall === 'clear' ? "No Firewall" : "Not Checked",
    });
  }
  if (filters.aiAnalysisStatus) {
    const statusLabels: Record<string, string> = {
      not_analyzed: "Not Analyzed",
      analyzing: "Analyzing",
      analyzed: "Analyzed",
      failed: "Analysis Failed",
      no_data: "No Data",
    };
    activeFilters.push({
      key: "aiAnalysisStatus",
      value: filters.aiAnalysisStatus,
      label: `AI: ${statusLabels[filters.aiAnalysisStatus] || filters.aiAnalysisStatus}`,
    });
  }

  // Never surface a chip for a field the caller hid (defends against stale values).
  const visibleActiveFilters = activeFilters.filter((f) => !isHidden(f.key));

  return (
    <div className={cn("space-y-3", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-2",
              activeFilterCount > 0 && "border-primary text-primary"
            )}
          >
            <Filter className="h-4 w-4" />
            Advanced Filters
            {activeFilterCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 h-5 min-w-5 px-1.5 bg-primary text-primary-foreground"
              >
                {activeFilterCount}
              </Badge>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
          <div className="rounded-lg border bg-card p-4 space-y-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* FIRMOGRAPHIC */}
                <FilterSection icon={<Building2 className="h-3.5 w-3.5" />} label="Firmographic">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Industry</Label>
                      <MultiSelectCombobox
                        options={filterOptions?.industries.map((i) => ({ value: i, label: i })) || []}
                        selected={filters.industries || []}
                        onToggle={(v) => toggleArrayFilter("industries", v)}
                        placeholder="Select industries..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Company Size (employees)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={filters.minEmployeeCount ?? ""}
                          onChange={(e) => updateEmployeeMinimum(e.target.value)}
                          placeholder="Min"
                          aria-label="Minimum employee count"
                          className="h-9"
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={filters.maxEmployeeCount ?? ""}
                          onChange={(e) => updateEmployeeMaximum(e.target.value)}
                          placeholder="Max"
                          aria-label="Maximum employee count"
                          className="h-9"
                        />
                      </div>
                      {filters.companySizes?.length ? (
                        <div className="pt-1">
                          <Label className="text-[11px] text-amber-600">Legacy exact bands</Label>
                          <MultiSelectCombobox
                            options={COMPANY_SIZE_OPTIONS}
                            selected={filters.companySizes}
                            onToggle={(v) => toggleArrayFilter("companySizes", v)}
                            placeholder="Legacy sizes..."
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Country</Label>
                      <MultiSelectCombobox
                        options={filterOptions?.countries.map((c) => ({ value: c, label: c })) || []}
                        selected={filters.countries || []}
                        onToggle={(v) => toggleArrayFilter("countries", v)}
                        placeholder="Select countries..."
                        searchable
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">City</Label>
                      <MultiSelectCombobox
                        options={filterOptions?.cities.map((c) => ({ value: c, label: c })) || []}
                        selected={filters.cities || []}
                        onToggle={(v) => toggleArrayFilter("cities", v)}
                        placeholder="Select cities..."
                        searchable
                      />
                    </div>
                  </div>
                </FilterSection>

                {/* ROLE */}
                <FilterSection icon={<UserCheck className="h-3.5 w-3.5" />} label="Role">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Seniority</Label>
                      <MultiSelectCombobox
                        options={filterOptions?.seniorities.map((s) => ({ value: s, label: formatSeniority(s) })) || []}
                        selected={filters.seniorities || []}
                        onToggle={(v) => toggleArrayFilter("seniorities", v)}
                        placeholder="Select seniority..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Department</Label>
                      <MultiSelectCombobox
                        options={filterOptions?.departments.map((d) => ({ value: d, label: formatDepartment(d) })) || []}
                        selected={filters.departments || []}
                        onToggle={(v) => toggleArrayFilter("departments", v)}
                        placeholder="Select departments..."
                      />
                    </div>
                  </div>
                </FilterSection>

                {/* QUALIFICATION */}
                <FilterSection icon={<Target className="h-3.5 w-3.5" />} label="Qualification">
                  <div className="space-y-4">
                    {/* ICP Score by Product */}
                    {products && products.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">ICP Score by Product</Label>
                        <div className="flex flex-wrap items-center gap-4">
                          <Select
                            value={filters.icpProductId || "_none"}
                            onValueChange={(v) => {
                              if (v === "_none") {
                                onChange({ ...filters, icpProductId: undefined, minIcpScore: undefined, maxIcpScore: undefined, minDmScore: undefined, maxDmScore: undefined });
                              } else {
                                onChange({ ...filters, icpProductId: v, minDmScore: undefined, maxDmScore: undefined });
                              }
                            }}
                          >
                            <SelectTrigger className="w-[220px] h-9">
                              <SelectValue placeholder="Select product..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">
                                <span className="text-muted-foreground">All products</span>
                              </SelectItem>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {filters.icpProductId && (
                            <>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs whitespace-nowrap">Min:</Label>
                                <Slider
                                  value={[localMinIcp]}
                                  onValueChange={([v]) => setLocalMinIcp(v)}
                                  onValueCommit={([v]) => debouncedUpdateFilter("minIcpScore", v > 0 ? v : undefined)}
                                  max={100}
                                  step={5}
                                  className="w-28"
                                />
                                <span className="text-xs text-muted-foreground w-8">{localMinIcp}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs whitespace-nowrap">Max:</Label>
                                <Slider
                                  value={[localMaxIcp]}
                                  onValueChange={([v]) => setLocalMaxIcp(v)}
                                  onValueCommit={([v]) => debouncedUpdateFilter("maxIcpScore", v < 100 ? v : undefined)}
                                  max={100}
                                  step={5}
                                  className="w-28"
                                />
                                <span className="text-xs text-muted-foreground w-8">{localMaxIcp}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* DM Fit Score — only when a product is selected */}
                    {filters.icpProductId && !isHidden("minDmScore") && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <UserCheck className="h-3 w-3 text-violet-500" />
                          Decision-Maker Fit Score
                        </Label>
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs whitespace-nowrap">Min:</Label>
                            <Slider
                              value={[localMinDm]}
                              onValueChange={([v]) => setLocalMinDm(v)}
                              onValueCommit={([v]) => debouncedUpdateFilter("minDmScore", v > 0 ? v : undefined)}
                              max={100}
                              step={5}
                              className="w-28"
                            />
                            <span className="text-xs text-muted-foreground w-8">{localMinDm}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs whitespace-nowrap">Max:</Label>
                            <Slider
                              value={[localMaxDm]}
                              onValueChange={([v]) => setLocalMaxDm(v)}
                              onValueCommit={([v]) => debouncedUpdateFilter("maxDmScore", v < 100 ? v : undefined)}
                              max={100}
                              step={5}
                              className="w-28"
                            />
                            <span className="text-xs text-muted-foreground w-8">{localMaxDm}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Enrichment-based qualification filters */}
                    {showQualSwitches && (
                      <div className="flex flex-wrap items-center gap-6">
                        {!isHidden("isB2b") && (
                          <div className="flex items-center gap-2">
                            <Switch
                              id="is-b2b"
                              checked={filters.isB2b === true}
                              onCheckedChange={(checked) =>
                                updateFilter("isB2b", checked ? true : undefined)
                              }
                            />
                            <Label htmlFor="is-b2b" className="text-sm">
                              B2B Only
                            </Label>
                          </div>
                        )}

                        {!isHidden("hasOutboundMotion") && (
                          <div className="flex items-center gap-2">
                            <Switch
                              id="has-outbound"
                              checked={filters.hasOutboundMotion === true}
                              onCheckedChange={(checked) =>
                                updateFilter("hasOutboundMotion", checked ? true : undefined)
                              }
                            />
                            <Label htmlFor="has-outbound" className="text-sm">
                              Has Outbound Motion
                            </Label>
                          </div>
                        )}

                        {!isHidden("hiringSalesRoles") && (
                          <div className="flex items-center gap-2">
                            <Switch
                              id="hiring-sales"
                              checked={filters.hiringSalesRoles === true}
                              onCheckedChange={(checked) =>
                                updateFilter("hiringSalesRoles", checked ? true : undefined)
                              }
                            />
                            <Label htmlFor="hiring-sales" className="text-sm">
                              Hiring Sales Roles
                            </Label>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Revenue Model */}
                    {!isHidden("revenueModels") && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Revenue Model</Label>
                        <MultiSelectCombobox
                          options={REVENUE_MODEL_OPTIONS}
                          selected={filters.revenueModels || []}
                          onToggle={(v) => toggleArrayFilter("revenueModels", v)}
                          placeholder="Select revenue models..."
                        />
                      </div>
                    )}
                  </div>
                </FilterSection>

                {/* WEBSITE & AD SIGNALS (from detected_technologies) */}
                {showWebsiteSignals && (
                <FilterSection icon={<Megaphone className="h-3.5 w-3.5" />} label="Website & Ad Signals">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Runs Paid Ads</Label>
                        <Select
                          value={filters.runsAds === undefined ? "_any" : filters.runsAds ? "yes" : "no"}
                          onValueChange={(v) =>
                            updateFilter("runsAds", v === "_any" ? undefined : v === "yes")
                          }
                        >
                          <SelectTrigger className="w-[100px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_any">Any</SelectItem>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs text-muted-foreground">Has Technology / Pixels</Label>
                        {(filters.detectedTechnologies?.length ?? 0) > 1 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Match</span>
                            <Select
                              value={filters.detectedTechMatchAll ? "all" : "any"}
                              onValueChange={(v) => updateFilter("detectedTechMatchAll", v === "all" ? true : undefined)}
                            >
                              <SelectTrigger className="h-7 w-[74px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">Any</SelectItem>
                                <SelectItem value="all">All</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      <MultiSelectCombobox
                        options={filterOptions?.detectedTechnologies.map((t) => ({ value: t, label: t })) || []}
                        selected={filters.detectedTechnologies || []}
                        onToggle={(v) => toggleArrayFilter("detectedTechnologies", v)}
                        placeholder="e.g. WordPress, TikTok Pixel, HubSpot..."
                        searchable
                        popoverWidth="w-[280px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Excludes Technology / Pixels</Label>
                      <MultiSelectCombobox
                        options={filterOptions?.detectedTechnologies.map((t) => ({ value: t, label: t })) || []}
                        selected={filters.excludedTechnologies || []}
                        onToggle={(v) => toggleArrayFilter("excludedTechnologies", v)}
                        placeholder="e.g. Meta Pixel (leads WITHOUT these)..."
                        searchable
                        popoverWidth="w-[280px]"
                      />
                    </div>
                  </div>
                </FilterSection>
                )}

                {/* CUSTOM QUESTIONS (score filters — multiple, AND-combined) */}
                {showCustomQuestions && customQuestionOptions.length > 0 && (
                  <FilterSection icon={<HelpCircle className="h-3.5 w-3.5" />} label="Custom Questions">
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {customQuestionConds.length === 0
                          ? "Match leads by AI custom-question answers."
                          : customQuestionConds.length > 1
                            ? "Match leads by custom-question answers — all conditions required."
                            : "Match leads by custom-question answers."}
                      </p>
                      {customQuestionConds.map((cond, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-2">
                          <Select value={cond.question} onValueChange={(v) => updateCq(idx, { question: v })}>
                            <SelectTrigger className="w-[240px] h-9">
                              <SelectValue placeholder="Select a question..." />
                            </SelectTrigger>
                            <SelectContent>
                              {customQuestionOptions.map((q) => (
                                <SelectItem key={q} value={q}>{q}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs whitespace-nowrap text-muted-foreground">Min score</Label>
                            <Select
                              value={String(cond.minScore ?? 0)}
                              onValueChange={(v) => updateCq(idx, { minScore: Number(v) > 0 ? Number(v) : undefined })}
                            >
                              <SelectTrigger className="w-[92px] h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Any</SelectItem>
                                <SelectItem value="25">≥ 25</SelectItem>
                                <SelectItem value="50">≥ 50</SelectItem>
                                <SelectItem value="75">≥ 75</SelectItem>
                                <SelectItem value="90">≥ 90</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeCq(idx)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      {customQuestionConds.length < customQuestionOptions.length && (
                        <Button variant="outline" size="sm" className="h-8" onClick={addCq}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Add question
                        </Button>
                      )}
                    </div>
                  </FilterSection>
                )}

                {/* CUSTOM FIELDS (org-defined custom variables — multiple, AND-combined) */}
                {showCustomFields && customFieldDefs && customFieldDefs.length > 0 && (
                  <FilterSection icon={<ListPlus className="h-3.5 w-3.5" />} label="Custom Fields">
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {customFieldConds.length === 0
                          ? "Match leads by one or more custom fields."
                          : customFieldConds.length > 1
                            ? "Match leads by custom field — all conditions required."
                            : "Match leads by custom field."}
                      </p>
                      {customFieldConds.map((cond, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-2">
                          <Select value={cond.fieldKey} onValueChange={(v) => updateCfc(idx, { fieldKey: v })}>
                            <SelectTrigger className="w-[200px] h-9">
                              <SelectValue placeholder="Select a field..." />
                            </SelectTrigger>
                            <SelectContent>
                              {customFieldDefs.map((f) => (
                                <SelectItem key={f.field_key} value={f.field_key}>{f.display_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={cond.operator}
                            onValueChange={(v) => updateCfc(idx, { operator: v as typeof cond.operator })}
                          >
                            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="has_value">Has any value</SelectItem>
                              <SelectItem value="is_empty">Is empty</SelectItem>
                              <SelectItem value="equals">Equals</SelectItem>
                              <SelectItem value="contains">Contains</SelectItem>
                            </SelectContent>
                          </Select>
                          {(cond.operator === "equals" || cond.operator === "contains") && (
                            <Input
                              value={cond.value || ""}
                              onChange={(e) => updateCfc(idx, { value: e.target.value })}
                              placeholder="Value..."
                              className="w-[160px] h-9"
                            />
                          )}
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeCfc(idx)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      {customFieldConds.length < customFieldDefs.length && (
                        <Button variant="outline" size="sm" className="h-8" onClick={addCfc}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Add condition
                        </Button>
                      )}
                    </div>
                  </FilterSection>
                )}

                {/* REACHABILITY */}
                {showReachability && (
                <FilterSection icon={<Mail className="h-3.5 w-3.5" />} label="Reachability">
                  <div className="flex flex-wrap items-center gap-6">
                    {!isHidden("hasEmail") && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Has Email</Label>
                      <Select
                        value={filters.hasEmail === undefined ? "_any" : filters.hasEmail ? "yes" : "no"}
                        onValueChange={(v) =>
                          updateFilter("hasEmail", v === "_any" ? undefined : v === "yes")
                        }
                      >
                        <SelectTrigger className="w-[100px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_any">Any</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    )}

                    {!isHidden("emailVerified") && (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="email-verified"
                        checked={filters.emailVerified === true}
                        onCheckedChange={(checked) =>
                          updateFilter("emailVerified", checked ? true : undefined)
                        }
                      />
                      <Label htmlFor="email-verified" className="text-sm">
                        Email Verified Only
                      </Label>
                    </div>
                    )}

                    {/* Email status (quality) — multi-select */}
                    {!isHidden("emailQuality") && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Label className="text-sm whitespace-nowrap">Email Status:</Label>
                      <div className="flex items-center gap-1 flex-wrap">
                        {EMAIL_QUALITY_OPTIONS.map((opt) => {
                          const active = filters.emailQuality?.includes(opt.value) ?? false;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                const current = filters.emailQuality ?? [];
                                const next = active
                                  ? current.filter((v) => v !== opt.value)
                                  : [...current, opt.value];
                                updateFilter("emailQuality", next.length > 0 ? next : undefined);
                              }}
                              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                                active
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background text-muted-foreground border-border hover:bg-muted"
                              }`}
                              title={opt.description}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}

                    {/* Email type (raw provider classification, e.g. MoltSets) — single-select */}
                    {!isHidden("emailType") && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Label className="text-sm whitespace-nowrap">Email Type:</Label>
                      <div className="flex items-center gap-1 flex-wrap">
                        {EMAIL_TYPE_OPTIONS.map((opt) => {
                          const active = filters.emailType === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                updateFilter("emailType", active ? undefined : opt.value)
                              }
                              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                                active
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background text-muted-foreground border-border hover:bg-muted"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}

                    {!isHidden("minEmailConfidence") && (
                    <div className="flex items-center gap-3">
                      <Label className="text-sm whitespace-nowrap">Min Confidence:</Label>
                      <div className="flex items-center gap-2 w-40">
                        <Slider
                          value={[localMinConfidence]}
                          onValueChange={([v]) => setLocalMinConfidence(v)}
                          onValueCommit={([v]) =>
                            debouncedUpdateFilter("minEmailConfidence", v > 0 ? v : undefined)
                          }
                          max={100}
                          step={10}
                          className="flex-1"
                        />
                        <span className="text-sm text-muted-foreground w-10 text-right">
                          {localMinConfidence}%
                        </span>
                      </div>
                    </div>
                    )}

                    {!isHidden("hasEnrichmentData") && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Enrichment Data</Label>
                      <Select
                        value={filters.hasEnrichmentData === undefined ? "_any" : filters.hasEnrichmentData ? "yes" : "no"}
                        onValueChange={(v) =>
                          updateFilter("hasEnrichmentData", v === "_any" ? undefined : v === "yes")
                        }
                      >
                        <SelectTrigger className="w-[100px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_any">Any</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    )}

                    {!isHidden("hasNotionUrl") && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Notion URL</Label>
                      <Select
                        value={filters.hasNotionUrl === undefined ? "_any" : filters.hasNotionUrl ? "yes" : "no"}
                        onValueChange={(v) =>
                          updateFilter("hasNotionUrl", v === "_any" ? undefined : v === "yes")
                        }
                      >
                        <SelectTrigger className="w-[100px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_any">Any</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    )}

                    {!isHidden("segFirewall") && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                        Email Firewall
                      </Label>
                      <Select
                        value={filters.segFirewall || "_any"}
                        onValueChange={(v) =>
                          updateFilter("segFirewall", v === "_any" ? undefined : v as 'behind' | 'clear' | 'unchecked')
                        }
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_any">Any</SelectItem>
                          <SelectItem value="behind">Behind firewall</SelectItem>
                          <SelectItem value="clear">No firewall</SelectItem>
                          <SelectItem value="unchecked">Not checked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    )}

                    {!isHidden("aiAnalysisStatus") && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5 text-blue-500" />
                        AI Analyzed
                      </Label>
                      <Select
                        value={filters.aiAnalysisStatus || "_any"}
                        onValueChange={(v) =>
                          updateFilter("aiAnalysisStatus", v === "_any" ? undefined : v as 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed' | 'no_data')
                        }
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_any">Any</SelectItem>
                          <SelectItem value="not_analyzed">Not Analyzed</SelectItem>
                          <SelectItem value="analyzing">Analyzing</SelectItem>
                          <SelectItem value="analyzed">Analyzed</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                          <SelectItem value="no_data">No Data</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    )}
                  </div>
                </FilterSection>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Active filter pills */}
      {visibleActiveFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Active:</span>
          {visibleActiveFilters.map((filter, i) => (
            <Badge
              key={`${filter.key}-${filter.value}-${i}`}
              variant="secondary"
              className="gap-1 pr-1"
            >
              {filter.label}
              <button
                onClick={() => removeFilter(filter.key, filter.value)}
                className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-6 px-2 text-xs"
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

// Section wrapper for categorized filter groups
function FilterSection({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

// Multi-select combobox component
interface MultiSelectComboboxProps {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  popoverWidth?: string;
}

function MultiSelectCombobox({
  options,
  selected,
  onToggle,
  placeholder = "Select...",
  searchable = false,
  popoverWidth,
}: MultiSelectComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between h-9 font-normal"
        >
          {selected.length > 0 ? (
            <span className="min-w-0 flex-1 truncate text-left">
              {selected.length === 1
                ? options.find((o) => o.value === selected[0])?.label ||
                  selected[0]
                : `${selected.length} selected`}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn(popoverWidth || "w-[200px]", "p-0")} align="start">
        <Command>
          {searchable && <CommandInput placeholder="Search..." />}
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => onToggle(option.value)}
                >
                  <div
                    className={cn(
                      "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                      selected.includes(option.value)
                        ? "bg-primary text-primary-foreground"
                        : "opacity-50"
                    )}
                  >
                    {selected.includes(option.value) && (
                      <Check className="h-3 w-3" />
                    )}
                  </div>
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default AdvancedFilters;
