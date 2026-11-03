import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChannelIndicator, getChannelLabel } from "./ChannelIndicator";
import {
  useContactConversations,
  type CrmConversation,
  type ConversationChannel,
} from "@/hooks/crm/useConversations";
import { ArrowRightLeft } from "lucide-react";

interface ChannelSwitcherProps {
  contactId: string;
  currentChannel: string;
  currentConversationId: string;
  onSwitchConversation: (conversationId: string) => void;
}

export function ChannelSwitcher({
  contactId,
  currentChannel,
  currentConversationId,
  onSwitchConversation,
}: ChannelSwitcherProps) {
  const { data: conversations } = useContactConversations(contactId);

  // Only show if there are multiple conversations
  const hasMultiple = conversations && conversations.length > 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5 px-2"
          disabled={!hasMultiple}
        >
          <ChannelIndicator
            channel={currentChannel as ConversationChannel}
            className="h-3.5 w-3.5"
          />
          <ArrowRightLeft className="h-3 w-3" />
          <span className="text-muted-foreground">Switch</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[260px] p-2" align="start">
        <p className="text-xs font-medium text-muted-foreground px-2 py-1.5 mb-1">
          Switch channel
        </p>

        <div className="space-y-0.5">
          {conversations?.map((conv) => (
            <ChannelOption
              key={conv.id}
              conversation={conv}
              isActive={conv.id === currentConversationId}
              onSelect={() => {
                if (conv.id !== currentConversationId) {
                  onSwitchConversation(conv.id);
                }
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChannelOption({
  conversation,
  isActive,
  onSelect,
}: {
  conversation: CrmConversation;
  isActive: boolean;
  onSelect: () => void;
}) {
  const statusColors: Record<string, string> = {
    open: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    closed:
      "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
    snoozed:
      "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    archived:
      "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500",
  };

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
      )}
    >
      <ChannelIndicator
        channel={conversation.channel}
        className="h-6 w-6 rounded-md flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {getChannelLabel(conversation.channel)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {conversation.message_count} messages
        </p>
      </div>
      <Badge
        variant="outline"
        className={cn(
          "h-4 text-[9px] capitalize border-0",
          statusColors[conversation.status] ||
            "bg-gray-100 text-gray-500"
        )}
      >
        {conversation.status}
      </Badge>
    </button>
  );
}
