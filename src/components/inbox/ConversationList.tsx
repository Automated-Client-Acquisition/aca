import { useRef, useCallback, useEffect } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ChannelIndicator } from "@/components/inbox/ChannelIndicator";
import { IntentBadge } from "@/components/inbox/IntentBadge";
import {
  type ConversationWithContact,
} from "@/hooks/crm/useConversations";
import { useUnipileAccounts, useSyncUnipileHistory } from "@/hooks/useUnipileAccounts";
import { useFavoriteConversationIds } from "@/hooks/crm/useConversationPreferences";
import { PriorityBadge } from "@/components/inbox/PriorityBadge";
import { SLABadge } from "@/components/inbox/SLABadge";
import { AlertCircle, Bot, Clock, Download, Loader2, MessageSquare, Settings, Star } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

/**
 * Detect garbled/binary text from Unipile (e.g. LinkedIn messages with corrupted encoding).
 * Returns null if the text is garbled, otherwise returns the cleaned text.
 */
function sanitizeGarbledText(text: string | null | undefined): string | null {
  if (!text) return null;
  // Strip Unicode replacement characters
  let cleaned = text.replace(/\uFFFD/g, '');
  // Strip control chars (except newline/tab)
  // eslint-disable-next-line no-control-regex -- These nonprinting bytes are the content being sanitized.
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
 * Detect if a string contains raw quoted-printable encoding and decode it.
 */
function tryDecodeQuotedPrintable(content: string): string {
  const qpMatches = content.match(/=[0-9A-Fa-f]{2}/g);
  if (!qpMatches || qpMatches.length < 2) return content;
  const hasSoftBreaks = /=\r?\n/.test(content);
  const density = qpMatches.length / content.length;
  if (!hasSoftBreaks && density < 0.01) return content;
  try {
    const cleaned = content.replace(/=\r?\n/g, '');
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

/**
 * Detect if a string is raw base64-encoded content and decode it.
 */
function tryDecodeBase64(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length < 20) return content;
  if (/<[a-zA-Z]/.test(trimmed)) return content;
  const stripped = trimmed.replace(/[\s\r\n]/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped) || stripped.length < 20) return content;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(stripped), c => c.charCodeAt(0))
    );
    // eslint-disable-next-line no-control-regex -- Reject decoded binary content before rendering a preview.
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded.substring(0, 200))) return content;
    return decoded;
  } catch {
    return content;
  }
}

function stripHtmlToText(html: string): string {
  // Strip MIME multipart envelope if present (raw MIME boundaries leak into some email previews)
  let cleaned = html;

  // Check if entire content is base64-encoded
  const decoded = tryDecodeBase64(cleaned);
  if (decoded !== cleaned) cleaned = decoded;

  // Check if entire content is quoted-printable encoded
  const qpDecoded = tryDecodeQuotedPrintable(cleaned);
  if (qpDecoded !== cleaned) cleaned = qpDecoded;

  const boundaryMatch = cleaned.match(/^--([^\s\r\n]+)\s/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = cleaned.split(new RegExp(`--${escapedBoundary}`));
    // Find the text/html part and extract its body
    for (const part of parts) {
      if (/Content-Type:\s*text\/html/i.test(part)) {
        const isBase64Part = /Content-Transfer-Encoding:\s*base64/i.test(part);
        const isQpPart = /Content-Transfer-Encoding:\s*quoted-printable/i.test(part);
        let body = part
          .replace(/\s*Content-Type:[^\n]*\n?/gi, '')
          .replace(/\s*Content-Transfer-Encoding:[^\n]*\n?/gi, '')
          .trim();
        if (isBase64Part) body = tryDecodeBase64(body);
        else if (isQpPart) body = tryDecodeQuotedPrintable(body);
        cleaned = body;
        break;
      }
    }
  }

  let text = cleaned
    .replace(/<(style|head|script|title)[^>]*>[\s\S]*?<\/\1>/gi, '') // remove style/head/script/title blocks
    .replace(/<br\s*\/?>/gi, ' ')                                     // <br> → space
    .replace(/<[^>]*>/g, '')                                           // strip remaining tags
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')                                             // collapse whitespace
    .trim();

  // Clean up quoted-printable artifacts in the preview text.
  // The DB trigger strip_html_to_text() already collapsed whitespace, so QP soft breaks
  // "=\r\n" became "= " in the stored preview. We fix two patterns:
  // 1. Full QP decode for =XX hex sequences (e.g. =C2=A0 → non-breaking space)
  const qpFinal = tryDecodeQuotedPrintable(text);
  if (qpFinal !== text) text = qpFinal;
  // 2. Collapsed QP soft breaks: "=\r\n" became "= " after DB whitespace normalization.
  //    Just strip the stray "=" — the space is either original or a harmless extra.
  text = text.replace(/= /g, ' ');

  return text;
}

interface ConversationListProps {
  conversations: ConversationWithContact[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAll?: () => void;
  totalCount?: number;
  countLabel?: string;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  onResetView?: () => void;
  errorMessage?: string;
  onRetry?: () => void;
}

export function ConversationList({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  totalCount,
  countLabel,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  emptyTitle,
  emptyDescription,
  onResetView,
  errorMessage,
  onRetry,
}: ConversationListProps) {
  const { data: unipileData } = useUnipileAccounts();
  const syncHistory = useSyncUnipileHistory();
  const { data: favoriteIds } = useFavoriteConversationIds();

  // Intersection observer for auto-loading next page
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node || isFetchingNextPage || !hasNextPage || !onLoadMore) return;
    observer.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && onLoadMore) {
        onLoadMore();
      }
    });
    observer.current.observe(node);
  }, [isFetchingNextPage, hasNextPage, onLoadMore]);

  const handleImportConversations = async () => {
    // Find accounts that can be synced
    const activeAccounts = unipileData?.accounts.filter(a => a.status === 'active') || [];

    if (activeAccounts.length === 0) {
      toast.error('No connected accounts to sync');
      return;
    }

    toast.info('Importing conversations from connected accounts...');

    const totalImported = { conversations: 0, messages: 0, contacts: 0 };

    for (const account of activeAccounts) {
      try {
        const result = await syncHistory.mutateAsync(account.id);
        if (result.success && result.stats) {
          totalImported.conversations += result.stats.conversationsImported || 0;
          totalImported.messages += result.stats.messagesImported || 0;
          totalImported.contacts += result.stats.contactsCreated || 0;
        }
      } catch (error) {
        console.error(`Failed to sync ${account.provider}:`, error);
      }
    }

    if (totalImported.conversations > 0 || totalImported.messages > 0) {
      toast.success(
        `Imported ${totalImported.conversations} conversations, ` +
        `${totalImported.messages} messages, ` +
        `${totalImported.contacts} new contacts`
      );
    } else {
      toast.info('No new conversations found to import');
    }
  };

  const hasActiveAccounts = unipileData?.accounts?.some(a => a.status === 'active');

  if (errorMessage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-card p-6 text-center" role="alert">
        <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Couldn’t load conversations</p>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
        </div>
        {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-card">
        <div className="p-3 border-b">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          {[...Array(8)].map((_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="h-full flex flex-col bg-card">
        <div className="p-3 border-b">
          <span className="text-sm font-medium text-muted-foreground">
            0 conversations
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-4">
            <MessageSquare className="h-10 w-10 text-muted-foreground/50 mx-auto" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{emptyTitle || "No conversations yet"}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {emptyDescription || (hasActiveAccounts
                  ? "Import your existing conversations or wait for new messages"
                  : "Connect an account to start receiving messages")}
              </p>
            </div>

            {hasNextPage && onLoadMore && (
              <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading…" : "Load more conversations"}
              </Button>
            )}
            {onResetView ? (
              <Button variant="outline" size="sm" onClick={onResetView}>Reset view</Button>
            ) : emptyTitle || emptyDescription ? null : hasActiveAccounts ? (
              <Button
                variant="cta"
                size="sm"
                onClick={handleImportConversations}
                disabled={syncHistory.isPending}
                className="mt-2"
              >
                {syncHistory.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Import Conversations
                  </>
                )}
              </Button>
            ) : (
              <Button variant="cta" size="sm" asChild className="mt-2">
                <Link to="/settings?tab=integrations">
                  <Settings className="h-4 w-4 mr-2" />
                  Connect Account
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Deduplicate conversations by id to prevent React duplicate key warnings
  const seen = new Set<string>();
  const deduped = conversations.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  const displayTotal = totalCount != null ? totalCount : deduped.length;
  const selectedLoadedCount = deduped.filter((c) => selectedIds?.has(c.id)).length;
  const allLoadedSelected = selectedLoadedCount === deduped.length;
  const selectionState = allLoadedSelected ? true : selectedLoadedCount > 0 ? "indeterminate" : false;

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden">
      <div className="min-h-12 px-3 border-b flex items-center gap-2">
        {onSelectAll && (
          <label
            className="flex h-9 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
            title={allLoadedSelected ? "Deselect loaded conversations" : "Select loaded conversations"}
          >
            <Checkbox
              checked={selectionState}
              onCheckedChange={onSelectAll}
              aria-label={allLoadedSelected ? "Deselect loaded conversations" : "Select loaded conversations"}
              className="h-5 w-5 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500 data-[state=checked]:text-black"
            />
          </label>
        )}
        <span className="text-sm font-medium text-muted-foreground">
          {countLabel ?? (totalCount != null && deduped.length < totalCount
            ? `${deduped.length} of ${totalCount} conversation${totalCount !== 1 ? "s" : ""}`
            : `${displayTotal.toLocaleString()} conversation${displayTotal !== 1 ? "s" : ""}`)}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1 [&>div>div]:!block">
        <div className="p-2 space-y-1">
          {deduped.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={conversation.id === selectedId}
              isBatchSelected={selectedIds?.has(conversation.id) ?? false}
              onToggleSelect={onToggleSelect}
              onClick={() => onSelect(conversation.id)}
              favoriteIds={favoriteIds}
            />
          ))}

          {/* Infinite scroll sentinel */}
          {hasNextPage && (
            <div ref={sentinelRef} className="py-3 flex justify-center" role="status" aria-label={isFetchingNextPage ? "Loading more conversations" : undefined}>
              {isFetchingNextPage && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: ConversationWithContact;
  isSelected: boolean;
  isBatchSelected: boolean;
  onToggleSelect?: (id: string) => void;
  onClick: () => void;
  favoriteIds?: Set<string>;
}

function ConversationItem({
  conversation,
  isSelected,
  isBatchSelected,
  onToggleSelect,
  onClick,
  favoriteIds,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const hasUnread = conversation.unread_count > 0;
  const isAiHandling = conversation.ai_enabled;
  const isSnoozed = conversation.status === "snoozed";
  const isFavorite = favoriteIds?.has(conversation.id) ?? false;

  const initials =
    contact?.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  // Smart snooze label
  const snoozeLabel = isSnoozed ? (() => {
    const st = conversation.snooze_type;
    if (st === 'until_reply') return 'Until reply';
    if (st === 'until_ooo_ends') {
      const rd = (conversation.snooze_context as { parsed_return_date?: string })?.parsed_return_date;
      if (rd) return `Until ${new Date(rd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      return 'Until OOO ends';
    }
    if (st === 'until_timezone_morning') return 'Until morning';
    return null;
  })() : null;

  const displayName = contact?.display_name || "Unknown contact";
  const subject = sanitizeGarbledText(conversation.last_message_subject);
  const preview = sanitizeGarbledText(stripHtmlToText(conversation.last_message_preview || "")) || "No messages yet";
  const lastMessageDate = conversation.last_message_at ? new Date(conversation.last_message_at) : null;
  const validMessageDate = lastMessageDate && !Number.isNaN(lastMessageDate.getTime()) ? lastMessageDate : null;

  return (
    <div
      className={cn(
        "group flex items-start rounded-xl border border-transparent transition-colors",
        isSelected ? "border-amber-500/30 bg-amber-500/10" : "hover:bg-muted/60",
        isBatchSelected && "border-amber-500/40 bg-amber-500/10",
        hasUnread && !isSelected && !isBatchSelected && "bg-muted/40"
      )}
    >
      {onToggleSelect && (
        <label
          className="ml-1 mt-2 flex h-9 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
          title={`Select conversation with ${displayName}`}
        >
          <Checkbox
            checked={isBatchSelected}
            onCheckedChange={() => onToggleSelect(conversation.id)}
            aria-label={`Select conversation with ${displayName}`}
            className="h-5 w-5 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500 data-[state=checked]:text-black"
          />
        </label>
      )}
      <button
        type="button"
        onClick={onClick}
        data-inbox-conversation={conversation.id}
        aria-current={isSelected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ContactAvatar
          contactId={contact?.id}
          avatarUrl={contact?.avatar_url}
          initials={initials}
          className="h-9 w-9 shrink-0"
          fallbackClassName="text-xs"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", hasUnread && "font-semibold")}>
              {displayName}
            </span>
            {isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" aria-label="Favorite" />}
            <span
              className="shrink-0 text-[11px] text-muted-foreground"
              title={validMessageDate?.toLocaleString()}
            >
              {validMessageDate ? formatDistanceToNowStrict(validMessageDate) : "New"}
            </span>
            {hasUnread && (
              <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white" aria-label={`${conversation.unread_count} unread messages`}>
                {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
              </span>
            )}
          </div>
          {subject && (
            <p className={cn("mt-1 truncate text-xs font-medium", hasUnread ? "text-foreground" : "text-foreground/80")}>
              {subject}
            </p>
          )}
          <p className={cn("mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground", hasUnread && "text-foreground/80")} style={{ overflowWrap: 'anywhere' }}>
            {conversation.last_message_direction === "outbound" && <span>You: </span>}
            {preview}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ChannelIndicator channel={conversation.channel} showLabel className="h-5 shrink-0 rounded-md px-1.5" />
            {conversation.lead_intent && conversation.lead_intent !== "neutral" && <IntentBadge intent={conversation.lead_intent} showIcon={false} />}
            {isAiHandling && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Bot className="h-3 w-3" aria-hidden="true" /> AI
              </span>
            )}
            {conversation.priority_score >= 30 && <PriorityBadge score={conversation.priority_score} />}
            {conversation.sla_status && conversation.sla_status !== "ok" && <SLABadge status={conversation.sla_status} />}
            {isSnoozed && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" /> {snoozeLabel || "Snoozed"}
              </span>
            )}
          </div>
          {(contact?.company || contact?.job_title) && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={contact.company || contact.job_title || undefined}>
              {contact.company || contact.job_title}
            </p>
          )}
        </div>
      </button>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex items-start gap-3 p-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}
