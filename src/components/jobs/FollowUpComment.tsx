import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronRight, HelpCircle, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowUpCommentProps {
  comment: string;
  onChange: (comment: string) => void;
  disabled?: boolean;
}

export function FollowUpComment({ comment, onChange, disabled = false }: FollowUpCommentProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 py-2 text-sm font-medium hover:text-foreground/80 transition-colors w-full">
        <ChevronRight
          className={cn(
            "h-4 w-4 transition-transform",
            isOpen && "rotate-90"
          )}
        />
        <MessageCircle className="h-4 w-4" />
        <span>Follow up comment</span>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <p className="text-xs">
                This text will be posted as the first comment under your post.
                Use it to add additional context, links, or a call-to-action.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {comment && !isOpen && (
          <span className="ml-auto text-xs text-muted-foreground truncate max-w-[200px]">
            {comment}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="space-y-2 pl-6">
          <Label htmlFor="follow-up-comment" className="sr-only">
            Follow up comment
          </Label>
          <Textarea
            id="follow-up-comment"
            value={comment}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write your first comment here..."
            rows={3}
            className="resize-none"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {comment.length} characters
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
