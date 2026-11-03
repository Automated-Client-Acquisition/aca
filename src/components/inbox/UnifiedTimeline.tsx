import { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelIndicator, getChannelLabel } from "./ChannelIndicator";
import {
  useUnifiedMessages,
  type UnifiedMessage,
} from "@/hooks/crm/useUnifiedMessages";
import type { ConversationChannel } from "@/hooks/crm/useConversations";
import { Mail, MessageSquare } from "lucide-react";
import DOMPurify from "dompurify";

interface UnifiedTimelineProps {
  contactId: string;
  currentConversationId: string;
}

export function UnifiedTimeline({
  contactId,
  currentConversationId,
}: UnifiedTimelineProps) {
  const { data: messagesDesc, isLoading } = useUnifiedMessages(contactId);

  // Reverse from DESC to chronological order
  const messages = useMemo(() => {
    if (!messagesDesc) return [];
    return [...messagesDesc].reverse();
  }, [messagesDesc]);

  if (isLoading) {
    return (
      <ScrollArea className="h-full p-4">
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <TimelineSkeleton key={i} isOutbound={i % 2 === 0} />
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No cross-channel messages
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Messages across all channels will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full p-4">
      <div className="space-y-3">
        {messages.map((message, index) => {
          const prevMessage = index > 0 ? messages[index - 1] : null;

          // Date divider
          const showDateDivider =
            !prevMessage ||
            format(new Date(message.created_at), "yyyy-MM-dd") !==
              format(new Date(prevMessage.created_at), "yyyy-MM-dd");

          // Channel switch marker
          const showChannelSwitch =
            prevMessage && prevMessage.channel !== message.channel;

          const isFromOtherConversation =
            message.conversation_id !== currentConversationId;

          return (
            <div key={message.message_id}>
              {showDateDivider && (
                <DateDivider date={new Date(message.created_at)} />
              )}
              {showChannelSwitch && !showDateDivider && (
                <ChannelSwitchMarker
                  channel={message.channel as ConversationChannel}
                />
              )}
              <TimelineMessage
                message={message}
                isDimmed={isFromOtherConversation}
              />
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function TimelineMessage({
  message,
  isDimmed,
}: {
  message: UnifiedMessage;
  isDimmed: boolean;
}) {
  const isOutbound = message.direction === "outbound";

  return (
    <div
      className={cn(
        "flex gap-2 max-w-[85%]",
        isOutbound ? "ml-auto flex-row-reverse" : "",
        isDimmed && "opacity-70"
      )}
    >
      <div className={cn("space-y-1", isOutbound && "items-end")}>
        {/* Channel badge */}
        <div
          className={cn(
            "flex items-center gap-1.5",
            isOutbound && "justify-end"
          )}
        >
          <ChannelBadge channel={message.channel as ConversationChannel} />
          {message.email_subject && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 truncate max-w-[200px]">
              <Mail className="h-2.5 w-2.5" />
              {message.email_subject}
            </span>
          )}
        </div>

        {/* Content bubble */}
        {message.content && (
          <div
            className={cn(
              "px-3 py-2 rounded-2xl text-sm",
              isOutbound
                ? "bg-blue-600 text-white rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            )}
          >
            {/<(?:br|p|div|span|a|b|strong|em|i|ul|ol|li|h[1-6]|img|table|blockquote)\b/i.test(message.content) ? (
              <div
                className={cn(
                  "prose prose-sm max-w-none break-words [&_*]:m-0 [&_p]:mb-1 [&_br]:block",
                  isOutbound ? "prose-invert" : "dark:prose-invert"
                )}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.content) }}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words">
                {message.content.replace(/\\n/g, '\n')}
              </p>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={cn(
            "flex items-center gap-1.5 text-[10px] text-muted-foreground px-1",
            isOutbound && "justify-end"
          )}
        >
          <span>{format(new Date(message.created_at), "h:mm a")}</span>
          {isOutbound && message.status && (
            <>
              <span>·</span>
              <span className={cn("capitalize", message.status === "failed" && "text-destructive font-medium")}>{message.status}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const channelColors: Record<string, string> = {
  email: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  linkedin:
    "bg-[#0A66C2]/10 text-[#0A66C2] dark:bg-[#0A66C2]/20 dark:text-[#5B9BD5]",
  instagram:
    "bg-[#E4405F]/10 text-[#E4405F] dark:bg-[#E4405F]/20 dark:text-[#F06292]",
  whatsapp:
    "bg-[#25D366]/10 text-[#25D366] dark:bg-[#25D366]/20 dark:text-[#66BB6A]",
  sms: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  telegram:
    "bg-[#0088cc]/10 text-[#0088cc] dark:bg-[#0088cc]/20 dark:text-[#4FC3F7]",
};

function ChannelBadge({ channel }: { channel: ConversationChannel }) {
  const colorClass =
    channelColors[channel] ||
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        colorClass
      )}
    >
      <ChannelIndicator channel={channel} className="h-2.5 w-2.5" />
      {getChannelLabel(channel)}
    </span>
  );
}

function ChannelSwitchMarker({
  channel,
}: {
  channel: ConversationChannel;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ChannelIndicator channel={channel} className="h-3 w-3" />
        <span>Switched to {getChannelLabel(channel)}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function DateDivider({ date }: { date: Date }) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let label: string;
  if (format(date, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")) {
    label = "Today";
  } else if (format(date, "yyyy-MM-dd") === format(yesterday, "yyyy-MM-dd")) {
    label = "Yesterday";
  } else {
    label = format(date, "MMMM d, yyyy");
  }

  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function TimelineSkeleton({ isOutbound }: { isOutbound: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-2 max-w-[70%]",
        isOutbound ? "ml-auto flex-row-reverse" : ""
      )}
    >
      <div className="space-y-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton
          className={cn(
            "h-14 rounded-2xl",
            isOutbound ? "w-44 rounded-br-sm" : "w-52 rounded-bl-sm"
          )}
        />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}
