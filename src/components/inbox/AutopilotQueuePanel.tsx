import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useAutopilotQueue,
  useAutopilotQueueCount,
} from "@/hooks/crm/useAutopilotQueue";
import { Bot, CheckCircle2, Loader2 } from "lucide-react";
import { IntentBadge } from "@/components/inbox/IntentBadge";

interface AutopilotQueuePanelProps {
  className?: string;
  onSelectConversation?: (conversationId: string) => void;
}

export function AutopilotQueuePanel({ className, onSelectConversation }: AutopilotQueuePanelProps) {
  const { data: count } = useAutopilotQueueCount();
  const { data: items, isLoading } = useAutopilotQueue();
  const [open, setOpen] = useState(false);

  const pendingCount = count || 0;

  const handleItemClick = (conversationId: string) => {
    onSelectConversation?.(conversationId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative h-8 w-8", className)}
          aria-label={`Autopilot queue${pendingCount > 0 ? `, ${pendingCount} pending approvals` : ""}`}
          title="Autopilot queue"
        >
          <Bot className="h-4 w-4" />
          {pendingCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] bg-amber-500 hover:bg-amber-500"
            >
              {pendingCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[400px] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm">Autopilot Queue</h3>
            {pendingCount > 0 && (
              <Badge variant="secondary" className="h-5 text-[10px]">
                {pendingCount} pending
              </Badge>
            )}
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="max-h-[min(500px,60dvh)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items && items.length > 0 ? (
            <div className="divide-y">
              {items.map((item) => {
                const contactName = item.conversation?.contact?.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleItemClick(item.conversation_id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Bot className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {contactName || "AI Draft"}
                        </span>
                      </div>
                      <IntentBadge intent={item.trigger_intent} />
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5 ml-5.5">
                      {item.draft_message.slice(0, 100)}
                      {item.draft_message.length > 100 ? "..." : ""}
                    </p>

                    <div className="flex items-center justify-between ml-5.5">
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(item.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                No pending approvals
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                AI drafts requiring review will appear here
              </p>
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
