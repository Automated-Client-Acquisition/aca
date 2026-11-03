import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Youtube, Linkedin } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const TikTokIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
  </svg>
);

const InstagramIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const platformIcons: Record<string, { icon: any; color: string }> = {
  youtube: { icon: Youtube, color: "text-red-600" },
  "youtube-shorts": { icon: Youtube, color: "text-red-600" },
  tiktok: { icon: TikTokIcon, color: "text-foreground" },
  instagram: { icon: InstagramIcon, color: "text-pink-600" },
  linkedin: { icon: Linkedin, color: "text-blue-600" },
};

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  type: "select" | "multi-select" | "checkbox" | "date-range";
  options?: FilterOption[];
}

interface FilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterConfig[];
  currentFilters: Record<string, any>;
  onApply: (filters: Record<string, any>) => void;
}

export function FilterDialog({
  open,
  onOpenChange,
  filters,
  currentFilters,
  onApply,
}: FilterDialogProps) {
  const [localFilters, setLocalFilters] = useState<Record<string, any>>(currentFilters);

  useEffect(() => {
    setLocalFilters(currentFilters);
  }, [currentFilters, open]);

  const handleApply = () => {
    onApply(localFilters);
    onOpenChange(false);
  };

  const handleClearAll = () => {
    setLocalFilters({});
  };

  const handleSelectChange = (key: string, value: string) => {
    setLocalFilters((prev) => {
      if (value === "__clear__") {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: value };
    });
  };

  const handleMultiSelectToggle = (key: string, value: string) => {
    setLocalFilters((prev) => {
      const current = prev[key] || [];
      const updated = current.includes(value)
        ? current.filter((v: string) => v !== value)
        : [...current, value];
      return { ...prev, [key]: updated.length > 0 ? updated : undefined };
    });
  };

  const handleCheckboxChange = (key: string, checked: boolean) => {
    setLocalFilters((prev) => ({
      ...prev,
      [key]: checked || undefined,
    }));
  };

  const handleDateRangeChange = (key: string, type: 'from' | 'to', date: Date | undefined) => {
    setLocalFilters((prev) => {
      const current = prev[key] || {};
      const updated = { ...current, [type]: date };
      
      // Remove the filter if both dates are undefined
      if (!updated.from && !updated.to) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      
      return { ...prev, [key]: updated };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>
            Apply filters to narrow down your results
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {filters.map((filter) => (
            <div key={filter.key} className="space-y-2">
              <Label>{filter.label}</Label>
              
              {filter.type === "select" && filter.options && (
                <div className="flex gap-2">
                  <Select
                    value={localFilters[filter.key] || ""}
                    onValueChange={(value) => handleSelectChange(filter.key, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${filter.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__clear__" className="text-muted-foreground italic">
                        Clear selection
                      </SelectItem>
                      {filter.options.map((option) => {
                        const platformConfig = filter.key === "platform" ? platformIcons[option.value] : null;
                        const Icon = platformConfig?.icon;
                        
                        return (
                          <SelectItem key={option.value} value={option.value}>
                            {platformConfig ? (
                              <div className="flex items-center gap-2">
                                <Icon className={cn("w-4 h-4", platformConfig.color)} />
                                <span>{option.label}</span>
                              </div>
                            ) : (
                              option.label
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {localFilters[filter.key] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSelectChange(filter.key, "__clear__")}
                      className="shrink-0"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}

              {filter.type === "multi-select" && filter.options && (
                <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
                  {filter.options.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`${filter.key}-${option.value}`}
                        checked={(localFilters[filter.key] || []).includes(option.value)}
                        onCheckedChange={() =>
                          handleMultiSelectToggle(filter.key, option.value)
                        }
                      />
                      <label
                        htmlFor={`${filter.key}-${option.value}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              )}

              {filter.type === "checkbox" && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={filter.key}
                    checked={localFilters[filter.key] || false}
                    onCheckedChange={(checked) =>
                      handleCheckboxChange(filter.key, checked as boolean)
                    }
                  />
                  <label
                    htmlFor={filter.key}
                    className="text-sm font-normal cursor-pointer"
                  >
                    Yes
                  </label>
                </div>
              )}

              {filter.type === "date-range" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !localFilters[filter.key]?.from && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {localFilters[filter.key]?.from ? (
                              format(localFilters[filter.key].from, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={localFilters[filter.key]?.from}
                            onSelect={(date) => handleDateRangeChange(filter.key, 'from', date)}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !localFilters[filter.key]?.to && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {localFilters[filter.key]?.to ? (
                              format(localFilters[filter.key].to, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={localFilters[filter.key]?.to}
                            onSelect={(date) => handleDateRangeChange(filter.key, 'to', date)}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  {(localFilters[filter.key]?.from || localFilters[filter.key]?.to) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const { [filter.key]: _, ...rest } = localFilters;
                        setLocalFilters(rest);
                      }}
                      className="w-full"
                    >
                      Clear Date Range
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClearAll}>
            Clear All
          </Button>
          <Button variant="cta" onClick={handleApply}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
