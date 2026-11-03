import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle, ArrowLeft, ArrowUpRight, Building2, Eye, EyeOff, Info, Loader2, Lock, Plus, RefreshCw, Send, Server } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  useValidatePostShiba,
  useConnectPostShiba,
  getPostShibaError,
  formatPostShibaClassification,
  type PostShibaCluster,
  type PostShibaConnection,
  type PostShibaTenant,
  type PostShibaErrorCode,
} from "@/hooks/usePostShiba";
import { POSTSHIBA_APP_URL } from "./PostShibaOnboarding";
import { StatusPill } from "./postshiba-shared";

type Step = "credentials" | "cluster" | "tenant";

const STEPS: Step[] = ["credentials", "cluster", "tenant"];
const STEP_LABELS: Record<Step, string> = {
  credentials: "Team id and API key",
  cluster: "Choose a cluster",
  tenant: "Choose a tenant",
};

/** Radio value for "create a new tenant". Tenant ids are short codes, so this can't collide. */
const NEW_TENANT = "__new__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current connection, when changing the cluster, tenant or key of a connected team. */
  existing?: PostShibaConnection | null;
  /** How many PostShiba domains the org has, to explain what a tenant switch moves. */
  domainCount?: number;
}

// Short heading per backend error_code. The backend's own sentence is always
// shown under it, since it carries the specifics.
const ERROR_TITLES: Record<PostShibaErrorCode, string> = {
  invalid_key: "API key not accepted",
  wrong_team: "Key belongs to a different team",
  kyc_required: "Verification needed",
  payment_required: "Payment needed",
  team_suspended: "Team suspended",
  cluster_not_ready: "Cluster not ready",
  rate_limited: "Too many attempts",
  not_connected: "Not connected",
  feature_disabled: "PostShiba is not enabled",
  tenant_not_found: "Tenant not found",
  tenant_in_use: "Tenant already in use",
};

interface InlineError {
  message: string;
  code?: PostShibaErrorCode;
}

/** Bulk suits cold email; among equals, the one with the most daily capacity. */
function recommendedCluster(clusters: PostShibaCluster[]): PostShibaCluster | undefined {
  const ready = clusters.filter((c) => c.sending_ready);
  return [...ready].sort(
    (a, b) =>
      Number(b.classification === "bulk") - Number(a.classification === "bulk") || b.emails_per_day - a.emails_per_day,
  )[0];
}

/** The current tenant, else the first one free to use, else a new one. */
function defaultTenantChoice(tenants: PostShibaTenant[]): string {
  const current = tenants.find((t) => t.current);
  if (current) return current.id;
  return tenants.find((t) => !t.in_use_elsewhere && !t.suspended)?.id ?? NEW_TENANT;
}

export function ConnectPostShibaDialog({ open, onOpenChange, existing, domainCount = 0 }: Props) {
  const { currentOrganization } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [teamId, setTeamId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [clusters, setClusters] = useState<PostShibaCluster[]>([]);
  const [clusterId, setClusterId] = useState("");
  const [tenants, setTenants] = useState<PostShibaTenant[]>([]);
  const [tenantChoice, setTenantChoice] = useState("");
  const [newTenantName, setNewTenantName] = useState("");
  const [error, setError] = useState<InlineError | null>(null);

  const validate = useValidatePostShiba();
  const connect = useConnectPostShiba();
  const busy = validate.isPending || connect.isPending;

  const readyClusters = clusters.filter((c) => c.sending_ready);
  const recommended = recommendedCluster(clusters);
  const canCheck = teamId.trim().length > 0 && apiKey.trim().length > 0 && !busy;
  const selected = clusters.find((c) => c.id === clusterId);
  const creatingTenant = tenantChoice === NEW_TENANT;
  const canConnect = !!clusterId && !busy && (creatingTenant ? newTenantName.trim().length > 0 : !!tenantChoice);
  // Picking another tenant on the same team moves the org's domains into it.
  const tenantSwitch =
    !!existing && existing.team_id === teamId.trim() && (creatingTenant || tenantChoice !== existing.tenant_id);
  const stepIndex = STEPS.indexOf(step);

  const reset = () => {
    setStep("credentials");
    setTeamId("");
    setApiKey("");
    setShowKey(false);
    setClusters([]);
    setClusterId("");
    setTenants([]);
    setTenantChoice("");
    setNewTenantName("");
    setError(null);
    validate.reset();
    connect.reset();
  };

  // Changing the cluster or key of a connected team: the team id is already known.
  useEffect(() => {
    if (open && existing) setTeamId((current) => current || existing.team_id);
  }, [open, existing]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const runValidate = async () => {
    setError(null);
    try {
      const result = await validate.mutateAsync({ team_id: teamId.trim(), api_key: apiKey.trim() });
      setClusters(result.clusters);
      setTenants(result.tenants);
      const ready = result.clusters.filter((c) => c.sending_ready);
      setClusterId((current) => {
        if (current && ready.some((c) => c.id === current)) return current;
        if (existing && ready.some((c) => c.id === existing.cluster_id)) return existing.cluster_id;
        return recommendedCluster(result.clusters)?.id ?? "";
      });
      setTenantChoice((current) =>
        current === NEW_TENANT || result.tenants.some((t) => t.id === current && !t.in_use_elsewhere)
          ? current
          : defaultTenantChoice(result.tenants),
      );
      setNewTenantName((current) => current || currentOrganization?.name || "");
      setStep("cluster");
    } catch (err) {
      setError(getPostShibaError(err));
    }
  };

  const runConnect = async () => {
    if (!clusterId) return;
    setError(null);
    try {
      const { connection, migration } = await connect.mutateAsync({
        team_id: teamId.trim(),
        api_key: apiKey.trim(),
        cluster_id: clusterId,
        ...(creatingTenant ? { new_tenant_name: newTenantName.trim() } : { tenant_id: tenantChoice }),
      });
      const tenantLabel = connection.tenant_name || connection.tenant_slug;
      toast.success(existing ? "PostShiba connection updated" : "PostShiba connected", {
        description: `Tenant ${tenantLabel} on ${connection.cluster_name}, up to ${connection.emails_per_day.toLocaleString()} emails a day.${
          migration?.domains_moved ? ` Moved ${migration.domains_moved} domain${migration.domains_moved === 1 ? "" : "s"} into it.` : ""
        }`,
      });
      if (migration?.domains_failed.length) {
        toast.error(`${migration.domains_failed.length} domain${migration.domains_failed.length === 1 ? "" : "s"} could not move to ${tenantLabel}`, {
          description: migration.domains_failed.map((f) => `${f.domain}: ${f.error}`).join(" "),
          duration: 15000,
        });
      }
      handleOpenChange(false);
    } catch (err) {
      setError(getPostShibaError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && handleOpenChange(next)}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="space-y-3 border-b px-6 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cta/30">
              <Send className="h-4 w-4" />
            </div>
            <div className="text-left">
              <DialogTitle>{existing ? "Update PostShiba connection" : "Connect PostShiba"}</DialogTitle>
              <DialogDescription className="text-xs">
                Step {stepIndex + 1} of {STEPS.length} · {STEP_LABELS[step]}
              </DialogDescription>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className={cn("h-1 rounded-full", i <= stepIndex ? "bg-foreground" : "bg-muted")} />
            ))}
          </div>
        </DialogHeader>

        {step === "credentials" && (
          <form
            className="space-y-5 px-6 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canCheck) runValidate();
            }}
          >
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold">Where to find these</span>
                <a
                  href={POSTSHIBA_APP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-shrink-0 items-center gap-0.5 text-xs font-medium underline-offset-4 hover:underline"
                >
                  Open PostShiba
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                {[
                  <>In PostShiba, open <span className="font-medium text-foreground">API keys</span>.</>,
                  <>Copy your <span className="font-medium text-foreground">team id</span> from that page, a short code like <span className="font-mono">KjkAJW</span>.</>,
                  <>Create a key with <span className="font-medium text-foreground">Full access</span> and copy it. Only a team administrator can create keys.</>,
                ].map((text, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground">
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="postshiba-team-id">Team id</Label>
              <Input
                id="postshiba-team-id"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                disabled={busy}
                autoFocus={!existing}
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. KjkAJW"
                className={cn("font-mono", error?.code === "wrong_team" && "border-destructive")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postshiba-api-key">API key</Label>
              <div className="relative">
                <Input
                  id="postshiba-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={busy}
                  autoFocus={!!existing}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your API key"
                  className={cn("pr-10 font-mono", error?.code === "invalid_key" && "border-destructive")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {error && <ErrorBox error={error} />}

            <DialogFooter className="items-center gap-2 sm:justify-between sm:space-x-0">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                Stored encrypted
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="cta" disabled={!canCheck}>
                  {validate.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}

        {step === "cluster" && (
          <div className="space-y-4 px-6 py-5">
            {clusters.length > 0 && (
              <RadioGroup value={clusterId} onValueChange={setClusterId} disabled={busy} className="gap-2.5">
                {clusters.map((c) => {
                  const itemId = `postshiba-cluster-${c.id}`;
                  const isSelected = clusterId === c.id;
                  return (
                    <Label
                      key={c.id}
                      htmlFor={itemId}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-4 font-normal transition-colors",
                        c.sending_ready ? "cursor-pointer hover:border-foreground/30" : "cursor-not-allowed opacity-60",
                        isSelected && "border-foreground/60 bg-muted/30 ring-1 ring-foreground/10",
                      )}
                    >
                      <RadioGroupItem id={itemId} value={c.id} disabled={!c.sending_ready} className="mt-1" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Server className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="truncate text-sm font-semibold">{c.name}</span>
                          {c.id === recommended?.id && readyClusters.length > 1 && (
                            <StatusPill tone="green">Recommended</StatusPill>
                          )}
                          {!c.sending_ready && <StatusPill tone="neutral">Not ready to send</StatusPill>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatPostShibaClassification(c.classification)} · <span className="capitalize">{c.plan}</span> plan ·{" "}
                          {c.emails_per_day.toLocaleString()} emails a day
                        </div>
                      </div>
                    </Label>
                  );
                })}
              </RadioGroup>
            )}

            {selected?.classification === "transactional" && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <span>
                  Transactional clusters are meant for receipts and login emails. Cold email is better on
                  a Bulk cluster, so it can't hurt that mail's reputation. You can switch later.
                </span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Need another cluster, like a Bulk one for cold email? Each cluster is its own PostShiba
                plan (nano to large, priced by daily volume) billed to your team's card, so it is created
                in PostShiba, not here. Your team must be KYC approved for a second cluster. Once it shows
                as ready, come back and press Check again.{" "}
                <a
                  href={POSTSHIBA_APP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Create a cluster in PostShiba
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </span>
            </div>

            {readyClusters.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  None of this team's clusters can send yet. Finish a sending cluster in PostShiba, then
                  check again.
                </span>
              </div>
            )}

            {error && <ErrorBox error={error} />}

            <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
              <Button
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep("credentials");
                }}
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={runValidate} disabled={busy}>
                  {validate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Check again
                </Button>
                <Button
                  variant="cta"
                  onClick={() => {
                    setError(null);
                    setStep("tenant");
                  }}
                  disabled={!clusterId || busy}
                >
                  Continue
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {step === "tenant" && (
          <div className="space-y-4 px-6 py-5">
            <p className="text-xs text-muted-foreground">
              A tenant holds this organization's sending domains, reply inboxes and suppression list
              inside your PostShiba team. New domains are added to the tenant you pick here.
            </p>

            <RadioGroup value={tenantChoice} onValueChange={setTenantChoice} disabled={busy} className="gap-2.5">
              {tenants.map((t) => {
                const itemId = `postshiba-tenant-${t.id}`;
                const unavailable = t.in_use_elsewhere || t.suspended;
                return (
                  <Label
                    key={t.id}
                    htmlFor={itemId}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 font-normal transition-colors",
                      unavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-foreground/30",
                      tenantChoice === t.id && "border-foreground/60 bg-muted/30 ring-1 ring-foreground/10",
                    )}
                  >
                    <RadioGroupItem id={itemId} value={t.id} disabled={unavailable} className="mt-1" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate text-sm font-semibold">{t.name}</span>
                        {t.current && <StatusPill tone="green">Current</StatusPill>}
                        {t.in_use_elsewhere && <StatusPill tone="neutral">Used by another organization</StatusPill>}
                        {t.suspended && <StatusPill tone="red">Suspended</StatusPill>}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                    </div>
                  </Label>
                );
              })}

              <Label
                htmlFor="postshiba-tenant-new"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border border-dashed p-4 font-normal transition-colors hover:border-foreground/30",
                  creatingTenant && "border-solid border-foreground/60 bg-muted/30 ring-1 ring-foreground/10",
                )}
              >
                <RadioGroupItem id="postshiba-tenant-new" value={NEW_TENANT} className="mt-1" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold">Create a new tenant</span>
                  </div>
                  {creatingTenant && (
                    <Input
                      value={newTenantName}
                      onChange={(e) => setNewTenantName(e.target.value)}
                      disabled={busy}
                      maxLength={100}
                      placeholder="Tenant name"
                      aria-label="New tenant name"
                      autoFocus
                    />
                  )}
                </div>
              </Label>
            </RadioGroup>

            {tenantSwitch && domainCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <span>
                  This organization's {domainCount} PostShiba domain{domainCount === 1 ? "" : "s"} will move
                  to this tenant with {domainCount === 1 ? "its" : "their"} reply inboxes, and every sender
                  switches to the tenant's SMTP login. The old tenant's suppressions are copied over by
                  PostShiba in the background.
                </span>
              </div>
            )}

            {error && <ErrorBox error={error} />}

            <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
              <Button
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep("cluster");
                }}
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="cta" onClick={runConnect} disabled={!canConnect}>
                  {connect.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : existing ? (
                    "Save"
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorBox({ error }: { error: InlineError }) {
  const title = error.code ? ERROR_TITLES[error.code] : undefined;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
      <div className="text-sm">
        {title && <div className="font-semibold text-destructive">{title}</div>}
        <div className="text-foreground/80">{error.message}</div>
      </div>
    </div>
  );
}
