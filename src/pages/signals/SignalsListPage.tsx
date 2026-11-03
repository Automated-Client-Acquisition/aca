import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  Plus,
  Pause,
  Play,
  Search,
  TrendingUp,
  UserPlus,
  Briefcase,
  Building2,
  Sparkles,
  Users,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicSignalLibraryPanel } from "@/components/signals/PublicSignalLibraryPanel";
import { CustomSignalLeadsPanel } from "@/components/signals/CustomSignalLeadsPanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PACK_CATALOG,
  usePackSubscriptions,
  useUpdatePackSubscription,
  useUpdateSignal,
  useDeletePackSubscription,
  type PackSubscription,
} from "@/hooks/useDiscovery";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

function packLabel(key: string): string {
  return PACK_CATALOG.find((p) => p.key === key)?.label ?? key;
}

function packIcon(key: string) {
  switch (key) {
    case "just_funded_saas":
      return TrendingUp;
    case "aggressive_hiring":
      return UserPlus;
    case "new_leadership":
      return Briefcase;
    case "recent_acquisitions":
      return Building2;
    default:
      return Sparkles;
  }
}

function statusColor(s: PackSubscription["status"]): string {
  switch (s) {
    case "active":
      return "bg-emerald-500";
    case "paused":
      return "bg-amber-500";
    case "cancelled":
      return "bg-muted-foreground/40";
    default:
      return "bg-muted-foreground/40";
  }
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

/** Aggregated count of enrolled-today across all signals for one org. */
function useTodayEnrolledMap(subIds: string[]) {
  return useQuery({
    queryKey: ["signals_today_counts", subIds.sort().join(",")],
    enabled: subIds.length > 0,
    queryFn: async () => {
      const todayIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
      const { data } = await supabase
        .from("signal_activity_log")
        .select("subscription_id")
        .in("subscription_id", subIds)
        .eq("outcome", "enrolled")
        .gte("created_at", todayIso);
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        const id = (row as { subscription_id: string }).subscription_id;
        map.set(id, (map.get(id) ?? 0) + 1);
      }
      return map;
    },
    refetchInterval: 30_000,
  });
}

function SignalRow({ sub, todayCount }: { sub: PackSubscription; todayCount: number }) {
  const navigate = useNavigate();
  const updateSub = useUpdatePackSubscription();
  const updateSignal = useUpdateSignal();
  const deleteSub = useDeletePackSubscription();
  const Icon = packIcon(sub.pack_key);
  const displayName = sub.name?.trim() || packLabel(sub.pack_key);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(displayName);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== displayName) {
      updateSignal.mutate({ id: sub.id, name: trimmed });
    }
    setRenaming(false);
  };
  const cancelRename = () => {
    setDraftName(displayName);
    setRenaming(false);
  };

  return (
    <Card
      className="hover:border-primary/40 transition cursor-pointer group"
      onClick={() => !renaming && navigate(`/signals/${sub.id}`)}
    >
      <CardContent className="py-4 flex items-center gap-4">
        <div className={`w-2 h-2 rounded-full ${statusColor(sub.status)} shrink-0`} />
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {renaming ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                }}
                disabled={updateSignal.isPending}
                className="font-medium bg-transparent border-b-2 border-primary outline-none px-0 py-0 min-w-[12rem]"
                aria-label="Rename signal"
              />
            ) : (
              <h3 className="font-medium truncate">{displayName}</h3>
            )}
            {sub.name && !renaming && (
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide font-normal">
                {packLabel(sub.pack_key)}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs capitalize">
              {sub.refresh_cadence}
            </Badge>
            {sub.status !== "active" && (
              <Badge variant="secondary" className="text-xs capitalize">
                {sub.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="text-foreground font-medium">{todayCount}</span> enrolled today ·
            last refresh {fmtRelative(sub.last_refreshed_at)}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setDraftName(displayName);
              setRenaming(true);
            }}
            aria-label="Rename"
            title="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() =>
              updateSub.mutate({
                id: sub.id,
                status: sub.status === "active" ? "paused" : "active",
              })
            }
            disabled={updateSub.isPending}
            aria-label={sub.status === "active" ? "Pause" : "Resume"}
          >
            {sub.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                disabled={deleteSub.isPending}
                aria-label="Delete signal"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{displayName}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Future refreshes stop and the signal disappears from your list.
                  The smart list and any contacts already discovered stay in your CRM,
                  so campaigns wired to this list keep working.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep signal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteSub.mutate(sub.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonRow() {
  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-4">
        <div className="w-2 h-2 rounded-full bg-muted shrink-0" />
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function SignalsListPage() {
  const subsQuery = usePackSubscriptions();
  const [search, setSearch] = useState("");
  const [signalMode, setSignalMode] = useState<"public" | "custom">("public");

  const subs = useMemo(() => subsQuery.data ?? [], [subsQuery.data]);
  // The Hermes public feed belongs in the Public signals workspace; it is not
  // a customer-configured signal and should never appear in this view.
  const active = subs.filter((s) => s.status !== "cancelled" && s.pack_key !== "public_linkedin_signals");
  const ids = active.map((s) => s.id);
  const todayQ = useTodayEnrolledMap(ids);
  const todayMap = todayQ.data ?? new Map<string, number>();

  const filtered = useMemo(() => {
    if (!search.trim()) return active;
    const q = search.toLowerCase();
    return active.filter(
      (s) =>
        (s.name ?? "").toLowerCase().includes(q) ||
        packLabel(s.pack_key).toLowerCase().includes(q),
    );
  }, [active, search]);

  const totalTodayCount = useMemo(
    () => Array.from(todayMap.values()).reduce((a, b) => a + b, 0),
    [todayMap],
  );

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="container mx-auto py-6 space-y-6">
        <PageHeader
          icon={Activity}
          title="Signals"
          description="AI agents that watch the market for the buyer triggers you care about and feed ICP-matched leads straight into your outreach. Configure once, runs forever."
        />

        <Tabs value={signalMode} onValueChange={(value) => setSignalMode(value as "public" | "custom")}>
          <TabsList className="h-11">
            <TabsTrigger value="public" className="gap-2 px-4"><Users className="h-4 w-4" /> Public signals</TabsTrigger>
            <TabsTrigger value="custom" className="gap-2 px-4"><Sparkles className="h-4 w-4" /> Custom signals</TabsTrigger>
          </TabsList>
        </Tabs>

        {signalMode === "public" ? <PublicSignalLibraryPanel /> : <>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Your signals</h2>
              <p className="mt-1 text-sm text-muted-foreground">Signals you configured for your own ICP and outreach.</p>
            </div>
            <Button variant="cta" size="sm" asChild>
              <Link to="/signals/new"><Plus className="mr-2 h-4 w-4" /> New signal</Link>
            </Button>
          </div>
        {/* Hero stat row */}
        {active.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Active signals" value={active.length} icon={Activity} className="p-4" />
            <StatCard
              label="In pipeline today"
              value={
                <span className={totalTodayCount > 0 ? "text-emerald-600" : undefined}>
                  {totalTodayCount}
                </span>
              }
              icon={TrendingUp}
              className="p-4"
            />
            <StatCard
              label="Triggers monitored"
              value={new Set(active.map((s) => s.pack_key)).size}
              icon={Sparkles}
              className="p-4"
            />
          </div>
        )}

        {active.length > 3 && (
          <div className="flex items-center gap-2 pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search signals…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
        )}

        {subsQuery.isLoading && (
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}

        {!subsQuery.isLoading && active.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center space-y-5">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Activity className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Set up your first signal</h2>
                <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                  Pick a target audience, choose the buyer triggers that matter, and we'll feed
                  ICP-matched leads into your outreach automatically.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl mx-auto pt-2">
                {[
                  { icon: TrendingUp, label: "Funding rounds" },
                  { icon: UserPlus, label: "Aggressive hiring" },
                  { icon: Briefcase, label: "New leadership" },
                  { icon: Building2, label: "Acquisitions" },
                ].map((t) => (
                  <div
                    key={t.label}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-muted/40"
                  >
                    <t.icon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{t.label}</span>
                  </div>
                ))}
              </div>
              <Button variant="cta" asChild size="lg">
                <Link to="/signals/new">Start in 60 seconds</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {!subsQuery.isLoading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((sub) => (
              <SignalRow key={sub.id} sub={sub} todayCount={todayMap.get(sub.id) ?? 0} />
            ))}
          </div>
        )}

        {!subsQuery.isLoading && filtered.length === 0 && active.length > 0 && (
          <p className="text-center text-sm text-muted-foreground py-12">
            No signals match "{search}".
          </p>
        )}
        </div>
        <CustomSignalLeadsPanel />
        </>}
      </div>
    </AppLayout>
  );
}
