import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, PenLine, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SignatureEditor } from "@/components/email/SignatureEditor";
import { useBulkUpdateMailboxes } from "@/hooks/useEmailMailboxes";
import { useGenerateSignatures } from "@/hooks/useEmailSendingDomains";
import type { EmailMailbox } from "@/types/email";

type SignatureMode = "create" | "generate";

interface BulkSignatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  selectedEmails: string[];
  selectedMailboxes?: EmailMailbox[];
}

export function BulkSignatureDialog({
  open,
  onOpenChange,
  selectedIds,
  selectedEmails,
  selectedMailboxes,
}: BulkSignatureDialogProps) {
  const [mode, setMode] = useState<SignatureMode | null>(null);
  const [signature, setSignature] = useState("");
  const bulkUpdate = useBulkUpdateMailboxes();

  // Generate mode state
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [signatureStyle, setSignatureStyle] = useState<"professional" | "modern" | "minimal">("professional");
  const generateSignatures = useGenerateSignatures();
  const [isApplyingGenerated, setIsApplyingGenerated] = useState(false);

  const handleApplyManual = () => {
    bulkUpdate.mutate(
      {
        ids: selectedIds,
        metadataUpdates: { signature: signature || null },
      },
      {
        onSuccess: () => {
          handleClose();
        },
      }
    );
  };

  const handleGenerate = async () => {
    // Build identities from mailbox data
    const identities = (selectedMailboxes || []).map((m) => {
      const displayName = m.display_name || m.email_address.split("@")[0];
      const parts = displayName.split(/[\s.]+/);
      return {
        first_name: parts[0] || displayName,
        last_name: parts.slice(1).join(" ") || "",
        job_title: (m.metadata as any)?.job_title || undefined,
        email: m.email_address,
        avatar_url: (m.metadata as any)?.avatar_url || undefined,
      };
    });

    if (identities.length === 0) return;

    const domain = selectedEmails[0]?.split("@")[1] || "";

    generateSignatures.mutate(
      {
        identities,
        domain,
        company_name: companyName || undefined,
        company_website: companyWebsite || undefined,
        style: signatureStyle,
      },
      {
        onSuccess: async (result) => {
          // Apply each generated signature to the corresponding mailbox
          setIsApplyingGenerated(true);
          try {
            const mailboxes = selectedMailboxes || [];
            for (const sig of result.signatures) {
              const mailbox = mailboxes[sig.index];
              if (mailbox && sig.signature_html) {
                await bulkUpdate.mutateAsync({
                  ids: [mailbox.id],
                  metadataUpdates: { signature: sig.signature_html },
                });
              }
            }
            handleClose();
          } finally {
            setIsApplyingGenerated(false);
          }
        },
      }
    );
  };

  const handleClose = () => {
    setMode(null);
    setSignature("");
    setCompanyName("");
    setCompanyWebsite("");
    setSignatureStyle("professional");
    onOpenChange(false);
  };

  const isGenerating = generateSignatures.isPending || isApplyingGenerated;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="w-4 h-4" />
            Bulk Edit Signature
          </DialogTitle>
          <DialogDescription>
            Apply signatures to {selectedIds.length} selected mailbox
            {selectedIds.length !== 1 ? "es" : ""}.
          </DialogDescription>
        </DialogHeader>

        {/* Mode selection */}
        {mode === null ? (
          <div className="grid grid-cols-2 gap-3 py-4">
            <button
              onClick={() => setMode("create")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-border hover:border-primary/50 hover:bg-muted/50 transition-all"
            >
              <PenLine className="w-8 h-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Create Manually</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Paste or write a signature applied to all selected mailboxes
                </p>
              </div>
            </button>
            <button
              onClick={() => setMode("generate")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-border hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
            >
              <Sparkles className="w-8 h-8 text-amber-500" />
              <div className="text-center">
                <p className="text-sm font-medium">Generate with AI</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-generate unique signatures for each mailbox
                </p>
              </div>
            </button>
          </div>
        ) : mode === "create" ? (
          <div className="space-y-4">
            {/* Affected mailboxes */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Applies to
              </p>
              <ScrollArea className="max-h-[80px]">
                <div className="flex flex-wrap gap-1.5">
                  {selectedEmails.map((email) => (
                    <span
                      key={email}
                      className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                    >
                      {email}
                    </span>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Signature editor */}
            <SignatureEditor
              value={signature}
              onChange={setSignature}
              hint="Paste HTML from your email client or type plain text. Leave empty to clear all signatures."
            />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Generate mode */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Generating for {selectedIds.length} mailbox{selectedIds.length !== 1 ? "es" : ""}
              </p>
              <ScrollArea className="max-h-[60px]">
                <div className="flex flex-wrap gap-1.5">
                  {selectedEmails.map((email) => (
                    <span
                      key={email}
                      className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                    >
                      {email}
                    </span>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Company Name</Label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Company Website</Label>
                <Input
                  value={companyWebsite}
                  onChange={(e) => setCompanyWebsite(e.target.value)}
                  placeholder="https://acme.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Style</Label>
              <Select value={signatureStyle} onValueChange={(v: any) => setSignatureStyle(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="modern">Modern</SelectItem>
                  <SelectItem value="minimal">Minimal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!selectedMailboxes?.length && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Mailbox data is required to generate per-mailbox signatures. Names will be derived from display names or email addresses.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {mode !== null && (
            <Button variant="ghost" onClick={() => setMode(null)} className="mr-auto">
              Back
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {mode === "create" && (
            <Button variant="cta" onClick={handleApplyManual} disabled={bulkUpdate.isPending}>
              {bulkUpdate.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Apply to {selectedIds.length} Mailbox
              {selectedIds.length !== 1 ? "es" : ""}
            </Button>
          )}
          {mode === "generate" && (
            <Button
              variant="cta"
              onClick={handleGenerate}
              disabled={isGenerating || !selectedMailboxes?.length}
            >
              {isGenerating && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              <Sparkles className="w-4 h-4 mr-1.5" />
              Generate & Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
