import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Cloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Unplug,
  Plus,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  useDnsProvider,
  useDisconnectCloudflare,
  useCloudflareZones,
} from "@/hooks/useDnsProviders";
import { useEmailSendingDomains } from "@/hooks/useEmailSendingDomains";
import { ConnectCloudflareDialog } from "./ConnectCloudflareDialog";
import { MigrateDomainToCloudflareDialog } from "./MigrateDomainToCloudflareDialog";
import type { EmailSendingDomain } from "@/types/email";

// Relative-time helper. Keeping local rather than importing date-fns to keep
// the bundle thin — this is the only spot in this component that needs it.
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function DnsProvidersSettings() {
  const { data: status, isLoading } = useDnsProvider();
  const disconnect = useDisconnectCloudflare();
  const [showConnect, setShowConnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [migrateDomain, setMigrateDomain] = useState<EmailSendingDomain | null>(null);

  const connected = !!status?.connected && !!status.provider;
  const provider = status?.provider;

  // Only fetch zones when connected — the hook handles caching so toggling
  // the expander doesn't refetch.
  const { data: zonesData, isLoading: zonesLoading } = useCloudflareZones({
    enabled: connected,
  });
  const zones = zonesData?.zones ?? [];

  // Full sending-domain list lets us label each CF domain as connected /
  // ready-to-migrate / available without making a second roundtrip.
  const { data: sendingDomains = [] } = useEmailSendingDomains();

  // Build a lookup so we can classify each zone in O(1) during render.
  // Key = lowercased ACA domain → { isManaged: boolean }. Includes both
  // exact-name and parent-domain matches (mail.acme.com → acme.com).
  const acaDomainStatus = useMemo(() => {
    const map = new Map<string, EmailSendingDomain>();
    for (const d of sendingDomains) {
      map.set(d.domain.toLowerCase(), d);
    }
    return map;
  }, [sendingDomains]);

  // Resolve the ACA sending domain that backs a given Cloudflare zone (exact or
  // parent-zone match). Returns null for zones that aren't ACA sending domains.
  const matchZoneDomain = (zoneName: string): EmailSendingDomain | null => {
    const lower = zoneName.toLowerCase();
    const direct = acaDomainStatus.get(lower);
    if (direct) return direct;
    for (const [name, domain] of acaDomainStatus) {
      if (name.endsWith(`.${lower}`)) return domain;
    }
    return null;
  };

  const classifyZone = (zoneName: string): "connected" | "ready_to_migrate" | "available" => {
    const match = matchZoneDomain(zoneName);
    if (!match) return "available";
    return match.dns_managed ? "connected" : "ready_to_migrate";
  };

  // Aggregate counts for the section header so the user can see at a glance.
  const counts = useMemo(() => {
    const c = { connected: 0, ready: 0, available: 0 };
    for (const z of zones) {
      const status = classifyZone(z.name);
      if (status === "connected") c.connected += 1;
      else if (status === "ready_to_migrate") c.ready += 1;
      else c.available += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, sendingDomains]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-amber-500" />
            <CardTitle>Managed DNS</CardTitle>
            {connected && (
              <Badge variant="outline" className="text-xs border-green-500/30 text-green-400">
                Connected
              </Badge>
            )}
          </div>
          {!connected && (
            <Button variant="cta" size="sm" onClick={() => setShowConnect(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Connect Cloudflare
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking connection...
            </div>
          )}

          {!isLoading && !connected && (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Connect your Cloudflare account and ACA will publish DNS records for new sending
                domains automatically — no more copy-paste, no more duplicate SPF / DMARC / MX
                gotchas.
              </p>
              <p className="text-xs">
                We only touch the specific records needed for sending email (MX, SPF, DKIM,
                DMARC, autodiscover). Your website's DNS is left alone.
              </p>
            </div>
          )}

          {!isLoading && connected && provider && (
            <>
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground text-xs flex-shrink-0">Account</span>
                    <span className="font-medium truncate">{provider.account_name || provider.account_id}</span>
                  </div>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {provider.zone_count ?? 0} {(provider.zone_count ?? 0) === 1 ? "domain" : "domains"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="flex-shrink-0">Last validated</span>
                  <span className="truncate">{relativeTime(provider.validated_at)}</span>
                </div>
              </div>

              {provider.last_error && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription className="text-sm space-y-2">
                    <div>
                      <div className="font-semibold mb-0.5">Cloudflare returned an error</div>
                      {provider.last_error}
                    </div>
                    <Button
                      variant="cta"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setShowConnect(true)}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Reconnect with a new token
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {!provider.last_error && (
                <Alert className="border-green-500/30 bg-green-500/5 py-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <AlertDescription className="text-xs text-muted-foreground ml-1">
                    Token is active. ACA can manage DNS on any domain in your Cloudflare account.
                  </AlertDescription>
                </Alert>
              )}

              {/* Zone list — collapsible so it doesn't dominate the card */}
              <div className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setShowZones((v) => !v)}
                  className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/40 transition-colors"
                >
                  <span className="flex items-center gap-2 flex-wrap text-left">
                    {showZones ? (
                      <ChevronDown className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span>
                      Domains in your Cloudflare account
                      <span className="text-muted-foreground font-normal ml-1.5">({zones.length})</span>
                    </span>
                    {counts.connected > 0 && (
                      <Badge variant="outline" className="text-xs border-green-500/40 text-green-600 dark:text-green-400">
                        {counts.connected} connected
                      </Badge>
                    )}
                    {counts.ready > 0 && (
                      <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-400">
                        {counts.ready} ready to migrate
                      </Badge>
                    )}
                    {counts.available > 0 && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {counts.available} available
                      </Badge>
                    )}
                  </span>
                </button>
                {showZones && (
                  <div className="border-t p-3 space-y-2">
                    {zonesLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading your Cloudflare domains...
                      </div>
                    ) : zones.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No domains found in your Cloudflare account.
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {zones.map((z) => {
                          const status = classifyZone(z.name);
                          const zoneDomain = status === "ready_to_migrate" ? matchZoneDomain(z.name) : null;
                          return (
                            <li key={z.zone_id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="flex items-center gap-2 min-w-0">
                                <Cloud className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                                <code className="font-mono truncate">{z.name}</code>
                                <span className="text-muted-foreground/70 text-[10px]">
                                  {z.status === "active" ? "active" : z.status}
                                </span>
                              </span>
                              {status === "connected" && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400 flex-shrink-0"
                                  title="ACA is already managing DNS on this domain"
                                >
                                  connected
                                </Badge>
                              )}
                              {status === "ready_to_migrate" && (
                                <Button
                                  variant="cta"
                                  size="sm"
                                  className="h-6 px-2 text-[11px] flex-shrink-0"
                                  disabled={!zoneDomain}
                                  onClick={() => zoneDomain && setMigrateDomain(zoneDomain)}
                                  title={`Switch ${z.name} to ACA-managed DNS`}
                                >
                                  <Cloud className="w-3 h-3 mr-1" />
                                  Migrate
                                </Button>
                              )}
                              {status === "available" && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-muted-foreground flex-shrink-0"
                                  title="Not yet used as an ACA sending domain — pick it when you add a new sending domain"
                                >
                                  available
                                </Badge>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="border-t pt-2 mt-2">
                      <a
                        href="https://dash.cloudflare.com/?to=/:account/add-site"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Add another domain to Cloudflare
                      </a>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={disconnect.isPending}
                >
                  <Unplug className="w-4 h-4 mr-1" />
                  Disconnect
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConnectCloudflareDialog open={showConnect} onOpenChange={setShowConnect} />

      {migrateDomain && (
        <MigrateDomainToCloudflareDialog
          open={!!migrateDomain}
          onOpenChange={(open) => !open && setMigrateDomain(null)}
          domain={migrateDomain}
        />
      )}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Cloudflare?</AlertDialogTitle>
            <AlertDialogDescription>
              ACA will stop publishing DNS records for new sending domains. Records already in
              your Cloudflare domains stay in place — disconnecting only stops future auto-updates.
              You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                await disconnect.mutateAsync();
                setConfirmDisconnect(false);
              }}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
