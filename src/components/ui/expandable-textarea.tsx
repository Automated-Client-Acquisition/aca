import * as React from "react";
import { useState, useCallback } from "react";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExpandableTextareaProps extends TextareaProps {
  /** Title shown in the expanded dialog header */
  expandTitle?: string;
}

const ExpandableTextarea = React.forwardRef<HTMLTextAreaElement, ExpandableTextareaProps>(
  ({ className, expandTitle = "Edit", value, onChange, ...props }, ref) => {
    const [expanded, setExpanded] = useState(false);
    // Keep a local mirror so the dialog textarea is controlled
    const currentValue = (value as string) ?? "";

    const handleDialogChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e);
      },
      [onChange],
    );

    return (
      <>
        <div className="relative group">
          <Textarea
            ref={ref}
            className={cn("pr-8", className)}
            value={value}
            onChange={onChange}
            {...props}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-muted z-10"
            onClick={() => setExpanded(true)}
            title="Expand editor"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>

        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-3xl h-[80vh] flex flex-col overflow-hidden">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{expandTitle}</DialogTitle>
            </DialogHeader>
            <Textarea
              value={currentValue}
              onChange={handleDialogChange}
              placeholder={props.placeholder}
              className={cn("flex-1 min-h-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0", className)}
              autoFocus
            />
          </DialogContent>
        </Dialog>
      </>
    );
  },
);
ExpandableTextarea.displayName = "ExpandableTextarea";

export { ExpandableTextarea };
export type { ExpandableTextareaProps };
