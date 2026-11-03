import { useState, useRef, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMailboxTags } from "@/hooks/useEmailMailboxes";

interface MailboxTagSelectorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MailboxTagSelector({
  tags,
  onChange,
  placeholder = "Add tag...",
  className,
}: MailboxTagSelectorProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const availableTags = useMailboxTags();

  const normalizeTag = (tag: string) => tag.trim().toLowerCase();

  const addTag = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || tags.some((t) => normalizeTag(t) === normalizeTag(trimmed))) return;
    onChange([...tags, trimmed]);
    setInputValue("");
    setShowSuggestions(false);
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (inputValue.trim()) addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const filteredSuggestions = availableTags
    .filter(
      (tag) =>
        !tags.some((t) => normalizeTag(t) === normalizeTag(tag)) &&
        normalizeTag(tag).includes(normalizeTag(inputValue))
    )
    .slice(0, 5);

  return (
    <div className="relative">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 min-h-[36px] cursor-text",
          "focus-within:ring-1 focus-within:ring-ring",
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="text-[11px] px-2 py-0.5 gap-1 font-normal"
          >
            {tag}
            <button
              type="button"
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
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(e.target.value.length > 0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(inputValue.length > 0)}
          onBlur={() => {
            // Delay to allow clicking suggestion items
            setTimeout(() => {
              if (inputValue.trim()) addTag(inputValue);
              setShowSuggestions(false);
            }, 200);
          }}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] border-0 p-0 h-6 text-sm shadow-none focus-visible:ring-0 bg-transparent"
        />
      </div>

      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
          <Command>
            <CommandList>
              <CommandGroup>
                {filteredSuggestions.map((tag) => (
                  <CommandItem
                    key={tag}
                    value={tag}
                    onSelect={() => addTag(tag)}
                    className="cursor-pointer"
                  >
                    {tag}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
