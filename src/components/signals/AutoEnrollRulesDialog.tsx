import { useMemo, useState } from "react";

import { AlertTriangle, Check, ChevronDown, Loader2, Pause, Pencil, Play, Trash2, X, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import { COUNTRY_OPTIONS, countryFlag, countryName } from "@/lib/signals";
import {
  useAutoEnrollPreviewCount,
  useAutoEnrollRules,
  useCreateAutoEnrollRule,
  useCustomSignalTypeOptions,
  useDeleteAutoEnrollRule,
  useUpdateAutoEnrollRule,
  countActiveGates,
  EMPLOYEE_BAND_OPTIONS,
  normalizeCriteria,
  packKeyFilterValues,
  parseKeywords,
  RECENCY_OPTIONS,
  REVENUE_BAND_OPTIONS,
  SENIORITY_OPTIONS,
  SOURCE_LABELS,
  type AutoEnrollRule,
  type AutoEnrollSource,
  type SignalFilterCriteria,
} from "@/hooks/usePublicSignalAutoEnroll";
import { SignalTypeBadge } from "@/components/signals/SignalTypeBadge";
import { BandPicker } from "@/components/signals/BandPicker";

interface LeadListOption {
  id: string;
  name: string;
}

/** 0 = leave it to the branch default: 5 per company on the public library
 *  (the historical literal), uncapped on the org's own signals. */
const PER_COMPANY_OPTIONS = [0, 1, 2, 3, 5, 10];

/**
 * Standing "auto-add" rules for the signal library: pick a list once and a
 * background sweep (every 30 min) enrolls each new vetted lead that passes the
 * rule — same eligibility and CRM upsert as the manual "Add to list" flow.
 *
 * The form is three steps: where leads come from, the filter they must pass,
 * and the list they land in. The filter step is evaluated server-side by
 * signal_lead_passes_filter plus the two candidate cores, and the live count
 * under it comes from public_signal_auto_enroll_preview — the same cores — so
 * what the dialog promises is what the sweep actually does.
 */
export function AutoEnrollRulesDialog({
  lists,
  signalTypeOptions,
  defaultSource = "public",
  defaultSignalType = "all",
  defaultRequireEmail = false,
  defaultRecencyDays = 0,
}: {
  lists: LeadListOption[];
  /** Type options for the public library; custom types are loaded per-org. */
  signalTypeOptions: Array<{ value: string; label: string }>;
  defaultSource?: AutoEnrollSource;
  defaultSignalType?: string;
  defaultRequireEmail?: boolean;
  /** Seeded from the panel's recency filter; 0 = each branch's default window. */
  defaultRecencyDays?: number;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listId, setListId] = useState<string>("");
  const [source, setSource] = useState<AutoEnrollSource>(defaultSource);
  const [signalType, setSignalType] = useState(defaultSignalType);
  const [requireEmail, setRequireEmail] = useState(defaultRequireEmail);
  const [criteria, setCriteria] = useState<SignalFilterCriteria>({});

  const customTypesQuery = useCustomSignalTypeOptions();
  const rulesQuery = useAutoEnrollRules();
  const createRule = useCreateAutoEnrollRule();
  const updateRule = useUpdateAutoEnrollRule();
  const deleteRule = useDeleteAutoEnrollRule();

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const activeCount = rules.filter((rule) => rule.status === "active").length;
  const listNameById = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists]);
  // Lists that already have a rule can't get a second one (unique per list) —
  // except the one being edited, which has to stay selectable.
  const availableLists = useMemo(
    () => lists.filter((list) => list.id === listId || !rules.some((rule) => rule.list_id === list.id)),
    [lists, rules, listId],
  );

  // Type options follow the source. "Both" spans two vocabularies that don't
  // overlap, so it only supports the unfiltered case.
  const typeOptions = useMemo(() => {
    if (source === "custom") {
      return [{ value: "all", label: "All my signals" }, ...(customTypesQuery.data ?? [])];
    }
    if (source === "all") return [{ value: "all", label: "All types" }];
    return signalTypeOptions;
  }, [source, customTypesQuery.data, signalTypeOptions]);

  const signalTypesForQuery = useMemo(
    () =>
      signalType === "all"
        ? null
        : source === "custom"
          ? packKeyFilterValues(signalType)
          : [signalType],
    [signalType, source],
  );

  const previewQuery = useAutoEnrollPreviewCount({
    source,
    signal_types: signalTypesForQuery,
    require_email: requireEmail,
    filter_criteria: criteria,
    list_id: listId || null,
    enabled: open,
  });

  const patch = (next: Partial<SignalFilterCriteria>) => setCriteria((prev) => ({ ...prev, ...next }));

  const resetForm = () => {
    setEditingId(null);
    setListId("");
    setSource(defaultSource);
    setSignalType(defaultSignalType);
    setRequireEmail(defaultRequireEmail);
    setCriteria(defaultRecencyDays ? { recency_days: defaultRecencyDays } : {});
  };

  const handleSourceChange = (next: AutoEnrollSource) => {
    setSource(next);
    setSignalType("all"); // the previous selection has no meaning in the new vocabulary
    // Only the public branch can tell "already in my CRM" apart — every custom
    // candidate is a crm_contact by construction.
    if (next === "custom") patch({ skip_known_companies: false });
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) resetForm(); // seed the form from the panel's current filter state
  };

  const startEditing = (rule: AutoEnrollRule) => {
    setEditingId(rule.id);
    setListId(rule.list_id);
    setSource(rule.source ?? "public");
    setSignalType(rule.signal_types?.length ? rule.signal_types[0] : "all");
    setRequireEmail(rule.require_email);
    setCriteria(rule.filter_criteria ?? {});
  };

  const submit = () => {
    const payload = {
      source,
      signal_types: signalTypesForQuery,
      require_email: requireEmail,
      filter_criteria: criteria,
    };
    if (editingId) {
      updateRule.mutate({ id: editingId, ...payload }, { onSuccess: resetForm });
      return;
    }
    createRule.mutate({ list_id: listId, ...payload }, { onSuccess: resetForm });
  };

  const saving = createRule.isPending || updateRule.isPending;
  const gateCount = countActiveGates(criteria) + (requireEmail ? 1 : 0);
  const includesPublic = source === "public" || source === "all";
  const hasCompanyGate =
    (criteria.employee_bands?.length ?? 0) > 0 || (criteria.revenue_bands?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-9">
          <Zap className="mr-1.5 h-3.5 w-3.5" />
          Auto-add
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 px-1.5 font-normal tabular-nums">{activeCount}</Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Auto-add signal leads</DialogTitle>
          <DialogDescription>
            Keep a list filling on its own. New leads are added as signals land — checked every
            30 minutes, using the same vetting as adding them by hand. Draw from the public
            library, from the signals you configured, or both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{editingId ? "Edit rule" : "New rule"}</p>
            {editingId && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={resetForm}>
                <X className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>

          {/* ------------------------------------------------------------ 1 */}
          <StepHeading index={1} title="Where leads come from" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={source} onValueChange={(value) => handleSourceChange(value as AutoEnrollSource)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SOURCE_LABELS) as AutoEnrollSource[]).map((value) => (
                  <SelectItem key={value} value={value}>{SOURCE_LABELS[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={signalType} onValueChange={setSignalType} disabled={source === "all"}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ------------------------------------------------------------ 2 */}
          <StepHeading
            index={2}
            title="Filter"
            hint={
              gateCount === 0
                ? "No gates — every matching lead is added"
                : `${gateCount} gate${gateCount === 1 ? "" : "s"}`
            }
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <LabelledField label="Job titles must match any of">
              <KeywordInput
                values={criteria.title_includes ?? []}
                onChange={(next) => patch({ title_includes: next })}
                placeholder="founder, ceo, head of sales"
              />
            </LabelledField>
            <LabelledField label="Job titles must not match any of">
              <KeywordInput
                values={criteria.title_excludes ?? []}
                onChange={(next) => patch({ title_excludes: next })}
                placeholder="assistant, intern, recruiter"
              />
            </LabelledField>
            <LabelledField label="Seniority">
              <Select
                value={String(criteria.min_seniority ?? 0)}
                onValueChange={(value) => patch({ min_seniority: Number(value) })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SENIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>
            <LabelledField label="Signal recency">
              <Select
                value={String(criteria.recency_days ?? 0)}
                onValueChange={(value) => patch({ recency_days: Number(value) })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>
            <LabelledField label="Countries">
              <CountryPicker
                selected={criteria.countries ?? []}
                onChange={(next) => patch({ countries: next })}
              />
            </LabelledField>
            <LabelledField label="Max leads per company">
              <Select
                value={String(criteria.max_per_company ?? 0)}
                onValueChange={(value) => patch({ max_per_company: Number(value) })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PER_COMPANY_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value === 0
                        ? source === "custom" ? "No limit" : "Default (5)"
                        : `${value} per company`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>
            <LabelledField label="Company size">
              <BandPicker
                options={EMPLOYEE_BAND_OPTIONS}
                selected={criteria.employee_bands ?? []}
                onChange={(next) => patch({ employee_bands: next })}
                emptyLabel="Any size"
                unit="band"
                searchPlaceholder="Search sizes…"
              />
            </LabelledField>
            <LabelledField label="Company revenue">
              <BandPicker
                options={REVENUE_BAND_OPTIONS}
                selected={criteria.revenue_bands ?? []}
                onChange={(next) => patch({ revenue_bands: next })}
                emptyLabel="Any revenue"
                unit="band"
                searchPlaceholder="Search revenue…"
              />
            </LabelledField>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={requireEmail} onCheckedChange={(checked) => setRequireEmail(checked === true)} />
              Only leads with an email
            </label>
            <label
              className={cn(
                "flex items-center gap-2 text-sm",
                source === "custom" ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
              title={
                source === "custom"
                  ? "Your own signal leads are already CRM contacts, so this would match nothing."
                  : undefined
              }
            >
              <Checkbox
                checked={criteria.skip_known_companies === true}
                disabled={source === "custom"}
                onCheckedChange={(checked) => patch({ skip_known_companies: checked === true })}
              />
              Skip companies already in my CRM
            </label>
          </div>

          <PreviewLine
            count={previewQuery.data}
            loading={previewQuery.isPending || previewQuery.isFetching}
            error={previewQuery.isError}
          />

          {requireEmail && includesPublic && (
            <Warning>
              Very few public-library leads carry an email yet — pairing “only leads with an email”
              with the public library matches almost nobody.
            </Warning>
          )}
          {(criteria.countries?.length ?? 0) > 0 && (
            <Warning>
              Signals with no country recorded are skipped, not kept. The public feed is only
              partly geo-tagged.
            </Warning>
          )}
          {hasCompanyGate && (
            <Warning>
              Companies whose size or revenue we don’t know yet are skipped, not kept — otherwise
              “no solopreneurs” wouldn’t mean anything.
              {source === "custom" && " Revenue is not collected for your own signals yet, so a revenue band matches nothing on this source."}
            </Warning>
          )}

          {/* ------------------------------------------------------------ 3 */}
          <StepHeading index={3} title="Where they land" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={listId} onValueChange={setListId} disabled={!!editingId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Target list…" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {availableLists.length === 0 ? (
                  <SelectItem value="__none" disabled>No lists without a rule</SelectItem>
                ) : (
                  availableLists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button variant="cta" size="sm" className="h-9" disabled={!listId || saving} onClick={submit}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save changes" : "Enable auto-add"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Your rules</p>
          {rulesQuery.isLoading ? (
            <p className="py-2 text-sm text-muted-foreground">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No auto-add rules yet. New leads only reach lists when you add them manually.
            </p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2",
                    editingId === rule.id && "border-primary bg-primary/5",
                  )}
                >
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${rule.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`}
                    title={rule.status === "active" ? "Active" : "Paused"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {listNameById.get(rule.list_id) ?? "List unavailable"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {SOURCE_LABELS[rule.source ?? "public"]}
                      </Badge>
                      {rule.signal_types?.length ? (
                        // Aliased pack keys are stored as a pair; one badge is enough.
                        <SignalTypeBadge type={rule.signal_types[0]} className="text-[11px]" />
                      ) : (
                        <Badge variant="secondary" className="text-[11px] font-normal">All types</Badge>
                      )}
                      {rule.require_email && (
                        <Badge variant="outline" className="text-[11px] font-normal">Email only</Badge>
                      )}
                      {gateBadges(rule.filter_criteria).map((label) => (
                        <Badge
                          key={label}
                          variant="outline"
                          className="max-w-[220px] truncate text-[11px] font-normal"
                        >
                          {label}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {rule.total_enrolled} added
                        {rule.last_run_at
                          ? ` · checked ${formatDistanceToNowStrict(new Date(rule.last_run_at), { addSuffix: true })}`
                          : " · first check within 30 min"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => startEditing(rule)}
                      aria-label="Edit rule"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={updateRule.isPending}
                      onClick={() => updateRule.mutate({ id: rule.id, status: rule.status === "active" ? "paused" : "active" })}
                      aria-label={rule.status === "active" ? "Pause rule" : "Resume rule"}
                      title={rule.status === "active" ? "Pause" : "Resume"}
                    >
                      {rule.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      disabled={deleteRule.isPending}
                      onClick={() => deleteRule.mutate(rule.id)}
                      aria-label="Delete rule"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepHeading({ index, title, hint }: { index: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b pb-1.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums">
        {index}
      </span>
      <span className="text-sm font-medium">{title}</span>
      {hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * Chip editor for the title gates. These have always accepted a list — the
 * comma-separated text box just never looked like one, so people assumed a
 * single keyword. Each keyword is its own removable chip; Enter, comma or blur
 * commits, Backspace on an empty box takes the last one back.
 */
function KeywordInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const known = new Set(values.map((v) => v.toLowerCase()));
    const added = parseKeywords(raw).filter((v) => {
      if (known.has(v.toLowerCase())) return false;
      known.add(v.toLowerCase());
      return true;
    });
    if (added.length) onChange([...values, ...added]);
    setDraft("");
  };

  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-sm focus-within:ring-1 focus-within:ring-ring">
      {values.map((value) => (
        <Badge key={value} variant="secondary" className="gap-1 px-1.5 py-0 font-normal">
          {value}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        className="h-6 min-w-[7rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        placeholder={values.length ? "Add another…" : placeholder}
        value={draft}
        onChange={(e) => {
          // Pasting or typing a comma finishes the keyword in place.
          if (e.target.value.includes(",")) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The guard against a rule that silently matches nothing forever. */
function PreviewLine({
  count,
  loading,
  error,
}: {
  count: number | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (error) {
    return <p className="text-xs text-muted-foreground">Couldn’t check how many leads match.</p>;
  }
  if (loading || count === undefined) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking how many leads match…
      </p>
    );
  }
  if (count === 0) {
    return (
      <Warning>
        No leads match right now — this rule would sit idle until a signal arrives that fits.
        Loosen a gate to see matches.
      </Warning>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Matches{" "}
      <span className="font-medium tabular-nums text-foreground">{count.toLocaleString()}</span>{" "}
      lead{count === 1 ? "" : "s"} right now.
    </p>
  );
}

/** Compact summary of a saved rule's gates, for the rule list. */
function gateBadges(criteria: SignalFilterCriteria | null | undefined): string[] {
  const c = normalizeCriteria(criteria ?? {});
  const out: string[] = [];
  if (c.title_includes?.length) out.push(`Title: ${c.title_includes.join(", ")}`);
  if (c.title_excludes?.length) out.push(`Not: ${c.title_excludes.join(", ")}`);
  if (c.min_seniority) {
    out.push(
      SENIORITY_OPTIONS.find((option) => option.value === c.min_seniority)?.label ??
        `Seniority ${c.min_seniority}+`,
    );
  }
  if (c.countries?.length) {
    out.push(c.countries.map((code) => `${countryFlag(code)} ${code}`.trim()).join(" "));
  }
  if (c.employee_bands?.length) {
    out.push(
      `Size: ${c.employee_bands
        .map((band) => EMPLOYEE_BAND_OPTIONS.find((o) => o.value === band)?.label ?? band)
        .join(", ")}`,
    );
  }
  if (c.revenue_bands?.length) out.push(`Revenue: ${c.revenue_bands.join(", ")}`);
  if (c.recency_days) out.push(`Last ${c.recency_days}d`);
  if (c.max_per_company) out.push(`Max ${c.max_per_company}/company`);
  if (c.skip_known_companies) out.push("New companies only");
  return out;
}

/** Multi-select over the feed's country vocabulary. Searches by name (a bare
 *  ISO code is unguessable) and stores ISO2 — what normalize_country_code
 *  compares against on the server. */
function CountryPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 w-full justify-between font-normal">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">Any country — pick as many as you like</span>
          ) : selected.length === 1 ? (
            <span className="truncate">{countryFlag(selected[0])} {countryName(selected[0])}</span>
          ) : (
            <span className="truncate">
              <span className="mr-1.5">{selected.slice(0, 4).map((code) => countryFlag(code)).join(" ")}</span>
              {selected.length} countries
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search countries…" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup heading={
              selected.length
                ? `${selected.length} selected — click to add or remove`
                : "Click as many as you need"
            }>
              {COUNTRY_OPTIONS.map((option) => (
                <CommandItem
                  key={option.code}
                  // cmdk filters on this value, so it carries the name people
                  // actually type as well as the code that gets stored.
                  value={`${option.name} ${option.code}`}
                  onSelect={() => toggle(option.code)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(option.code) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="mr-1.5">{countryFlag(option.code)}</span>
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
