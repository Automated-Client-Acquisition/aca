import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Multi-select over a fixed vocabulary (company size, revenue, industry…).
 *
 * Shared by the auto-add rule dialog and the dashboard's firmographic filters
 * so a band means the same thing — and reads the same — in a rule as it does
 * in a filter.
 */
export function BandPicker({
  options,
  selected,
  onChange,
  emptyLabel,
  unit,
  searchPlaceholder,
  className,
  contentClassName,
  highlightWhenSelected = false,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  unit: string;
  searchPlaceholder: string;
  className?: string;
  contentClassName?: string;
  /** Filter bars mark an active filter; form fields sitting in a labelled grid
   *  don't need it and shouldn't change appearance mid-form. */
  highlightWhenSelected?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const labelFor = (value: string) => options.find((o) => o.value === value)?.label ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={highlightWhenSelected && selected.length ? "secondary" : "outline"}
          size="sm"
          className={cn("h-9 w-full justify-between font-normal", className)}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{emptyLabel}</span>
          ) : selected.length === 1 ? (
            <span className="truncate">{labelFor(selected[0])}</span>
          ) : (
            <span className="truncate">{selected.length} {unit}s</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[240px] p-0", contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.value} value={option.label} onSelect={() => toggle(option.value)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(option.value) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
