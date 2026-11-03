import { useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, RefreshCcw, Pause, Play, X, Calendar, Loader2, ExternalLink, CircleAlert, KeyRound,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  findPackInCatalog,
  usePackSubscription,
  usePackRefreshJobs,
  useUpdatePackSubscription,
  useTriggerPackRefresh,
  type RefreshCadence,
} from "@/hooks/useDiscovery";
import { useApiKeys } from "@/hooks/useApiKeys";

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

export default function DiscoverySubscriptionPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>();
  const navigate = useNavigate();
  const subQuery = usePackSubscription(subscriptionId);
  const refreshJobs = usePackRefreshJobs(subscriptionId, 25);
  const updateSub = useUpdatePackSubscription();
  const triggerRefresh = useTriggerPackRefresh();
  const apiKeysQuery = useApiKeys();

  const sub = subQuery.data;
  const pack = useMemo(() => (sub ? findPackInCatalog(sub.pack_key) : undefined), [sub]);
  const signalBaseReady = (apiKeysQuery.data ?? []).some(
    (key) => key.provider === "apify" && key.is_valid,
  );
  const missingSignalBaseKey = !!pack?.requiresProvider && !signalBaseReady;

  if (subQuery.isLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto py-6">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!sub) {
    return (
      <AppLayout>
        <div className="container mx-auto py-6 space-y-4">
          <Button variant="outline" size="sm" onClick={() => navigate("/discovery")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to catalog
          </Button>
          <p className="text-sm text-muted-foreground">Subscription not found.</p>
        </div>
      </AppLayout>
    );
  }

  const togglePause = () => {
    updateSub.mutate({ id: sub.id, status: sub.status === "active" ? "paused" : "active" });
  };
  const cancel = () => {
    updateSub.mutate({ id: sub.id, status: "cancelled" });
  };
  const setCadence = (cadence: RefreshCadence) => {
    updateSub.mutate({ id: sub.id, refresh_cadence: cadence });
  };

  return (
    <AppLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" asChild>
            <Link to="/discovery">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to catalog
            </Link>
          </Button>
          <UserProfileMenu />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{pack?.label ?? sub.pack_key}</h1>
            <Badge variant={sub.status === "active" ? "default" : "secondary"} className="capitalize">
              {sub.status}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {sub.tier.replace("_", " ")}
            </Badge>
          </div>
          {pack && <p className="text-sm text-muted-foreground mt-1">{pack.description}</p>}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Refresh cadence</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={sub.refresh_cadence} onValueChange={(v) => setCadence(v as RefreshCadence)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Last refresh</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg">{fmtRelative(sub.last_refreshed_at)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Next scheduled</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {sub.next_refresh_at
                  ? format(new Date(sub.next_refresh_at), "MMM d, h:mm a")
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        {missingSignalBaseKey && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-medium">Connect SignalBase to run this pack</p>
                  <p className="text-sm text-muted-foreground">
                    This is a private, BYOK source. Add a valid Apify key for this workspace; it is never used for ACA's public Hermes signal feed.
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=integrations")}>
                <KeyRound className="h-4 w-4 mr-2" /> Connect provider
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="cta"
            size="sm"
            onClick={() => triggerRefresh.mutate(sub.id)}
            disabled={triggerRefresh.isPending || missingSignalBaseKey}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            {triggerRefresh.isPending ? "Triggering…" : "Refresh now"}
          </Button>
          <Button variant="outline" size="sm" onClick={togglePause} disabled={updateSub.isPending || (missingSignalBaseKey && sub.status !== "active")}>
            {sub.status === "active" ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Resume
              </>
            )}
          </Button>
          {sub.status !== "cancelled" && (
            <Button variant="destructive" size="sm" onClick={cancel} disabled={updateSub.isPending}>
              <X className="h-4 w-4 mr-2" /> Cancel subscription
            </Button>
          )}
          {sub.lead_list_id && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/leads`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open lead list
              </Link>
            </Button>
          )}
        </div>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle>Refresh history</CardTitle>
          </CardHeader>
          <CardContent>
            {refreshJobs.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (refreshJobs.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No refreshes yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Contacts added</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(refreshJobs.data ?? []).map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtRelative(job.started_at ?? job.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            job.status === "completed"
                              ? "default"
                              : job.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="capitalize"
                        >
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{job.contacts_added}</TableCell>
                      <TableCell className="text-right">{job.contacts_skipped}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Array.isArray(job.errors) && job.errors.length > 0
                          ? `${job.errors.length} error(s)`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
