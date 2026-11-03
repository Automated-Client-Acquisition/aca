import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Server,
  Network,
  Globe,
} from "lucide-react";
import {
  BYO_HOSTING_PROVIDERS,
  BGP_PROVIDERS,
  getAffiliateUrl,
  getBgpAffiliateUrl,
  type ByoHostingProvider,
  type BgpProviderInfo,
} from "@/config/byo-hosting-providers";

interface HostingRecommendationsProps {
  /** Optional: pre-filter to a region. */
  regionFilter?: "EU" | "US" | "Global";
}

export function HostingRecommendations({ regionFilter }: HostingRecommendationsProps) {
  const [tab, setTab] = useState<"server" | "ips">("server");

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Don't have a server yet?</div>
        <p className="text-xs text-muted-foreground">
          Below are the providers we recommend for cold email. ACA works with any host that has port 25 open.
          The links include our partner referral — same price for you, supports ACA.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "server" | "ips")}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="server" className="gap-1.5">
            <Server className="w-3.5 h-3.5" />
            Bare metal hosts
          </TabsTrigger>
          <TabsTrigger value="ips" className="gap-1.5">
            <Network className="w-3.5 h-3.5" />
            IPv4 leasing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="space-y-2 mt-3">
          {BYO_HOSTING_PROVIDERS
            .filter((p) => !regionFilter || p.region === regionFilter || p.region === "Global")
            .map((p) => (
              <ProviderCard key={`${p.id}-${p.name}`} provider={p} />
            ))}
        </TabsContent>

        <TabsContent value="ips" className="space-y-2 mt-3">
          {BGP_PROVIDERS.map((p) => (
            <BgpProviderCard key={p.id} provider={p} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProviderCard({ provider }: { provider: ByoHostingProvider }) {
  const url = getAffiliateUrl(provider);
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{provider.name}</span>
            <RegionBadge region={provider.region} />
            <Port25Badge port25={provider.port25} />
            <BgpBadge bgp={provider.bgpSupport} />
          </div>
          <div className="text-xs text-muted-foreground">
            <strong>{provider.costNote}</strong> — {provider.recommendedSku}
          </div>
          <div className="text-xs text-muted-foreground/80 leading-relaxed">
            {provider.notes}
          </div>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {provider.bestFor.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <Button asChild variant="cta" size="sm" className="flex-shrink-0 h-7 text-xs">
          <a href={url} target="_blank" rel="noopener noreferrer">
            Order
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>
        </Button>
      </div>
    </Card>
  );
}

function BgpProviderCard({ provider }: { provider: BgpProviderInfo }) {
  const url = getBgpAffiliateUrl(provider);
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{provider.name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {provider.termCommitment}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            <strong>
              ${provider.monthlyForSlash24Usd.min}-{provider.monthlyForSlash24Usd.max}/mo
            </strong>{" "}
            for a /24 ({`$${provider.pricePerIpUsd.min}-${provider.pricePerIpUsd.max}/IP/month`})
          </div>
          <div className="text-xs text-muted-foreground/80 leading-relaxed">
            {provider.notes}
          </div>
        </div>
        <Button asChild variant="cta" size="sm" className="flex-shrink-0 h-7 text-xs">
          <a href={url} target="_blank" rel="noopener noreferrer">
            Lease IPs
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>
        </Button>
      </div>
    </Card>
  );
}

function RegionBadge({ region }: { region: "EU" | "US" | "Global" }) {
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
      <Globe className="w-2.5 h-2.5" />
      {region}
    </Badge>
  );
}

function Port25Badge({ port25 }: { port25: "open" | "request" | "blocked" }) {
  if (port25 === "open") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-400 bg-green-500/10 flex items-center gap-1">
        <ShieldCheck className="w-2.5 h-2.5" />
        Port 25 open
      </Badge>
    );
  }
  if (port25 === "request") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10 flex items-center gap-1">
        <ShieldAlert className="w-2.5 h-2.5" />
        Port 25 on request
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive/30 text-destructive bg-destructive/10 flex items-center gap-1">
      <ShieldAlert className="w-2.5 h-2.5" />
      Port 25 blocked
    </Badge>
  );
}

function BgpBadge({ bgp }: { bgp: "native" | "byoip-rewrite" | "vrack" | "request" | "none" }) {
  if (bgp === "none") return null;
  const label =
    bgp === "native" ? "BGP native" :
    bgp === "byoip-rewrite" ? "BYOIP" :
    bgp === "vrack" ? "BGP via vRack" :
    "BGP on request";
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
      {label}
    </Badge>
  );
}
