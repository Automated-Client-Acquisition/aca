import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Network,
  Plus,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Snowflake,
  AlertCircle,
  PlugZap,
  Clock,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useByoServerIps,
  useByoDomains,
  useDetachByoIp,
  useAssignByoIpToDomain,
  useRecheckByoBlocklist,
} from "@/hooks/useByoServers";
import { AttachByoIpDialog } from "./AttachByoIpDialog";
import { BulkAttachByoIpsDialog } from "./BulkAttachByoIpsDialog";
import { PtrSetupHint } from "./PtrSetupHint";
import type { ByoIpStatus, ByoServer, ByoServerIp } from "@/types/email";

const ipStatusVariants: Record<
  ByoIpStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  pending: { label: "Pending", className: "border-blue-500/30 text-blue-400 bg-blue-500/10", Icon: Clock },
  active: { label: "Active", className: "border-green-500/30 text-green-400 bg-green-500/10", Icon: CheckCircle2 },
  cooling: { label: "Cooling", className: "border-amber-500/30 text-amber-400 bg-amber-500/10", Icon: Snowflake },
  blacklisted: { label: "Blacklisted", className: "border-destructive/30 text-destructive bg-destructive/10", Icon: AlertCircle },
  disabled: { label: "Disabled", className: "border-muted text-muted-foreground", Icon: PlugZap },
};

function IpStatusBadge({ status }: { status: ByoIpStatus }) {
  const v = ipStatusVariants[status] || ipStatusVariants.disabled;
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-xs ${v.className}`}>
      <v.Icon className="w-3 h-3" />
      {v.label}
    </Badge>
  );
}

interface ByoIpRotationPanelProps {
  server: ByoServer;
}

export function ByoIpRotationPanel({ server }: ByoIpRotationPanelProps) {
  const { data: ips = [], isLoading } = useByoServerIps(server.id);
  const { data: domains = [] } = useByoDomains(server.id);
  const [expanded, setExpanded] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showBulkAttach, setShowBulkAttach] = useState(false);

  const stats = {
    total: ips.length,
    active: ips.filter((i) => i.status === "active").length,
    blacklisted: ips.filter((i) => i.status === "blacklisted" || (i.blacklisted_on?.length ?? 0) > 0).length,
    totalCap: ips.filter((i) => i.status === "active").reduce((s, i) => s + (i.daily_send_limit || 0), 0),
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Network className="w-3.5 h-3.5" />
          Sending IPs ({stats.total})
          {stats.total > 0 && (
            <span className="font-mono normal-case text-[10px] text-muted-foreground/70">
              · {stats.active} active · {stats.totalCap}/day cap
              {stats.blacklisted > 0 && ` · ${stats.blacklisted} blacklisted`}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowBulkAttach(true)}>
            <Network className="w-3 h-3 mr-1" />
            Bulk attach (CIDR)
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAttach(true)}>
            <Plus className="w-3 h-3 mr-1" />
            Attach IP
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="text-xs text-muted-foreground py-2 px-3">Loading...</div>
          ) : ips.length === 0 ? (
            <div className="text-center py-4 rounded-md border border-dashed text-muted-foreground">
              <Network className="w-6 h-6 mx-auto mb-1 opacity-50" />
              <p className="text-xs">No additional sending IPs yet.</p>
              <p className="text-[11px]">
                Mailboxes use the server's primary IP by default. Attach more IPs to spread load and rotate sender reputation.
              </p>
            </div>
          ) : (
            ips.map((ip) => <IpRow key={ip.id} server={server} ip={ip} />)
          )}
        </div>
      )}

      <AttachByoIpDialog server={server} open={showAttach} onOpenChange={setShowAttach} />
      <BulkAttachByoIpsDialog
        server={server}
        domains={domains}
        open={showBulkAttach}
        onOpenChange={setShowBulkAttach}
      />
    </div>
  );
}

function IpRow({ server, ip }: { server: ByoServer; ip: ByoServerIp }) {
  const { data: domains = [] } = useByoDomains(ip.server_id);
  const detach = useDetachByoIp();
  const assign = useAssignByoIpToDomain();
  const recheck = useRecheckByoBlocklist();
  const [showRemove, setShowRemove] = useState(false);

  const blacklists = ip.blacklisted_on ?? [];
  const ratio = ip.daily_send_limit > 0 ? Math.min(100, Math.round((ip.daily_sent / ip.daily_send_limit) * 100)) : 0;

  return (
    <div className="rounded-md border bg-card/30 px-3 py-2 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono font-medium">{ip.ip_address}</span>
          <IpStatusBadge status={ip.status} />
          {ip.ptr_verified ? (
            <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400 bg-green-500/10 flex items-center gap-1">
              <ShieldCheck className="w-2.5 h-2.5" />
              PTR
            </Badge>
          ) : ip.ptr_record ? (
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10 flex items-center gap-1">
              <ShieldAlert className="w-2.5 h-2.5" />
              PTR unverified
            </Badge>
          ) : null}
          {blacklists.length > 0 && (
            <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive bg-destructive/10">
              Listed on {blacklists.length} DNSBL{blacklists.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Select
            value={ip.domain_id ?? "__unassigned"}
            onValueChange={(v) => assign.mutate({ ip_id: ip.id, domain_id: v === "__unassigned" ? null : v })}
            disabled={assign.isPending}
          >
            <SelectTrigger className="h-7 text-xs w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned">Unassigned</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => recheck.mutate({ ip_id: ip.id })}
            disabled={recheck.isPending}
            title="Recheck blocklists now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${recheck.isPending ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setShowRemove(true)} title="Detach IP">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
        <span>Warmup day {ip.warmup_day}</span>
        <span className="font-mono">
          {ip.daily_sent} / {ip.daily_send_limit} today ({ratio}%)
        </span>
        <div className="flex-1 max-w-[180px] h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={`h-full transition-all ${ratio < 80 ? "bg-green-500/70" : ratio < 100 ? "bg-amber-500/70" : "bg-destructive/70"}`}
            style={{ width: `${ratio}%` }}
          />
        </div>
        {ip.health_score < 1 && (
          <span className={ip.health_score < 0.7 ? "text-destructive" : "text-amber-400"}>
            health {ip.health_score.toFixed(2)}
          </span>
        )}
      </div>

      {!ip.ptr_verified && ip.status !== "disabled" && (
        <PtrSetupHint server={server} ip={ip} />
      )}

      <AlertDialog open={showRemove} onOpenChange={setShowRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach IP</AlertDialogTitle>
            <AlertDialogDescription>
              Removes <code className="font-mono">{ip.ip_address}</code> from the Postfix transport map and unpins
              all mailboxes that were sticky-bound to it. They'll fall back to the server's default outbound IP.
              The IP itself stays attached to your server's NIC — you can reattach it here later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { detach.mutate({ ip_id: ip.id }); setShowRemove(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
