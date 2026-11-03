import { useState, useEffect } from "react";
import { X, Check, ChevronsUpDown, Tag, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useIdeaTags, useIdeasCountByTag } from "@/hooks/useIdeaTags";
import { useIdeaTagsForIdea, useSetIdeaTags } from "@/hooks/useIdeaTagAssignments";
import { useIdeaTagsCRUD } from "@/hooks/useIdeaTagsCRUD";

interface IdeaTagSelectorProps {
  id?: string;
  "aria-label"?: string;
  ideaId: string;
  className?: string;
  disabled?: boolean;
}

export function IdeaTagSelector({
  id,
  "aria-label": ariaLabel = "Tags",
  ideaId,
  className,
  disabled = false,
}: IdeaTagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [showNewTagInput, setShowNewTagInput] = useState(false);

  const { data: availableTags = [], isLoading: isLoadingTags } = useIdeaTags();
  const { data: tagCounts = {} } = useIdeasCountByTag();
  const { data: assignments = [], isLoading: isLoadingAssignments } = useIdeaTagsForIdea(ideaId);
  const { mutateAsync: setTags, isPending: isSettingTags } = useSetIdeaTags();
  const { createTag, isCreating } = useIdeaTagsCRUD();

  // Get the IDs of currently assigned tags
  const selectedTagIds = assignments.map((a: any) => a.tag_id);

  const handleSelect = async (tagId: string) => {
    const newSelection = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];

    await setTags({ ideaId, tagIds: newSelection });
  };

  const handleRemove = async (tagId: string) => {
    const newSelection = selectedTagIds.filter((id) => id !== tagId);
    await setTags({ ideaId, tagIds: newSelection });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const newTag = await createTag.mutateAsync(newTagName);
      setNewTagName("");
      setShowNewTagInput(false);
      // Auto-select the new tag
      if (newTag?.id) {
        await setTags({ ideaId, tagIds: [...selectedTagIds, newTag.id] });
      }
    } catch (error) {
      // Error is handled in the hook
    }
  };

  const isLoading = isLoadingTags || isLoadingAssignments;

  // Get the tag objects for selected tags
  const selectedTags = availableTags.filter((tag) => selectedTagIds.includes(tag.id));

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            aria-label={ariaLabel}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || isLoading}
            className="w-full min-w-0 justify-between font-normal"
          >
            {isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </span>
            ) : selectedTags.length > 0 ? (
              <span className="text-muted-foreground">
                {selectedTags.length} tag{selectedTags.length !== 1 ? "s" : ""} selected
              </span>
            ) : (
              <span className="text-muted-foreground">Select tags...</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] max-w-[calc(100vw-2rem)] p-0" align="start"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}>

          <Command>
            <CommandInput placeholder="Search tags..." />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Loading tags..." : "No tags found."}
              </CommandEmpty>
              <CommandGroup>
                {availableTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => handleSelect(tag.id)}
                    disabled={isSettingTags}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selectedTagIds.includes(tag.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <Tag className="mr-2 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{tag.name}</span>
                    {tagCounts[tag.name] !== undefined && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        ({tagCounts[tag.name]})
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                {showNewTagInput ? (
                  <div className="p-2 space-y-2">
                    <Input
                      aria-label="New tag name"
                      placeholder="New tag name..."
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateTag();
                        }
                        if (e.key === "Escape") {
                          setShowNewTagInput(false);
                          setNewTagName("");
                        }
                      }}
                      autoFocus
                      disabled={isCreating}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="cta"
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim() || isCreating}
                        className="flex-1"
                      >
                        {isCreating && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Create
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowNewTagInput(false);
                          setNewTagName("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <CommandItem
                    onSelect={() => setShowNewTagInput(true)}
                    className="text-primary"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create new tag
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="max-w-full gap-1 py-0 pl-2.5 pr-0.5"
            >
              <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{tag.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleRemove(tag.id);
                }}
                disabled={disabled || isSettingTags}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full outline-none ring-offset-background hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove {tag.name}</span>
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
