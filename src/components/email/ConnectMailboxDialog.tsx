import { useState, useCallback, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
// Collapsible removed — IMAP fields are now always visible and required
import {
  Loader2,
  Key,
  Download,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Mail,
  Upload,
  Server,
  Zap,
  FileSpreadsheet,
  Shield,
  Building2,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useTestSMTPConnection,
  useTestIMAPConnection,
  useAddSMTPMailbox,
  useImportCSVMailboxes,
} from "@/hooks/useEmailMailboxes";
import {
  useZapMailApiKeys,
  useListWorkspaces,
  useImportFromStoredKey,
} from "@/hooks/useZapMailApiKeys";
import { useNavigate } from "react-router-dom";

// ============================================================================
// Types
// ============================================================================

type DialogStep = "provider" | "smtp" | "zapmail" | "zapmail-workspaces" | "csv" | "result";

interface ResultData {
  imported: number;
  verified?: number;
  failed?: number;
  unverified?: number;
  verifying?: boolean;
  skipped: number;
  mailboxes?: Array<{ email: string; status: string; verified?: boolean; error?: string }>;
  errors?: string[];
  source: "smtp" | "zapmail" | "csv";
}

interface ConnectMailboxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Provider Card Component
// ============================================================================

function ProviderCard({
  icon,
  label,
  description,
  disabled,
  comingSoon,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  disabled?: boolean;
  comingSoon?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all text-center",
        disabled
          ? "opacity-50 cursor-not-allowed border-border bg-muted/20"
          : "border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
      )}
    >
      {comingSoon && (
        <Badge
          variant="outline"
          className="absolute top-2 right-2 text-[9px] bg-muted text-muted-foreground"
        >
          Coming soon
        </Badge>
      )}
      {badge && !comingSoon && (
        <Badge
          variant="outline"
          className="absolute top-2 right-2 text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20"
        >
          {badge}
        </Badge>
      )}
      <div className="w-10 h-10 flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ConnectMailboxDialog({
  open,
  onOpenChange,
}: ConnectMailboxDialogProps) {
  const [step, setStep] = useState<DialogStep>("provider");
  const [result, setResult] = useState<ResultData | null>(null);

  // SMTP form state
  const [smtpForm, setSmtpForm] = useState({
    from_name: "",
    from_email: "",
    smtp_host: "",
    smtp_port: "587",
    smtp_username: "",
    smtp_password: "",
    imap_host: "",
    imap_port: "993",
    imap_username: "",
    imap_password: "",
  });
  const [smtpTested, setSmtpTested] = useState(false);
  const [imapTested, setImapTested] = useState(false);

  // ZapMail state
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [zapWorkspaces, setZapWorkspaces] = useState<Array<{ id: string; name: string; domainCount: string; mailboxCount: string }>>([]);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(new Set());
  const [isImportingWorkspaces, setIsImportingWorkspaces] = useState(false);

  // CSV state
  const [csvData, setCsvData] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mutations
  const testSmtp = useTestSMTPConnection();
  const testImap = useTestIMAPConnection();
  const addSmtp = useAddSMTPMailbox();
  const importCsv = useImportCSVMailboxes();
  const { data: storedKeys } = useZapMailApiKeys();
  const listWorkspaces = useListWorkspaces();
  const importFromKey = useImportFromStoredKey();
  const navigate = useNavigate();

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("provider");
      setResult(null);
      setSmtpForm({
        from_name: "",
        from_email: "",
        smtp_host: "",
        smtp_port: "587",
        smtp_username: "",
        smtp_password: "",
        imap_host: "",
        imap_port: "993",
        imap_username: "",
        imap_password: "",
      });
      setSmtpTested(false);
      setImapTested(false);
      setSelectedKeyId(null);
      setZapWorkspaces([]);
      setSelectedWorkspaceIds(new Set());
      setIsImportingWorkspaces(false);
      setCsvData("");
      testSmtp.reset();
      testImap.reset();
      addSmtp.reset();
      importCsv.reset();
      listWorkspaces.reset();
    }, 200);
  }, [onOpenChange]);

  const goBack = () => {
    setStep("provider");
    setSmtpTested(false);
    setImapTested(false);
    testSmtp.reset();
    testImap.reset();
  };

  // ── SMTP handlers ──────────────────────────────────────────────────

  const updateSmtpField = (field: string, value: string) => {
    setSmtpForm((prev) => ({ ...prev, [field]: value }));
    if (field.startsWith("smtp_")) setSmtpTested(false);
    if (field.startsWith("imap_")) setImapTested(false);
  };

  const handleTestSmtp = () => {
    testSmtp.mutate(
      {
        smtp_host: smtpForm.smtp_host,
        smtp_port: parseInt(smtpForm.smtp_port, 10) || 587,
        smtp_username: smtpForm.smtp_username,
        smtp_password: smtpForm.smtp_password,
      },
      {
        onSuccess: () => setSmtpTested(true),
      }
    );
  };

  const handleTestImap = () => {
    testImap.mutate(
      {
        imap_host: smtpForm.imap_host,
        imap_port: parseInt(smtpForm.imap_port, 10) || 993,
        imap_username: smtpForm.imap_username || smtpForm.smtp_username,
        imap_password: smtpForm.imap_password || smtpForm.smtp_password,
      },
      {
        onSuccess: () => setImapTested(true),
      }
    );
  };

  const handleAddSmtp = () => {
    addSmtp.mutate(
      {
        from_name: smtpForm.from_name,
        from_email: smtpForm.from_email,
        smtp_host: smtpForm.smtp_host,
        smtp_port: parseInt(smtpForm.smtp_port, 10) || 587,
        smtp_username: smtpForm.smtp_username,
        smtp_password: smtpForm.smtp_password,
        imap_host: smtpForm.imap_host,
        imap_port: parseInt(smtpForm.imap_port, 10) || 993,
        imap_username: smtpForm.imap_username || smtpForm.smtp_username,
        imap_password: smtpForm.imap_password || smtpForm.smtp_password,
      },
      {
        onSuccess: (data) => {
          setResult({
            imported: 1,
            skipped: 0,
            mailboxes: [{ email: data.mailbox.email, status: data.mailbox.status }],
            source: "smtp",
          });
          setStep("result");
        },
      }
    );
  };

  const smtpReady =
    smtpForm.from_email.includes("@") &&
    smtpForm.smtp_host &&
    smtpForm.smtp_username &&
    smtpForm.smtp_password;

  const imapReady = !!smtpForm.imap_host;

  const allReady = smtpReady && imapReady;

  // ── ZapMail handlers ───────────────────────────────────────────────

  const hasStoredKeys = storedKeys && storedKeys.length > 0;

  const handleFetchWorkspaces = async () => {
    if (!selectedKeyId) return;
    try {
      const workspaces = await listWorkspaces.mutateAsync({ key_id: selectedKeyId });

      if (workspaces.length <= 1) {
        // Single or no workspace — import directly
        importFromKey.mutate(
          { key_id: selectedKeyId, workspace_id: workspaces[0]?.id, workspace_name: workspaces[0]?.name },
          {
            onSuccess: (data) => {
              setResult({
                imported: data.imported,
                skipped: data.skipped,
                mailboxes: data.mailboxes,
                errors: data.errors,
                source: "zapmail",
              });
              setStep("result");
            },
          }
        );
      } else {
        // Multiple workspaces — show picker
        setZapWorkspaces(workspaces);
        setSelectedWorkspaceIds(new Set(workspaces.map((w) => w.id)));
        setStep("zapmail-workspaces");
      }
    } catch {
      // Error toast handled by mutation hook
    }
  };

  const toggleWorkspace = (id: string) => {
    const next = new Set(selectedWorkspaceIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedWorkspaceIds(next);
  };

  const handleImportSelectedWorkspaces = async () => {
    if (!selectedKeyId || selectedWorkspaceIds.size === 0) return;

    setIsImportingWorkspaces(true);
    let totalImported = 0;
    let totalSkipped = 0;
    const allMailboxes: Array<{ email: string; status: string }> = [];
    const allErrors: string[] = [];

    try {
      for (const wsId of selectedWorkspaceIds) {
        const wsName = zapWorkspaces.find((w) => w.id === wsId)?.name;
        const data = await importFromKey.mutateAsync({
          key_id: selectedKeyId,
          workspace_id: wsId,
          workspace_name: wsName,
        });
        totalImported += data.imported;
        totalSkipped += data.skipped;
        if (data.mailboxes) allMailboxes.push(...data.mailboxes);
        if (data.errors) allErrors.push(...data.errors);
      }
      setResult({
        imported: totalImported,
        skipped: totalSkipped,
        mailboxes: allMailboxes,
        errors: allErrors.length > 0 ? allErrors : undefined,
        source: "zapmail",
      });
      setStep("result");
    } catch {
      // Error toast handled by mutation hook
    } finally {
      setIsImportingWorkspaces(false);
    }
  };

  const handleGoToSettings = () => {
    handleClose();
    navigate("/settings?tab=integrations");
  };

  // ── CSV handlers ───────────────────────────────────────────────────

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvData((ev.target?.result as string) || "");
    };
    reader.readAsText(file);
  };

  const handleImportCsv = () => {
    if (!csvData.trim()) return;
    importCsv.mutate(
      { csv_data: csvData },
      {
        onSuccess: (data) => {
          setResult({
            imported: data.imported,
            verified: data.verified,
            failed: data.failed,
            unverified: data.unverified,
            verifying: data.verifying,
            skipped: data.skipped,
            mailboxes: data.mailboxes,
            errors: data.errors,
            source: "csv",
          });
          setStep("result");
        },
      }
    );
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[640px]">
        {/* ── Step: Provider Selection ─────────────────────── */}
        {step === "provider" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Connect Mailbox
              </DialogTitle>
              <DialogDescription>
                Choose how you want to connect your email mailboxes.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-5">
              <div>
                <p className="text-sm font-medium mb-3">Choose your provider:</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <ProviderCard
                    icon={
                      <div className="w-8 h-8 rounded-md bg-red-500/10 flex items-center justify-center text-red-600 font-bold text-sm border border-red-500/20">
                        G
                      </div>
                    }
                    label="Google"
                    description="Gmail / Workspace"
                    disabled
                    comingSoon
                  />
                  <ProviderCard
                    icon={
                      <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-600 font-bold text-sm border border-blue-500/20">
                        O
                      </div>
                    }
                    label="Outlook"
                    description="Microsoft 365"
                    disabled
                    comingSoon
                  />
                  <ProviderCard
                    icon={<Server className="h-6 w-6 text-muted-foreground" />}
                    label="SMTP"
                    description="Any provider"
                    onClick={() => setStep("smtp")}
                  />
                  <ProviderCard
                    icon={<Zap className="h-6 w-6 text-amber-500" />}
                    label="ZapMail"
                    description="API key import"
                    onClick={() => setStep("zapmail")}
                  />
                  <ProviderCard
                    icon={<Server className="h-6 w-6 text-blue-500" />}
                    label="Azure Infrastructure"
                    description="Dedicated servers with DNS, warmup & IP rotation"
                    badge="Self-hosted"
                    onClick={() => {
                      handleClose();
                      navigate("/settings?tab=email-infra");
                    }}
                  />
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium mb-2">Bulk Email Addition</p>
                <button
                  onClick={() => setStep("csv")}
                  className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-dashed hover:border-primary/50 hover:bg-primary/5 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">Import from CSV</p>
                    <p className="text-xs text-muted-foreground">
                      Bulk add mailboxes with SMTP credentials
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step: SMTP Form ─────────────────────────────── */}
        {step === "smtp" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                SMTP / IMAP Connection
              </DialogTitle>
              <DialogDescription>
                Enter your email provider's SMTP credentials to connect this
                mailbox.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="from_name">Display Name</Label>
                  <Input
                    id="from_name"
                    placeholder="John Doe"
                    value={smtpForm.from_name}
                    onChange={(e) => updateSmtpField("from_name", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="from_email">Email Address *</Label>
                  <Input
                    id="from_email"
                    type="email"
                    placeholder="john@company.com"
                    value={smtpForm.from_email}
                    onChange={(e) => updateSmtpField("from_email", e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              {/* SMTP Settings */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                SMTP Settings
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="smtp_host">SMTP Host *</Label>
                  <Input
                    id="smtp_host"
                    placeholder="smtp.gmail.com"
                    value={smtpForm.smtp_host}
                    onChange={(e) => updateSmtpField("smtp_host", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_port">Port *</Label>
                  <Input
                    id="smtp_port"
                    type="number"
                    placeholder="587"
                    value={smtpForm.smtp_port}
                    onChange={(e) => updateSmtpField("smtp_port", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_username">Username *</Label>
                  <Input
                    id="smtp_username"
                    placeholder="john@company.com"
                    value={smtpForm.smtp_username}
                    onChange={(e) =>
                      updateSmtpField("smtp_username", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_password">Password *</Label>
                  <Input
                    id="smtp_password"
                    type="password"
                    placeholder="App password"
                    value={smtpForm.smtp_password}
                    onChange={(e) =>
                      updateSmtpField("smtp_password", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Test result */}
              {testSmtp.isSuccess && smtpTested && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-xs text-green-700 dark:text-green-400">
                    SMTP connection successful
                  </p>
                </div>
              )}
              {testSmtp.isError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-xs text-red-600">
                    {testSmtp.error?.message || "Connection failed"}
                  </p>
                </div>
              )}

              <Separator />

              {/* IMAP Settings (Required) */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                IMAP Settings (Required for replies)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="imap_host">IMAP Host *</Label>
                  <Input
                    id="imap_host"
                    placeholder="imap.gmail.com"
                    value={smtpForm.imap_host}
                    onChange={(e) =>
                      updateSmtpField("imap_host", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="imap_port">Port *</Label>
                  <Input
                    id="imap_port"
                    type="number"
                    placeholder="993"
                    value={smtpForm.imap_port}
                    onChange={(e) =>
                      updateSmtpField("imap_port", e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="imap_username">
                    Username{" "}
                    <span className="text-muted-foreground font-normal">
                      (if different from SMTP)
                    </span>
                  </Label>
                  <Input
                    id="imap_username"
                    placeholder="Same as SMTP"
                    value={smtpForm.imap_username}
                    onChange={(e) =>
                      updateSmtpField("imap_username", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="imap_password">
                    Password{" "}
                    <span className="text-muted-foreground font-normal">
                      (if different from SMTP)
                    </span>
                  </Label>
                  <Input
                    id="imap_password"
                    type="password"
                    placeholder="Same as SMTP"
                    value={smtpForm.imap_password}
                    onChange={(e) =>
                      updateSmtpField("imap_password", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* IMAP test result */}
              {testImap.isSuccess && imapTested && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-xs text-green-700 dark:text-green-400">
                    IMAP connection successful
                  </p>
                </div>
              )}
              {testImap.isError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-xs text-red-600">
                    {testImap.error?.message || "IMAP connection failed"}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={goBack} className="sm:mr-auto">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back
              </Button>
              <Button
                variant="outline"
                onClick={handleTestSmtp}
                disabled={!smtpReady || testSmtp.isPending}
              >
                {testSmtp.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4 mr-1.5" />
                )}
                Test SMTP
              </Button>
              <Button
                variant="outline"
                onClick={handleTestImap}
                disabled={!imapReady || testImap.isPending}
              >
                {testImap.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4 mr-1.5" />
                )}
                Test IMAP
              </Button>
              <Button
                variant="cta"
                onClick={handleAddSmtp}
                disabled={!allReady || !smtpTested || !imapTested || addSmtp.isPending}
              >
                {addSmtp.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-1.5" />
                )}
                Add Mailbox
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: ZapMail — Key Selection ──────────────── */}
        {step === "zapmail" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                Import from ZapMail
              </DialogTitle>
              <DialogDescription>
                {hasStoredKeys
                  ? "Select your ZapMail API key to import mailboxes."
                  : "Add your ZapMail API key in Settings > Integrations first, then return here to import."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {hasStoredKeys ? (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Select an API key
                  </Label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {storedKeys!.map((key) => (
                      <label
                        key={key.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          selectedKeyId === key.id
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50",
                          !key.is_valid && "opacity-50"
                        )}
                      >
                        <input
                          type="radio"
                          name="zapmail-key"
                          className="sr-only"
                          checked={selectedKeyId === key.id}
                          onChange={() => setSelectedKeyId(key.id)}
                          disabled={!key.is_valid}
                        />
                        <div
                          className={cn(
                            "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                            selectedKeyId === key.id
                              ? "border-primary"
                              : "border-muted-foreground/40"
                          )}
                        >
                          {selectedKeyId === key.id && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{key.name}</p>
                            {!key.is_valid && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-red-500/10 text-red-500 border-red-500/20"
                              >
                                Invalid
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">
                            {key.key_hint}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 space-y-3">
                  <Key className="h-8 w-8 text-muted-foreground mx-auto" />
                  <div>
                    <p className="text-sm font-medium">No API key configured</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add your ZapMail API key in Settings &gt; Integrations to get started.
                    </p>
                  </div>
                  <Button variant="outline" onClick={handleGoToSettings}>
                    <Settings2 className="h-4 w-4 mr-1.5" />
                    Go to Settings
                  </Button>
                </div>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={goBack} className="sm:mr-auto">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back
              </Button>
              {hasStoredKeys && (
                <Button
                  variant="cta"
                  onClick={handleFetchWorkspaces}
                  disabled={!selectedKeyId || listWorkspaces.isPending || importFromKey.isPending}
                >
                  {listWorkspaces.isPending || importFromKey.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {listWorkspaces.isPending ? "Loading workspaces..." : "Importing..."}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Next
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* ── Step: ZapMail — Workspace Selection ──────────── */}
        {step === "zapmail-workspaces" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Select Workspaces
              </DialogTitle>
              <DialogDescription>
                Choose which ZapMail workspaces to import mailboxes from.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {zapWorkspaces.map((ws) => (
                  <label
                    key={ws.id}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedWorkspaceIds.has(ws.id)}
                      onCheckedChange={() => toggleWorkspace(ws.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ws.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ws.domainCount} domain{ws.domainCount !== "1" ? "s" : ""},{" "}
                        {ws.mailboxCount} mailbox{ws.mailboxCount !== "1" ? "es" : ""}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              {selectedWorkspaceIds.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedWorkspaceIds.size} of {zapWorkspaces.length} workspace
                  {zapWorkspaces.length !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("zapmail");
                  setZapWorkspaces([]);
                  setSelectedWorkspaceIds(new Set());
                }}
                className="sm:mr-auto"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back
              </Button>
              <Button
                variant="cta"
                onClick={handleImportSelectedWorkspaces}
                disabled={selectedWorkspaceIds.size === 0 || isImportingWorkspaces}
              >
                {isImportingWorkspaces ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Import from {selectedWorkspaceIds.size} workspace
                    {selectedWorkspaceIds.size !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: CSV Import ────────────────────────────── */}
        {step === "csv" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Bulk CSV Import
              </DialogTitle>
              <DialogDescription>
                Upload a CSV file with your mailbox SMTP credentials. Uses the
                Smartlead CSV format.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* File upload zone */}
              <div
                className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    Drag & Drop CSV file here
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Upload from your system,{" "}
                    <span className="text-primary">choose file</span>
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>

              {/* Or paste */}
              <div className="space-y-1.5">
                <Label htmlFor="csv-paste">Or paste CSV data:</Label>
                <textarea
                  id="csv-paste"
                  className="w-full h-24 rounded-md border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="from_name,from_email,user_name,password,smtp_host,smtp_port,imap_host,imap_port,max_email_per_day,warmup_enabled..."
                  value={csvData}
                  onChange={(e) => setCsvData(e.target.value)}
                />
              </div>

              {csvData && (
                <p className="text-xs text-muted-foreground">
                  {csvData.split("\n").filter(Boolean).length - 1} row(s)
                  detected
                </p>
              )}

              {/* Expected format + sample download */}
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium">Required columns:</p>
                  <a
                    href="/sample-mailboxes.csv"
                    download="sample-mailboxes.csv"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Download className="h-3 w-3" />
                    Download sample CSV
                  </a>
                </div>
                <p className="font-mono">
                  from_email, smtp_host, smtp_port, user_name, password,
                  imap_host, imap_port, imap_password
                </p>
                <p className="font-medium mt-1.5">Optional columns:</p>
                <p className="font-mono">
                  from_name, imap_user_name, max_email_per_day,
                  warmup_enabled, signature
                </p>
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={goBack} className="sm:mr-auto">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back
              </Button>
              <Button
                variant="cta"
                onClick={handleImportCsv}
                disabled={!csvData.trim() || importCsv.isPending}
              >
                {importCsv.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import Mailboxes
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Result Summary ────────────────────────── */}
        {step === "result" && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                {result.source === "smtp"
                  ? "Mailbox Connected"
                  : "Import Complete"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {(() => {
                const hasFailures = (result.failed ?? 0) > 0;
                return (
                  <div
                    className={
                      hasFailures
                        ? "flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20"
                        : "flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20"
                    }
                  >
                    {hasFailures ? (
                      <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    )}
                    <div>
                      <p
                        className={
                          hasFailures
                            ? "text-sm font-medium text-amber-700 dark:text-amber-400"
                            : "text-sm font-medium text-green-700 dark:text-green-400"
                        }
                      >
                        {result.source === "smtp"
                          ? "SMTP mailbox added successfully"
                          : `${result.imported} mailbox${result.imported !== 1 ? "es" : ""} imported`}
                      </p>
                      {result.source === "csv" && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {result.verifying
                            ? "Verifying each connection in the background — statuses will update in the Mailboxes list shortly."
                            : [
                                (result.verified ?? 0) > 0 && `${result.verified} verified`,
                                (result.failed ?? 0) > 0 && `${result.failed} failed connection test`,
                                (result.unverified ?? 0) > 0 && `${result.unverified} not yet tested`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </p>
                      )}
                      {result.skipped > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {result.skipped} skipped (already connected)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {result.mailboxes && result.mailboxes.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {result.mailboxes.map(
                    (mb: { email: string; status: string; verified?: boolean; error?: string }, i: number) => {
                      const isReady = mb.status === "ready";
                      const isFailed = mb.status === "disconnected";
                      const badgeClass = isReady
                        ? "bg-green-500/10 text-green-600 border-green-500/20 text-[10px]"
                        : isFailed
                          ? "bg-red-500/10 text-red-600 border-red-500/20 text-[10px]"
                          : "bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]";
                      const label = isReady
                        ? "ready"
                        : isFailed
                          ? "failed"
                          : result.verifying
                            ? "verifying…"
                            : "needs test";
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 p-2 rounded border text-sm"
                        >
                          <div className="min-w-0">
                            <span className="truncate block">{mb.email}</span>
                            {isFailed && mb.error && (
                              <span className="text-[10px] text-red-500 truncate block">
                                {mb.error}
                              </span>
                            )}
                          </div>
                          <Badge variant="outline" className={badgeClass}>
                            {label}
                          </Badge>
                        </div>
                      );
                    }
                  )}
                </div>
              )}

              {result.errors && result.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <p className="text-xs font-medium text-red-600">
                      {result.errors.length} error
                      {result.errors.length > 1 ? "s" : ""}
                    </p>
                  </div>
                  {result.errors.map((err: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="cta" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
