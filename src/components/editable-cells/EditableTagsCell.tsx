import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Pencil, Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableTagsCellProps {
  tags: string[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  availableTags?: string[];
  maxDisplay?: number;
  className?: string;
}

export function EditableTagsCell({
  tags,
  onAddTag,
  onRemoveTag,
  availableTags = [],
  maxDisplay = 2,
  className,
}: EditableTagsCellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingTag, setRemovingTag] = useState<string | null>(null);

  const handleAddTag = async () => {
    if (!newTag.trim()) return;

    setIsAdding(true);
    try {
      await onAddTag(newTag.trim());
      setNewTag("");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    setRemovingTag(tag);
    try {
      await onRemoveTag(tag);
    } finally {
      setRemovingTag(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSuggestionClick = async (tag: string) => {
    if (tags.includes(tag)) return;
    setIsAdding(true);
    try {
      await onAddTag(tag);
    } finally {
      setIsAdding(false);
    }
  };

  const displayTags = tags.slice(0, maxDisplay);
  const remainingCount = tags.length - maxDisplay;
  const suggestions = availableTags.filter(t => !tags.includes(t));

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-1 cursor-pointer rounded px-1 -mx-1 hover:bg-muted/50 min-h-[28px]",
            className
          )}
        >
          {tags.length === 0 ? (
            <span className="text-muted-foreground text-sm">No tags</span>
          ) : (
            <>
              {displayTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs font-normal"
                >
                  {tag}
                </Badge>
              ))}
              {remainingCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  +{remainingCount}
                </span>
              )}
            </>
          )}
          <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">Tags</div>

          {/* Current tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs font-normal pr-1"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    disabled={removingTag === tag}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    {removingTag === tag ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <X className="w-3 h-3" />
                    )}
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Add new tag */}
          <div className="flex gap-1">
            <Input
              placeholder="Add tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
              disabled={isAdding}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddTag}
              disabled={!newTag.trim() || isAdding}
              className="h-8 px-2"
            >
              {isAdding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Suggestions</div>
              <div className="flex flex-wrap gap-1">
                {suggestions.slice(0, 5).map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="text-xs font-normal cursor-pointer hover:bg-muted"
                    onClick={() => handleSuggestionClick(tag)}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
