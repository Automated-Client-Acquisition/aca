import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Filter } from "lucide-react";
import { useMailboxTags, useEmailMailboxes } from "@/hooks/useEmailMailboxes";

interface MailboxTagFilterPopoverProps {
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
  compact?: boolean;
}

export function MailboxTagFilterPopover({
  selectedTags,
  onSelectedTagsChange,
  compact = false,
}: MailboxTagFilterPopoverProps) {
  const availableTags = useMailboxTags();
  const { data: mailboxes = [] } = useEmailMailboxes();

  const toggleTag = (tag: string) => {
    const updated = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    onSelectedTagsChange(updated);
  };

  const clearAll = () => onSelectedTagsChange([]);

  const getTagCount = (tag: string) =>
    mailboxes.filter((m) => m.tags?.includes(tag)).length;

  if (availableTags.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          {compact ? "Tags" : "Filter by tags"}
          {selectedTags.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-5 rounded-full px-1.5 text-xs"
            >
              {selectedTags.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px]" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Filter by tags</h4>
            {selectedTags.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-auto p-1 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>

          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {availableTags.map((tag) => (
              <div
                key={tag}
                role="button"
                tabIndex={0}
                className="flex items-center space-x-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded"
                onClick={() => toggleTag(tag)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleTag(tag);
                  }
                }}
              >
                <Checkbox
                  checked={selectedTags.includes(tag)}
                  onCheckedChange={() => toggleTag(tag)}
                />
                <Label className="flex-1 cursor-pointer text-sm font-normal">
                  {tag}
                </Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {getTagCount(tag)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
