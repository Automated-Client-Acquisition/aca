import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableTextCellProps {
  value: string | null;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  type?: "text" | "url" | "tel" | "email";
  className?: string;
}

export function EditableTextCell({
  value,
  onSave,
  placeholder = "—",
  type = "text",
  className,
}: EditableTextCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (localValue === (value || "")) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(localValue);
      setIsEditing(false);
    } catch {
      setLocalValue(value || "");
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setLocalValue(value || "");
      setIsEditing(false);
    }
  };

  const handleClick = () => {
    if (!isEditing && !isSaving) {
      setIsEditing(true);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type={type}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm py-1.5 px-2 w-full"
          disabled={isSaving}
        />
        {isSaving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  const displayValue = value || "";
  const isEmpty = !displayValue;

  const renderValue = () => {
    if (isEmpty) {
      return <span className="text-muted-foreground">{placeholder}</span>;
    }

    if (type === "url" && displayValue) {
      return (
        <a
          href={displayValue.startsWith("http") ? displayValue : `https://${displayValue}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {displayValue.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
          <ExternalLink className="w-3 h-3" />
        </a>
      );
    }

    if (type === "tel" && displayValue) {
      return (
        <a
          href={`tel:${displayValue}`}
          className="text-blue-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {displayValue}
        </a>
      );
    }

    if (type === "email" && displayValue) {
      return (
        <a
          href={`mailto:${displayValue}`}
          className="text-blue-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {displayValue}
        </a>
      );
    }

    return displayValue;
  };

  // Only show tooltip if there's content that might be truncated
  const shouldShowTooltip = !isEmpty && displayValue.length > 30;

  const content = (
    <div
      className={cn(
        "group flex items-start gap-1 cursor-pointer rounded px-1 -mx-1 hover:bg-muted/50 min-h-[28px]",
        className
      )}
      onClick={handleClick}
    >
      <span className="break-words line-clamp-2">{renderValue()}</span>
      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
    </div>
  );

  if (shouldShowTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px]">
          <p className="break-words">{displayValue}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
