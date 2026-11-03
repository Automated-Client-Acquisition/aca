import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Mail,
  Send,
  Loader2,
  User,
  Check,
  ChevronsUpDown,
  UserPlus,
} from "lucide-react";
import { useContacts } from "@/hooks/crm/useContacts";
import { useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { useCreateConversation, type ConversationChannel } from "@/hooks/crm/useConversations";
import { useSendMessage } from "@/hooks/crm/useMessages";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated?: (conversationId: string) => void;
}

/**
 * The picker holds the picked contact by value, not by id looked up in the
 * current result page. The result page is a *server-side search* that changes
 * with every keystroke, so an id-only selection would silently resolve to
 * `undefined` the moment the query moves on — which is exactly how the
 * recipient "failed to add".
 */
interface PickedContact {
  id: string;
  display_name: string;
  primary_email: string | null;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onConversationCreated,
}: NewConversationDialogProps) {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  // Form state
  const [channel, setChannel] = useState<ConversationChannel>("email");
  const [selectedContact, setSelectedContact] = useState<PickedContact | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingContact, setIsCreatingContact] = useState(false);

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const searchTrim = contactSearch.trim();
  const searchIsEmail = EMAIL_REGEX.test(searchTrim);

  // Data
  // Search server-side. Previously this fetched an unfiltered first page (50
  // contacts by last_activity_at) and let cmdk filter it client-side, so any
  // contact outside that page was unfindable — on an org with 100k+ contacts
  // that is effectively "search never finds an existing contact".
  const { data: contactsData, isFetching: contactsFetching } = useContacts(
    { search: searchTrim || undefined, pageSize: 25 },
    { enabled: contactPickerOpen }
  );
  const contacts = contactsData?.data;
  // Only a *first* load for the current search term is a spinner; background
  // refetches keep the existing list on screen.
  const isSearching = contactsFetching && !contacts?.length;
  const { data: mailboxes } = useEmailMailboxes();

  const readyMailboxes = useMemo(
    () => mailboxes?.filter((m) => m.status === "ready") || [],
    [mailboxes]
  );

  const recipientEmail = selectedContact?.primary_email?.trim() || "";

  const handleContactSelect = (contact: PickedContact) => {
    setSelectedContact({
      id: contact.id,
      display_name: contact.display_name,
      primary_email: contact.primary_email,
    });
    setContactPickerOpen(false);
    setContactSearch("");
  };

  // An exact email match already in the results — don't offer to create a
  // duplicate of a contact the user can just click.
  const exactEmailMatch = useMemo(
    () =>
      searchIsEmail
        ? contacts?.find(
            (c) => c.primary_email?.trim().toLowerCase() === searchTrim.toLowerCase()
          )
        : undefined,
    [contacts, searchIsEmail, searchTrim]
  );
  const showUseEmailOption = searchIsEmail && !exactEmailMatch && !isSearching;

  /**
   * Resolve a typed email to a contact: reuse the existing one if there is a
   * row for it, otherwise create it. A blind insert used to hit the
   * (organization_id, lower(primary_email)) unique index and surface as
   * "duplicate key value violates unique constraint" — the recipient just
   * never got added.
   */
  const handleUseEmail = async () => {
    if (!searchIsEmail || !currentOrganization?.id) return;
    setIsCreatingContact(true);
    const emailLc = searchTrim.toLowerCase();
    const orgId = currentOrganization.id;

    const findExisting = async (): Promise<PickedContact | null> => {
      // Only used to resolve a duplicate after a 23505 on insert — never as a
      // pre-check, because proving non-existence scans on a 2M-row org and
      // times out (57014). The unique index makes the INSERT itself the fast
      // existence check.
      try {
        // @ts-ignore
        const { data, error } = await supabase.rpc("find_crm_contact_by_email", {
          p_org_id: orgId,
          p_email: emailLc,
        });
        if (!error && data?.length) {
          return (data as unknown as PickedContact[])[0];
        }
      } catch {
        // ignore and fall through
      }

      // Exact match, not ilike: ilike can't use the lower(primary_email) btree
      // and falls back to the cross-org trigram index (~3s, times out under
      // load). The RPC above is the case-insensitive lookup; this is only its
      // fast fallback when that call fails.
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("id, display_name, primary_email")
        .eq("organization_id", orgId)
        .eq("primary_email", emailLc)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as PickedContact | null;
    };

    try {
      // INSERT-first: for a genuinely new email this succeeds without any
      // scan. Only on a 23505 duplicate do we look up the existing row.
      const { data, error } = await supabase
        .from("crm_contacts")
        .insert({
          organization_id: orgId,
          display_name: emailLc.split("@")[0],
          primary_email: emailLc,
          source: "manual_inbox",
        })
        .select("id, display_name, primary_email")
        .single();

      if (!error) {
        await queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
        handleContactSelect(data as PickedContact);
        toast.success(`Contact ${emailLc} created`);
        return;
      }

      // Duplicate — another row already has this email. Resolve it.
      if (error.code === "23505") {
        const raced = await findExisting();
        if (raced) {
          handleContactSelect(raced);
          toast.success(`Using existing contact ${raced.primary_email}`);
          return;
        }
      }
      throw error;
    } catch (error) {
      console.error("[NewConversationDialog] handleUseEmail failed", error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as any).message)
            : "Failed to add recipient";
      toast.error(message);
    } finally {
      setIsCreatingContact(false);
    }
  };

  const canSend =
    selectedContact &&
    body.trim() &&
    (channel !== "email" || (recipientEmail && selectedMailboxId));

  const handleSend = async () => {
    if (!canSend || !user || !selectedContact) return;
    setIsSending(true);

    try {
      // Get org ID
      const { data: userData } = await supabase
        .from("users")
        .select("organization_id, active_organization_id")
        .eq("id", user.id)
        .single();
      const orgId = userData?.active_organization_id || userData?.organization_id;
      if (!orgId) throw new Error("No organization found");

      // Create conversation — use 7-arg overload to include mailbox_id and
      // disambiguate from the legacy 6-arg overload (PGRST203).
      const { data: convId, error: convError } = await supabase.rpc(
        "get_or_create_conversation",
        {
          p_org_id: orgId,
          p_contact_id: selectedContact.id,
          p_channel: channel,
          p_channel_account_id: null,
          p_external_conversation_id: null,
          p_external_participant_id: channel === "email" ? recipientEmail : null,
          p_mailbox_id: channel === "email" ? selectedMailboxId : null,
        } as never
      );

      if (convError) throw convError;

      // Get session for auth
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No valid session");

      // Send the message via edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-send-message`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            conversation_id: convId,
            contact_id: selectedContact.id,
            channel,
            recipient_external_id: recipientEmail,
            recipient_display_name: selectedContact.display_name,
            content: body.trim(),
            content_type: "text",
            email_subject: channel === "email" ? subject.trim() || undefined : undefined,
          }),
        }
      );

      const rawBody = await response.text();
      let result: { success?: boolean; error?: string; [k: string]: unknown } = {};
      try {
        result = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        // non-JSON body — fall through to raw snippet below
      }
      if (!response.ok || !result.success) {
        const detail =
          result.error ||
          (rawBody && rawBody.length < 500 ? rawBody : null) ||
          `HTTP ${response.status}`;
        console.error("[NewConversationDialog] send failed", {
          status: response.status,
          body: rawBody,
        });
        throw new Error(`Send failed: ${detail}`);
      }

      toast.success("Message sent");
      onConversationCreated?.(convId as string);
      handleReset();
      onOpenChange(false);
    } catch (error) {
      console.error("[NewConversationDialog] handleSend error", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to send message"
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleReset = () => {
    setChannel("email");
    setSelectedContact(null);
    setSelectedMailboxId(null);
    setSubject("");
    setBody("");
    setContactSearch("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleReset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[520px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>New Conversation</DialogTitle>
          <DialogDescription>
            Start a new conversation with a contact
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2">
          {/* Channel */}
          <div className="space-y-2">
            <Label htmlFor="new-conversation-channel">Channel</Label>
            <Select
              value={channel}
              onValueChange={(v) => setChannel(v as ConversationChannel)}
            >
              <SelectTrigger id="new-conversation-channel" aria-label="Channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">
                  <span className="flex items-center gap-2">
                    <Mail className="h-4 w-4" /> Email
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Contact Picker */}
          <div className="space-y-2">
            <Label htmlFor="new-conversation-recipient">Recipient</Label>
            <Popover open={contactPickerOpen} onOpenChange={setContactPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  id="new-conversation-recipient"
                  role="combobox"
                  aria-label="Recipient"
                  aria-expanded={contactPickerOpen}
                  className="w-full justify-between font-normal"
                >
                  {selectedContact ? (
                    <span className="flex items-center gap-2 truncate">
                      <User className="h-4 w-4 flex-shrink-0" />
                      {selectedContact.display_name}
                      {selectedContact.primary_email && (
                        <span className="text-muted-foreground text-xs">
                          ({selectedContact.primary_email})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Select a contact...
                    </span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[460px] max-w-[calc(100vw-2rem)] p-0" align="start">
                {/* shouldFilter={false}: the search runs server-side against the
                    whole org, so cmdk must not re-filter (and hide) results
                    that matched on company or job title. */}
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search contacts or type an email..."
                    value={contactSearch}
                    onValueChange={setContactSearch}
                  />
                  <CommandList>
                    {isSearching && (
                      <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching contacts...
                      </div>
                    )}

                    {!isSearching && (
                      <CommandEmpty>
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No contacts found. Type a full email address to start a
                          conversation with someone new.
                        </div>
                      </CommandEmpty>
                    )}

                    {showUseEmailOption && (
                      <CommandGroup>
                        <CommandItem
                          value={`__use_email__${searchTrim}`}
                          disabled={isCreatingContact}
                          onSelect={handleUseEmail}
                        >
                          {isCreatingContact ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <UserPlus className="mr-2 h-4 w-4" />
                          )}
                          <span className="text-sm">
                            Send to{" "}
                            <span className="text-muted-foreground">
                              &lt;{searchTrim}&gt;
                            </span>
                          </span>
                        </CommandItem>
                      </CommandGroup>
                    )}

                    {!!contacts?.length && (
                      <CommandGroup>
                        {contacts.map((contact) => {
                          // An email conversation needs an address to send to —
                          // picking an address-less contact used to silently
                          // leave Send disabled with no explanation.
                          const noEmail =
                            channel === "email" && !contact.primary_email?.trim();
                          return (
                            <CommandItem
                              key={contact.id}
                              value={contact.id}
                              disabled={noEmail}
                              onSelect={() => handleContactSelect(contact)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4 flex-shrink-0",
                                  selectedContact?.id === contact.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm truncate">
                                  {contact.display_name}
                                </span>
                                {contact.primary_email ? (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {contact.primary_email}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">
                                    No email address
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}

                    {!isSearching &&
                      !!contactsData &&
                      contactsData.total > (contacts?.length ?? 0) && (
                        <div className="px-3 py-2 text-xs text-muted-foreground border-t">
                          Showing {contacts?.length ?? 0} of {contactsData.total}{" "}
                          matches — keep typing to narrow it down.
                        </div>
                      )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Email-specific fields */}
          {channel === "email" && (
            <>
              {/* Mailbox selector */}
              <div className="space-y-2">
                <Label htmlFor="new-conversation-mailbox">Send from</Label>
                <Select
                  value={selectedMailboxId || ""}
                  onValueChange={setSelectedMailboxId}
                >
                  <SelectTrigger id="new-conversation-mailbox" aria-label="Send from">
                    <SelectValue placeholder="Select a mailbox..." />
                  </SelectTrigger>
                  <SelectContent>
                    {readyMailboxes.map((mb) => (
                      <SelectItem key={mb.id} value={mb.id} textValue={mb.display_name || mb.email_address}>
                        <span className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5" />
                          {mb.display_name || mb.email_address}
                          {mb.display_name && (
                            <span className="text-muted-foreground text-xs">
                              &lt;{mb.email_address}&gt;
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label htmlFor="new-conversation-subject">Subject</Label>
                <Input
                  id="new-conversation-subject"
                placeholder="Email subject..."
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="new-conversation-message">Message</Label>
            <Textarea
              id="new-conversation-message"
              placeholder="Write your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleSend}
            disabled={!canSend || isSending}
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
