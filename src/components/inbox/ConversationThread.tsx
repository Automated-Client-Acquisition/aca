import { useRef, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import { Button } from "@/components/ui/button";
import { ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { PanelGroup, type ImperativePanelGroupHandle } from "react-resizable-panels";
import { useAuth } from "@/contexts/AuthContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChannelIndicator, getChannelLabel } from "@/components/inbox/ChannelIndicator";
import { MessageComposer } from "@/components/inbox/MessageComposer";
import { FavoriteToggle } from "@/components/inbox/FavoriteToggle";
import { QuickActionsMenu } from "@/components/inbox/QuickActionsMenu";
import { IntentBadge } from "@/components/inbox/IntentBadge";
import { SequenceEnrollmentBadge } from "@/components/inbox/SequenceEnrollmentBadge";
import DOMPurify from "dompurify";
import { useMessages, type CrmMessage } from "@/hooks/crm/useMessages";
import {
  useMarkConversationRead,
  useToggleConversationAI,
  type ConversationWithContact,
} from "@/hooks/crm/useConversations";
import { useManualHandoff, useHandoffTriggers } from "@/hooks/crm";
import { useAttachmentUrl, type MessageAttachment } from "@/hooks/crm/useMessages";
import { useEmailMailbox } from "@/hooks/useEmailMailbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown,
  Maximize2,
  Minimize2,
  Columns2,
  Rows2,
  Loader2,
  Bot,
  User,
  PanelRightClose,
  PanelRightOpen,
  MessageSquare,
  FileText,
  Download,
  Mic,
  Mail,
  StickyNote,
  Layers,
  UserRoundCheck,
} from "lucide-react";
import { AutopilotApprovalBanner } from "@/components/inbox/AutopilotApprovalBanner";
import { UnifiedTimeline } from "@/components/inbox/UnifiedTimeline";
import { AssignToUserPicker } from "@/components/inbox/AssignToUserPicker";

interface ConversationThreadProps {
  conversation: ConversationWithContact | null;
  isActive?: boolean;
  onToggleContactDetails: () => void;
  showContactDetails: boolean;
  onSwitchConversation?: (conversationId: string) => void;
  onConversationDeleted?: () => void;
  onToggleAgentPanel?: () => void;
  showAgentPanel?: boolean;
  isFocused?: boolean;
  onToggleFocus?: () => void;
}

export function ConversationThread({
  conversation,
  isActive = true,
  onToggleContactDetails,
  showContactDetails,
  onSwitchConversation,
  onConversationDeleted,
  onToggleAgentPanel,
  showAgentPanel,
  isFocused = false,
  onToggleFocus,
}: ConversationThreadProps) {
  const [showUnifiedView, setShowUnifiedView] = useState(false);
  const [sentRevision, setSentRevision] = useState(0);
  const { currentOrganization } = useAuth();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [replyMinSize, setReplyMinSize] = useState(45);
  const [focusLayout, setFocusLayout] = useState<"horizontal" | "vertical">("horizontal");
  const splitDirection = isFocused && onToggleFocus ? focusLayout : "vertical";
  const defaultReplySize = splitDirection === "horizontal" ? 42 : Math.max(45, replyMinSize);
  const splitRef = useRef<ImperativePanelGroupHandle>(null);
  const savedSplits = useRef<Partial<Record<"horizontal" | "vertical", number[]>>>({});
  const hasConversation = !!conversation;
  useLayoutEffect(() => {
    if (!hasConversation) return;
    splitRef.current?.setLayout(savedSplits.current[splitDirection] ?? (splitDirection === "horizontal" ? [58, 42] : [55, 45]));
  }, [splitDirection, hasConversation]);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(() => {
      const height = workspace.clientHeight;
      if (height) setReplyMinSize(Math.min(65, Math.max(30, 260 / height * 100)));
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [conversation?.id]);

  // Mutations
  const markReadMutation = useMarkConversationRead();
  const toggleAIMutation = useToggleConversationAI();
  const handoffMutation = useManualHandoff();
  const { data: handoffTriggers } = useHandoffTriggers();

  // SMTP email mailbox info for header badge (must be before early return to respect Rules of Hooks)
  const isSmtpEmail = conversation?.channel === "email" && !!conversation?.mailbox_id;
  const { data: mailbox } = useEmailMailbox(
    isSmtpEmail ? conversation!.mailbox_id! : undefined
  );

  // Mark as read immediately when opening an unread conversation,
  // or when a new message arrives on the currently viewed conversation.
  const unreadCount = conversation?.unread_count ?? 0;
  useEffect(() => {
    if (isActive && conversation?.id && unreadCount > 0) {
      markReadMutation.mutate(conversation.id);
    }
  }, [conversation?.id, unreadCount, isActive]);

  if (!conversation) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/10">
        <div className="text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="font-medium text-muted-foreground">
            Select a conversation
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Choose a conversation from the list to view messages
          </p>
        </div>
      </div>
    );
  }

  const contact = conversation.contact;
  const initials =
    contact?.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
          <ContactAvatar
            contactId={contact?.id}
            avatarUrl={contact?.avatar_url}
            initials={initials}
            className="h-8 w-8 flex-shrink-0"
            fallbackClassName="text-[10px]"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <h2 className="font-semibold text-sm truncate">
                {contact?.display_name || "Unknown Contact"}
              </h2>
              <ChannelIndicator
                channel={conversation.channel}
                className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
              />
              {conversation.lead_intent && (
                <IntentBadge intent={conversation.lead_intent} />
              )}
              {conversation.status === "closed" && (
                <Badge variant="outline" className="h-4 text-[9px] px-1.5">
                  Closed
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {contact?.company && `${contact.company}`}
              {contact?.company && contact?.job_title && " · "}
              {contact?.job_title}
              {!contact?.company && !contact?.job_title && (
                <span className="capitalize">
                  via {getChannelLabel(conversation.channel)}
                </span>
              )}
              {isSmtpEmail && mailbox && (
                <>
                  {(contact?.company || contact?.job_title) && " · "}
                  {mailbox.email_address}
                </>
              )}
            </p>
            <SequenceEnrollmentBadge contactId={contact?.id} className="mt-1" />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {isFocused && onToggleFocus && (
            <Button
              variant="outline"
              size="sm"
              className="mr-2 h-8 gap-1.5"
              onClick={() => setFocusLayout((layout) => layout === "horizontal" ? "vertical" : "horizontal")}
              aria-label={splitDirection === "horizontal" ? "Switch to stacked view" : "Switch to side-by-side view"}
            >
              {splitDirection === "horizontal" ? <Rows2 className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
              {splitDirection === "horizontal" ? "Stacked view" : "Side-by-side view"}
            </Button>
          )}
          {onToggleFocus && (
            <Button variant="outline" size="sm" className="mr-2 h-8 gap-1.5" onClick={onToggleFocus} aria-pressed={isFocused}>
              {isFocused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFocused ? "Show inbox" : "Focus"}
            </Button>
          )}
          {/* Unified View Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showUnifiedView ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowUnifiedView(!showUnifiedView)}
                aria-label={showUnifiedView ? "Show channel thread" : "Show unified cross-channel view"}
              >
                <Layers className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showUnifiedView ? "Show channel thread" : "Unified cross-channel view"}
            </TooltipContent>
          </Tooltip>

          {/* Assign to User */}
          <AssignToUserPicker
            conversationId={conversation.id}
            currentAssignedUserId={conversation.assigned_to_user_id}
            compact
          />

          {/* Favorite Toggle */}
          <FavoriteToggle conversationId={conversation.id} />

          {/* AI Agent Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              {conversation.ai_enabled ? (
                <Button
                  variant={showAgentPanel ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={onToggleAgentPanel}
                  aria-label="Open AI agent"
                >
                  <div className="relative">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                    <div className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </div>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    toggleAIMutation.mutate({
                      conversationId: conversation.id,
                      enabled: true,
                    });
                    onToggleAgentPanel?.();
                  }}
                  disabled={toggleAIMutation.isPending}
                  aria-label="Enable AI agent"
                >
                  <Bot className="h-3.5 w-3.5" />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {conversation.ai_enabled ? "AI Agent" : "Enable AI agent"}
            </TooltipContent>
          </Tooltip>

          {/* Handoff to Human */}
          {conversation.ai_enabled && conversation.contact_id && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={handoffMutation.isPending}
                      aria-label="Handoff to human"
                    >
                      <UserRoundCheck className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Handoff to human</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {handoffTriggers?.filter((t) => t.is_active).map((trigger) => (
                  <DropdownMenuItem
                    key={trigger.id}
                    onClick={() =>
                      handoffMutation.mutate({
                        conversationId: conversation.id,
                        contactId: conversation.contact_id!,
                        triggerId: trigger.id,
                      })
                    }
                  >
                    {trigger.name}
                  </DropdownMenuItem>
                ))}
                {handoffTriggers?.some((t) => t.is_active) && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem
                  onClick={() =>
                    handoffMutation.mutate({
                      conversationId: conversation.id,
                      contactId: conversation.contact_id!,
                    })
                  }
                >
                  Manual handoff (no trigger)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Quick Actions Menu */}
          <QuickActionsMenu conversation={conversation} onDeleted={onConversationDeleted} />

          {/* Toggle Contact Details */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onToggleContactDetails}
                aria-label={showContactDetails ? "Hide contact details" : "Show contact details"}
              >
                {showContactDetails ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showContactDetails ? "Hide contact details" : "Show contact details"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Autopilot Approval Banner — shown inline when agent panel is hidden */}
      {!showAgentPanel && (
        <AutopilotApprovalBanner
          conversationId={conversation.id}
          onOpenAgentPanel={onToggleAgentPanel}
        />
      )}

      <div ref={workspaceRef} className="min-h-0 min-w-0 flex-1">
      <PanelGroup ref={splitRef} direction={splitDirection} className="flex h-full w-full min-h-0 min-w-0 data-[panel-group-direction=vertical]:flex-col">
        <ResizablePanel id="history" order={1} defaultSize={100 - defaultReplySize} minSize={splitDirection === "horizontal" ? 35 : 25} className="min-h-0 min-w-0">
          {showUnifiedView && conversation.contact_id ? (
            <UnifiedTimeline contactId={conversation.contact_id} currentConversationId={conversation.id} />
          ) : (
            <MessageHistory key={`${currentOrganization?.id}:${conversation.id}`} conversation={conversation} isActive={isActive} sentRevision={sentRevision} />
          )}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          aria-label={splitDirection === "horizontal" ? "Resize conversation history and reply editor widths" : "Resize conversation history and reply editor heights"}
          className="bg-muted/60 data-[panel-group-direction=horizontal]:w-2 data-[panel-group-direction=vertical]:h-2"
          onDragging={(dragging) => {
            if (!dragging && splitRef.current) savedSplits.current[splitDirection] = splitRef.current.getLayout();
          }}
        />
        <ResizablePanel id="reply" order={2} defaultSize={defaultReplySize} minSize={splitDirection === "horizontal" ? 35 : replyMinSize} className="min-h-0 min-w-0">
          <div className={cn("h-full min-h-0 px-3 py-2 sm:px-4", conversation.status === "closed" && "bg-muted/50")}>
            <MessageComposer conversation={conversation} disabled={conversation.status === "closed"} onSwitchConversation={onSwitchConversation} fillHeight onMessageSent={() => setSentRevision((revision) => revision + 1)} />
          </div>
        </ResizablePanel>
      </PanelGroup>
      </div>
    </div>
  );
}

/** Keeps the reading position independent from the editor and incoming messages. */
function MessageHistory({ conversation, isActive, sentRevision }: {
  conversation: ConversationWithContact; isActive: boolean; sentRevision: number;
}) {
  const [limit, setLimit] = useState(50);
  const query = useMessages(conversation.id, limit);
  const lastData = useRef<typeof query.data>();
  if (query.data) lastData.current = query.data;
  const data = query.data ?? lastData.current;
  const messages = useMemo(() => [...(data?.messages ?? [])].reverse(), [data?.messages]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const initialized = useRef(false);
  const anchor = useRef<{ id?: string; offset: number } | null>(null);
  const readingAnchor = useRef<{ id?: string; offset: number } | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const scrollToLatest = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    anchor.current = null;
    readingAnchor.current = null;
    followLatest.current = true;
    const latest = contentRef.current?.querySelector<HTMLElement>('[data-message-id]:last-child');
    // Open a long latest message at its beginning instead of showing only its sign-off.
    viewport.scrollTop = latest && latest.offsetHeight > viewport.clientHeight - 24
      ? viewport.scrollTop + latest.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12
      : viewport.scrollHeight;
    setAwayFromLatest(false);
  };

  useLayoutEffect(() => {
    if (!isActive || !data || !viewportRef.current) return;
    const viewport = viewportRef.current;
    if (anchor.current && !query.isFetching && !query.isError) {
      const saved = anchor.current;
      const row = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.dataset.messageId === saved.id);
      if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset;
      readingAnchor.current = saved;
      anchor.current = null;
    } else if (initialized.current && !followLatest.current && readingAnchor.current && !anchor.current) {
      const saved = readingAnchor.current;
      const row = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.dataset.messageId === saved.id);
      if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset;
    } else if (!initialized.current || (followLatest.current && !anchor.current)) {
      scrollToLatest();
      initialized.current = true;
    }
  }, [data, isActive, query.isFetching, query.isError]);

  useEffect(() => {
    if (sentRevision > 0) scrollToLatest();
  }, [sentRevision]);

  // Images, font loading and split resizing must not pull a reader out of history.
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(() => {
      if (!isActive || anchor.current) return;
      if (followLatest.current) scrollToLatest();
      else if (readingAnchor.current) {
        const saved = readingAnchor.current;
        const row = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.dataset.messageId === saved.id);
        if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset;
      }
    });
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [isActive]);

  const loadEarlier = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const firstVisible = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top);
    anchor.current = { id: firstVisible?.dataset.messageId, offset: firstVisible ? firstVisible.getBoundingClientRect().top - viewport.getBoundingClientRect().top : 0 };
    followLatest.current = false;
    setLimit((value) => Math.max(value, data?.messages.length ?? 0) + 50);
  };

  return (
    <div className="relative h-full min-h-0 bg-muted/15">
      <div ref={viewportRef} className="h-full overflow-y-auto overscroll-contain px-3 py-3 sm:px-5" role="region" aria-label="Conversation messages" tabIndex={0}
        onScroll={() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          const atLatest = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 48;
          followLatest.current = atLatest;
          if (atLatest) readingAnchor.current = null;
          else if (!anchor.current) {
            const firstVisible = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top);
            readingAnchor.current = { id: firstVisible?.dataset.messageId, offset: firstVisible ? firstVisible.getBoundingClientRect().top - viewport.getBoundingClientRect().top : 0 };
          }
          const latest = contentRef.current?.querySelector<HTMLElement>('[data-message-id]:last-child');
          const latestVisible = latest && latest.getBoundingClientRect().top < viewport.getBoundingClientRect().bottom && latest.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top;
          setAwayFromLatest(!atLatest && !latestVisible);
        }}>
        <div ref={contentRef} className="mx-auto max-w-3xl space-y-5 pb-2">
          {query.isLoading && !data ? (
            <div className="space-y-4">{Array.from({ length: 4 }, (_, index) => <MessageSkeleton key={index} isOutbound={index % 2 === 0} />)}</div>
          ) : (
            <>
              {query.isError ? (
                <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border p-3 text-sm" role="alert">
                  <span>{data ? "Earlier messages could not be loaded." : "Messages could not be loaded."}</span>
                  <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
                </div>
              ) : data?.hasMore ? (
                <div className="text-center">
                  <Button variant="outline" size="sm" disabled={query.isFetching} onClick={loadEarlier}>
                    {query.isFetching && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    {query.isFetching ? "Loading earlier messages…" : "Load earlier messages"}
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground">{messages.length} of {data.total} messages</p>
                </div>
              ) : messages.length > 0 ? <p className="text-center text-xs text-muted-foreground">Beginning of conversation · {messages.length} messages</p> : null}
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const showDate = !previous || format(new Date(message.created_at), "yyyy-MM-dd") !== format(new Date(previous.created_at), "yyyy-MM-dd");
                return <div key={message.id} data-message-id={message.id}>
                  {showDate && <DateDivider date={new Date(message.created_at)} />}
                  <MessageBubble message={message} contact={conversation.contact} channel={conversation.channel} />
                </div>;
              })}
              {!query.isError && !messages.length && <div className="py-12 text-center text-sm text-muted-foreground">No messages yet. Write a message below to start the conversation.</div>}
            </>
          )}
        </div>
      </div>
      {awayFromLatest && <Button variant="outline" size="sm" className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-2 rounded-full bg-background shadow-md" onClick={scrollToLatest}>
        <ArrowDown className="h-3.5 w-3.5" /> Latest messages
      </Button>}
    </div>
  );
}

interface MessageBubbleProps {
  message: CrmMessage;
  contact: ConversationWithContact["contact"];
  channel: ConversationWithContact["channel"];
}

function MessageBubble({ message, contact, channel }: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";
  const isAI = message.sender_type === "ai";

  // Detect internal notes
  const meta = (message.metadata as Record<string, any>) ?? {};
  const isNote = message.sender_type === "system" && meta.note === true;

  // Email metadata from message fields or metadata
  const emailSubject = message.email_subject || meta.email_subject;
  const emailFrom = message.email_from || meta.email_from;
  // Use the full-width email card layout for the email channel, or any message
  // carrying email metadata (subject/from) even on a non-email conversation.
  const isEmail = channel === "email" || !!(emailSubject || emailFrom);
  const isEmailHtml = isEmail && message.content_type === "html";
  // Detect if chat message content contains HTML tags (e.g. LinkedIn messages with <br>)
  // This catches both: content_type="text" with HTML tags, and content_type="html" for non-email channels
  const hasHtmlTags = !isEmail && message.content
    ? (message.content_type === "html" || /<(?:br|p|div|span|a|b|strong|em|i|ul|ol|li|h[1-6]|img|table|tr|td|th|blockquote)\b/i.test(message.content))
    : false;

  const initials =
    contact?.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  // Internal note bubble — distinct styling
  if (isNote) {
    return (
      <div className="flex justify-center max-w-[85%] mx-auto">
        <div className="space-y-1 w-full">
          <div className="px-3 py-2 rounded-lg text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 mb-1">
              <StickyNote className="h-3 w-3" />
              <span>Internal Note</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-amber-900 dark:text-amber-200">
              {message.content}
            </p>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{format(new Date(message.created_at), "h:mm a")}</span>
          </div>
        </div>
      </div>
    );
  }

  // Email messages get a full-width card layout instead of chat bubbles (like Gmail/SmartLead)
  if (isEmail) {
    return (
      <div className="w-full space-y-1.5">
        {/* Email header — compact single row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {!isOutbound ? (
              <>
                <ContactAvatar
                  contactId={contact?.id}
                  avatarUrl={contact?.avatar_url}
                  initials={initials}
                  className="h-5 w-5 flex-shrink-0"
                  fallbackClassName="text-[8px]"
                />
                <span className="text-xs font-medium truncate">
                  {contact?.display_name || emailFrom || "Unknown"}
                </span>
                {emailFrom && contact?.display_name && (
                  <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                    {emailFrom}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs font-medium">You</span>
            )}
            {isAI && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px] gap-0.5 flex-shrink-0">
                <Bot className="h-2.5 w-2.5" /> AI
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-shrink-0 ml-2">
            <span>{format(new Date(message.created_at), "h:mm a")}</span>
            {isOutbound && message.status && (
              <>
                <span>·</span>
                <span className={cn("capitalize", message.status === "failed" && "text-destructive font-medium")}>{message.status}</span>
              </>
            )}
          </div>
        </div>

        {/* Subject line — only if present */}
        {emailSubject && (
          <div className="text-xs text-muted-foreground px-0.5">{emailSubject}</div>
        )}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {message.attachments.map((att, i) => (
              <AttachmentRenderer key={i} attachment={att} isOutbound={isOutbound} />
            ))}
          </div>
        )}

        {/* Email body card */}
        {message.content && (
          <EmailMessageBody
            content={message.content}
            isHtml={isEmailHtml}
            isOutbound={isOutbound}
            // Some replies put the whole message in the subject and only quote us
            // in the body. Show that subject as the message ("Re: …" says nothing).
            subjectAsMessage={emailSubject && !/^\s*(re|fwd?|aw|tr|sv)\s*:/i.test(emailSubject) ? emailSubject : undefined}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2 max-w-[92%] sm:max-w-[85%]",
        isOutbound ? "ml-auto flex-row-reverse" : ""
      )}
    >
      {!isOutbound && (
        <ContactAvatar
          contactId={contact?.id}
          avatarUrl={contact?.avatar_url}
          initials={initials}
          className="h-7 w-7"
          fallbackClassName="text-[10px]"
        />
      )}

      <div className={cn("min-w-0 space-y-1", isOutbound && "items-end")}>
        {/* Email metadata (subject + from) */}
        {emailSubject && (
          <div className={cn(
            "text-[11px] font-medium px-1",
            isOutbound ? "text-right" : ""
          )}>
            {emailSubject}
          </div>
        )}
        {!isOutbound && emailFrom && (
          <div className="text-[10px] text-muted-foreground px-1 flex items-center gap-1">
            <Mail className="h-3 w-3" />
            {emailFrom}
          </div>
        )}

        {/* Attachment rendering */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {message.attachments.map((att, i) => (
              <AttachmentRenderer key={i} attachment={att} isOutbound={isOutbound} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {message.content && (
        <div
          className={cn(
            "px-4 py-3 rounded-2xl text-[15px] leading-relaxed [overflow-wrap:anywhere]",
            isOutbound
              ? "bg-blue-600 text-white rounded-br-sm"
              : "bg-muted rounded-bl-sm"
          )}
        >
          {sanitizeGarbledText(message.content) === null ? (
            <p className="text-muted-foreground italic">Message content unavailable</p>
          ) : hasHtmlTags ? (
            <div
              className={cn(
                "prose prose-sm max-w-none break-words [&_*]:m-0 [&_p]:mb-1 [&_br]:block",
                isOutbound ? "prose-invert" : "dark:prose-invert"
              )}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.content) }}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content.replace(/\\n/g, '\n')}</p>
          )}
        </div>
        )}

        <div
          className={cn(
            "flex items-center gap-1.5 text-[10px] text-muted-foreground px-1",
            isOutbound && "justify-end"
          )}
        >
          {isAI && (
            <>
              <Bot className="h-3 w-3" />
              <span>AI</span>
              <span>·</span>
            </>
          )}
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

function EmailMessageBody({ content, isHtml, isOutbound, subjectAsMessage }: { content: string; isHtml: boolean; isOutbound: boolean; subjectAsMessage?: string }) {
  const body = useMemo(() => {
    const resolved = stripMimeEnvelope(content);
    const html = isHtml || /<[a-zA-Z]/.test(resolved);
    if (html) {
      const container = document.createElement("div");
      container.innerHTML = DOMPurify.sanitize(resolved.replace(/ src=["']cid:[^"']*["']/gi, ''));
      const wrapDetails = (contents: Node, label: string) => {
        const details = document.createElement("details");
        details.className = "mt-3 border-t pt-2";
        const summary = document.createElement("summary");
        summary.className = "cursor-pointer text-xs text-muted-foreground";
        summary.textContent = label;
        details.append(summary, contents);
        return details;
      };
      // Outlook puts the reply header before the quoted body instead of wrapping it.
      const outlookQuote = container.querySelector('#divRplyFwdMsg');
      if (outlookQuote) {
        const range = document.createRange();
        range.setStartBefore(outlookQuote);
        range.setEnd(container, container.childNodes.length);
        const quoted = range.extractContents();
        container.append(wrapDetails(quoted, "Show quoted messages"));
      }
      // Keep repeated quoted replies available without making each email a copy of the entire thread.
      const quotes = Array.from(container.querySelectorAll('.gmail_quote, .yahoo_quoted, blockquote[type="cite"]'));
      quotes.filter((quote) => !quote.closest("details") && !quotes.some((parent) => parent !== quote && parent.contains(quote))).forEach((quote) => {
        const details = document.createElement("details");
        details.className = "mt-3 border-t pt-2";
        const summary = document.createElement("summary");
        summary.className = "cursor-pointer text-xs text-muted-foreground";
        summary.textContent = "Show quoted messages";
        quote.replaceWith(details);
        details.append(summary, quote);
      });
      const signatureTables = Array.from(container.querySelectorAll("table"));
      signatureTables.filter((table) => !table.closest("details") && !table.parentElement?.closest("table") &&
        table.querySelector('a[href^="mailto:"]') && table.querySelector('a[href^="http"]') && table.querySelector("img") &&
        (table.textContent || "").length < 400).forEach((table) => {
          const marker = document.createComment("signature");
          table.replaceWith(marker);
          marker.replaceWith(wrapDetails(table, "Show signature"));
        });
      const own = container.cloneNode(true) as HTMLElement;
      own.querySelectorAll("details").forEach((d) => d.remove());
      return { html: container.innerHTML, text: "", quoted: "", empty: !(own.textContent || "").trim() };
    }
    const text = resolved.replace(/\\n/g, '\n');
    // Apple Mail and others prefix every quoted line, the "On … wrote:" header included, with "> ".
    let quoteStart = text.search(/^(?:>\s*)*(?:On .{3,200}wrote:|Le .{3,200}(?:écrit|wrote)\s*:|[-_]{2,}\s*(?:Original Message|Forwarded message))/im);
    if (quoteStart < 0) quoteStart = text.search(/^>/m);
    const own = quoteStart >= 0 ? text.slice(0, quoteStart).trimEnd() : text;
    return { html: "", text: own, quoted: quoteStart >= 0 ? text.slice(quoteStart) : "", empty: !own.trim() };
  }, [content, isHtml]);

  return <div className={cn("rounded-xl border px-4 py-3 text-[15px] leading-relaxed overflow-hidden [overflow-wrap:anywhere]", isOutbound ? "bg-amber-50/50 dark:bg-amber-950/15 border-amber-200/60 dark:border-amber-900/50" : "bg-card")}>
    {body.empty && subjectAsMessage && <p className="whitespace-pre-wrap break-words">{subjectAsMessage}</p>}
    {body.html ? <div className="prose prose-sm max-w-none text-[15px] leading-relaxed break-words [&_*]:max-w-full [&_img]:max-w-full dark:prose-invert" dangerouslySetInnerHTML={{ __html: body.html }} /> : <>
      {!body.empty && <p className="whitespace-pre-wrap break-words">{body.text}</p>}
      {body.quoted && <details className="mt-3 border-t pt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show quoted messages</summary>
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{body.quoted}</p>
      </details>}
    </>}
  </div>;
}

function AttachmentRenderer({ attachment, isOutbound }: { attachment: MessageAttachment; isOutbound: boolean }) {
  const type = attachment.type || inferTypeFromMime(attachment.mimeType);
  const url = useAttachmentUrl(attachment);

  // Not viewable: the file wasn't kept, or its private link is still being signed.
  if (!url) {
    const pending = !attachment.unavailable && !!attachment.storagePath;
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-2xl text-sm",
          isOutbound ? "bg-blue-600 text-white rounded-br-sm" : "bg-muted rounded-bl-sm"
        )}
      >
        {pending ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" /> : <FileText className="h-4 w-4 flex-shrink-0" />}
        <span className="truncate max-w-[180px]">{attachment.filename || 'File'}</span>
        {!pending && (
          <span className="text-[10px] opacity-70 flex-shrink-0">
            {attachment.unavailable === 'too_large' ? 'Too large to keep' : 'Not available'}
          </span>
        )}
      </div>
    );
  }

  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={attachment.filename || 'Image'}
          className="max-w-[240px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
        />
      </a>
    );
  }

  if (type === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="max-w-[280px] rounded-lg"
      />
    );
  }

  if (type === 'audio') {
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-2xl text-sm",
        isOutbound ? "bg-blue-600 text-white rounded-br-sm" : "bg-muted rounded-bl-sm"
      )}>
        <Mic className="h-4 w-4 flex-shrink-0" />
        <audio src={url} controls preload="metadata" className="h-8 max-w-[200px]" />
      </div>
    );
  }

  // File / document fallback
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-2xl text-sm hover:opacity-80 transition-opacity",
        isOutbound ? "bg-blue-600 text-white rounded-br-sm" : "bg-muted rounded-bl-sm"
      )}
    >
      <FileText className="h-4 w-4 flex-shrink-0" />
      <span className="truncate max-w-[180px]">{attachment.filename || 'File'}</span>
      {attachment.size && (
        <span className="text-[10px] opacity-70 flex-shrink-0">{formatFileSize(attachment.size)}</span>
      )}
      <Download className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
    </a>
  );
}

/**
 * Detect if a string looks like raw base64-encoded content and decode it.
 * Returns the decoded string if it was base64, or the original string if not.
 */
/**
 * Detect if a string contains raw quoted-printable encoding and decode it.
 * QP signs: soft line breaks (=\r?\n) and =XX hex sequences.
 */
function tryDecodeQuotedPrintable(content: string): string {
  // Must have at least a few QP-encoded sequences to trigger
  const qpMatches = content.match(/=[0-9A-Fa-f]{2}/g);
  if (!qpMatches || qpMatches.length < 2) return content;
  // Also check for soft line breaks or high density of =XX patterns
  const hasSoftBreaks = /=\r?\n/.test(content);
  const density = qpMatches.length / content.length;
  if (!hasSoftBreaks && density < 0.01) return content;
  try {
    // Remove soft line breaks
    const cleaned = content.replace(/=\r?\n/g, '');
    // Decode =XX hex sequences to bytes, then interpret as UTF-8
    const bytes: number[] = [];
    let i = 0;
    while (i < cleaned.length) {
      if (cleaned[i] === '=' && i + 2 < cleaned.length) {
        const hex = cleaned.substring(i + 1, i + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          bytes.push(parseInt(hex, 16));
          i += 3;
          continue;
        }
      }
      bytes.push(cleaned.charCodeAt(i));
      i++;
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return content;
  }
}

function tryDecodeBase64(content: string): string {
  const trimmed = content.trim();
  // Quick heuristic: base64 strings are long, have no spaces/html tags, and match the charset
  if (trimmed.length < 20) return content;
  if (/<[a-zA-Z]/.test(trimmed)) return content; // already has HTML tags
  // Check if it looks like base64: only base64 chars + whitespace, at least 80% alphanumeric
  // Note: MIME base64 wraps at 76 chars with CRLF, so whitespace between chunks is expected
  const stripped = trimmed.replace(/[\s\r\n]/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) return content;
  if (stripped.length < 20) return content;

  try {
    const binaryStr = atob(stripped);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const decoded = new TextDecoder('utf-8').decode(bytes);
    // Verify the decoded content looks like text/HTML (not binary garbage)
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded.substring(0, 200))) return content;
    return decoded;
  } catch {
    return content;
  }
}

/**
 * Detect garbled/binary text from Unipile (e.g. LinkedIn messages with corrupted encoding).
 * Returns null if the text is garbled, otherwise returns the cleaned text.
 */
function sanitizeGarbledText(text: string | null | undefined): string | null {
  if (!text) return null;
  let cleaned = text.replace(/\uFFFD/g, '');
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  cleaned = cleaned.trim();
  if (!cleaned) return null;
  // Heuristic 1: if >40% of remaining chars are non-word/non-punctuation/non-space,
  // the content is garbled binary data
  const readable = cleaned.replace(/[^\w\s.,!?'"@#$%&()\-:;/\\=+<>[\]{}|~`^*€£¥©®™°…–—''""•·\n\r]/g, '');
  if (cleaned.length >= 4 && readable.length / cleaned.length < 0.6) {
    return null;
  }
  // Heuristic 2: real text contains word-like patterns (2+ consecutive letters).
  // Garbled strings like "n$~j+6<" have isolated single chars separated by symbols.
  const letterChars = (cleaned.match(/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
  const hasWords = /[a-zA-Z\u00C0-\u024F]{2,}/.test(cleaned);
  if (cleaned.length >= 3 && letterChars > 0 && !hasWords) {
    return null;
  }
  // Heuristic 3: very short strings with high symbol density are likely garbled
  if (cleaned.length <= 12 && cleaned.length >= 3) {
    const alphaNum = (cleaned.match(/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\s]/g) || []).length;
    if (alphaNum / cleaned.length < 0.5) {
      return null;
    }
  }
  return cleaned;
}

/**
 * Strip MIME multipart envelope from email content.
 * Some messages arrive with raw MIME boundaries still wrapping the HTML body
 * (e.g. "--boundary Content-Type: text/html ... <html>...</html> --boundary Content-Type: image/png ...base64...").
 * This extracts just the HTML part so it renders cleanly.
 */
function stripMimeEnvelope(content: string): string {
  // Guard against extremely large payloads that could cause performance issues
  if (content.length > 500000) return content.substring(0, 500000);

  // Check if the entire content is base64-encoded (no MIME envelope, just raw base64)
  const decoded = tryDecodeBase64(content);
  if (decoded !== content) return decoded;

  // Check if the entire content is quoted-printable encoded (no MIME envelope)
  const qpDecoded = tryDecodeQuotedPrintable(content);
  if (qpDecoded !== content) return qpDecoded;

  // Quick check: does it look like MIME multipart content?
  // MIME boundaries start with "--" followed by boundary ID
  const boundaryMatch = content.match(/^--([^\s\r\n]+)\s/);
  if (!boundaryMatch) return content;

  const boundary = boundaryMatch[1];
  // Split by boundary
  const parts = content.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // Find the text/html part
  for (const part of parts) {
    if (/Content-Type:\s*text\/html/i.test(part)) {
      const isBase64Part = /Content-Transfer-Encoding:\s*base64/i.test(part);
      const isQpPart = /Content-Transfer-Encoding:\s*quoted-printable/i.test(part);
      // Strip the MIME headers from this part (everything before the first blank-ish line after headers)
      const headerEnd = part.search(/\r?\n\r?\n|(?:Content-Transfer-Encoding:[^\n]*\n)/i);
      if (headerEnd !== -1) {
        // Find the actual content start after all MIME headers
        const afterHeaders = part.replace(/^[\s\S]*?Content-Transfer-Encoding:[^\n]*\n/i, '').replace(/^\s*/, '');
        if (afterHeaders.trim()) {
          const body = afterHeaders.trim();
          if (isBase64Part) return tryDecodeBase64(body);
          if (isQpPart) return tryDecodeQuotedPrintable(body);
          return body;
        }
      }
      // Fallback: strip the Content-Type/Content-Transfer-Encoding lines
      const body = part
        .replace(/\s*Content-Type:[^\n]*\n?/gi, '')
        .replace(/\s*Content-Transfer-Encoding:[^\n]*\n?/gi, '')
        .trim();
      if (isBase64Part) return tryDecodeBase64(body);
      if (isQpPart) return tryDecodeQuotedPrintable(body);
      return body;
    }
  }

  return content;
}

function inferTypeFromMime(mime?: string): string {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function MessageSkeleton({ isOutbound }: { isOutbound: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-2 max-w-[70%]",
        isOutbound ? "ml-auto flex-row-reverse" : ""
      )}
    >
      {!isOutbound && <Skeleton className="h-7 w-7 rounded-full" />}
      <div className="space-y-1">
        <Skeleton
          className={cn(
            "h-16 rounded-2xl",
            isOutbound ? "w-48 rounded-br-sm" : "w-56 rounded-bl-sm"
          )}
        />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}
