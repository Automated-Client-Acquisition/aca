import { useQuery } from "@tanstack/react-query";
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
import { Check, ChevronDown, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TagFilterDropdownProps {
  selected: string[];
  onChange: (tags: string[]) => void;
}

/** Actual tags present on contacts. Segment rules use this rather than the
 * tag-management catalogue, which can contain unused or legacy entries. */
export function useDistinctContactTags() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["contact-tags-distinct", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("tags")
        .eq("organization_id", currentOrganization!.id)
        .not("tags", "is", null);
      if (error) throw error;
      const all = new Set<string>();
      for (const row of data ?? []) {
        for (const tag of row.tags ?? []) {
          if (tag) all.add(tag);
        }
      }
      return Array.from(all).sort((a, b) => a.localeCompare(b));
    },
    enabled: !!currentOrganization,
    staleTime: 60_000,
  });
}

export function TagFilterDropdown({ selected, onChange }: TagFilterDropdownProps) {
  const { data: tags = [] } = useDistinctContactTags();

  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      const next = selected.filter((t) => t !== tag);
      onChange(next);
    } else {
      onChange([...selected, tag]);
    }
  };

  const clear = () => onChange([]);

  const hasFilter = selected.length > 0;

  let label = "Tag";
  if (selected.length === 1) label = selected[0];
  else if (selected.length > 1) label = `${selected.length} tags`;

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
          <Tag className="h-4 w-4" />
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
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput
            className="[&:focus-visible]:ring-0 [&:focus-visible]:ring-offset-0"
            placeholder="Search tags..."
          />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup className="p-1">
              {tags.map((tag) => {
                const isSelected = selected.includes(tag);
                return (
                  <CommandItem
                    key={tag}
                    value={tag}
                    onSelect={() => toggle(tag)}
                    className="gap-2 py-1.5"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40 opacity-50"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <span className="truncate flex-1 text-sm">{tag}</span>
                    {isSelected && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 shrink-0 bg-primary/10 text-primary"
                      >
                        on
                      </Badge>
                    )}
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
