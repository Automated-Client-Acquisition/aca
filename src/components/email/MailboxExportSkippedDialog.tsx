import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Copy } from "lucide-react";
import type { MailboxExportSkipped } from "@/hooks/useEmailMailboxes";

interface MailboxExportSkippedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skipped: MailboxExportSkipped[];
}

const REASON_COPY: Record<MailboxExportSkipped["reason"], string> = {
  missing_credentials:
    "No SMTP credentials stored — reconnect this mailbox to fix",
  decryption_failed:
    "Stored credentials couldn't be decrypted — reconnect this mailbox to fix",
};

export function MailboxExportSkippedDialog({
  open,
  onOpenChange,
  skipped,
}: MailboxExportSkippedDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(skipped.map((s) => s.email).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Mailboxes skipped from export</DialogTitle>
          <DialogDescription>
            {skipped.length} mailbox{skipped.length === 1 ? "" : "es"} couldn't
            be exported. Reconnect them to restore SMTP credentials.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[360px]">
          <div className="space-y-1.5 pr-3">
            {skipped.map((item) => (
              <div
                key={item.email}
                className="rounded border px-3 py-2 text-sm"
              >
                <div className="font-medium font-mono text-xs break-all">
                  {item.email}
                </div>
                <div className="text-muted-foreground text-xs mt-1">
                  {REASON_COPY[item.reason]}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCopy}
            disabled={skipped.length === 0}
          >
            {copied ? (
              <Check className="w-4 h-4 mr-1" />
            ) : (
              <Copy className="w-4 h-4 mr-1" />
            )}
            Copy emails
          </Button>
          <Button variant="cta" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
