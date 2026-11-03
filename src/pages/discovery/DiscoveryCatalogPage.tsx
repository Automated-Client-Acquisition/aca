import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Telescope, Sparkles, Calendar, Database, Loader2, KeyRound, CircleAlert, CircleCheck } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  PACK_CATALOG,
  usePackSubscriptions,
  useCreatePackSubscription,
  type PackCatalogEntry,
  type PackSubscription,
} from "@/hooks/useDiscovery";
import { useApiKeys } from "@/hooks/useApiKeys";

function PackCard({
  pack,
  subscription,
  onSubscribe,
  onConfigureProvider,
  providerReady,
  onOpen,
  loading,
}: {
  pack: PackCatalogEntry;
  subscription?: PackSubscription;
  onSubscribe: () => void;
  onConfigureProvider: () => void;
  providerReady: boolean;
  onOpen: () => void;
  loading: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {pack.label}
          </CardTitle>
          <Badge variant="outline" className="capitalize">
            {pack.tier.replace("_", " ")}
          </Badge>
        </div>
        <CardDescription>{pack.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>Default refresh: {pack.defaultCadence}</span>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span className="font-medium">Sources</span>
          </div>
          <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-0.5">
            {pack.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div className="mt-auto flex gap-2">
          {subscription ? (
            <>
              <Badge variant={subscription.status === "active" ? "default" : "secondary"} className="capitalize">
                {subscription.status}
              </Badge>
              <Button variant="outline" size="sm" className="ml-auto" onClick={onOpen}>
                Manage
              </Button>
            </>
          ) : (
            pack.requiresProvider && !providerReady ? (
              <Button variant="outline" size="sm" className="ml-auto" onClick={onConfigureProvider}>
                <KeyRound className="h-4 w-4 mr-2" /> Connect SignalBase
              </Button>
            ) : (
              <Button variant="cta" size="sm" className="ml-auto" onClick={onSubscribe} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Subscribe"}
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DiscoveryCatalogPage() {
  const navigate = useNavigate();
  const subsQuery = usePackSubscriptions();
  const apiKeysQuery = useApiKeys();
  const createSub = useCreatePackSubscription();
  const [activeTier, setActiveTier] = useState<"all" | "signal" | "trade" | "pro_services">("all");

  const subscriptionsByPack = useMemo(() => {
    const map = new Map<string, PackSubscription>();
    (subsQuery.data ?? []).forEach((s) => map.set(s.pack_key, s));
    return map;
  }, [subsQuery.data]);

  const visiblePacks = PACK_CATALOG.filter((p) => activeTier === "all" || p.tier === activeTier);
  const signalBaseReady = (apiKeysQuery.data ?? []).some(
    (key) => key.provider === "apify" && key.is_valid,
  );

  return (
    <AppLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Telescope className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold">Discovery</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Private SignalBase packs run with your own connected provider key. ACA's public Hermes signal feed is curated separately and is never used for customer discovery.
            </p>
          </div>
          <UserProfileMenu />
        </div>

        <Card className={signalBaseReady ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-start gap-3">
              {signalBaseReady ? <CircleCheck className="mt-0.5 h-5 w-5 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-5 w-5 text-amber-600" />}
              <div>
                <p className="font-medium">SignalBase private discovery</p>
                <p className="text-sm text-muted-foreground">
                  {signalBaseReady
                    ? "Your Apify key is connected. SignalBase packs can run in this workspace."
                    : "Connect your own Apify key to use SignalBase funding, hiring, leadership, and M&A packs. It is optional and does not power ACA's public signals."}
                </p>
              </div>
            </div>
            {!signalBaseReady && (
              <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=integrations")}>
                <KeyRound className="h-4 w-4 mr-2" /> Connect provider
              </Button>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTier} onValueChange={(v) => setActiveTier(v as typeof activeTier)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="signal">Signal</TabsTrigger>
            <TabsTrigger value="trade">Trade</TabsTrigger>
            <TabsTrigger value="pro_services">Pro Services</TabsTrigger>
          </TabsList>
          <TabsContent value={activeTier} className="mt-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visiblePacks.map((pack) => (
                <PackCard
                  key={pack.key}
                  pack={pack}
                  subscription={subscriptionsByPack.get(pack.key)}
                  providerReady={!pack.requiresProvider || signalBaseReady}
                  loading={createSub.isPending && createSub.variables?.pack_key === pack.key}
                  onSubscribe={() =>
                    createSub.mutate(
                      {
                        pack_key: pack.key,
                        tier: pack.tier,
                        config: {},
                        refresh_cadence: pack.defaultCadence,
                      },
                      {
                        onSuccess: (created) => navigate(`/discovery/${created.id}`),
                      },
                    )
                  }
                  onConfigureProvider={() => navigate("/settings?tab=integrations")}
                  onOpen={() => {
                    const existing = subscriptionsByPack.get(pack.key);
                    if (existing) navigate(`/discovery/${existing.id}`);
                  }}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {visiblePacks.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No packs in this tier yet. Check back as we add more.
          </p>
        )}
      </div>
    </AppLayout>
  );
}
