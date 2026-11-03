import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Mail,
  CheckCircle2,
  Flame,
  AlertCircle,
  Pause,
  PlugZap,
  Plus,
  ChevronDown,
  ChevronRight,
  Send,
  Trash2,
  Unplug,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useByoMailboxes, useDeprovisionByo } from "@/hooks/useByoServers";
import { AddByoMailboxDialog } from "./AddByoMailboxDialog";
import { BulkAddByoMailboxesDialog } from "./BulkAddByoMailboxesDialog";
import { TestSendByoDialog } from "./TestSendByoDialog";
import { Upload } from "lucide-react";
import { getDerivedMailboxStatus, type DerivedMailboxStatus } from "@/lib/mailbox-status";
import type { EmailMailbox, EmailSendingDomain } from "@/types/email";

const statusVariants: Record<DerivedMailboxStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  warming: { label: "Warming", className: "border-amber-500/30 text-amber-400 bg-amber-500/10", Icon: Flame },
  ready: { label: "Ready", className: "border-green-500/30 text-green-400 bg-green-500/10", Icon: CheckCircle2 },
  connection_issue: { label: "Connection issue", className: "border-orange-500/30 text-orange-400 bg-orange-500/10", Icon: Unplug },
  paused: { label: "Paused", className: "border-muted text-muted-foreground", Icon: Pause },
  burned: { label: "Burned", className: "border-destructive/30 text-destructive bg-destructive/10", Icon: AlertCircle },
  disconnected: { label: "Disconnected", className: "border-muted text-muted-foreground", Icon: PlugZap },
};

function MailboxStatusBadge({ mailbox }: { mailbox: EmailMailbox }) {
  const derived = getDerivedMailboxStatus(mailbox);
  const v = statusVariants[derived] || statusVariants.disconnected;
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-xs ${v.className}`}>
      <v.Icon className="w-3 h-3" />
      {v.label}
    </Badge>
  );
}

interface ByoMailboxListProps {
  domain: EmailSendingDomain;
}

export function ByoMailboxList({ domain }: ByoMailboxListProps) {
  const { data: mailboxes = [], isLoading } = useByoMailboxes(domain.id);
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);

  const stats = {
    total: mailboxes.length,
    warming: mailboxes.filter((m) => m.status === "warming").length,
    ready: mailboxes.filter((m) => m.status === "ready").length,
    burned: mailboxes.filter((m) => m.status === "burned").length,
    dailyCap: mailboxes.reduce((sum, m) => sum + (m.daily_limit || 0), 0),
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Mail className="w-3.5 h-3.5" />
          Mailboxes ({stats.total})
          {stats.total > 0 && (
            <span className="font-mono normal-case text-[10px] text-muted-foreground/70">
              · {stats.ready} ready · {stats.warming} warming · {stats.dailyCap}/day cap
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowBulkAdd(true)}>
            <Upload className="w-3 h-3 mr-1" />
            Bulk CSV
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
            <Plus className="w-3 h-3 mr-1" />
            Add mailbox
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="text-xs text-muted-foreground py-2 px-3">Loading...</div>
          ) : mailboxes.length === 0 ? (
            <div className="text-center py-4 rounded-md border border-dashed text-muted-foreground">
              <Mail className="w-6 h-6 mx-auto mb-1 opacity-50" />
              <p className="text-xs">No mailboxes on this domain yet.</p>
            </div>
          ) : (
            mailboxes.map((m) => <MailboxRow key={m.id} mailbox={m} />)
          )}
        </div>
      )}

      <AddByoMailboxDialog domain={domain} open={showAdd} onOpenChange={setShowAdd} />
      <BulkAddByoMailboxesDialog domain={domain} open={showBulkAdd} onOpenChange={setShowBulkAdd} />
    </div>
  );
}

function MailboxRow({ mailbox }: { mailbox: EmailMailbox }) {
  const { user } = useAuth();
  const [showTest, setShowTest] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [deleteMaildir, setDeleteMaildir] = useState(false);
  const deprovision = useDeprovisionByo();

  return (
    <div className="rounded-md border bg-card/30 px-3 py-2 flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{mailbox.email_address}</span>
          <MailboxStatusBadge mailbox={mailbox} />
          {mailbox.imap_connected && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 bg-blue-500/10">
              IMAP
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {mailbox.display_name && <>{mailbox.display_name} · </>}
          {mailbox.daily_sent}/{mailbox.daily_limit} today · bounce {(mailbox.bounce_rate * 100).toFixed(1)}%
        </div>
        {mailbox.last_error && <div className="text-xs text-destructive mt-0.5">{mailbox.last_error}</div>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowTest(true)}
          title="Send a real test email through this mailbox"
        >
          <Send className="w-3 h-3 mr-1" />
          Test
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setShowRemove(true)}
          title="Remove mailbox"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <TestSendByoDialog
        mailbox={mailbox}
        open={showTest}
        onOpenChange={setShowTest}
        defaultRecipient={user?.email ?? undefined}
      />

      <AlertDialog open={showRemove} onOpenChange={setShowRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {mailbox.email_address}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Removes the mailbox from Postfix (virtual maps), Dovecot (auth), and any sender-transport pin. The DB row is also deleted.
              </span>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteMaildir}
                  onChange={(e) => setDeleteMaildir(e.target.checked)}
                />
                Also delete the Maildir on the server (irreversible — wipes all stored mail).
              </label>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deprovision.mutate({
                  target_kind: "mailbox",
                  mailbox_id: mailbox.id,
                  delete_maildir: deleteMaildir,
                });
                setShowRemove(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
