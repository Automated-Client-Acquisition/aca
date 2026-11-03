import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: FilterOption[];
  /** Label for the "no filter" choice, e.g. "All campaigns". */
  allLabel: string;
  searchPlaceholder: string;
  className?: string;
}

/**
 * A filter dropdown that stays usable with a long list (an org can have
 * 1,700+ mailboxes): type to narrow, "All …" clears the filter.
 */
export function FilterCombobox({ value, onChange, options, allLabel, searchPlaceholder, className }: FilterComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "inline-flex h-9 w-[220px] items-center justify-between gap-2 rounded-md border bg-card px-3 text-sm shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected ? "text-foreground" : "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? allLabel}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__all__ ${allLabel}`}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", !selected ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
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
