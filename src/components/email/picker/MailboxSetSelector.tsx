import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { ChevronsUpDown, Bookmark, Trash2 } from "lucide-react";
import { useMailboxSets, useDeleteMailboxSet, type MailboxSet } from "@/hooks/useMailboxSets";
import { cn } from "@/lib/utils";

interface MailboxSetSelectorProps {
  selectedSetId: string | null;
  onSelect: (set: MailboxSet | null) => void;
}

export function MailboxSetSelector({
  selectedSetId,
  onSelect,
}: MailboxSetSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data: sets = [], isLoading } = useMailboxSets();
  const deleteSet = useDeleteMailboxSet();

  const selectedSet = sets.find((s) => s.id === selectedSetId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5 h-8 min-w-[180px] justify-between font-normal",
            !selectedSet && "text-muted-foreground"
          )}
        >
          <span className="flex items-center gap-1.5 truncate">
            <Bookmark className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {selectedSet ? selectedSet.name : "Load preset"}
            </span>
            {selectedSet && (
              <span className="text-muted-foreground shrink-0">
                · {selectedSet.mailbox_ids.length}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command>
          <CommandInput placeholder="Search presets..." className="h-9" />
          <CommandList>
            {isLoading ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                Loading...
              </div>
            ) : sets.length === 0 ? (
              <CommandEmpty>
                <div className="px-3 py-4 text-xs text-muted-foreground text-center space-y-1">
                  <p>No presets yet.</p>
                  <p className="text-[10px]">
                    Save your current selection from the picker to reuse it later.
                  </p>
                </div>
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {selectedSet && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onSelect(null);
                      setOpen(false);
                    }}
                    className="text-muted-foreground"
                  >
                    Unload preset
                  </CommandItem>
                )}
                {sets.map((set) => (
                  <CommandItem
                    key={set.id}
                    value={`${set.name} ${set.description || ""}`}
                    onSelect={() => {
                      onSelect(set);
                      setOpen(false);
                    }}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{set.name}</span>
                        {selectedSetId === set.id && (
                          <span className="text-[10px] text-primary">active</span>
                        )}
                      </div>
                      {set.description && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {set.description}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {set.mailbox_ids.length} mailbox
                        {set.mailbox_ids.length !== 1 ? "es" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete preset ${set.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(`Delete preset "${set.name}"? This cannot be undone.`)
                        ) {
                          deleteSet.mutate(set.id);
                          if (selectedSetId === set.id) onSelect(null);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
