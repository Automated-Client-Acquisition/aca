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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check, Download } from "lucide-react";
import type { EmailSendingDomain } from "@/types/email";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface CredentialExportDialogProps {
  domain: EmailSendingDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MailboxCredential {
  email: string;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  from_email: string;
}

export function CredentialExportDialog({ domain, open, onOpenChange }: CredentialExportDialogProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const { currentOrganization } = useAuth();

  const { data: mailboxes } = useQuery({
    queryKey: ["email-mailboxes", currentOrganization?.id, domain.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("email_mailboxes")
        .select("email_address, display_name, metadata")
        .eq("organization_id", currentOrganization.id)
        .eq("sending_domain_id", domain.id)
        .eq("connection_type", "acs");
      if (error) throw error;
      return data;
    },
    enabled: open && !!currentOrganization,
  });

  const credentials: MailboxCredential[] = (mailboxes || []).map((mb) => ({
    email: mb.email_address,
    display_name: mb.display_name || mb.email_address,
    smtp_host: "smtp.azurecomm.net",
    smtp_port: 587,
    smtp_username: domain.acs_smtp_username || "",
    from_email: mb.email_address,
  }));

  const handleCopyAll = () => {
    const lines = credentials.map((c) =>
      `${c.smtp_host}\t${c.smtp_port}\t${c.smtp_username}\t${c.from_email}\t${c.display_name}`
    );
    navigator.clipboard.writeText(
      "SMTP Host\tPort\tUsername\tFrom Email\tDisplay Name\n" + lines.join("\n")
    );
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleDownloadCsv = () => {
    const header = "SMTP Host,Port,Username,From Email,Display Name";
    const rows = credentials.map((c) =>
      `${c.smtp_host},${c.smtp_port},"${c.smtp_username}","${c.from_email}","${c.display_name}"`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${domain.domain}-smtp-credentials.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export SMTP Credentials</DialogTitle>
          <DialogDescription>
            SMTP credentials for {domain.domain}. Import these into Instantly, Smartlead, or other tools.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">SMTP Host</span>
            <span className="font-mono">smtp.azurecomm.net</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Port</span>
            <span className="font-mono">587 (STARTTLS)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Username</span>
            <span className="font-mono text-xs break-all">{domain.acs_smtp_username || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Password</span>
            <Badge variant="secondary">Stored encrypted</Badge>
          </div>
        </div>

        <ScrollArea className="max-h-[300px]">
          <div className="space-y-1">
            {credentials.map((cred) => (
              <div key={cred.email} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{cred.display_name}</span>
                  <span className="text-muted-foreground ml-2">{cred.from_email}</span>
                </div>
              </div>
            ))}
            {credentials.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No sender addresses created yet.
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleCopyAll} disabled={credentials.length === 0}>
            {copiedAll ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            Copy All
          </Button>
          <Button variant="cta" onClick={handleDownloadCsv} disabled={credentials.length === 0}>
            <Download className="w-4 h-4 mr-1" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
