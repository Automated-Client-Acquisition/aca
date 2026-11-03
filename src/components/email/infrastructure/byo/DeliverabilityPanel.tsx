import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Flame,
  PlugZap,
  Shield,
  Mail,
  Network,
  Loader2,
  Plug,
  Unplug,
} from "lucide-react";
import {
  useConnectPostmaster,
  useDeliverabilityMetrics,
  useDisconnectPostmaster,
  usePostmasterStatus,
} from "@/hooks/useDeliverability";

export function DeliverabilityPanel() {
  const { data: metrics, isLoading } = useDeliverabilityMetrics();
  const { data: postmaster } = usePostmasterStatus();
  const connect = useConnectPostmaster();
  const disconnect = useDisconnectPostmaster();

  if (isLoading || !metrics) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">Loading deliverability metrics...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Deliverability monitoring
        </h3>
        <p className="text-sm text-muted-foreground">
          Real-time signals from Gmail Postmaster Tools, Microsoft SNDS, and DMARC aggregate reports. Auto-burns domains
          and cools IPs when reputation drops.
        </p>
      </div>

      {/* Postmaster connection card */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-full bg-muted/50 p-2">
              <Mail className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                Google Postmaster Tools
                {metrics.postmaster_connected ? (
                  <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 text-xs">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs">
                    <PlugZap className="w-3 h-3 mr-1" /> Not connected
                  </Badge>
                )}
              </div>
              {metrics.postmaster_connected ? (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {metrics.postmaster_account && <>Account: <code className="font-mono">{metrics.postmaster_account}</code> · </>}
                  Last sync: {postmaster?.last_synced_at ? new Date(postmaster.last_synced_at).toLocaleString() : "pending first run"}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-0.5">
                  Real-time Gmail reputation, spam-rate, and auth pass-rate per domain. Required to detect burns before they tank deliverability.
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {metrics.postmaster_connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Unplug className="w-3.5 h-3.5 mr-1" />}
                Disconnect
              </Button>
            ) : (
              <Button
                variant="cta"
                size="sm"
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
              >
                {connect.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-1" />}
                Connect Google account
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DomainHealthCard
          healthy={metrics.domains_healthy}
          warning={metrics.domains_warning}
          burned={metrics.domains_burned}
          total={metrics.domains_total}
        />
        <IpHealthCard
          green={metrics.ips_green}
          yellow={metrics.ips_yellow}
          red={metrics.ips_red}
          registered={metrics.ips_with_snds}
        />
        <Card>
          <CardContent className="pt-4 pb-4 space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" />
              DMARC reports
            </div>
            <div className="text-2xl font-bold">{metrics.recent_dmarc_reports_30d}</div>
            <div className="text-xs text-muted-foreground">
              {metrics.recent_dmarc_alignment_failures_30d > 0 ? (
                <span className="text-amber-400">
                  {metrics.recent_dmarc_alignment_failures_30d} alignment failure{metrics.recent_dmarc_alignment_failures_30d !== 1 ? "s" : ""} (last 30d)
                </span>
              ) : (
                <>Reports ingested over the last 30 days</>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Network className="w-3.5 h-3.5" />
              Auto-protections
            </div>
            <div className="text-2xl font-bold flex items-center gap-2">
              {metrics.domains_burned > 0 || metrics.ips_red > 0 ? (
                <>
                  {metrics.domains_burned}
                  <Flame className="w-5 h-5 text-destructive" />
                </>
              ) : (
                <>
                  Active
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {metrics.domains_burned > 0
                ? `${metrics.domains_burned} domain${metrics.domains_burned !== 1 ? "s" : ""} auto-burned · ${metrics.ips_red} IP${metrics.ips_red !== 1 ? "s" : ""} cooling`
                : "No domains burned, all IPs clean"}
            </div>
          </CardContent>
        </Card>
      </div>

      {!metrics.postmaster_connected && metrics.domains_total > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <AlertTitle>Connect Postmaster Tools to monitor reputation</AlertTitle>
          <AlertDescription>
            Without it, you're flying blind on Gmail reputation and won't detect burns until bounce rate or replies tank.
            One-time OAuth, no separate account needed — uses any Google account that has Postmaster Tools access.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function DomainHealthCard({ healthy, warning, burned, total }: { healthy: number; warning: number; burned: number; total: number }) {
  const main = total === 0 ? 0 : healthy;
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Mail className="w-3.5 h-3.5" />
          Domain reputation
        </div>
        <div className="text-2xl font-bold flex items-center gap-2">
          {main}/{total}
          {total > 0 && healthy === total && <CheckCircle2 className="w-5 h-5 text-green-500" />}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          {healthy > 0 && <span className="text-green-400">{healthy} healthy</span>}
          {warning > 0 && <span className="text-amber-400">· {warning} warning</span>}
          {burned > 0 && <span className="text-destructive">· {burned} burned</span>}
          {total === 0 && <>No BYO domains yet</>}
        </div>
      </CardContent>
    </Card>
  );
}

function IpHealthCard({ green, yellow, red, registered }: { green: number; yellow: number; red: number; registered: number }) {
  const total = green + yellow + red;
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Network className="w-3.5 h-3.5" />
          SNDS (Outlook)
        </div>
        <div className="text-2xl font-bold">
          {registered === 0 ? "—" : `${green}/${total}`}
        </div>
        <div className="text-xs text-muted-foreground">
          {registered === 0 ? (
            <>Not registered with Microsoft</>
          ) : (
            <>
              {green} green
              {yellow > 0 && <span className="text-amber-400"> · {yellow} yellow</span>}
              {red > 0 && <span className="text-destructive"> · {red} red</span>}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
