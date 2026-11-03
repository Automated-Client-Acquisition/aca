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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Upload,
  AlertCircle,
} from "lucide-react";
import { useBulkConnectM365Tenants } from "@/hooks/useM365Tenants";

interface ParsedTenant {
  onmicrosoft_domain: string;
  display_name?: string;
  admin_email?: string;
  admin_password?: string;
}

interface ImportResult {
  domain: string;
  success: boolean;
  display_name?: string;
  error?: string;
}

function parseTenantList(raw: string): ParsedTenant[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      // Supported formats:
      // contoso.onmicrosoft.com
      // contoso.onmicrosoft.com, Display Name
      // contoso.onmicrosoft.com, Display Name, admin@contoso.com
      // contoso.onmicrosoft.com, Display Name, admin@contoso.com, password
      const parts = line.split(",").map((p) => p.trim());
      const raw_domain = parts[0] || "";
      const domain = raw_domain.toLowerCase().includes("onmicrosoft")
        ? raw_domain.toLowerCase()
        : `${raw_domain.toLowerCase()}.onmicrosoft.com`;

      return {
        onmicrosoft_domain: domain,
        display_name: parts[1] || undefined,
        admin_email: parts[2] || undefined,
        admin_password: parts[3] || undefined,
      };
    })
    .filter((t) => t.onmicrosoft_domain.length > 4);
}

interface BulkImportTenantsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkImportTenantsDialog({ open, onOpenChange }: BulkImportTenantsDialogProps) {
  const [raw, setRaw] = useState("");
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const bulkConnect = useBulkConnectM365Tenants();
  const parsed = parseTenantList(raw);

  const handleImport = async () => {
    if (parsed.length === 0) return;
    setResults(null);
    try {
      const data = await bulkConnect.mutateAsync(parsed);
      setResults(data.results);
    } catch {
      // error handled by mutation
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setRaw("");
      setResults(null);
      bulkConnect.reset();
    }
    onOpenChange(isOpen);
  };

  const connected = results?.filter((r) => r.success).length ?? 0;
  const failed = results?.filter((r) => !r.success).length ?? 0;
  const missingPassword = parsed.filter((t) => !t.admin_password).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Bulk Import M365 Tenants
          </DialogTitle>
          <DialogDescription>
            One tenant per line. Include admin email and password for mailbox provisioning.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Textarea
                placeholder={`contoso.onmicrosoft.com, Contoso, admin@contoso.onmicrosoft.com, Passw0rd!\nfabrikam.onmicrosoft.com, Fabrikam, admin@fabrikam.onmicrosoft.com, Passw0rd!`}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                className="h-40 font-mono text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Format: <code className="bg-muted px-1 rounded">domain, Display Name, admin@email, password</code>
              </p>
            </div>

            {parsed.length > 0 && (
              <Alert variant={missingPassword > 0 ? "destructive" : "default"}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>{parsed.length}</strong> tenant{parsed.length !== 1 ? "s" : ""} ready to import.
                  {missingPassword > 0 && (
                    <p className="mt-1 text-xs">
                      ⚠ {missingPassword} tenant{missingPassword !== 1 ? "s are" : " is"} missing admin password — mailbox creation will fail for those tenants.
                    </p>
                  )}
                  <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                    {parsed.map((t, i) => (
                      <div key={i} className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                        {t.onmicrosoft_domain}{t.display_name ? ` · ${t.display_name}` : ""}
                        {!t.admin_password && <span className="text-destructive">· no password</span>}
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                variant="cta"
                onClick={handleImport}
                disabled={parsed.length === 0 || bulkConnect.isPending}
              >
                {bulkConnect.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting {parsed.length} tenant{parsed.length !== 1 ? "s" : ""}...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import {parsed.length} Tenant{parsed.length !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {connected > 0 && (
                <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {connected} connected
                </Badge>
              )}
              {failed > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="w-3.5 h-3.5" />
                  {failed} failed
                </Badge>
              )}
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 rounded-md border p-2.5 text-sm ${
                    r.success
                      ? "border-green-500/20 bg-green-500/5"
                      : "border-destructive/20 bg-destructive/5"
                  }`}
                >
                  {r.success ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">{r.domain}</div>
                    {r.success && r.display_name && (
                      <div className="text-xs text-muted-foreground mt-0.5">{r.display_name}</div>
                    )}
                    {!r.success && r.error && (
                      <div className="text-xs text-destructive mt-0.5">{r.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              {failed > 0 && (
                <Button variant="outline" onClick={() => { setResults(null); bulkConnect.reset(); }}>
                  Retry Failed
                </Button>
              )}
              <Button variant="cta" onClick={() => handleClose(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
