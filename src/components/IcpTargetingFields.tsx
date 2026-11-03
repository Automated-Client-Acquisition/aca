import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Target, Heart, AlertTriangle, MessageCircle, Tag, MapPin, Building2, UserCheck, ChevronDown, ChevronRight } from "lucide-react";
import { EditableList } from "./EditableList";
import { cn } from "@/lib/utils";
import {
  SENIORITY_OPTIONS,
  DEPARTMENT_OPTIONS,
  EMPLOYEE_BAND_OPTIONS,
  REVENUE_BAND_OPTIONS,
} from "@/lib/icp-targeting-options";

export interface IcpTargetingValue {
  pain_points: string[];
  desires: string[];
  objections: string[];
  language_style: string;
  tags: string[];
  target_locations: string[];
  target_employee_bands: string[];
  target_revenue_bands: string[];
  target_industries: string[];
  target_seniorities: string[];
  target_departments: string[];
  target_title_keywords: string[];
  decision_maker_notes: string;
}

interface IcpTargetingFieldsProps {
  value: IcpTargetingValue;
  onChange: <K extends keyof IcpTargetingValue>(field: K, value: IcpTargetingValue[K]) => void;
  dmSectionOpen: boolean;
  onDmSectionOpenChange: (open: boolean) => void;
}

function ChipToggle({
  options,
  selected,
  onToggle,
  colorClass,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  colorClass: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onToggle(opt.value)}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
            selected.includes(opt.value) ? colorClass : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Everything about an ICP besides Name/Summary/Description (see
 * IcpBasicsFields): messaging fields, locations, company firmographics, and
 * decision-maker targeting. Shared between AddICPDialog and ICPDetailsDialog
 * so a field added to one is never missing from the other, and both render
 * with identical styling.
 */
export function IcpTargetingFields({ value, onChange, dmSectionOpen, onDmSectionOpenChange }: IcpTargetingFieldsProps) {
  const toggleInList = (field: "target_seniorities" | "target_departments" | "target_employee_bands" | "target_revenue_bands", v: string) => {
    const current = value[field];
    onChange(field, current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
  };

  const violetChip = "bg-violet-100 dark:bg-violet-900/40 border-violet-300 dark:border-violet-700 text-violet-800 dark:text-violet-200";
  const amberChip = "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className="text-base font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-red-600" />
          Pain Points
        </Label>
        <EditableList
          items={value.pain_points}
          onChange={(items) => onChange("pain_points", items)}
          placeholder="What problems does this audience face?"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-base font-semibold flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-600" />
          Desires & Goals
        </Label>
        <EditableList
          items={value.desires}
          onChange={(items) => onChange("desires", items)}
          placeholder="What does this audience want to achieve?"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-base font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          Objections
        </Label>
        <EditableList
          items={value.objections}
          onChange={(items) => onChange("objections", items)}
          placeholder="What concerns or objections might they have?"
        />
      </div>

      <div className="space-y-3">
        <Label htmlFor="icp-language-style" className="text-base font-semibold flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          Language Style
        </Label>
        <Textarea
          id="icp-language-style"
          value={value.language_style}
          onChange={(e) => onChange("language_style", e.target.value)}
          placeholder="How does this audience speak? What phrases or jargon do they use?"
          className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-base font-semibold flex items-center gap-2">
          <Tag className="w-4 h-4 text-green-600" />
          Tags
        </Label>
        <EditableList
          items={value.tags}
          onChange={(items) => onChange("tags", items)}
          placeholder="Add organizational tags..."
        />
      </div>

      <div className="space-y-3">
        <Label className="text-base font-semibold flex items-center gap-2">
          <MapPin className="w-4 h-4 text-teal-600" />
          Target Locations
        </Label>
        <EditableList
          items={value.target_locations}
          onChange={(items) => onChange("target_locations", items)}
          placeholder='e.g., "United States", "DACH", "London"'
        />
        <p className="text-xs text-muted-foreground">
          Geographies this audience is based in (countries, regions, or cities). Used to score geographic fit during company analysis.
        </p>
      </div>

      <Separator />

      {/* Firmographics — the company, as opposed to the person */}
      <div className="space-y-4">
        <Label className="text-base font-semibold flex items-center gap-2">
          <Building2 className="w-4 h-4 text-amber-600" />
          Company Firmographics
        </Label>
        <p className="text-xs text-muted-foreground">
          What kind of company this audience works at. Company analysis resolves each lead's real
          headcount, revenue, and industry, then scores the match. A lead we can't resolve is never
          penalized for it — leave a criterion empty to ignore it entirely.
        </p>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Company Size (employees)</Label>
          <ChipToggle
            options={EMPLOYEE_BAND_OPTIONS}
            selected={value.target_employee_bands}
            onToggle={(v) => toggleInList("target_employee_bands", v)}
            colorClass={amberChip}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Revenue</Label>
          <ChipToggle
            options={REVENUE_BAND_OPTIONS}
            selected={value.target_revenue_bands}
            onToggle={(v) => toggleInList("target_revenue_bands", v)}
            colorClass={amberChip}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Industries</Label>
          <EditableList
            items={value.target_industries}
            onChange={(items) => onChange("target_industries", items)}
            placeholder='e.g., "Recruitment", "Managed IT services"'
          />
          <p className="text-xs text-muted-foreground">
            Matched on meaning, not exact wording.
          </p>
        </div>
      </div>

      <Separator />

      {/* Decision-Maker Targeting Section */}
      <Collapsible open={dmSectionOpen} onOpenChange={onDmSectionOpenChange}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex items-center gap-2 w-full text-left group">
            <UserCheck className="w-4 h-4 text-violet-600" />
            <span className="text-base font-semibold">Decision-Maker Targeting</span>
            {(value.target_seniorities.length > 0 || value.target_departments.length > 0 || value.target_title_keywords.length > 0) && (
              <Badge variant="secondary" className="text-xs ml-1">Configured</Badge>
            )}
            <span className="ml-auto">
              {dmSectionOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-4">
          <p className="text-sm text-muted-foreground">
            Define who at the company is the right person to contact. Used to score contacts as decision makers during company analysis.
          </p>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Target Seniority Levels</Label>
            <ChipToggle
              options={SENIORITY_OPTIONS}
              selected={value.target_seniorities}
              onToggle={(v) => toggleInList("target_seniorities", v)}
              colorClass={violetChip}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Target Departments</Label>
            <ChipToggle
              options={DEPARTMENT_OPTIONS}
              selected={value.target_departments}
              onToggle={(v) => toggleInList("target_departments", v)}
              colorClass={violetChip}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Title Keywords</Label>
            <EditableList
              items={value.target_title_keywords}
              onChange={(items) => onChange("target_title_keywords", items)}
              placeholder='e.g., "growth", "revenue", "demand gen"'
            />
            <p className="text-xs text-muted-foreground">
              Keywords to match in job titles. Matched case-insensitively.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="icp-dm-notes" className="text-sm font-medium">AI Notes</Label>
            <Textarea
              id="icp-dm-notes"
              value={value.decision_maker_notes}
              onChange={(e) => onChange("decision_maker_notes", e.target.value)}
              placeholder='e.g., "At small companies (<50 people), the CEO/founder is usually the decision maker. At mid-market, look for VP-level roles."'
              className="min-h-[60px] max-h-[150px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Context for the AI when evaluating decision-maker fit during company analysis.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
