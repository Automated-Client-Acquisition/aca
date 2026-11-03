import { useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Linkedin,
  Instagram,
  Upload,
  User,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  Users,
  Mail,
  Link as LinkIcon,
  Calendar,
  Tag,
  Activity,
  Target,
  Plus,
  Zap,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import { useSmartListPreviewCount } from "@/hooks/useLeadLists";
import { usePipelines, usePipelineStages } from "@/hooks/crm/usePipeline";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { usePackSubscriptions, findPackInCatalog } from "@/hooks/useDiscovery";
import { AdvancedFilters } from "@/components/contacts/AdvancedFilters";
import {
  criteriaToEnrichment,
  mergeEnrichmentIntoCriteria,
  SMARTLIST_HIDDEN_FIELDS,
} from "@/lib/smart-list-criteria";
import { cn } from "@/lib/utils";
import { SegmentRuleBuilder } from "@/components/lead-lists/SegmentRuleBuilder";
import { countSmartSegmentRules, summarizeSmartSegmentCriteria, validateSmartSegmentCriteria } from "@/lib/smart-segment-rules";

interface SmartListFilterBuilderProps {
  criteria: SmartListFilterCriteria;
  onChange: (criteria: SmartListFilterCriteria) => void;
  showPreviewCount?: boolean;
  className?: string;
  active?: boolean;
}

const SOURCE_OPTIONS = [
  { value: "linkedin_connection", label: "LinkedIn Connections", icon: Linkedin },
  { value: "linkedin_comment", label: "LinkedIn Comment Leads", icon: Linkedin },
  { value: "instagram_comment", label: "Instagram Comment Leads", icon: Instagram },
  { value: "manual", label: "Manual Entry", icon: User },
  { value: "import", label: "CSV Import", icon: Upload },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "bounced", label: "Bounced" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "do_not_contact", label: "Do Not Contact" },
];

const DATE_RANGE_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
];

export function SmartListFilterBuilder({
  criteria,
  onChange,
  showPreviewCount = true,
  className,
  active = true,
}: SmartListFilterBuilderProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");

  // Signals available to filter "discovered by" against
  const { data: signals = [] } = usePackSubscriptions();

  const validation = useMemo(() => validateSmartSegmentCriteria(criteria), [criteria]);
  const [previewCriteria, setPreviewCriteria] = useState<SmartListFilterCriteria | null>(null);
  const criteriaKey = JSON.stringify(criteria);
  const previewReady = previewCriteria !== null && JSON.stringify(previewCriteria) === criteriaKey;
  useEffect(() => {
    if (!active || !showPreviewCount || validation.length) { setPreviewCriteria(null); return; }
    const timeout = setTimeout(() => setPreviewCriteria(criteria), 350);
    return () => clearTimeout(timeout);
  }, [criteria, active, showPreviewCount, validation.length]);
  const { data: previewCount, isFetching: countLoading, error: previewError, refetch: retryPreview } = useSmartListPreviewCount(
    active && showPreviewCount && previewReady && !validation.length ? previewCriteria : null
  );

  // Fetch pipelines and stages
  const { data: pipelines } = usePipelines();
  const { data: stages } = usePipelineStages(criteria.pipeline_id || null);
  const { data: members = [] } = useOrganizationMembers();

  // Helper to update a single field
  const updateField = <K extends keyof SmartListFilterCriteria>(
    field: K,
    value: SmartListFilterCriteria[K] | undefined
  ) => {
    const newCriteria = { ...criteria };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      delete newCriteria[field];
    } else {
      newCriteria[field] = value;
    }
    onChange(newCriteria);
  };

  // Clear pipeline-related fields when pipeline changes
  useEffect(() => {
    if (!criteria.pipeline_id || !criteria.stage_id || !stages) return;
    if (!stages.some((stage) => stage.id === criteria.stage_id)) {
      const { stage_id, ...nextCriteria } = criteria;
      onChange(nextCriteria);
    }
  }, [criteria, stages, onChange]);

  // Count active filters
  const activeFilterCount = Object.keys(criteria).filter((k) => {
    const value = criteria[k as keyof SmartListFilterCriteria];
    return value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
  }).length;

  const ruleCount = countSmartSegmentRules(criteria);
  const preview = showPreviewCount && <Card className="overflow-hidden border-amber-500/20 bg-amber-500/[0.025]">
    <CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />Matching people</p><p className="mt-1 text-xs text-muted-foreground">{ruleCount ? `${ruleCount} audience rule${ruleCount === 1 ? '' : 's'}` : 'Choose who belongs in this audience'}</p></div>
        {!validation.length && (previewError ? <span className="text-sm font-medium text-destructive">Preview unavailable</span> : !previewReady || countLoading ? <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Updating…</span> : <span className="text-2xl font-semibold tabular-nums">{previewCount?.toLocaleString() ?? '—'}</span>)}
      </div>
      {ruleCount > 0 && <p className="break-words border-t pt-3 text-xs leading-relaxed text-muted-foreground">{summarizeSmartSegmentCriteria(criteria)}</p>}
      {validation.length > 0 ? <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground" role="status"><AlertCircle className="h-4 w-4 shrink-0" /><div><p>{validation[0].message}</p>{validation.length > 1 && <p className="mt-1">{validation.length - 1} more incomplete rule{validation.length === 2 ? '' : 's'} to finish.</p>}</div></div> : previewError ? <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/5 p-3 text-xs text-destructive" role="alert"><AlertCircle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">We could not check the audience. Retry before connecting outreach.</span><Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => retryPreview()}><RefreshCw className="mr-1 h-3 w-3" />Retry</Button></div> : previewReady && !countLoading && previewCount === 0 ? <p className="text-xs text-muted-foreground">No people match yet. Adjust the rules, or save this audience for future matches.</p> : previewReady && !countLoading ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Membership updates as people match or stop matching these rules.</p> : null}
    </CardContent>
  </Card>;

  if (criteria.rule_group) {
    return (
      <div className={cn("space-y-4", className)}>
        {preview}
        {criteria.rule_group.rules.length === 0 && <div className="space-y-2"><p className="text-xs font-medium text-muted-foreground">Start with a common audience</p><div className="flex flex-wrap gap-2">{[
          { label: 'People with email', field: 'has_email' as const, operator: 'exists' as const, value: undefined },
          { label: 'LinkedIn audience', field: 'has_linkedin' as const, operator: 'exists' as const, value: undefined },
          { label: 'Added in the last 30 days', field: 'created_days_ago' as const, operator: 'within' as const, value: 30 },
        ].map((starter) => <Button key={starter.field} type="button" variant="outline" size="sm" className="h-auto whitespace-normal py-2 text-left" onClick={() => onChange({ rule_group: { id: criteria.rule_group!.id, operator: 'and', rules: [{ id: crypto.randomUUID(), field: 'status', operator: 'is', value: 'active' }, { id: crypto.randomUUID(), field: starter.field, operator: starter.operator, value: starter.value }] } })}>{starter.label}</Button>)}</div><p className="text-xs text-muted-foreground">Each starter includes active people. You can edit every rule.</p></div>}
        <SegmentRuleBuilder group={criteria.rule_group} onChange={(rule_group) => onChange({ rule_group })} />
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {preview}

      {/* Source Filter */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          Contact Source
        </Label>
        <Select
          value={criteria.source || "__all__"}
          onValueChange={(v) => updateField("source", v === "__all__" ? undefined : v as SmartListFilterCriteria["source"])}
        >
          <SelectTrigger>
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All sources</SelectItem>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div className="flex items-center gap-2">
                  <opt.icon className="h-4 w-4" />
                  {opt.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Filter by how contacts were added to your CRM
        </p>
      </div>

      {/* Signal Filter */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          Discovered by signal
        </Label>
        <Select
          value={criteria.signal_subscription_id || "__all__"}
          onValueChange={(v) =>
            updateField("signal_subscription_id", v === "__all__" ? undefined : v)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Not filtered by signal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Not filtered by signal</SelectItem>
            {signals.map((sub) => (
              <SelectItem key={sub.id} value={sub.id}>
                {sub.name || findPackInCatalog(sub.pack_key)?.label || sub.pack_key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Only include contacts discovered through this signal
        </p>
      </div>

      {/* Status Filter */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Status
        </Label>
        <Select
          value={criteria.status || "__all__"}
          onValueChange={(v) => updateField("status", v === "__all__" ? undefined : v as SmartListFilterCriteria["status"])}
        >
          <SelectTrigger>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tags Filter */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          Tags
        </Label>
        <div className="flex gap-2">
          <Input
            placeholder="Enter tag name..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput.trim()) {
                e.preventDefault();
                const currentTags = criteria.tags || [];
                const newTag = tagInput.trim().toLowerCase();
                if (!currentTags.includes(newTag)) {
                  updateField("tags", [...currentTags, newTag]);
                }
                setTagInput("");
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              if (tagInput.trim()) {
                const currentTags = criteria.tags || [];
                const newTag = tagInput.trim().toLowerCase();
                if (!currentTags.includes(newTag)) {
                  updateField("tags", [...currentTags, newTag]);
                }
                setTagInput("");
              }
            }}
            disabled={!tagInput.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {criteria.tags && criteria.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {criteria.tags.map((tagName) => (
              <Badge
                key={tagName}
                variant="secondary"
                className="gap-1"
              >
                {tagName}
                <button
                  type="button"
                  onClick={() => {
                    updateField(
                      "tags",
                      criteria.tags?.filter((t) => t !== tagName)
                    );
                  }}
                  className="ml-1 hover:bg-muted rounded-full"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Contacts with ANY of the selected tags will match
        </p>
      </div>

      {/* Lead Score Range */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          Lead Score Range
        </Label>
        <div className="flex items-center gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                min={0}
                max={100}
                value={criteria.min_score ?? ""}
                onChange={(e) =>
                  updateField(
                    "min_score",
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                className="w-24"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="number"
                placeholder="Max"
                min={0}
                max={100}
                value={criteria.max_score ?? ""}
                onChange={(e) =>
                  updateField(
                    "max_score",
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                className="w-24"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Filter contacts by their engagement score (0-100)
        </p>
      </div>

      {/* CRM Context (dates, pipeline, reachability) */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between px-0">
            <span className="font-medium">Pipeline, dates &amp; reachability</span>
            {advancedOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          {/* Date Filters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                Created
              </Label>
              <Select
                value={criteria.created_days_ago?.toString() || "__all__"}
                onValueChange={(v) =>
                  updateField("created_days_ago", v && v !== "__all__" ? parseInt(v) : undefined)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Any time</SelectItem>
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value.toString()}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Last Active
              </Label>
              <Select
                value={criteria.activity_days_ago?.toString() || "__all__"}
                onValueChange={(v) =>
                  updateField("activity_days_ago", v && v !== "__all__" ? parseInt(v) : undefined)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Any time</SelectItem>
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value.toString()}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Pipeline/Stage Filters */}
          {pipelines && pipelines.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Select
                  value={criteria.pipeline_id || "__all__"}
                  onValueChange={(v) => {
                    updateField("pipeline_id", v && v !== "__all__" ? v : undefined);
                    if (!v || v === "__all__") updateField("stage_id", undefined);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Any pipeline</SelectItem>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Stage</Label>
                <Select
                  value={criteria.stage_id || "__all__"}
                  onValueChange={(v) => updateField("stage_id", v && v !== "__all__" ? v : undefined)}
                  disabled={!criteria.pipeline_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Any stage</SelectItem>
                    {stages?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Owner Filter */}
          {members.length > 0 && (
            <div className="space-y-2">
              <Label>Owner</Label>
              <Select
                value={criteria.owner_user_id || "__all__"}
                onValueChange={(v) => updateField("owner_user_id", v && v !== "__all__" ? v : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Any owner</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.user?.full_name || m.user?.email || m.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Reachability toggles */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Has email address
              </Label>
              <Select
                value={criteria.has_email === undefined ? "__all__" : criteria.has_email ? "yes" : "no"}
                onValueChange={(v) =>
                  updateField("has_email", v === "__all__" ? undefined : v === "yes")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Any</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-muted-foreground" />
                Has LinkedIn URL
              </Label>
              <Select
                value={criteria.has_linkedin === undefined ? "__all__" : criteria.has_linkedin ? "yes" : "no"}
                onValueChange={(v) =>
                  updateField("has_linkedin", v === "__all__" ? undefined : v === "yes")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Any</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Enrichment / firmographic / ICP — the shared Advanced Filters panel.
          Fields the smart-list membership engine can't evaluate are hidden
          (SMARTLIST_HIDDEN_FIELDS) so nothing here is a dead filter. */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          Firmographic &amp; enrichment
        </Label>
        <AdvancedFilters
          filters={criteriaToEnrichment(criteria)}
          onChange={(ef) => onChange(mergeEnrichmentIntoCriteria(criteria, ef))}
          hiddenFields={SMARTLIST_HIDDEN_FIELDS}
          defaultOpen
        />
      </div>

      {/* Clear All Button */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({})}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4 mr-2" />
          Clear all filters
        </Button>
      )}
    </div>
  );
}
