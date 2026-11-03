import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, GitBranch, ListFilter, Check, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useDistinctContactTags } from "@/components/contacts/TagFilterDropdown";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import { usePackSubscriptions, findPackInCatalog } from "@/hooks/useDiscovery";
import { usePipelines } from "@/hooks/crm/usePipeline";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useProducts } from "@/hooks/useProducts";
import { useFilterOptions, formatSeniority, formatDepartment, COMPANY_SIZE_OPTIONS } from "@/hooks/useFilterOptions";
import { EMAIL_QUALITY_OPTIONS, EMAIL_TYPE_OPTIONS, REVENUE_MODEL_OPTIONS } from "@/components/contacts/AdvancedFilters";
import type { SegmentRule, SegmentRuleField, SegmentRuleGroup, SegmentRuleOperator } from "@/hooks/useLeadLists";
import { SEGMENT_FIELD_GROUPS, SEGMENT_OPERATORS, validateSegmentRule } from "@/lib/smart-segment-rules";
import { cn } from "@/lib/utils";

const makeId = () => crypto.randomUUID();

/** Every stage across every pipeline in the org, independent of any
 *  pipeline_id rule elsewhere in the segment -- avoids a cross-rule
 *  dependency the flat-form field-per-field model doesn't support. */
function useAllStages() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ['crm-pipeline-stages-all', currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_pipeline_stages')
        .select('id, name, pipeline_id')
        .eq('organization_id', currentOrganization!.id)
        .order('stage_order', { ascending: true });
      if (error) throw error;
      return data as Array<{ id: string; name: string; pipeline_id: string }>;
    },
  });
}

const BOOLEAN_FIELDS: ReadonlySet<SegmentRuleField> = new Set(['is_b2b', 'has_outbound_motion', 'hiring_sales_roles', 'runs_ads', 'email_verified']);
const NUMERIC_FIELDS: ReadonlySet<SegmentRuleField> = new Set(['lead_score', 'company_employee_count', 'created_days_ago', 'activity_days_ago', 'min_email_confidence']);
const DYNAMIC_MULTI_FIELDS: ReadonlySet<SegmentRuleField> = new Set(['industry', 'seniority', 'department', 'technology', 'detected_technology']);
const STATIC_MULTI_FIELDS: ReadonlySet<SegmentRuleField> = new Set(['company_size', 'revenue_model', 'email_quality']);

const SEG_FIREWALL_OPTIONS = [
  { value: 'behind', label: 'Behind a firewall' }, { value: 'clear', label: 'Clear' }, { value: 'unchecked', label: 'Not checked yet' },
];
const AI_ANALYSIS_STATUS_OPTIONS = [
  { value: 'not_analyzed', label: 'Not analyzed' }, { value: 'analyzing', label: 'Analyzing' },
  { value: 'analyzed', label: 'Analyzed' }, { value: 'failed', label: 'Failed' }, { value: 'no_data', label: 'No data to analyze' },
];

function defaultValueFor(field: SegmentRuleField): SegmentRule['value'] {
  if (field === 'source') return 'import';
  if (field === 'status') return 'active';
  if (field === 'tag' || DYNAMIC_MULTI_FIELDS.has(field) || STATIC_MULTI_FIELDS.has(field)) return [];
  if (BOOLEAN_FIELDS.has(field)) return 'true';
  return '';
}

const newRule = (field: SegmentRuleField): SegmentRule => ({ id: makeId(), field, operator: SEGMENT_OPERATORS[field][0].value, value: defaultValueFor(field) });
const isGroup = (node: SegmentRule | SegmentRuleGroup): node is SegmentRuleGroup => 'rules' in node;

function RuleFieldPicker({ value, onChange }: { value?: SegmentRuleField; onChange: (field: SegmentRuleField) => void }) {
  const [open, setOpen] = useState(false);
  const label = SEGMENT_FIELD_GROUPS.flatMap((group) => group.items).find((field) => field.value === value)?.label;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={value ? 'Choose rule field' : 'Add audience rule'} className={cn('h-9 justify-between gap-2 font-medium', value && 'w-full')}>
        {!value && <Plus className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{label || 'Add rule'}</span>
        <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[320px] max-w-[calc(100vw-3rem)] p-0">
      <Command>
        <CommandInput placeholder="Search audience fields…" />
        <CommandList>
          <CommandEmpty>No matching field. Try “email” or “score”.</CommandEmpty>
          {SEGMENT_FIELD_GROUPS.map((group) => <CommandGroup key={group.group} heading={group.group}>
            {group.items.map((field) => <CommandItem key={field.value} value={`${field.label} ${group.group}`} onSelect={() => { onChange(field.value); setOpen(false); }}>
              <Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', field.value === value ? 'opacity-100' : 'opacity-0')} />{field.label}
            </CommandItem>)}
          </CommandGroup>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}

function MultiValuePicker({ options, selected, label, fieldLabel, onChange }: { options: string[]; selected: string[]; label: (value: string) => string; fieldLabel: string; onChange: (value: string[]) => void }) {
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={`${fieldLabel} values`} className="h-9 w-full justify-between font-normal"><span className="truncate">{selected.length ? `${selected.length} selected` : 'Select values…'}</span><ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[320px] max-w-[calc(100vw-3rem)] p-0"><Command><CommandInput placeholder={`Search ${fieldLabel.toLowerCase()}…`} /><CommandList><CommandEmpty>No values found. Try another field or search.</CommandEmpty><CommandGroup>{options.map((value) => <CommandItem key={value} value={label(value)} onSelect={() => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])}><Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', selected.includes(value) ? 'opacity-100' : 'opacity-0')} />{label(value)}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
  </Popover>;
}

interface Props { group: SegmentRuleGroup; onChange: (group: SegmentRuleGroup) => void; depth?: number; }
export function SegmentRuleBuilder({ group, onChange, depth = 0 }: Props) {
  const { data: tags = [] } = useDistinctContactTags();
  const { data: customFields = [] } = useCustomFieldDefs();
  const { data: signals = [] } = usePackSubscriptions();
  const { data: pipelines = [] } = usePipelines();
  const { data: stages = [] } = useAllStages();
  const { data: members = [] } = useOrganizationMembers();
  const { products } = useProducts();
  const { data: filterOptions } = useFilterOptions();
  const pipelineNameById = useMemo(() => new Map(pipelines.map((p) => [p.id, p.name])), [pipelines]);
  const customQuestionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) {
      for (const q of p.analysis_questions || []) {
        const t = q?.trim();
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [products]);
  const updateNode = (index: number, node: SegmentRule | SegmentRuleGroup) => onChange({ ...group, rules: group.rules.map((item, i) => i === index ? node : item) });
  const remove = (index: number) => onChange({ ...group, rules: group.rules.filter((_, i) => i !== index) });
  const addRule = (field: SegmentRuleField) => onChange({ ...group, rules: [...group.rules, newRule(field)] });
  const addGroup = () => onChange({ ...group, rules: [...group.rules, { id: makeId(), operator: 'and', rules: [] }] });
  return <div className={depth ? "min-w-0 space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.025] p-3" : "min-w-0 space-y-3"}>
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
      <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <span className="text-sm font-medium">{depth ? "Within this group, match" : "People must match"}</span>
      <Select value={group.operator} onValueChange={(operator: 'and' | 'or') => onChange({ ...group, operator })}>
        <SelectTrigger aria-label={depth ? 'Rule group match mode' : 'Audience match mode'} className="h-8 w-[140px] bg-background"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="and">all rules</SelectItem><SelectItem value="or">any rule</SelectItem></SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">below</span>
    </div>
    {group.rules.map((node, index) => <div key={node.id} className="min-w-0 space-y-3">
      {index > 0 && <div className="flex items-center gap-2" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="rounded border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide">{group.operator.toUpperCase()}</span><span className="h-px flex-1 bg-border" /></div>}
      {isGroup(node) ? (
      <div className="relative min-w-0 pr-8"><Button type="button" variant="ghost" size="icon" aria-label="Remove rule group" className="absolute right-0 top-1 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(index)}><Trash2 className="h-3.5 w-3.5" /></Button><SegmentRuleBuilder group={node} depth={depth + 1} onChange={(next) => updateNode(index, next)} /></div>
    ) : (
      <RuleRow
        key={node.id}
        rule={node}
        tags={tags}
        customFields={customFields}
        signals={signals}
        pipelines={pipelines}
        stages={stages}
        pipelineNameById={pipelineNameById}
        members={members}
        products={products}
        customQuestionOptions={customQuestionOptions}
        filterOptions={filterOptions}
        onChange={(next) => updateNode(index, next)}
        onRemove={() => remove(index)}
      />
    )}</div>)}
    {group.rules.length === 0 && <div className="rounded-xl border border-dashed px-4 py-8 text-center"><ListFilter className="mx-auto mb-2 h-5 w-5 text-muted-foreground" /><p className="text-sm font-medium">Start with an audience rule</p><p className="mt-1 text-xs text-muted-foreground">Choose a field such as source, tag, score, or a custom field.</p></div>}
    <div className="flex flex-wrap gap-2"><RuleFieldPicker onChange={addRule} />{depth < 3 && <Button type="button" variant="ghost" size="sm" onClick={addGroup}><GitBranch className="mr-1 h-3.5 w-3.5" />Add rule group</Button>}</div>
  </div>;
}

interface RuleRowProps {
  rule: SegmentRule;
  tags: string[];
  customFields: Array<{ field_key: string; display_name: string }>;
  signals: Array<{ id: string; name: string | null; pack_key: string }>;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; pipeline_id: string }>;
  pipelineNameById: Map<string, string>;
  members: Array<{ user_id: string; user?: { email: string; full_name: string | null } }>;
  products: Array<{ id: string; name: string }>;
  customQuestionOptions: string[];
  filterOptions: { industries: string[]; seniorities: string[]; departments: string[]; technologies: string[]; detectedTechnologies: string[] } | undefined;
  onChange: (rule: SegmentRule) => void;
  onRemove: () => void;
}

/** Options + label formatter backing every "select many, chips below" field. */
function multiSelectSource(field: SegmentRuleField, filterOptions: RuleRowProps['filterOptions']) {
  switch (field) {
    case 'industry': return { options: filterOptions?.industries ?? [], label: (v: string) => v };
    case 'seniority': return { options: filterOptions?.seniorities ?? [], label: formatSeniority };
    case 'department': return { options: filterOptions?.departments ?? [], label: formatDepartment };
    case 'technology': return { options: filterOptions?.technologies ?? [], label: (v: string) => v };
    case 'detected_technology': return { options: filterOptions?.detectedTechnologies ?? [], label: (v: string) => v };
    case 'company_size': return { options: COMPANY_SIZE_OPTIONS.map((o) => o.value), label: (v: string) => COMPANY_SIZE_OPTIONS.find((o) => o.value === v)?.label ?? v };
    case 'revenue_model': return { options: REVENUE_MODEL_OPTIONS.map((o) => o.value), label: (v: string) => REVENUE_MODEL_OPTIONS.find((o) => o.value === v)?.label ?? v };
    case 'email_quality': return { options: EMAIL_QUALITY_OPTIONS.map((o) => o.value), label: (v: string) => EMAIL_QUALITY_OPTIONS.find((o) => o.value === v)?.label ?? v };
    default: return { options: [] as string[], label: (v: string) => v };
  }
}

function RuleRow({ rule, tags, customFields, signals, pipelines, stages, pipelineNameById, members, products, customQuestionOptions, filterOptions, onChange, onRemove }: RuleRowProps) {
  const fieldLabel = SEGMENT_FIELD_GROUPS.flatMap((group) => group.items).find((field) => field.value === rule.field)?.label || rule.field;
  const options = SEGMENT_OPERATORS[rule.field];
  const needsValue = !['exists', 'not_exists', 'is_empty'].includes(rule.operator);
  const setField = (field: SegmentRuleField) => onChange({ id: rule.id, field, operator: SEGMENT_OPERATORS[field][0].value, value: defaultValueFor(field) });
  const arrayValue = Array.isArray(rule.value) ? rule.value : [];
  const isMulti = rule.field === 'tag' || DYNAMIC_MULTI_FIELDS.has(rule.field) || STATIC_MULTI_FIELDS.has(rule.field);

  let valueEditor: React.ReactNode;
  if (!needsValue) {
    valueEditor = null;
  } else if (rule.field === 'source' || rule.field === 'status') {
    const opts = rule.field === 'source' ? ['import', 'manual', 'linkedin_connection', 'linkedin_comment', 'instagram_comment'] : ['active', 'archived', 'bounced', 'unsubscribed', 'do_not_contact'];
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent>{opts.map((value) => <SelectItem key={value} value={value}>{value.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'tag') {
    valueEditor = <MultiValuePicker options={tags} selected={arrayValue} label={(value) => value} fieldLabel={fieldLabel} onChange={(value) => onChange({ ...rule, value })} />;
  } else if (rule.field === 'signal') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose a signal" /></SelectTrigger><SelectContent>{signals.map((sub) => <SelectItem key={sub.id} value={sub.id}>{sub.name || findPackInCatalog(sub.pack_key)?.label || sub.pack_key}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'pipeline_id') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose a pipeline" /></SelectTrigger><SelectContent>{pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'stage_id') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose a stage" /></SelectTrigger><SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{pipelineNameById.get(s.pipeline_id) ? `${pipelineNameById.get(s.pipeline_id)} › ${s.name}` : s.name}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'owner_user_id') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose an owner" /></SelectTrigger><SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.user?.full_name || m.user?.email || m.user_id}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'email_type') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose a type" /></SelectTrigger><SelectContent>{EMAIL_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'seg_firewall') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose a status" /></SelectTrigger><SelectContent>{SEG_FIREWALL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'ai_analysis_status') {
    valueEditor = <Select value={String(rule.value || '')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose a status" /></SelectTrigger><SelectContent>{AI_ANALYSIS_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
  } else if (BOOLEAN_FIELDS.has(rule.field)) {
    valueEditor = <Select value={String(rule.value ?? 'true')} onValueChange={(value) => onChange({ ...rule, value })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent></Select>;
  } else if (isMulti) {
    const { options: multiOptions, label } = multiSelectSource(rule.field, filterOptions);
    valueEditor = <MultiValuePicker options={multiOptions} selected={arrayValue} label={label} fieldLabel={fieldLabel} onChange={(value) => onChange({ ...rule, value })} />;
  } else if (NUMERIC_FIELDS.has(rule.field) || rule.field === 'icp_score' || rule.field === 'dm_score' || rule.field === 'custom_question') {
    valueEditor = <Input aria-label={`${fieldLabel} value`} className="h-9 w-full" type="number" min={['created_days_ago', 'activity_days_ago'].includes(rule.field) ? 1 : 0} max={['lead_score', 'min_email_confidence', 'icp_score', 'dm_score'].includes(rule.field) ? 100 : undefined} step={rule.field === 'custom_question' ? 'any' : 1} value={String(rule.value ?? '')} onChange={(event) => onChange({ ...rule, value: event.target.value })} placeholder={rule.field === 'created_days_ago' || rule.field === 'activity_days_ago' ? 'Days' : rule.field === 'custom_question' ? 'Min score (optional)' : 'Value'} />;
  } else {
    valueEditor = <Input aria-label={`${fieldLabel} value`} className="h-9 w-full" type="text" value={String(rule.value ?? '')} onChange={(event) => onChange({ ...rule, value: event.target.value })} placeholder="Value" />;
  }

  let fieldKeyEditor: React.ReactNode = null;
  if (rule.field === 'custom_field') {
    fieldKeyEditor = <Select value={rule.fieldKey || '__none__'} onValueChange={(fieldKey) => onChange({ ...rule, fieldKey: fieldKey === '__none__' ? undefined : fieldKey })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose field" /></SelectTrigger><SelectContent><SelectItem value="__none__">Choose field</SelectItem>{customFields.map((field) => <SelectItem key={field.field_key} value={field.field_key}>{field.display_name}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'icp_score' || rule.field === 'dm_score') {
    fieldKeyEditor = <Select value={rule.fieldKey || '__none__'} onValueChange={(fieldKey) => onChange({ ...rule, fieldKey: fieldKey === '__none__' ? undefined : fieldKey })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose product" /></SelectTrigger><SelectContent><SelectItem value="__none__">Choose product</SelectItem>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>;
  } else if (rule.field === 'custom_question') {
    fieldKeyEditor = <Select value={rule.fieldKey || '__none__'} onValueChange={(fieldKey) => onChange({ ...rule, fieldKey: fieldKey === '__none__' ? undefined : fieldKey })}><SelectTrigger aria-label={`${fieldLabel} value`} className="h-9 w-full"><SelectValue placeholder="Choose question" /></SelectTrigger><SelectContent><SelectItem value="__none__">Choose question</SelectItem>{customQuestionOptions.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent></Select>;
  }

  const error = validateSegmentRule(rule);
  return <div className={cn('min-w-0 space-y-3 rounded-xl border bg-background p-3', error && 'border-amber-500/40')}>
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <div className="min-w-0 basis-[190px] flex-grow space-y-1"><p className="text-[11px] text-muted-foreground">Audience field</p><RuleFieldPicker value={rule.field} onChange={setField} /></div>
      {fieldKeyEditor && <div className="min-w-0 basis-[160px] flex-grow space-y-1"><p className="text-[11px] text-muted-foreground">{rule.field === 'custom_field' ? 'Field' : rule.field === 'custom_question' ? 'Question' : 'Product'}</p>{fieldKeyEditor}</div>}
      <div className="min-w-0 basis-[135px] flex-grow space-y-1"><p className="text-[11px] text-muted-foreground">Condition</p><Select value={rule.operator} onValueChange={(operator: SegmentRuleOperator) => onChange({ ...rule, operator })}><SelectTrigger aria-label={`${fieldLabel} condition`} className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
      {valueEditor && <div className="min-w-0 basis-[145px] flex-grow space-y-1"><p className="text-[11px] text-muted-foreground">{rule.field === 'custom_question' ? 'Minimum score (optional)' : 'Value'}</p>{valueEditor}</div>}
      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${fieldLabel} rule`} className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
    {isMulti && arrayValue.length > 0 && (
      <div className="flex min-w-0 flex-wrap gap-1">
        {arrayValue.map((v) => {
          const label = rule.field === 'tag' ? v : multiSelectSource(rule.field, filterOptions).label(v);
          return <Badge key={v} variant="secondary" className="max-w-full gap-1"><span className="break-all">{label}</span><button type="button" aria-label={`Remove ${label}`} className="shrink-0" onClick={() => onChange({ ...rule, value: arrayValue.filter((value) => value !== v) })}>×</button></Badge>;
        })}
      </div>
    )}
    {error && <p className="text-xs text-amber-700 dark:text-amber-400" role="status">{error}</p>}
  </div>;
}
