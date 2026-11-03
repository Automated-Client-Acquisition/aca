import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Server,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Rocket,
  Plus,
  Globe,
  ChevronDown,
  ChevronRight,
  Activity,
  Lock,
} from "lucide-react";
import type { ByoServer, ByoServerStatus } from "@/types/email";
import { useByoDomains } from "@/hooks/useByoServers";
import { DeployByoServerDialog } from "./DeployByoServerDialog";
import { ProvisionByoDomainDialog } from "./ProvisionByoDomainDialog";
import { ByoDomainBlock } from "./ByoDomainBlock";
import { ByoIpRotationPanel } from "./ByoIpRotationPanel";
import { InstallByoTlsDialog } from "./InstallByoTlsDialog";

const statusVariants: Record<
  ByoServerStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  pending: { label: "Pending", className: "border-muted text-muted-foreground", Icon: Clock },
  connecting: { label: "Connecting", className: "border-blue-500/30 text-blue-400 bg-blue-500/10", Icon: RefreshCw },
  deploying: { label: "Deploying", className: "border-blue-500/30 text-blue-400 bg-blue-500/10", Icon: RefreshCw },
  ready: { label: "Ready", className: "border-green-500/30 text-green-400 bg-green-500/10", Icon: CheckCircle2 },
  degraded: { label: "Degraded", className: "border-amber-500/30 text-amber-400 bg-amber-500/10", Icon: AlertCircle },
  error: { label: "Error", className: "border-destructive/30 text-destructive bg-destructive/10", Icon: AlertCircle },
  disconnected: { label: "Disconnected", className: "border-muted text-muted-foreground", Icon: AlertCircle },
};

function ByoServerStatusBadge({ status }: { status: ByoServerStatus }) {
  const variant = statusVariants[status];
  return (
    <Badge variant="outline" className={`flex items-center gap-1 ${variant.className}`}>
      <variant.Icon className="w-3 h-3" />
      {variant.label}
    </Badge>
  );
}

interface ByoServerCardProps {
  server: ByoServer;
  onRemove: () => void;
  removing?: boolean;
}

export function ByoServerCard({ server, onRemove, removing }: ByoServerCardProps) {
  const port25Ok = server.port25_verified;
  const stackInstalled = !!server.postfix_version;
  const canDeploy = server.status === "ready" && port25Ok && !stackInstalled;
  const canAddDomain = server.status === "ready" && stackInstalled;

  const [expanded, setExpanded] = useState(canAddDomain);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [showTls, setShowTls] = useState(false);

  const { data: domains = [] } = useByoDomains(canAddDomain ? server.id : null);

  const tlsInfo = (server.deploy_state as Record<string, unknown> | null | undefined)?.tls as
    | { not_after?: string; issuer?: string; helo?: string }
    | undefined;
  const tlsInstalled = !!tlsInfo?.not_after;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <Server className="w-5 h-5 text-muted-foreground" />
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">{server.name}</CardTitle>
                <ByoServerStatusBadge status={server.status} />
                {port25Ok ? (
                  <Badge
                    variant="outline"
                    className="border-green-500/30 text-green-400 bg-green-500/10 flex items-center gap-1 text-xs"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    Port 25 OK
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 text-amber-400 bg-amber-500/10 flex items-center gap-1 text-xs"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    Port 25 unverified
                  </Badge>
                )}
                {stackInstalled && (
                  <Badge variant="outline" className="text-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    Stack deployed
                  </Badge>
                )}
                {stackInstalled && <ByoHeartbeatBadge server={server} />}
                {stackInstalled && tlsInstalled && (
                  <Badge
                    variant="outline"
                    className="text-xs flex items-center gap-1 border-green-500/30 text-green-400 bg-green-500/10"
                    title={tlsInfo?.not_after ? `Cert expires ${tlsInfo.not_after}` : undefined}
                  >
                    <Lock className="w-3 h-3" />
                    TLS
                  </Badge>
                )}
                {stackInstalled && !tlsInstalled && (
                  <Badge
                    variant="outline"
                    className="text-xs flex items-center gap-1 border-amber-500/30 text-amber-400 bg-amber-500/10"
                    title="Self-signed cert in use — install Let's Encrypt for better deliverability"
                  >
                    <Lock className="w-3 h-3" />
                    Self-signed TLS
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground font-mono">
                {server.ssh_username}@{server.hostname}:{server.ssh_port}
              </div>
              {server.provider_hint && (
                <div className="text-xs text-muted-foreground capitalize">Provider: {server.provider_hint}</div>
              )}
              {server.last_error && <div className="text-xs text-destructive">{server.last_error}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canDeploy && (
              <Button variant="cta" size="sm" className="h-8 text-xs" onClick={() => setShowDeploy(true)}>
                <Rocket className="w-3.5 h-3.5 mr-1" />
                Deploy mail stack
              </Button>
            )}
            {canAddDomain && (
              <Button variant="cta" size="sm" className="h-8 text-xs" onClick={() => setShowProvision(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add domain
              </Button>
            )}
            {canAddDomain && !tlsInstalled && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowTls(true)}
                title="Install Let's Encrypt cert for the HELO hostname"
              >
                <Lock className="w-3.5 h-3.5 mr-1" />
                Install TLS
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onRemove} disabled={removing} title="Remove server">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div className="text-xs text-muted-foreground">
            Postfix {server.postfix_version || "—"} · OpenDKIM {server.opendkim_version || "—"} · Dovecot {server.dovecot_version || "—"}
            {server.ssh_fingerprint && (
              <>
                {" · "}
                <span title="SSH host key fingerprint pinned at connect time">
                  Host key: <code className="font-mono">{server.ssh_fingerprint}</code>
                </span>
              </>
            )}
          </div>

          {canAddDomain && (
            <ByoIpRotationPanel server={server} />
          )}

          {canAddDomain && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                Sending domains
              </div>
              {domains.length === 0 ? (
                <div className="text-center py-6 rounded-md border border-dashed text-muted-foreground">
                  <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No domains attached to this server yet.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowProvision(true)}>
                    <Plus className="w-3 h-3 mr-1" />
                    Add domain
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {domains.map((d) => (
                    <ByoDomainBlock key={d.id} domain={d} />
                  ))}
                </div>
              )}
            </div>
          )}

          {canDeploy && (
            <div className="rounded-md border border-dashed p-3 text-sm space-y-1">
              <div className="font-medium flex items-center gap-1.5">
                <Rocket className="w-4 h-4" />
                Ready to install the mail stack
              </div>
              <p className="text-muted-foreground text-xs">
                Click "Deploy mail stack" to install Postfix + OpenDKIM + Dovecot. After it completes, you'll be able to
                attach domains to this server.
              </p>
            </div>
          )}
        </CardContent>
      )}

      <DeployByoServerDialog server={server} open={showDeploy} onOpenChange={setShowDeploy} />
      <ProvisionByoDomainDialog server={server} open={showProvision} onOpenChange={setShowProvision} />
      <InstallByoTlsDialog server={server} open={showTls} onOpenChange={setShowTls} />
    </Card>
  );
}

/**
 * Phase 6: shows whether the on-server agent has phoned home recently.
 *   - Within 2 minutes  → green "Live"
 *   - 2-10 minutes      → amber "Stale"
 *   - >10 minutes       → red "No heartbeat" (the cron sweep flips status='degraded' too)
 *   - Never reported    → gray "No agent" (deploy hasn't installed it yet)
 */
function ByoHeartbeatBadge({ server }: { server: ByoServer }) {
  const lastHealth = (server.deploy_state as Record<string, unknown> | null | undefined)?.last_health as string | undefined;
  const agentInstalled = ((server.deploy_state as Record<string, unknown> | null | undefined)?.agent_installed as boolean | undefined) ?? false;

  if (!agentInstalled && !lastHealth) {
    return (
      <Badge
        variant="outline"
        className="text-xs flex items-center gap-1 border-muted text-muted-foreground"
        title="Re-run deploy to install the monitoring agent"
      >
        <Activity className="w-3 h-3" />
        No agent
      </Badge>
    );
  }

  if (!lastHealth) {
    return (
      <Badge
        variant="outline"
        className="text-xs flex items-center gap-1 border-amber-500/30 text-amber-400 bg-amber-500/10"
        title="Agent installed but hasn't reported yet"
      >
        <Activity className="w-3 h-3" />
        Awaiting first report
      </Badge>
    );
  }

  const ageMs = Date.now() - Date.parse(lastHealth);
  if (ageMs < 2 * 60_000) {
    return (
      <Badge
        variant="outline"
        className="text-xs flex items-center gap-1 border-green-500/30 text-green-400 bg-green-500/10"
        title={`Last heartbeat: ${new Date(lastHealth).toLocaleTimeString()}`}
      >
        <Activity className="w-3 h-3" />
        Live
      </Badge>
    );
  }
  if (ageMs < 10 * 60_000) {
    return (
      <Badge
        variant="outline"
        className="text-xs flex items-center gap-1 border-amber-500/30 text-amber-400 bg-amber-500/10"
        title={`Last heartbeat ${Math.round(ageMs / 60_000)} min ago`}
      >
        <Activity className="w-3 h-3" />
        Stale ({Math.round(ageMs / 60_000)}m)
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs flex items-center gap-1 border-destructive/30 text-destructive bg-destructive/10"
      title={`Last heartbeat ${Math.round(ageMs / 60_000)} min ago — agent may be down`}
    >
      <Activity className="w-3 h-3" />
      No heartbeat
    </Badge>
  );
}
