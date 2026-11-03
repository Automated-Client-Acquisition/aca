import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, Loader2, Upload, FileDown, Mail } from "lucide-react";
import { useProvisionByoMailbox } from "@/hooks/useByoServers";
import type { EmailSendingDomain } from "@/types/email";

interface BulkAddByoMailboxesDialogProps {
  domain: EmailSendingDomain;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned?: (mailboxIds: string[]) => void;
}

interface ParsedRow {
  username: string;
  display_name: string;
  daily_limit: number;
}

interface RowResult {
  username: string;
  display_name: string;
  daily_limit: number;
  status: "ok" | "error" | "skipped";
  job_id?: string;
  mailbox_id?: string;
  error?: string;
}

const TEMPLATE_CSV = `username,display_name,daily_limit
cedric,Cedric Seguela,5
sarah,Sarah Lin,5
mike,Mike Chen,5
`;

export function BulkAddByoMailboxesDialog({
  domain,
  open,
  onOpenChange,
  onProvisioned,
}: BulkAddByoMailboxesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);
  const [progress, setProgress] = useState(0);

  const provision = useProvisionByoMailbox();

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setRows([]);
        setParseErrors([]);
        setRunning(false);
        setResults([]);
        setProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleFile = (file: File) => {
    setParseErrors([]);
    setResults([]);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const errors: string[] = [];
        const valid: ParsedRow[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < parsed.data.length; i++) {
          const row = parsed.data[i];
          const username = (row.username ?? row.email ?? "").trim().toLowerCase();
          const displayName = (row.display_name ?? row.name ?? row.full_name ?? "").trim();
          const limitRaw = (row.daily_limit ?? row.limit ?? "").toString().trim();
          const limit = parseInt(limitRaw, 10);
          const lineNo = i + 2;

          if (!username) {
            errors.push(`Line ${lineNo}: missing username`);
            continue;
          }
          if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(username)) {
            errors.push(`Line ${lineNo}: invalid username "${username}" (lowercase alnum + . _ -)`);
            continue;
          }
          if (!displayName) {
            errors.push(`Line ${lineNo}: missing display_name for "${username}"`);
            continue;
          }
          if (seen.has(username)) {
            errors.push(`Line ${lineNo}: duplicate username "${username}"`);
            continue;
          }
          seen.add(username);
          const dailyLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 5;
          valid.push({ username, display_name: displayName, daily_limit: dailyLimit });
        }

        setRows(valid);
        if (errors.length > 0) setParseErrors(errors.slice(0, 20));
      },
      error: (err) => {
        setParseErrors([`CSV parse failed: ${err.message}`]);
        setRows([]);
      },
    });
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `byo-mailboxes-template-${domain.domain}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadFailedCsv = () => {
    const failed = results.filter((r) => r.status === "error");
    if (failed.length === 0) return;
    const lines = ["username,display_name,daily_limit,error"];
    for (const r of failed) {
      const safeErr = (r.error ?? "").replace(/"/g, '""').replace(/\n/g, " ");
      lines.push(`${r.username},"${r.display_name}",${r.daily_limit},"${safeErr}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `byo-mailboxes-failed-${domain.domain}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRun = async () => {
    if (rows.length === 0) return;
    setRunning(true);
    setResults([]);
    const out: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const r = await provision.mutateAsync({
          domain_id: domain.id,
          username: row.username,
          display_name: row.display_name,
          daily_limit: row.daily_limit,
        });
        out.push({
          username: row.username,
          display_name: row.display_name,
          daily_limit: row.daily_limit,
          status: "ok",
          job_id: r.job_id,
          mailbox_id: r.mailbox_id,
        });
      } catch (e) {
        out.push({
          username: row.username,
          display_name: row.display_name,
          daily_limit: row.daily_limit,
          status: "error",
          error: e instanceof Error ? e.message : "unknown",
        });
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
      setResults([...out]);
    }
    setRunning(false);
    if (onProvisioned) {
      onProvisioned(out.filter((r) => r.status === "ok").map((r) => r.mailbox_id!).filter(Boolean));
    }
  };

  const okCount = results.filter((r) => r.status === "ok").length;
  const failCount = results.filter((r) => r.status === "error").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Bulk add mailboxes via CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV with <code className="font-mono">username</code>, <code className="font-mono">display_name</code>,{" "}
            <code className="font-mono">daily_limit</code> columns. Each row provisions one mailbox at{" "}
            <code className="font-mono">@{domain.domain}</code>.
          </DialogDescription>
        </DialogHeader>

        {results.length === 0 && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={running}>
                <Upload className="w-4 h-4 mr-1" /> Choose CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <FileDown className="w-4 h-4 mr-1" /> Download template
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>

            {parseErrors.length > 0 && (
              <Alert className="border-destructive/40 bg-destructive/5">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{parseErrors.length} row{parseErrors.length === 1 ? "" : "s"} skipped</AlertTitle>
                <AlertDescription>
                  <ul className="text-xs space-y-0.5 mt-1 max-h-40 overflow-y-auto font-mono">
                    {parseErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {rows.length > 0 && (
              <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                <div className="text-sm font-medium">{rows.length} valid row{rows.length === 1 ? "" : "s"}</div>
                <div className="text-xs text-muted-foreground max-h-48 overflow-y-auto font-mono">
                  {rows.slice(0, 12).map((r, i) => (
                    <div key={i}>
                      {r.username}@{domain.domain} — {r.display_name} — limit {r.daily_limit}
                    </div>
                  ))}
                  {rows.length > 12 && <div className="opacity-60">… and {rows.length - 12} more.</div>}
                </div>
              </div>
            )}

            {!domain.dkim_verified && (
              <Alert className="border-amber-500/40 bg-amber-500/5">
                <AlertTitle>DNS not fully verified</AlertTitle>
                <AlertDescription>
                  SPF or DKIM hasn't propagated for <code className="font-mono">{domain.domain}</code> yet.
                  You can still provision mailboxes, but warmup deliverability will be poor until DNS lands.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-3 py-2">
            {running && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Provisioning {results.length} of {rows.length}...</span>
                </div>
                <Progress value={progress} />
              </>
            )}

            <Alert className={failCount > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}>
              {failCount > 0 ? <AlertCircle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
              <AlertTitle>
                {okCount} succeeded{failCount > 0 ? `, ${failCount} failed` : ""}
              </AlertTitle>
              <AlertDescription>
                <div className="text-xs mt-1">
                  Each successful row triggered an async provision job. Watch the mailbox list to see them go live.
                </div>
              </AlertDescription>
            </Alert>

            <div className="border rounded-md max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">Mailbox</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono">{r.username}@{domain.domain}</td>
                      <td className="p-2">
                        {r.status === "ok" && <span className="text-green-600">queued</span>}
                        {r.status === "error" && <span className="text-destructive">error</span>}
                      </td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground">
                        {r.status === "ok" ? r.job_id?.slice(0, 8) : r.error}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {failCount > 0 && (
              <Button variant="outline" size="sm" onClick={downloadFailedCsv}>
                <FileDown className="w-4 h-4 mr-1" /> Download failed rows CSV
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          {results.length === 0 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
                Cancel
              </Button>
              <Button
                variant="cta"
                onClick={handleRun}
                disabled={rows.length === 0 || running}
              >
                {running ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Running...</> : `Provision ${rows.length} mailbox${rows.length === 1 ? "" : "es"}`}
              </Button>
            </>
          )}
          {results.length > 0 && (
            <Button variant="cta" onClick={() => onOpenChange(false)} disabled={running}>
              {running ? "Hide (still running)" : "Close"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
