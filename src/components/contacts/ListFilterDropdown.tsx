import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Check, ChevronDown, List, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadList } from "@/hooks/useLeadLists";

export interface ListFilter {
  inListIds?: string[];
  notInListIds?: string[];
}

interface ListFilterDropdownProps {
  lists: LeadList[];
  filter: ListFilter | null;
  onChange: (filter: ListFilter | null) => void;
}

export function ListFilterDropdown({
  lists,
  filter,
  onChange,
}: ListFilterDropdownProps) {
  const inIds = filter?.inListIds ?? [];
  const notInIds = filter?.notInListIds ?? [];
  const hasFilter = inIds.length > 0 || notInIds.length > 0;

  // Cycle through states: neutral → include → exclude → neutral
  const cycleList = (listId: string) => {
    const isIn = inIds.includes(listId);
    const isNotIn = notInIds.includes(listId);

    let newInIds = [...inIds];
    let newNotInIds = [...notInIds];

    if (!isIn && !isNotIn) {
      // neutral → include
      newInIds.push(listId);
    } else if (isIn) {
      // include → exclude
      newInIds = newInIds.filter((id) => id !== listId);
      newNotInIds.push(listId);
    } else {
      // exclude → neutral
      newNotInIds = newNotInIds.filter((id) => id !== listId);
    }

    if (newInIds.length === 0 && newNotInIds.length === 0) {
      onChange(null);
    } else {
      onChange({
        inListIds: newInIds.length > 0 ? newInIds : undefined,
        notInListIds: newNotInIds.length > 0 ? newNotInIds : undefined,
      });
    }
  };

  const clear = () => {
    onChange(null);
  };

  // Build label
  const inNames = lists.filter((l) => inIds.includes(l.id)).map((l) => l.name);
  const notInNames = lists.filter((l) => notInIds.includes(l.id)).map((l) => l.name);
  const totalActive = inNames.length + notInNames.length;

  let label = "List";
  if (totalActive === 1 && inNames.length === 1) {
    label = `In: ${inNames[0]}`;
  } else if (totalActive === 1 && notInNames.length === 1) {
    label = `Not in: ${notInNames[0]}`;
  } else if (totalActive > 1) {
    const parts: string[] = [];
    if (inNames.length > 0) parts.push(`${inNames.length} in`);
    if (notInNames.length > 0) parts.push(`${notInNames.length} excluded`);
    label = parts.join(", ");
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="default"
          className={cn(
            "gap-1.5 h-9 px-3",
            hasFilter && "border-primary text-primary"
          )}
        >
          <List className="h-4 w-4" />
          <span className="truncate max-w-[160px]">{label}</span>
          {hasFilter && (
            <span
              role="button"
              className="ml-0.5 rounded-full hover:bg-muted p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <div className="px-3 py-1.5 border-b">
          <p className="text-[11px] text-muted-foreground">
            Click to include, click again to exclude, click again to clear.
          </p>
        </div>
        <Command className="overflow-visible">
          <CommandInput
            className="[&:focus-visible]:ring-0 [&:focus-visible]:ring-offset-0"
            placeholder="Search lists..."
          />
          <CommandList>
            <CommandEmpty>No lists found.</CommandEmpty>
            <CommandGroup className="p-1">
              {lists.map((list) => {
                const isIn = inIds.includes(list.id);
                const isNotIn = notInIds.includes(list.id);
                return (
                  <CommandItem
                    key={list.id}
                    value={list.name}
                    onSelect={() => cycleList(list.id)}
                    className="gap-2 py-1.5"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        isIn && "bg-emerald-600 border-emerald-600 text-white",
                        isNotIn && "bg-destructive border-destructive text-destructive-foreground",
                        !isIn && !isNotIn && "border-muted-foreground/40 opacity-50"
                      )}
                    >
                      {isIn && <Check className="h-3 w-3" />}
                      {isNotIn && <Minus className="h-3 w-3" />}
                    </div>
                    <span className="truncate flex-1 text-sm">{list.name}</span>
                    {(isIn || isNotIn) && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0 shrink-0",
                          isIn && "bg-emerald-600/10 text-emerald-600",
                          isNotIn && "bg-destructive/10 text-destructive"
                        )}
                      >
                        {isIn ? "in" : "excluded"}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="ml-auto text-xs shrink-0">
                      {list.lead_count}
                    </Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
