import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Send, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useTestSendByoMailbox } from "@/hooks/useByoServers";
import type { EmailMailbox } from "@/types/email";

interface TestSendByoDialogProps {
  mailbox: EmailMailbox;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default recipient — usually the logged-in user's email */
  defaultRecipient?: string;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function TestSendByoDialog({ mailbox, open, onOpenChange, defaultRecipient }: TestSendByoDialogProps) {
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [result, setResult] = useState<{ ok: boolean; error?: string; messageId?: string } | null>(null);
  const send = useTestSendByoMailbox();

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setResult(null);
        setRecipient(defaultRecipient ?? "");
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open, defaultRecipient]);

  const valid = EMAIL_RE.test(recipient.trim());

  const submit = async () => {
    if (!valid) return;
    try {
      const r = await send.mutateAsync({ mailbox_id: mailbox.id, recipient: recipient.trim() });
      setResult({ ok: r.success, error: r.error, messageId: r.message_id });
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Send failed" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Test send from {mailbox.email_address}
          </DialogTitle>
          <DialogDescription>
            Sends a single email through the same code path the sequence processor uses. Validates SASL auth,
            relay, DKIM signing, TLS, and outbound port 25 — end to end.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="byo-test-recipient">Recipient</Label>
            <Input
              id="byo-test-recipient"
              placeholder="you@example.com"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Use your own inbox. Inspect the <code className="font-mono">Received:</code> headers when it arrives — the outbound IP and HELO must match what you configured.
            </p>
          </div>

          {result?.ok && (
            <Alert className="border-green-500/30 bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle>Sent</AlertTitle>
              <AlertDescription>
                Message ID: <code className="font-mono text-xs break-all">{result.messageId}</code>
                <br />
                If it doesn't arrive in 1-2 minutes, check the recipient's spam folder.
              </AlertDescription>
            </Alert>
          )}

          {result && !result.ok && (
            <Alert className="border-destructive/40 bg-destructive/5">
              <XCircle className="h-4 w-4 text-destructive" />
              <AlertTitle>Failed</AlertTitle>
              <AlertDescription className="space-y-1">
                <div className="text-xs font-mono break-words">{result.error || "Unknown error"}</div>
                <p className="text-xs">Common causes: SASL auth (re-provision the mailbox), TLS cert (run Install TLS on the server), port 25 blocked (check provider).</p>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="cta" onClick={submit} disabled={!valid || send.isPending}>
            {send.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Sending...</> : "Send test email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
