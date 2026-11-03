import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignatureEditor } from "@/components/email/SignatureEditor";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Send,
  Flame,
  Database,
  ShieldCheck,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Mail,
  XCircle,
  RefreshCw,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateMailbox, useRetestConnection, useUpdateMailboxTags } from "@/hooks/useEmailMailboxes";
import { MailboxTagSelector } from "@/components/email/MailboxTagSelector";
import type { EmailMailbox } from "@/types/email";

interface MailboxEditSheetProps {
  mailbox: EmailMailbox | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  // Column fields
  display_name: string;
  first_name: string;
  last_name: string;
  daily_limit: number;
  // Metadata fields
  min_time_gap_minutes: number;
  reply_to_address: string;
  signature: string;
  bcc_crm_address: string;
}

function getInitialState(mailbox: EmailMailbox | null): FormState {
  const meta = mailbox?.metadata || {};
  return {
    display_name: mailbox?.display_name || "",
    first_name: mailbox?.first_name || "",
    last_name: mailbox?.last_name || "",
    daily_limit: mailbox?.daily_limit ?? 30,
    min_time_gap_minutes: (meta.min_time_gap_minutes as number) ?? 3,
    reply_to_address: (meta.reply_to_address as string) ?? "",
    signature: (meta.signature as string) ?? "",
    bcc_crm_address: (meta.bcc_crm_address as string) ?? "",
  };
}

export function MailboxEditSheet({
  mailbox,
  open,
  onOpenChange,
}: MailboxEditSheetProps) {
  const [form, setForm] = useState<FormState>(() => getInitialState(mailbox));
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tags: true,
    smtp: true,
    connection: false,
    warmup: false,
    crm: false,
    unblock: false,
  });
  const updateMailbox = useUpdateMailbox();
  const retestConnection = useRetestConnection();
  const updateTags = useUpdateMailboxTags();

  useEffect(() => {
    if (open && mailbox) {
      setForm(getInitialState(mailbox));
    }
  }, [open, mailbox]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    if (!mailbox) return;

    const columnUpdates: Record<string, unknown> = {
      display_name: form.display_name || null,
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      daily_limit: form.daily_limit,
    };

    const metadataUpdates: Record<string, unknown> = {
      min_time_gap_minutes: form.min_time_gap_minutes,
      reply_to_address: form.reply_to_address || null,
      signature: form.signature || null,
      bcc_crm_address: form.bcc_crm_address || null,
    };

    updateMailbox.mutate(
      { id: mailbox.id, columnUpdates, metadataUpdates },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-lg">
            {mailbox?.email_address || "Mailbox Settings"}
          </SheetTitle>
          <SheetDescription>
            Configure sending and tracking settings
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-1">
            {/* ── Tags ── */}
            <Collapsible
              open={openSections.tags}
              onOpenChange={() => toggleSection("tags")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-3 text-sm font-medium hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground" />
                  Tags
                  {mailbox?.tags && mailbox.tags.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {mailbox.tags.length}
                    </Badge>
                  )}
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    openSections.tags && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pb-4">
                <p className="text-xs text-muted-foreground">
                  Organize mailboxes with tags for easier filtering and selection in sequences.
                </p>
                <MailboxTagSelector
                  tags={mailbox?.tags || []}
                  onChange={(tags) => {
                    if (mailbox) {
                      updateTags.mutate({ id: mailbox.id, tags });
                    }
                  }}
                />
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* ── SMTP Settings ── */}
            <Collapsible
              open={openSections.smtp}
              onOpenChange={() => toggleSection("smtp")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-3 text-sm font-medium hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-muted-foreground" />
                  SMTP Settings
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    openSections.smtp && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pb-4">
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={form.display_name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, display_name: e.target.value }))
                    }
                    placeholder="John Doe"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input
                      value={form.first_name}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, first_name: e.target.value }))
                      }
                      placeholder="John"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input
                      value={form.last_name}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, last_name: e.target.value }))
                      }
                      placeholder="Doe"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Messages Per Day</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={form.daily_limit}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        daily_limit: parseInt(e.target.value) || 1,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Minimum Time Gap (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={form.min_time_gap_minutes}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        min_time_gap_minutes: parseInt(e.target.value) || 1,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reply-to Address</Label>
                  <Input
                    type="email"
                    value={form.reply_to_address}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        reply_to_address: e.target.value,
                      }))
                    }
                    placeholder="Set a different reply-to address"
                  />
                </div>
                <SignatureEditor
                  value={form.signature}
                  onChange={(val) =>
                    setForm((p) => ({ ...p, signature: val }))
                  }
                />
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* ── Connection Status ── */}
            <Collapsible
              open={openSections.connection}
              onOpenChange={() => toggleSection("connection")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-3 text-sm font-medium hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  Connection Status
                  {mailbox && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        mailbox.imap_connected
                          ? "text-green-600 border-green-600/30"
                          : "text-red-500 border-red-500/30"
                      )}
                    >
                      {mailbox.imap_connected ? "Connected" : "Issue Detected"}
                    </Badge>
                  )}
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    openSections.connection && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pb-4">
                {mailbox?.connection_type === "zapmail" && !mailbox?.metadata?.smtp_credentials ? (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 space-y-2">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      SMTP/IMAP credentials required
                    </p>
                    <p className="text-xs text-muted-foreground">
                      This mailbox was imported from ZapMail, which handles domain provisioning only. To send and receive emails, you need to re-add this mailbox via SMTP with your email provider's SMTP and IMAP credentials.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Verify that this mailbox can send and receive emails.
                    </p>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retestConnection.isPending}
                        onClick={() => mailbox && retestConnection.mutate(mailbox.id)}
                      >
                        {retestConnection.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        Test Connection
                      </Button>
                      {retestConnection.isSuccess && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          All good
                        </span>
                      )}
                      {retestConnection.isError && (
                        <span className="flex items-center gap-1 text-xs text-red-500">
                          <XCircle className="w-3.5 h-3.5" />
                          {retestConnection.error?.message || "Failed"}
                        </span>
                      )}
                    </div>
                    {!mailbox?.imap_connected && !retestConnection.isPending && (
                      <p className="text-xs text-amber-600">
                        There may be a connection issue with this mailbox. Click "Test Connection" to diagnose.
                      </p>
                    )}
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* ── BCC to CRM ── */}
            <Collapsible
              open={openSections.crm}
              onOpenChange={() => toggleSection("crm")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-3 text-sm font-medium hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-muted-foreground" />
                  BCC to CRM Settings
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    openSections.crm && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pb-4">
                <div className="space-y-2">
                  <Label>BCC Email Address</Label>
                  <Input
                    type="email"
                    value={form.bcc_crm_address}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        bcc_crm_address: e.target.value,
                      }))
                    }
                    placeholder="Forward all emails to your CRM"
                  />
                  <p className="text-xs text-muted-foreground">
                    All emails sent through this account will be BCC'd to this
                    address
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* ── Warmup Settings (Coming Soon) ── */}
            <Collapsible
              open={openSections.warmup}
              onOpenChange={() => toggleSection("warmup")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-3 text-sm font-medium hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-muted-foreground" />
                  Warmup Settings
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30 px-1.5 py-0">
                    Coming Soon
                  </Badge>
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    openSections.warmup && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pb-4">
                <p className="text-xs text-muted-foreground">
                  Built-in email warmup is coming soon. In the meantime, we recommend warming up your mailboxes with Mailflow (free for up to 100 mailboxes).
                </p>
                <a
                  href="https://www.mailflow.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  Visit Mailflow
                  <CheckCircle2 className="h-3 w-3" />
                </a>
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* ── Unblock Code ── */}
            <Collapsible
              open={openSections.unblock}
              onOpenChange={() => toggleSection("unblock")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-3 text-sm font-medium hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                  Generate Unblock Code
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    openSections.unblock && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pb-4">
                <p className="text-xs text-muted-foreground">
                  If your mailbox configuration is correct and active, click
                  Unblock to receive a code at{" "}
                  <span className="font-medium text-foreground">
                    {mailbox?.email_address}
                  </span>
                </p>
                <Button variant="outline" disabled>
                  Generate Unblock Code
                </Button>
                {/* TODO: Implement unblock code backend */}
              </CollapsibleContent>
            </Collapsible>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleSave} disabled={updateMailbox.isPending}>
            {updateMailbox.isPending && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Save Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
