import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useLeadMagnetRecoveryContext,
  useSendMessage,
  type MessageAttachment,
  type MessageContentType,
} from "@/hooks/crm/useMessages";
import { EmailRichTextEditor } from "@/components/email/EmailRichTextEditor";
import { type ConversationWithContact } from "@/hooks/crm/useConversations";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useEmailMailbox } from "@/hooks/useEmailMailbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Send,
  Paperclip,
  Smile,
  Bot,
  ChevronDown,
  Sparkles,
  Clock,
  X,
  FileText,
  Mic,
  Film,
  Mail,
  StickyNote,
  MessageSquare,
  AlertTriangle,
  CalendarCheck,
  ShieldCheck,
  ThumbsUp,
  Zap,
  PenLine,
  Type,
  MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { getChannelCapabilities } from "@/lib/channel-capabilities";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSendWhatsAppTemplate, useWhatsAppTemplates, useWhatsAppWindow } from "@/hooks/useWhatsAppTemplates";
import { CannedResponsePicker } from "@/components/inbox/CannedResponsePicker";
import { SnippetsMenu } from "@/components/inbox/SnippetsMenu";
import { resolveSnippetVariables, snippetIsHtml, snippetToHtml, snippetToPlainText } from "@/lib/snippet-utils";
import { EmojiPicker } from "@/components/jobs/EmojiPicker";
import { ChannelSwitcher } from "@/components/inbox/ChannelSwitcher";
import { useAiDraft } from "@/hooks/crm/useAiDraft";
import { useToggleConversationAI } from "@/hooks/crm/useConversations";
import { useQueueMessage, type QueueMessageInput } from "@/hooks/crm/useMessages";
import { format, addHours, setHours, setMinutes, nextMonday } from "date-fns";
import { Loader2 } from "lucide-react";

/** An HTML body with only an `<img>` (e.g. a Loom thumbnail) has no plain text but isn't empty. */
function isHtmlBodyEmpty(html: string): boolean {
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped.length === 0 && !/<img\b/i.test(html);
}

function formatRecoveryDelay(hours?: number): string {
  if (!hours) return "";
  return hours % 24 === 0
    ? `${hours / 24} day${hours === 24 ? "" : "s"}`
    : `${hours} hours`;
}

interface ComposerDraft {
  message: string;
  bodyFormat: "html" | "text";
  emailSubject: string;
  attachments: MessageAttachment[];
  isNoteMode: boolean;
}

const emptyDraft = (): ComposerDraft => ({ message: "", bodyFormat: "text", emailSubject: "", attachments: [], isNoteMode: false });
// Session memory only: never persist customer messages to browser storage.
const composerDrafts = new Map<string, ComposerDraft>();
let composerDraftScope: string | undefined;

interface MessageComposerProps {
  conversation: ConversationWithContact;
  disabled?: boolean;
  fillHeight?: boolean;
  onMessageSent?: () => void;
  onSwitchConversation?: (conversationId: string) => void;
}

export function MessageComposer({
  conversation,
  disabled = false,
  fillHeight = false,
  onMessageSent,
  onSwitchConversation,
}: MessageComposerProps) {
  const { user, currentOrganization } = useAuth();
  const draftScope = `${user?.id || ""}:${currentOrganization?.id || ""}`;
  const draftKey = `${draftScope}:${conversation.id}`;
  const activeDraftKeyRef = useRef(draftKey);
  const isCurrentDraft = () => activeDraftKeyRef.current === draftKey && composerDraftScope === draftScope;
  const [draftState, setDraftState] = useState<{ key: string; draft: ComposerDraft }>(() => ({ key: draftKey, draft: composerDrafts.get(draftKey) || emptyDraft() }));
  const draft = draftState.key === draftKey ? draftState.draft : (composerDraftScope === draftScope ? composerDrafts.get(draftKey) : undefined) || emptyDraft();
  const { message, bodyFormat, emailSubject, attachments, isNoteMode } = draft;
  const [editorSeed, setEditorSeed] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSubject, setShowSubject] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useLayoutEffect(() => {
    activeDraftKeyRef.current = draftKey;
    if (composerDraftScope !== draftScope) {
      composerDrafts.clear();
      composerDraftScope = draftScope;
    }
    setDraftState({ key: draftKey, draft: composerDrafts.get(draftKey) || emptyDraft() });
    setIsExpanded(false);
    setShowSubject(false);
    setShowFormatting(false);
    setShowTools(false);
    setShowSchedulePicker(false);
    setShowAiDirectionPicker(false);
    setCustomDirection("");
  }, [draftScope, draftKey]);

  const updateDraft = (patch: Partial<ComposerDraft> | ((current: ComposerDraft) => Partial<ComposerDraft>), targetKey = draftKey) => {
    // An upload/send that finishes after an org switch must not recreate its old draft.
    if (composerDraftScope !== draftScope) return;
    const stored = composerDrafts.get(targetKey) || (draftState.key === targetKey ? draftState.draft : emptyDraft());
    const updated = { ...stored, ...(typeof patch === "function" ? patch(stored) : patch) };
    composerDrafts.set(targetKey, updated);
    setDraftState((current) => current.key === targetKey && composerDraftScope === draftScope
      ? { key: targetKey, draft: updated }
      : current
    );
  };
  const setMessage = (value: string | ((previous: string) => string)) => updateDraft((current) => ({ message: typeof value === "function" ? value(current.message) : value }));
  const setBodyFormat = (value: "html" | "text") => updateDraft({ bodyFormat: value });
  const setEmailSubject = (value: string) => updateDraft({ emailSubject: value });
  const setAttachments = (value: MessageAttachment[] | ((previous: MessageAttachment[]) => MessageAttachment[])) => updateDraft((current) => ({ attachments: typeof value === "function" ? value(current.attachments) : value }));
  const setIsNoteMode = (value: boolean) => updateDraft({ isNoteMode: value });
  const resetSentDraft = () => {
    // Preserve any new typing while the outgoing message was in flight.
    updateDraft((current) => (
      current.message === message && current.bodyFormat === bodyFormat &&
      current.emailSubject === emailSubject && current.attachments === attachments &&
      current.isNoteMode === isNoteMode
        ? emptyDraft()
        : current
    ));
    if (isCurrentDraft()) setEditorSeed((n) => n + 1);
  };
  const queryClient = useQueryClient();
  const sendMutation = useSendMessage();
  const { uploadMedia, isUploading } = useMediaUpload();

  // Determine if this is an SMTP email conversation (has mailbox_id)
  const isSmtpEmail = conversation.channel === "email" && !!conversation.mailbox_id;
  const { data: mailbox } = useEmailMailbox(
    isSmtpEmail ? conversation.mailbox_id! : undefined
  );
  const {
    data: leadMagnetContext,
    isLoading: isLoadingLeadMagnetContext,
    isError: isLeadMagnetContextError,
  } = useLeadMagnetRecoveryContext(conversation.id, isSmtpEmail);

  // Mailbox status check. 'warming' is a sendable state (reduced daily cap,
  // not a connection state), so only block on actually-broken statuses.
  const mailboxUnavailable = isSmtpEmail && mailbox &&
    !['ready', 'active', 'warming'].includes(mailbox.status);

  // `message` is WYSIWYG HTML only for SMTP email conversations mid-edit in
  // the rich-text editor; every other channel/state keeps it plain text.
  const isHtmlMessage = isSmtpEmail && bodyFormat === "html";
  const isMessageEmpty = isHtmlMessage
    ? isHtmlBodyEmpty(message)
    : !message.trim();

  // AI Draft & Autopilot
  const aiDraft = useAiDraft();
  const toggleAIMutation = useToggleConversationAI();

  // Schedule send
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const queueMessage = useQueueMessage();

  // AI direction picker
  const [showAiDirectionPicker, setShowAiDirectionPicker] = useState(false);
  const [customDirection, setCustomDirection] = useState("");

  const handleAiDraft = (direction?: string) => {
    if (!conversation?.id || !conversation?.contact_id) return;
    setShowAiDirectionPicker(false);
    setCustomDirection("");
    toast.loading('Generating AI draft...', { id: 'ai-draft' });
    aiDraft.mutate(
      {
        conversationId: conversation.id,
        contactId: conversation.contact_id,
        channel: conversation.channel,
        direction: direction || undefined,
      },
      {
        onSuccess: (data) => {
          if (data?.draft) {
            setMessage(data.draft);
            setBodyFormat("text"); // AI drafts come back as plain text
            if (isCurrentDraft()) {
              setEditorSeed((n) => n + 1);
              textareaRef.current?.focus();
            }
            toast.success('AI draft generated', { id: 'ai-draft' });
          } else {
            toast.error('AI returned an empty draft', { id: 'ai-draft' });
          }
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to generate AI draft', { id: 'ai-draft' });
        },
      }
    );
  };

  // Schedule send handler
  const handleScheduleSend = (scheduledFor: Date) => {
    if (isMessageEmpty || !conversation) return;

    queueMessage.mutate(
      {
        contact_id: conversation.contact_id,
        channel: conversation.channel,
        recipient_external_id: conversation.external_participant_id || '',
        content: isHtmlMessage ? message : message.trim(),
        content_type: isHtmlMessage ? "html" : "text",
        conversation_id: conversation.id,
        channel_account_id: conversation.channel_account_id || undefined,
        recipient_display_name: conversation.contact?.display_name || undefined,
        email_subject: isSmtpEmail && emailSubject.trim() ? emailSubject.trim() : undefined,
        scheduled_for: scheduledFor.toISOString(),
        source_type: 'manual',
      } as QueueMessageInput,
      {
        onSuccess: () => {
          resetSentDraft();
          setShowSchedulePicker(false);
          toast.success(`Message scheduled for ${format(scheduledFor, 'PPp')}`);
        },
      }
    );
  };

  // Canned response picker — detect `/` at start of input
  const slashMatch = message.match(/^\/(\S*)$/);
  const showCannedPicker = !!slashMatch && !isNoteMode;
  const cannedQuery = slashMatch ? slashMatch[1] : "";

  const handleCannedSelect = (content: string) => {
    setMessage(snippetToPlainText(resolveSnippetVariables(content, conversation.contact, { html: snippetIsHtml(content) })));
    textareaRef.current?.focus();
  };

  // Toolbar snippet insert: at the cursor for plain channels, appended as
  // paragraphs for the SMTP rich-text editor (which is remounted to pick it up).
  const handleSnippetInsert = (content: string) => {
    const isHtml = snippetIsHtml(content);
    const resolved = resolveSnippetVariables(content, conversation.contact, { html: isHtml });
    if (isSmtpEmail) {
      const snippetHtml = isHtml ? resolved : snippetToHtml(resolved);
      const current = isHtmlBodyEmpty(message) ? "" : message;
      if (!current) {
        setMessage(snippetHtml);
        setBodyFormat("html");
      } else {
        const base = bodyFormat === "html" ? current : snippetToHtml(current);
        setMessage(base + snippetHtml);
        setBodyFormat("html");
      }
      setEditorSeed((n) => n + 1);
      return;
    }
    const text = snippetToPlainText(resolved);
    const el = textareaRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + text + message.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  // Channel capabilities
  const capabilities = getChannelCapabilities(conversation.channel);

  // WhatsApp 24h window check
  const lastInboundAt = (conversation as any).last_inbound_at;
  const whatsapp24hExpired = capabilities.has24hWindow && lastInboundAt &&
    (Date.now() - new Date(lastInboundAt).getTime() > 24 * 60 * 60 * 1000);

  // WhatsApp Business (Twilio) threads: Meta blocks free text once the 24h window
  // closes, so the composer only offers an approved template then.
  const isWhatsAppBusiness = conversation.channel === "whatsapp" && (conversation as { provider?: string }).provider === "twilio";
  const { data: waWindow } = useWhatsAppWindow(conversation.id, isWhatsAppBusiness);
  const waWindowClosed = isWhatsAppBusiness && waWindow?.open === false;
  const { data: waTemplates = [] } = useWhatsAppTemplates();
  const approvedTemplates = waTemplates.filter((t) => t.approval_status === "approved");
  const sendTemplate = useSendWhatsAppTemplate();

  // Character limit tracking
  const charLimit = capabilities.characterLimit;
  const charsRemaining = charLimit ? charLimit - message.length : null;

  // Auto-resize textarea
  const maxTextareaHeight = isSmtpEmail ? 400 : 200;
  useEffect(() => {
    if (textareaRef.current && !fillHeight) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        maxTextareaHeight
      )}px`;
    }
  }, [message, maxTextareaHeight, fillHeight]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const url = await uploadMedia(file);
      if (url) {
        const type = inferAttachmentType(file.type);
        setAttachments((prev) => [
          ...prev,
          { type, url, filename: file.name, size: file.size, mimeType: file.type },
        ]);
      }
    }
    // Reset input so re-selecting the same file triggers change
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const canSend = (!disabled && !sendMutation.isPending && !isUploading && !isSavingNote && (!mailboxUnavailable || isNoteMode) && (!waWindowClosed || isNoteMode)) &&
    (!isMessageEmpty || (!isNoteMode && attachments.length > 0));

  const handleSaveNote = async () => {
    if (isMessageEmpty || !user || !currentOrganization) return;
    setIsSavingNote(true);
    try {
      const { error } = await supabase.from("crm_messages").insert({
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        organization_id: currentOrganization.id,
        direction: "outbound",
        sender_type: "system",
        content: isHtmlMessage ? message : message.trim(),
        content_type: isHtmlMessage ? "html" : "text",
        status: "delivered",
        metadata: { note: true, author_id: user.id },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["crm-messages", conversation.id] });
      resetSentDraft();
      setIsExpanded(false);
      if (isCurrentDraft()) onMessageSent?.();
      toast.success("Note saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleSend = (sendAsLeadMagnet = false) => {
    if (!canSend) return;

    // Note mode — save locally, don't send externally
    if (isNoteMode) {
      handleSaveNote();
      return;
    }

    // Validate that we have the external participant ID for sending
    if (!conversation.external_participant_id) {
      toast.error("Cannot send message: this conversation is not linked to an external account");
      return;
    }

    if (sendAsLeadMagnet && leadMagnetContext?.status !== "ready") {
      if (leadMagnetContext?.sourceSequenceId) {
        toast.info(leadMagnetContext.message || "Configure this campaign’s recovery route first");
        navigate(`/email/sequences/${leadMagnetContext.sourceSequenceId}?settings=followup_rules#campaign-settings`);
      } else {
        toast.error(leadMagnetContext?.message || "ACA could not identify the campaign behind this conversation");
      }
      return;
    }

    sendMutation.mutate(
      {
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        content: isHtmlMessage ? message : message.trim(),
        content_type: (isHtmlMessage ? "html" : "text") as MessageContentType,
        attachments: attachments.length > 0 ? attachments : undefined,
        // Pass conversation details for sending
        channel: conversation.channel,
        channel_account_id: conversation.channel_account_id,
        recipient_external_id: conversation.external_participant_id,
        recipient_display_name: conversation.contact?.display_name,
        external_conversation_id: conversation.external_conversation_id,
        // Email-specific fields
        email_subject: isSmtpEmail && emailSubject.trim() ? emailSubject.trim() : undefined,
        lead_magnet_delivery: isSmtpEmail && sendAsLeadMagnet ? true : undefined,
      },
      {
        onSuccess: (result) => {
          resetSentDraft();
          setIsExpanded(false);
          if (isCurrentDraft()) onMessageSent?.();

          if (result.leadMagnetRecovery?.status === "failed") {
            toast.warning("Email sent, but the follow-up could not be scheduled", {
              description: result.leadMagnetRecovery.warning || "Enroll this contact in the selected sequence manually; the email itself was sent.",
              duration: 8000,
            });
          } else if (result.leadMagnetRecovery?.status === "already_active") {
            toast.info("Lead magnet sent; follow-up was already active", {
              description: result.leadMagnetRecovery.warning || "The selected sequence will continue on its existing schedule in this email thread.",
            });
          } else if (result.leadMagnetRecovery) {
            toast.success("Lead magnet sent and follow-up scheduled", {
              description: `“${result.leadMagnetRecovery.sequenceName || leadMagnetContext?.targetSequenceName || "Recovery sequence"}” starts in ${formatRecoveryDelay(leadMagnetContext?.delayHours)} unless they reply.`,
            });
          }
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When canned response picker is open, let it handle navigation keys
    if (showCannedPicker && ["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
      return; // CannedResponsePicker handles these via window listener
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSend) handleSend();
    }
  };

  const replyTools = (
    <div className={cn("flex min-w-0 gap-2", fillHeight ? "flex-col" : "shrink-0 flex-wrap items-center justify-between px-2 pb-1 border-t pt-1")}>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {/* Emoji insertion targets the plain textarea's selection — not
                available once the rich-text editor is in use for email. */}
            {!isSmtpEmail && (
              <EmojiPicker
                onSelect={(emoji) => {
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const newMsg = message.slice(0, start) + emoji + message.slice(end);
                    setMessage(newMsg);
                    requestAnimationFrame(() => {
                      ta.selectionStart = ta.selectionEnd = start + emoji.length;
                      ta.focus();
                    });
                  } else {
                    setMessage((prev) => prev + emoji);
                  }
                }}
                trigger={
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Smile className="h-3.5 w-3.5 mr-1" />
                    Emoji
                  </Button>
                }
              />
            )}

            <Popover open={showAiDirectionPicker} onOpenChange={setShowAiDirectionPicker}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={aiDraft.isPending}
                    >
                      {aiDraft.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      AI Assist
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Generate reply with AI</TooltipContent>
              </Tooltip>
              <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-2" side="top">
                <AiDirectionPicker
                  customDirection={customDirection}
                  onCustomDirectionChange={setCustomDirection}
                  onSelect={handleAiDraft}
                  isPending={aiDraft.isPending}
                />
              </PopoverContent>
            </Popover>

            <div className="w-px h-4 bg-border" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isNoteMode ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs",
                    isNoteMode && "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                  )}
                  onClick={() => {
                    const nextNoteMode = !isNoteMode;
                    setIsNoteMode(nextNoteMode);
                    setShowTools(false);
                    if (nextNoteMode) {
                      setShowSchedulePicker(false);
                    }
                  }}
                >
                  {isNoteMode ? (
                    <>
                      <MessageSquare className="h-3.5 w-3.5 mr-1" />
                      Message
                    </>
                  ) : (
                    <>
                      <StickyNote className="h-3.5 w-3.5 mr-1" />
                      Note
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isNoteMode ? "Switch to message mode" : "Write an internal note"}
              </TooltipContent>
            </Tooltip>

            {onSwitchConversation && conversation.contact_id && (
              <>
                <div className="w-px h-4 bg-border" />
                <ChannelSwitcher
                  contactId={conversation.contact_id}
                  currentChannel={conversation.channel}
                  currentConversationId={conversation.id}
                  onSwitchConversation={onSwitchConversation}
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {charLimit && (
              <span className={cn(
                "text-[10px] font-medium tabular-nums",
                charsRemaining !== null && charsRemaining < 0
                  ? "text-destructive"
                  : charsRemaining !== null && charsRemaining < 100
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}>
                {conversation.channel === "sms"
                  ? // One SMS holds 160 characters; longer texts go out as 153-character parts
                    `${message.length} · ${message.length <= 160 ? 1 : Math.ceil(message.length / 153)} SMS`
                  : `${message.length}/${charLimit}`}
              </span>
            )}
            {/* The rich-text editor doesn't wire Cmd/Ctrl+Enter to send — Enter always
                starts a new paragraph there, so this shortcut hint would be misleading. */}
            {!isSmtpEmail && (
              <p className="text-[10px] text-muted-foreground">
                <kbd className="px-1 py-0.5 rounded bg-muted text-[9px]">Ctrl/Cmd+Enter</kbd> send{" "}
                <kbd className="px-1 py-0.5 rounded bg-muted text-[9px]">Enter</kbd> new line
              </p>
            )}
          </div>
        </div>
  );

  return (
    <div
      className={cn(
        "relative min-w-0 rounded-lg border transition-all",
        fillHeight && "flex h-full min-h-0 flex-col",
        isNoteMode ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700" : "bg-background",
        isExpanded && "shadow-sm",
        disabled && "opacity-50"
      )}
    >
      <div className="flex shrink-0 min-w-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {isNoteMode ? "Internal note" : `Reply to ${conversation.contact?.display_name || "contact"}`}
          </span>
          {(!isMessageEmpty || attachments.length > 0) && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title="Kept in this browser session until you send it or reload the app.">
              Unsent draft
            </span>
          )}
        </div>
        {isSmtpEmail && !isNoteMode && (
          <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={() => setShowSubject((visible) => !visible)} aria-expanded={showSubject || !!emailSubject}>
            {showSubject || emailSubject ? "Subject" : "Add subject"}
          </Button>
        )}
      </div>
      {/* Note mode banner */}
      {isNoteMode && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <StickyNote className="h-3.5 w-3.5" />
            <span>Internal note — only visible to your team</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-amber-700 dark:text-amber-400 hover:text-amber-900"
            aria-label="Close internal note"
            onClick={() => setIsNoteMode(false)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* SMTP Email: Sending-from badge + Subject */}
      {isSmtpEmail && !isNoteMode && (
        <div className="shrink-0 px-3 pt-2 space-y-1">
          {mailbox && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Mail className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {mailbox.display_name || mailbox.email_address}
                {mailbox.display_name && ` <${mailbox.email_address}>`}
              </span>
            </div>
          )}
          {(showSubject || !!emailSubject) && <Input
            value={emailSubject}
            aria-label="Email subject"
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Subject (optional for replies)"
            className="h-7 text-xs border-0 border-b rounded-none shadow-none focus-visible:ring-0 px-0"
            disabled={disabled}
          />}
        </div>
      )}

      {/* Attachment Preview Strip */}
      {attachments.length > 0 && (
        <div className="flex shrink-0 max-h-20 overflow-y-auto flex-wrap gap-2 px-3 pt-2">
          {attachments.map((att, i) => (
            <AttachmentPreview key={i} attachment={att} onRemove={() => removeAttachment(i)} />
          ))}
        </div>
      )}

      {/* Upload progress */}
      {isUploading && (
        <div className="px-3 pt-1">
          <div className="text-[10px] text-muted-foreground">Uploading...</div>
        </div>
      )}

      {/* AI generating indicator */}
      {aiDraft.isPending && (
        <div className="flex items-center gap-2 px-3 pt-2 text-xs text-purple-700 dark:text-purple-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
          <span>Generating AI draft...</span>
        </div>
      )}

      {/* Mailbox unavailable warning */}
      {mailboxUnavailable && !isNoteMode && (
        <div className="flex items-center gap-1.5 px-3 pt-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Mailbox is {mailbox!.status} — cannot send emails until it is reconnected</span>
        </div>
      )}

      {/* WhatsApp Business: closed window → template only; open → when it closes */}
      {waWindowClosed && !isNoteMode && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>WhatsApp's 24-hour window is closed. Send an approved template to reopen the conversation.</span>
          {approvedTemplates.length > 0 ? (
            <Select
              value=""
              onValueChange={(templateId) => sendTemplate.mutate({ conversationId: conversation.id, templateId })}
              disabled={sendTemplate.isPending || disabled}
            >
              <SelectTrigger className="h-7 w-auto text-xs" aria-label="Send a WhatsApp template">
                <SelectValue placeholder={sendTemplate.isPending ? "Sending…" : "Send template"} />
              </SelectTrigger>
              <SelectContent>
                {approvedTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.language})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span>No approved template yet (Settings → SMS &amp; WhatsApp).</span>
          )}
        </div>
      )}
      {isWhatsAppBusiness && waWindow?.open && waWindow.closesAt && !isNoteMode && (
        <div className="px-3 pt-2 text-xs text-muted-foreground">
          Free replies allowed until {waWindow.closesAt.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      )}

      {/* WhatsApp 24h window warning */}
      {whatsapp24hExpired && !isWhatsAppBusiness && !isNoteMode && (
        <div className="flex items-center gap-1.5 px-3 pt-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>24h window expired — message may not be delivered without a template</span>
        </div>
      )}

      {/* Hidden file input */}
      {capabilities.supportsAttachments && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept={
            capabilities.supportsFileAttachments
              ? "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
              : "image/*"
          }
        />
      )}

      {/* Canned Response Picker (floating above composer) */}
      <CannedResponsePicker
        query={cannedQuery}
        open={showCannedPicker}
        onSelect={(content) => handleCannedSelect(content)}
        onClose={() => setMessage("")}
      />

      {/* Main Input Area */}
      <div className={cn("flex min-w-0 flex-col gap-2 p-2", fillHeight && "min-h-0 flex-1")}>
        {/* Body: rich-text editor for SMTP email (supports embedding e.g. a
            Loom thumbnail image linking to the video), plain textarea for
            every other channel (LinkedIn/WhatsApp/etc. don't render HTML). */}
        {isSmtpEmail ? (
          <div className={cn("order-first min-w-0 w-full", fillHeight && "flex min-h-0 flex-1 flex-col")} onFocus={() => setIsExpanded(true)}>
            <EmailRichTextEditor
              key={`${draftKey}:${editorSeed}`}
              value={message}
              bodyFormat={bodyFormat}
              onChange={(html) => {
                setMessage(html);
                setBodyFormat("html");
              }}
              placeholder={
                disabled
                  ? "Conversation is closed"
                  : aiDraft.isPending
                  ? "AI is writing a draft..."
                  : isNoteMode
                  ? "Write an internal note..."
                  : `Message ${conversation.contact?.display_name || "contact"}...`
              }
              minHeight={fillHeight ? 0 : 112}
              className="min-w-0 w-full"
              maxHeight={fillHeight ? undefined : maxTextareaHeight}
              fillHeight={fillHeight}
              showToolbar={showFormatting}
            />
          </div>
        ) : (
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsExpanded(true)}
            placeholder={
              disabled
                ? "Conversation is closed"
                : aiDraft.isPending
                ? "AI is writing a draft..."
                : isNoteMode
                ? "Write an internal note..."
                : `Message ${conversation.contact?.display_name || "contact"}... (type / for quick replies)`
            }
            disabled={disabled}
            aria-label={isNoteMode ? "Internal note" : "Reply message"}
            className={cn(
              "order-first min-w-0 w-full resize-none border-0 shadow-none focus-visible:ring-0 px-3 py-2 bg-white dark:bg-white dark:text-gray-900 text-[15px] leading-relaxed",
              fillHeight && "flex-1 min-h-0 h-full",
              "placeholder:text-muted-foreground/60 dark:placeholder:text-gray-400",
              !fillHeight && "min-h-[112px] max-h-[200px]"
            )}
            rows={1}
          />
        )}

        <div className="flex shrink-0 min-w-0 flex-wrap items-center gap-1">
        {/* Attachments — only for channels that support them */}
        {capabilities.supportsAttachments && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                disabled={disabled || isUploading}
                aria-label={capabilities.supportsFileAttachments ? "Attach file" : "Attach image"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {capabilities.supportsFileAttachments ? "Attach file" : "Attach image"}
            </TooltipContent>
          </Tooltip>
        )}

        {!isNoteMode && <SnippetsMenu disabled={disabled} onInsert={handleSnippetInsert} />}
        {isSmtpEmail && (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Formatting" aria-expanded={showFormatting} onClick={() => { setShowFormatting((visible) => !visible); setShowTools(false); }}>
            <Type className="h-4 w-4" />
          </Button>
        )}

        {fillHeight && (
          <Popover open={showTools} onOpenChange={setShowTools}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More reply tools" onClick={() => setShowFormatting(false)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="max-w-[calc(100vw-2rem)] p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Reply tools</p>
              {replyTools}
            </PopoverContent>
          </Popover>
        )}
        {/* Send Button */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Send Options Dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={disabled}
                    aria-label="Send options"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Send options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setShowSchedulePicker(true)}
                disabled={isMessageEmpty || isNoteMode}
              >
                <Clock className="h-4 w-4 mr-2" />
                Schedule send
              </DropdownMenuItem>
              {isSmtpEmail && !isNoteMode && (
                <DropdownMenuItem
                  onClick={() => {
                    if (leadMagnetContext?.status === "ready") {
                      handleSend(true);
                      return;
                    }
                    if (leadMagnetContext?.sourceSequenceId) {
                      toast.info(leadMagnetContext.message || "Configure this campaign’s recovery route first");
                      navigate(`/email/sequences/${leadMagnetContext.sourceSequenceId}?settings=followup_rules#campaign-settings`);
                    }
                  }}
                  disabled={
                    isLoadingLeadMagnetContext ||
                    isLeadMagnetContextError ||
                    (!leadMagnetContext?.sourceSequenceId && leadMagnetContext?.status !== "ready") ||
                    (leadMagnetContext?.status === "ready" && !canSend)
                  }
                >
                  <Zap className="h-4 w-4 mr-2" />
                  <div className="min-w-0">
                    <p>
                      {isLoadingLeadMagnetContext
                        ? "Checking campaign…"
                        : leadMagnetContext?.status === "ready"
                          ? "Send promised lead magnet"
                          : leadMagnetContext?.sourceSequenceId
                            ? `Configure recovery for ${leadMagnetContext.sourceSequenceName}`
                            : "Lead magnet recovery unavailable"}
                    </p>
                    <p className="max-w-[320px] truncate text-xs text-muted-foreground">
                      {leadMagnetContext?.status === "ready"
                        ? `${leadMagnetContext.sourceSequenceName} → ${leadMagnetContext.targetSequenceName} · ${formatRecoveryDelay(leadMagnetContext.delayHours)}`
                        : leadMagnetContext?.message || (isLeadMagnetContextError ? "Could not resolve the originating campaign" : "Inbox will never guess a campaign")}
                    </p>
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => {
                // Use setTimeout so the popover opens after the dropdown fully closes,
                // preventing Radix focus management from immediately dismissing it
                setTimeout(() => setShowAiDirectionPicker(true), 0);
              }} disabled={aiDraft.isPending}>
                {aiDraft.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generate with AI
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toggleAIMutation.mutate({
                    conversationId: conversation.id,
                    enabled: true,
                  });
                }}
                disabled={toggleAIMutation.isPending || conversation.ai_enabled}
              >
                <Bot className="h-4 w-4 mr-2" />
                {conversation.ai_enabled ? 'AI is responding' : 'Let AI respond'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Schedule Send Picker */}
          {showSchedulePicker && (
            <div className="absolute bottom-full right-0 mb-2 p-3 bg-popover border rounded-lg shadow-lg z-50 w-72 max-w-[calc(100vw-2rem)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Schedule send</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label="Close schedule picker"
                  onClick={() => setShowSchedulePicker(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-col gap-1.5 mb-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-7"
                  onClick={() => handleScheduleSend(addHours(new Date(), 1))}
                >
                  <Clock className="h-3 w-3 mr-1.5" />
                  In 1 hour
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-7"
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    handleScheduleSend(setMinutes(setHours(tomorrow, 9), 0));
                  }}
                >
                  <Clock className="h-3 w-3 mr-1.5" />
                  Tomorrow 9:00 AM
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-7"
                  onClick={() => {
                    handleScheduleSend(setMinutes(setHours(nextMonday(new Date()), 9), 0));
                  }}
                >
                  <Clock className="h-3 w-3 mr-1.5" />
                  Monday 9:00 AM
                </Button>
              </div>
              <div className="border-t pt-2">
                <label className="text-xs text-muted-foreground mb-1 block">Custom date & time</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleScheduleSend(new Date(e.target.value));
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* AI Direction Picker (triggered from dropdown menu) */}
          {showAiDirectionPicker && !(fillHeight ? showTools : isExpanded) && (
            <div className="absolute bottom-full right-0 mb-2 p-2 bg-popover border rounded-lg shadow-lg z-50 w-72 max-w-[calc(100vw-2rem)]">
              <AiDirectionPicker
                customDirection={customDirection}
                onCustomDirectionChange={setCustomDirection}
                onSelect={handleAiDraft}
                onClose={() => setShowAiDirectionPicker(false)}
                isPending={aiDraft.isPending}
              />
            </div>
          )}

          {/* Send / Save Note Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="cta"
                size="sm"
                className="h-8 gap-2 px-3"
                onClick={() => handleSend()}
                aria-label={isNoteMode ? "Save internal note" : "Send message"}
                disabled={!canSend}
              >
                {isNoteMode ? (
                  <StickyNote className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {isNoteMode ? "Save note" : "Send"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isNoteMode ? "Save note" + (isSmtpEmail ? "" : " (Ctrl/Cmd+Enter)") : "Send message" + (isSmtpEmail ? "" : " (Ctrl/Cmd+Enter)")}
            </TooltipContent>
          </Tooltip>
        </div>
        </div>
      </div>

      {/* In full-height mode tools float above the editor instead of reducing writing room. */}
      {!fillHeight && isExpanded && replyTools}
    </div>
  );
}

function AttachmentPreview({ attachment, onRemove }: { attachment: MessageAttachment; onRemove: () => void }) {
  const type = attachment.type;
  const isImage = type === 'image';

  if (isImage) {
    return (
      <div className="relative group">
        <img
          src={attachment.url}
          alt={attachment.filename}
          className="h-16 w-16 rounded-lg object-cover border"
        />
        <button
          type="button"
          aria-label={`Remove ${attachment.filename || "attachment"}`}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const Icon = type === 'audio' ? Mic : type === 'video' ? Film : FileText;

  return (
    <div className="relative group flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5 text-xs max-w-[200px]">
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.filename}</span>
      <button
        type="button"
        aria-label={`Remove ${attachment.filename || "attachment"}`}
        onClick={onRemove}
        className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const AI_DIRECTION_PRESETS = [
  { label: "Book a meeting", icon: CalendarCheck, direction: "Book a meeting or call — suggest a time or ask for their availability" },
  { label: "Handle objection", icon: ShieldCheck, direction: "Address their objection or concern empathetically, then pivot back to the value proposition" },
  { label: "Close the deal", icon: ThumbsUp, direction: "Push toward closing — ask for commitment, next steps, or a decision" },
  { label: "Follow up", icon: Zap, direction: "Send a friendly follow-up that re-engages the conversation without being pushy" },
];

function AiDirectionPicker({
  customDirection,
  onCustomDirectionChange,
  onSelect,
  onClose,
  isPending,
}: {
  customDirection: string;
  onCustomDirectionChange: (v: string) => void;
  onSelect: (direction?: string) => void;
  onClose?: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-xs font-medium text-muted-foreground">What should the reply do?</p>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-5 w-5" aria-label="Close AI direction picker" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      {AI_DIRECTION_PRESETS.map((preset) => (
        <Button
          key={preset.label}
          variant="ghost"
          size="sm"
          className="justify-start h-8 px-2 text-xs font-normal"
          onClick={() => onSelect(preset.direction)}
          disabled={isPending}
        >
          <preset.icon className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {preset.label}
        </Button>
      ))}
      <div className="border-t my-1" />
      <div className="flex items-center gap-1.5 px-1">
        <PenLine className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <Input
          value={customDirection}
          onChange={(e) => onCustomDirectionChange(e.target.value)}
          placeholder="Custom direction..."
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && customDirection.trim()) {
              e.preventDefault();
              onSelect(customDirection.trim());
            }
          }}
          disabled={isPending}
        />
        {customDirection.trim() && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onSelect(customDirection.trim())}
            disabled={isPending}
          >
            <Send className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="border-t my-1" />
      <Button
        variant="ghost"
        size="sm"
        className="justify-start h-8 px-2 text-xs font-normal text-muted-foreground"
        onClick={() => onSelect()}
        disabled={isPending}
      >
        <Sparkles className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
        Auto (no specific direction)
      </Button>
    </div>
  );
}

function inferAttachmentType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}
