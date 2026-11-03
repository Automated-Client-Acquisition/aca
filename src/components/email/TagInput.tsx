import { useState, useRef, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export function TagInput({
  tags,
  onChange,
  placeholder = "Add tag...",
  className,
  ariaLabel = "Tags",
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInputValue("");
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes(",")) {
      e.preventDefault();
      const newTags = pasted
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s && !tags.includes(s));
      if (newTags.length > 0) {
        onChange([...tags, ...newTags]);
      }
      setInputValue("");
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 min-h-[36px] cursor-text",
        "focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, index) => (
        <Badge
          key={tag}
          variant="secondary"
          className="text-[11px] px-2 py-0.5 gap-1 font-normal"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={(e) => {
              e.stopPropagation();
              removeTag(index);
            }}
            className="ml-0.5 hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => {
          if (inputValue.trim()) addTag(inputValue);
        }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[80px] border-0 p-0 h-6 text-sm shadow-none focus-visible:ring-0 bg-transparent"
      />
    </div>
  );
}
