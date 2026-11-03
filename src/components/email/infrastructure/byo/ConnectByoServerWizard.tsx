import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Server,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateByoServer,
  useValidateByoServer,
  useByoJob,
  type ConnectByoServerResult,
} from "@/hooks/useByoServers";
import type { ByoProviderHint } from "@/types/email";
import { DeployLogViewer } from "./DeployLogViewer";
import { HostingRecommendations } from "./HostingRecommendations";

interface ProviderOption {
  value: ByoProviderHint;
  label: string;
  port25: "ok" | "blocked" | "request";
  notes: string;
}

const PROVIDERS: ProviderOption[] = [
  { value: "hetzner", label: "Hetzner", port25: "ok", notes: "Port 25 open by default. Recommended." },
  { value: "ovh", label: "OVH", port25: "ok", notes: "Port 25 open by default. Recommended." },
  { value: "ionos", label: "IONOS", port25: "ok", notes: "Port 25 open by default." },
  { value: "contabo", label: "Contabo", port25: "ok", notes: "Port 25 open by default." },
  { value: "vultr", label: "Vultr", port25: "request", notes: "Must request port 25 unblock from support." },
  { value: "linode", label: "Linode (Akamai)", port25: "request", notes: "Must request port 25 unblock from support." },
  { value: "digitalocean", label: "DigitalOcean", port25: "blocked", notes: "Blocks port 25 for new accounts." },
  { value: "aws", label: "AWS EC2", port25: "blocked", notes: "Blocks port 25 by default. Hard to unblock." },
  { value: "gcp", label: "Google Cloud", port25: "blocked", notes: "Permanently blocks port 25 outbound." },
  { value: "azure", label: "Azure", port25: "blocked", notes: "Blocks port 25 outside enterprise agreements." },
  { value: "other", label: "Other", port25: "request", notes: "Confirm with your provider that port 25 is open before continuing." },
];

type Step = "provider" | "details" | "install_key" | "validating" | "done";

interface ConnectByoServerWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (serverId: string) => void;
}

export function ConnectByoServerWizard({ open, onOpenChange, onConnected }: ConnectByoServerWizardProps) {
  const [step, setStep] = useState<Step>("provider");
  const [provider, setProvider] = useState<ByoProviderHint | "">("");
  const [providerAcknowledged, setProviderAcknowledged] = useState(false);

  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("root");

  const [created, setCreated] = useState<ConnectByoServerResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const createMutation = useCreateByoServer();
  const validateMutation = useValidateByoServer();
  const { data: job } = useByoJob(jobId);

  const selectedProvider = useMemo(() => PROVIDERS.find((p) => p.value === provider), [provider]);
  const port25Status = selectedProvider?.port25;

  const reset = () => {
    setStep("provider");
    setProvider("");
    setProviderAcknowledged(false);
    setName("");
    setHostname("");
    setSshPort("22");
    setSshUsername("root");
    setCreated(null);
    setCopied(null);
    setJobId(null);
  };

  useEffect(() => {
    if (!open) {
      // Defer reset so closing animation runs cleanly.
      const t = setTimeout(reset, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Watch the validation job and advance UI state when terminal.
  useEffect(() => {
    if (!job) return;
    if (job.status === "succeeded" && step === "validating") {
      setStep("done");
    }
  }, [job, step]);

  const handleClose = (next: boolean) => {
    onOpenChange(next);
  };

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 2000);
  };

  const goToStep2 = () => {
    if (!provider) return;
    if ((port25Status === "blocked" || port25Status === "request") && !providerAcknowledged) return;
    setStep("details");
  };

  const handleCreate = async () => {
    const port = parseInt(sshPort, 10);
    if (!name.trim() || !hostname.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error("Fill in name, hostname, and a valid SSH port.");
      return;
    }
    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        hostname: hostname.trim(),
        ssh_port: port,
        ssh_username: sshUsername.trim() || "root",
        provider_hint: (provider || undefined) as ByoProviderHint | undefined,
      });
      setCreated(result);
      setStep("install_key");
    } catch {
      // toast already shown by hook
    }
  };

  const handleValidate = async () => {
    if (!created) return;
    try {
      const result = await validateMutation.mutateAsync(created.server.id);
      setJobId(result.job_id);
      setStep("validating");
    } catch {
      // toast already shown
    }
  };

  const handleFinish = () => {
    if (created && onConnected) onConnected(created.server.id);
    handleClose(false);
  };

  const stepNumber: Record<Step, number> = {
    provider: 1,
    details: 2,
    install_key: 2,
    validating: 3,
    done: 3,
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Connect a server
            <span className="ml-2 text-xs font-normal text-muted-foreground">Step {stepNumber[step]} of 3</span>
          </DialogTitle>
          <DialogDescription>
            {step === "provider" && "Confirm your server provider supports outbound port 25."}
            {step === "details" && "Tell us about the server you want to connect."}
            {step === "install_key" && "Install our deploy key on your server, then run validation."}
            {step === "validating" && "Validating SSH access, sudo, and outbound port 25..."}
            {step === "done" && "Server connected. Mail stack deployment ships in the next phase."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* STEP 1 — Provider check */}
          {step === "provider" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Where is this server hosted?</Label>
                <Select value={provider || undefined} onValueChange={(v) => { setProvider(v as ByoProviderHint); setProviderAcknowledged(false); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <div className="flex items-center gap-2">
                          {p.port25 === "ok" ? (
                            <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                          ) : p.port25 === "blocked" ? (
                            <ShieldAlert className="w-3.5 h-3.5 text-destructive" />
                          ) : (
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                          )}
                          {p.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedProvider && port25Status === "ok" && (
                <Alert className="border-green-500/30 bg-green-500/5">
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                  <AlertTitle>Port 25 should be open</AlertTitle>
                  <AlertDescription>{selectedProvider.notes}</AlertDescription>
                </Alert>
              )}

              {selectedProvider && (port25Status === "blocked" || port25Status === "request") && (
                <Alert className={port25Status === "blocked" ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}>
                  <ShieldAlert className={`h-4 w-4 ${port25Status === "blocked" ? "text-destructive" : "text-amber-500"}`} />
                  <AlertTitle>{port25Status === "blocked" ? "Port 25 is blocked on this provider" : "Port 25 may need to be unblocked"}</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <div>{selectedProvider.notes}</div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={providerAcknowledged}
                        onChange={(e) => setProviderAcknowledged(e.target.checked)}
                      />
                      I've confirmed port 25 outbound is open on this server.
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              <div className="border-t pt-4 mt-4">
                <HostingRecommendations />
              </div>
            </div>
          )}

          {/* STEP 2a — Server details */}
          {step === "details" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="byo-name">Display name</Label>
                  <Input
                    id="byo-name"
                    placeholder="hetzner-fra1-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">A label for this server in your dashboard.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="byo-hostname">Hostname or IP</Label>
                  <Input
                    id="byo-hostname"
                    placeholder="mail.example.com or 1.2.3.4"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value.trim())}
                  />
                  <p className="text-xs text-muted-foreground">
                    Public FQDN preferred — used as HELO hostname later. Must resolve from the public internet.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="byo-port">SSH port</Label>
                    <Input
                      id="byo-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={sshPort}
                      onChange={(e) => setSshPort(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="byo-user">SSH user</Label>
                    <Input
                      id="byo-user"
                      placeholder="root"
                      value={sshUsername}
                      onChange={(e) => setSshUsername(e.target.value.trim())}
                    />
                    <p className="text-xs text-muted-foreground">Non-root users need passwordless sudo.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2b — Install key */}
          {step === "install_key" && created && (
            <div className="space-y-4">
              <Alert>
                <KeyRound className="h-4 w-4" />
                <AlertTitle>Add this key to your server</AlertTitle>
                <AlertDescription>
                  Paste the command below as <code className="font-mono">{created.server.ssh_username}</code> on{" "}
                  <code className="font-mono">{created.server.hostname}</code>. We will SSH in as that user when you click validate.
                </AlertDescription>
              </Alert>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">One-line install command</Label>
                <div className="flex items-start gap-2">
                  <code className="flex-1 rounded-md border bg-muted/50 p-3 text-xs font-mono break-all">
                    {created.install_command}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => copy("install", created.install_command)}
                    title="Copy"
                  >
                    {copied === "install" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Public key (alternative — paste manually)</Label>
                <div className="flex items-start gap-2">
                  <code className="flex-1 rounded-md border bg-muted/50 p-3 text-xs font-mono break-all">
                    {created.public_key}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => copy("pubkey", created.public_key)}
                    title="Copy"
                  >
                    {copied === "pubkey" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Fingerprint: <code className="font-mono">{created.fingerprint}</code>
              </div>
            </div>
          )}

          {/* STEP 3 — Validating */}
          {step === "validating" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                {job?.status === "succeeded" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : job?.status === "failed" ? (
                  <XCircle className="w-4 h-4 text-destructive" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                <span>
                  {!job && "Queuing job..."}
                  {job?.status === "pending" && "Waiting for deployer to pick up the job..."}
                  {job?.status === "running" && "Running validation checks..."}
                  {job?.status === "succeeded" && "Validation passed."}
                  {job?.status === "failed" && (job.error_message || "Validation failed.")}
                </span>
              </div>
              <DeployLogViewer job={job} />
            </div>
          )}

          {/* DONE */}
          {step === "done" && created && (
            <Alert className="border-green-500/30 bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle>{created.server.name} is ready</AlertTitle>
              <AlertDescription>
                SSH access verified, sudo confirmed, and outbound port 25 is open. The "Deploy mail stack" step
                installs Postfix + OpenDKIM + Dovecot — that ships in the next phase.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 flex flex-row gap-2">
          {step === "provider" && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button
                variant="cta"
                onClick={goToStep2}
                disabled={!provider || ((port25Status === "blocked" || port25Status === "request") && !providerAcknowledged)}
              >
                Continue <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          )}

          {step === "details" && (
            <>
              <Button variant="outline" onClick={() => setStep("provider")}>Back</Button>
              <Button variant="cta" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating key...</> : <>Generate key <ArrowRight className="w-4 h-4 ml-1" /></>}
              </Button>
            </>
          )}

          {step === "install_key" && (
            <>
              <Button variant="outline" onClick={() => setStep("details")}>Back</Button>
              <Button variant="cta" onClick={handleValidate} disabled={validateMutation.isPending}>
                {validateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Validating...</> : <>I've added the key — validate</>}
              </Button>
            </>
          )}

          {step === "validating" && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Close</Button>
              {job?.status === "failed" && (
                <Button variant="cta" onClick={() => setStep("install_key")}>
                  Back to install
                </Button>
              )}
            </>
          )}

          {step === "done" && (
            <Button variant="cta" onClick={handleFinish}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
