import { useState, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function TagInput({ tags, onTagsChange, placeholder = "Add tags...", className }: TagInputProps) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const addTag = () => {
    const tag = input.trim();
    if (!tag) return;

    // Auto-prefix with # if not present
    const formattedTag = tag.startsWith('#') ? tag : `#${tag}`;
    
    // Avoid duplicates
    if (!tags.includes(formattedTag)) {
      onTagsChange([...tags, formattedTag]);
    }
    
    setInput("");
  };

  const removeTag = (index: number) => {
    onTagsChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-background min-h-[42px] focus-within:ring-2 focus-within:ring-ring">
        {tags.map((tag, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="gap-1 pr-1 hover:bg-secondary"
          >
            <Hash className="h-3 w-3" />
            {tag.replace('#', '')}
            <button
              type="button"
              onClick={() => removeTag(index)}
              className="ml-1 rounded-sm hover:bg-secondary-foreground/10 p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] border-0 shadow-none focus-visible:ring-0 p-0 h-6"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Press Enter or comma to add. Hashtags will be appended to your caption when posted.
      </p>
    </div>
  );
}
