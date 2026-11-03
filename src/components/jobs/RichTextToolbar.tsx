import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EmojiPicker } from "./EmojiPicker";
import {
  Wand2,
  Smile,
  Hash,
  Link,
  AtSign,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextToolbarProps {
  onAIGenerate?: () => void;
  onInsertText?: (text: string, wrapWith?: { before: string; after: string }) => void;
  onEmojiSelect?: (emoji: string) => void;
  onHashtagInsert?: () => void;
  onLinkInsert?: () => void;
  onMentionInsert?: () => void;
  isAIGenerating?: boolean;
  disabled?: boolean;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "ai";
}

function ToolbarButton({ icon, tooltip, onClick, disabled, variant = "default" }: ToolbarButtonProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8",
              variant === "ai" && "bg-primary/10 hover:bg-primary/20 text-primary"
            )}
            onClick={onClick}
            disabled={disabled}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RichTextToolbar({
  onAIGenerate,
  onInsertText,
  onEmojiSelect,
  onHashtagInsert,
  onLinkInsert,
  onMentionInsert,
  isAIGenerating = false,
  disabled = false,
}: RichTextToolbarProps) {
  const handleHashtag = () => {
    if (onHashtagInsert) {
      onHashtagInsert();
    } else {
      onInsertText?.("#");
    }
  };

  const handleLink = () => {
    if (onLinkInsert) {
      onLinkInsert();
    } else {
      // Insert a plain URL placeholder
      onInsertText?.("https://");
    }
  };

  const handleMention = () => {
    if (onMentionInsert) {
      onMentionInsert();
    } else {
      onInsertText?.("@");
    }
  };

  return (
    <div className="flex items-center gap-0.5 p-1 border rounded-lg bg-background">
      {/* AI Button - Special styling */}
      <ToolbarButton
        icon={isAIGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        tooltip="Generate with AI"
        onClick={onAIGenerate}
        disabled={disabled || isAIGenerating}
        variant="ai"
      />

      <div className="w-px h-6 bg-border mx-1" />

      {/* Emoji picker */}
      <EmojiPicker
        onSelect={(emoji) => {
          if (onEmojiSelect) {
            onEmojiSelect(emoji);
          } else {
            onInsertText?.(emoji);
          }
        }}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={disabled}
          >
            <Smile className="h-4 w-4" />
          </Button>
        }
      />

      <div className="w-px h-6 bg-border mx-1" />

      {/* Tags and links */}
      <ToolbarButton
        icon={<Hash className="h-4 w-4" />}
        tooltip="Add hashtag"
        onClick={handleHashtag}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Link className="h-4 w-4" />}
        tooltip="Add link"
        onClick={handleLink}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<AtSign className="h-4 w-4" />}
        tooltip="Mention"
        onClick={handleMention}
        disabled={disabled}
      />
    </div>
  );
}
