import { useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, Plus, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { usePostShibaConnection, getPostShibaError, type PostShibaConnection } from "@/hooks/usePostShiba";
import { usePostShibaDomains, usePostShibaSenders } from "@/hooks/usePostShibaDomains";
import { ConnectPostShibaDialog } from "./ConnectPostShibaDialog";
import { PostShibaConnectionCard } from "./PostShibaConnectionCard";
import { PostShibaDomains } from "./PostShibaDomains";
import { PostShibaOnboarding } from "./PostShibaOnboarding";
import { StepTrack, getDomainStage } from "./postshiba-shared";

const DOMAINS_ANCHOR = "postshiba-domains";

export function PostShibaSettings() {
  const { data, isLoading, error, refetch, isRefetching } = usePostShibaConnection();
  const [showConnect, setShowConnect] = useState(false);
  const [addRequest, setAddRequest] = useState(0);
  const [sendersRequest, setSendersRequest] = useState<{ domainId: string; n: number } | null>(null);

  const connection = data?.connected ? data.connection : null;
  const isActive = connection?.status === "active";
  const { data: domains } = usePostShibaDomains();

  return (
    <div className="space-y-6">
      {isLoading && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
            <Skeleton className="h-16 w-full rounded-lg" />
          </CardContent>
        </Card>
      )}

      {!isLoading && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>Couldn't load the PostShiba connection. {getPostShibaError(error).message}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && !connection && <PostShibaOnboarding onConnect={() => setShowConnect(true)} />}

      {!isLoading && connection && (
        <>
          {isActive && (
            <PostShibaOverview
              connection={connection}
              onAddDomain={() => setAddRequest((n) => n + 1)}
              onAddSenders={(domainId) => setSendersRequest((prev) => ({ domainId, n: (prev?.n ?? 0) + 1 }))}
            />
          )}
          <PostShibaConnectionCard connection={connection} onReconnect={() => setShowConnect(true)} />
          {isActive && (
            <div id={DOMAINS_ANCHOR} className="scroll-mt-6">
              <PostShibaDomains addRequest={addRequest} sendersRequest={sendersRequest} />
            </div>
          )}
        </>
      )}

      <ConnectPostShibaDialog
        open={showConnect}
        onOpenChange={setShowConnect}
        existing={connection}
        domainCount={domains?.length ?? 0}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Setup guide until the first domain is ready with senders, then the numbers
// ----------------------------------------------------------------------------

function PostShibaOverview({
  connection,
  onAddDomain,
  onAddSenders,
}: {
  connection: PostShibaConnection;
  onAddDomain: () => void;
  onAddSenders: (domainId: string) => void;
}) {
  const { data: domains = [], isLoading: domainsLoading } = usePostShibaDomains();
  const { data: senders = [] } = usePostShibaSenders();

  if (domainsLoading) return null;

  const readyIds = new Set(domains.filter((d) => getDomainStage(d) === "ready").map((d) => d.id));
  const activeSenders = senders.filter((s) => s.status !== "disconnected");
  const sendersOnReady = activeSenders.filter((s) => s.sending_domain_id && readyIds.has(s.sending_domain_id));
  const plannedPerDay = activeSenders.reduce((sum, s) => sum + s.daily_limit, 0);

  const scrollToDomains = () =>
    document.getElementById(DOMAINS_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (sendersOnReady.length === 0) {
    const steps = [
      { label: "Connect team", done: true },
      { label: "Add a domain", done: domains.length > 0 },
      { label: "Verify DNS", done: readyIds.size > 0 },
      { label: "Add senders", done: false },
    ];
    const current = steps.findIndex((s) => !s.done);
    const copy = [
      null,
      { title: "Add your first sending domain", body: "Pick a domain used only for cold email. ACA creates it in PostShiba and sets up its DNS.", action: "Add domain" },
      { title: "Verify the domain's DNS", body: "Publish the records and ACA keeps checking with PostShiba until the domain is ready.", action: "Go to domains" },
      { title: "Add the people who will send", body: "Give each sender a name and an address on the domain, then set how many emails a day the domain sends.", action: "Add senders" },
    ][current === -1 ? 3 : current];
    const firstReady = domains.find((d) => readyIds.has(d.id));
    const onAction = current === 1 ? onAddDomain : current === 3 && firstReady ? () => onAddSenders(firstReady.id) : scrollToDomains;

    return (
      <Card className="overflow-hidden">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Setup · {steps.filter((s) => s.done).length} of {steps.length} done
              </div>
              <h3 className="text-base font-semibold">{copy?.title}</h3>
              <p className="max-w-xl text-sm text-muted-foreground">{copy?.body}</p>
            </div>
            {copy && (
              <Button variant="cta" onClick={onAction}>
                {current === 2 ? <ArrowRight className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {copy.action}
              </Button>
            )}
          </div>
          <StepTrack steps={steps} />
          <p className="text-xs text-muted-foreground">
            Senders can send once their domain is ready. ACA then captures their replies and bounces automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  const usage = connection.emails_per_day > 0 ? Math.min(100, (plannedPerDay / connection.emails_per_day) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile value={`${readyIds.size} of ${domains.length}`} label="Domains ready" />
      <StatTile value={activeSenders.length.toLocaleString()} label="Senders" />
      <StatTile value={plannedPerDay.toLocaleString()} label="Emails a day, planned">
        <Progress value={usage} className="mt-2 h-1" />
      </StatTile>
      <StatTile value={connection.emails_per_day.toLocaleString()} label="Cluster daily limit" />
    </div>
  );
}

function StatTile({ value, label, children }: { value: string; label: string; children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {children}
      </CardContent>
    </Card>
  );
}
