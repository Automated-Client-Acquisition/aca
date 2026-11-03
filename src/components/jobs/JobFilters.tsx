import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, X } from "lucide-react";
import type { SortOption, DateRangeOption } from "@/hooks/useGenerationJobs";

export interface JobFilterState {
  blueprint: string;
  pipeline: string;
  brandVoice: string;
  product: string;
  character: string;
  dateRange: DateRangeOption;
  sortBy: SortOption;
}
interface JobFiltersProps {
  filters: JobFilterState;
  onFiltersChange: (filters: JobFilterState) => void;
  availableOptions: {
    blueprints: string[];
    pipelines: { value: string; label: string }[];
    brandVoices: string[];
    products: string[];
    characters: string[];
  };
}
const SORT_OPTIONS = [{ value: "date_desc", label: "Newest first" }, { value: "date_asc", label: "Oldest first" }, { value: "name_asc", label: "Name (A–Z)" }, { value: "name_desc", label: "Name (Z–A)" }];
const DATE_OPTIONS = [{ value: "all", label: "All time" }, { value: "today", label: "Today" }, { value: "week", label: "Last 7 days" }, { value: "month", label: "Last 30 days" }];

export function JobFilters({ filters, onFiltersChange, availableOptions }: JobFiltersProps) {
  const fields = [
    { key: "blueprint" as const, label: "Blueprint", options: availableOptions.blueprints.map(value => ({ value, label: value })) },
    { key: "pipeline" as const, label: "Content type", options: availableOptions.pipelines },
    { key: "brandVoice" as const, label: "Brand voice", options: availableOptions.brandVoices.map(value => ({ value, label: value })) },
    { key: "product" as const, label: "Product", options: availableOptions.products.map(value => ({ value, label: value })) },
    { key: "character" as const, label: "Character", options: availableOptions.characters.map(value => ({ value, label: value })) },
  ];
  const active = fields.filter(field => filters[field.key]);
  const count = active.length + (filters.dateRange !== "all" ? 1 : 0);
  const reset = () => onFiltersChange({ blueprint: "", pipeline: "", brandVoice: "", product: "", character: "", dateRange: "all", sortBy: "date_desc" });
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-9"><Filter className="mr-2 h-3.5 w-3.5" />Filters & sort{count > 0 && <Badge variant="secondary" className="ml-2 px-1.5">{count}</Badge>}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)] space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Filters & sort</h2><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>Reset</Button></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="jobs-sort" className="text-xs">Sort by</Label><Select value={filters.sortBy} onValueChange={value => onFiltersChange({ ...filters, sortBy: value as SortOption })}><SelectTrigger id="jobs-sort" className="h-9 min-w-0"><SelectValue /></SelectTrigger><SelectContent>{SORT_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="jobs-date" className="text-xs">Created</Label><Select value={filters.dateRange} onValueChange={value => onFiltersChange({ ...filters, dateRange: value as DateRangeOption })}><SelectTrigger id="jobs-date" className="h-9 min-w-0"><SelectValue /></SelectTrigger><SelectContent>{DATE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {fields.some(field => field.options.length > 0 || filters[field.key]) && <div className="space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">Refine the runs on this page</p>
          {fields.filter(field => field.options.length > 0 || filters[field.key]).map(field => <div key={field.key} className="space-y-1.5"><Label htmlFor={`jobs-${field.key}`} className="text-xs">{field.label}</Label><Select value={filters[field.key] || "__all__"} onValueChange={value => onFiltersChange({ ...filters, [field.key]: value === "__all__" ? "" : value })}><SelectTrigger id={`jobs-${field.key}`} className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">All</SelectItem>{filters[field.key] && !field.options.some(option => option.value === filters[field.key]) && <SelectItem value={filters[field.key]}>{filters[field.key]}</SelectItem>}{field.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>)}
        </div>}
        {count > 0 && <div className="flex flex-wrap gap-1.5 border-t pt-3">{active.map(field => <Badge key={field.key} variant="secondary" className="max-w-full whitespace-normal break-words gap-1 text-xs">{field.options.find(option => option.value === filters[field.key])?.label || filters[field.key]}<button type="button" className="shrink-0 rounded p-1" aria-label={`Remove ${field.label.toLowerCase()} filter`} onClick={() => onFiltersChange({ ...filters, [field.key]: "" })}><X className="h-3 w-3" /></button></Badge>)}</div>}
      </PopoverContent>
    </Popover>
  );
}
