import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChannelIndicator } from "@/components/inbox/ChannelIndicator";
import type { ConversationWithContact } from "@/hooks/crm/useConversations";
import {
  BellOff,
  Clock,
  Plus,
  Sparkles,
  Star,
  XCircle,
} from "lucide-react";

export type CommandAction =
  | { type: 'navigate'; conversationId: string }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'snooze'; hours: number }
  | { type: 'tag'; tag: string }
  | { type: 'note'; text: string }
  | { type: 'mute' }
  | { type: 'favorite' }
  | { type: 'ai-draft' };

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationWithContact[];
  selectedConversation: ConversationWithContact | null;
  onAction: (action: CommandAction) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  conversations,
  selectedConversation,
  onAction,
}: CommandPaletteProps) {
  const handleAction = (action: CommandAction) => {
    onAction(action);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">Inbox command palette</DialogTitle>
      <DialogDescription className="sr-only">Search conversations and choose an inbox action.</DialogDescription>
      <CommandInput placeholder="Type a command or search conversations..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigation — search conversations */}
        <CommandGroup heading="Conversations">
          {conversations.map((conv) => (
            <CommandItem
              key={conv.id}
              value={`${conv.contact?.display_name || ''} ${conv.contact?.primary_email || ''} ${conv.contact?.company || ''}`}
              onSelect={() => handleAction({ type: 'navigate', conversationId: conv.id })}
              className="gap-2"
            >
              <ChannelIndicator channel={conv.channel} className="h-4 w-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">
                  {conv.contact?.display_name || "Unknown"}
                </span>
                {conv.last_message_preview && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {conv.last_message_preview
                      .replace(/<(style|head|script|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
                      .replace(/<[^>]*>/g, '')
                      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
                      .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
                      .replace(/&amp;/gi, '&')
                      .replace(/&lt;/gi, '<')
                      .replace(/&gt;/gi, '>')
                      .replace(/&quot;/gi, '"')
                      .replace(/&apos;/gi, "'")
                      .replace(/&nbsp;/gi, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 60)}
                  </p>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Actions — only when a conversation is selected */}
        {selectedConversation && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => handleAction({ type: 'close' })}
                className="gap-2"
              >
                <XCircle className="h-4 w-4" />
                Close conversation
              </CommandItem>
              <CommandItem
                onSelect={() => handleAction({ type: 'snooze', hours: 1 })}
                className="gap-2"
              >
                <Clock className="h-4 w-4" />
                Snooze 1 hour
              </CommandItem>
              <CommandItem
                onSelect={() => handleAction({ type: 'snooze', hours: 3 })}
                className="gap-2"
              >
                <Clock className="h-4 w-4" />
                Snooze 3 hours
              </CommandItem>
              <CommandItem
                onSelect={() => handleAction({ type: 'snooze', hours: 24 })}
                className="gap-2"
              >
                <Clock className="h-4 w-4" />
                Snooze until tomorrow
              </CommandItem>
              <CommandItem
                onSelect={() => handleAction({ type: 'ai-draft' })}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Generate AI reply
              </CommandItem>
              <CommandItem
                onSelect={() => handleAction({ type: 'favorite' })}
                className="gap-2"
              >
                <Star className="h-4 w-4" />
                Toggle favorite
              </CommandItem>
              <CommandItem
                onSelect={() => handleAction({ type: 'mute' })}
                className="gap-2"
              >
                <BellOff className="h-4 w-4" />
                Toggle mute
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {/* Quick Actions — always available */}
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() => handleAction({ type: 'navigate', conversationId: '__new__' })}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            New message
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
