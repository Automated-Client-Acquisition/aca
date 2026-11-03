import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Globe, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { useAuth } from "@/contexts/AuthContext";
import { useCloudflareZones, useDnsProvider, usePushDnsToCloudflare } from "@/hooks/useDnsProviders";
import {
  usePostShibaDomains,
  usePostShibaSenders,
  useVerifyPostShibaDomain,
  useRemovePostShibaDomain,
  getPostShibaProvisionError,
  type PostShibaDomain,
  type PostShibaSender,
} from "@/hooks/usePostShibaDomains";
import { MigrateDomainToCloudflareDialog } from "@/components/email/infrastructure/MigrateDomainToCloudflareDialog";
import { AddPostShibaDomainDialog } from "./AddPostShibaDomainDialog";
import { AddPostShibaSendersDialog } from "./AddPostShibaSendersDialog";
import { PostShibaDomainCard } from "./PostShibaDomainCard";
import { getDomainStage, type DomainStage } from "./postshiba-shared";

/**
 * After a publish ACA forces one PostShiba check, then only reads the results
 * of PostShiba's own re-checks (30s, 2m and 5m after a miss). Forced checks
 * cost one of PostShiba's 60 setup calls an hour, so dozens of domains can
 * be published without hitting the limit.
 */
const AUTO_CHECKS = [
  { delayMs: 30_000, force: true },
  { delayMs: 150_000, force: false },
  { delayMs: 360_000, force: false },
];

type ScheduledCheck = { at: number; force: boolean };
type Filter = "all" | "action" | "waiting" | "ready";

// Domains that need the user first, then ones waiting on DNS, then finished ones.
const STAGE_ORDER: Record<DomainStage, number> = { records: 0, mx: 1, inbox: 2, verifying: 3, ready: 4 };
const STAGE_FILTER: Record<DomainStage, Exclude<Filter, "all">> = {
  records: "action",
  mx: "action",
  inbox: "action",
  verifying: "waiting",
  ready: "ready",
};
// Above this many domains, cards start folded so the list stays scannable.
const AUTO_EXPAND_MAX = 3;
const FILTER_MIN = 5;

function zoneMatches(domain: string, zoneNames: string[] | null): boolean | null {
  if (zoneNames === null) return null;
  const lower = domain.toLowerCase();
  return zoneNames.some((z) => lower === z || lower.endsWith(`.${z}`));
}

interface Props {
  /** Bumped by the parent to open the add-domain dialog (e.g. from the setup guide). */
  addRequest?: number;
  /** Set by the parent to open the add-senders dialog for a domain. */
  sendersRequest?: { domainId: string; n: number } | null;
}

export function PostShibaDomains({ addRequest = 0, sendersRequest = null }: Props) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { data: domains = [], isLoading, error } = usePostShibaDomains();
  const { data: senders = [] } = usePostShibaSenders();
  const { data: dnsProvider } = useDnsProvider();
  const cloudflareConnected = !!dnsProvider?.connected;
  const { data: zonesData } = useCloudflareZones({ enabled: cloudflareConnected });
  const zoneNames = useMemo(
    () => (zonesData?.zones ? zonesData.zones.map((z) => z.name.toLowerCase()) : null),
    [zonesData?.zones],
  );

  const verify = useVerifyPostShibaDomain();
  const push = usePushDnsToCloudflare();
  const remove = useRemovePostShibaDomain();

  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sendersTarget, setSendersTarget] = useState<PostShibaDomain | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PostShibaDomain | null>(null);
  const [reviewTarget, setReviewTarget] = useState<PostShibaDomain | null>(null);
  const [reviewRun, setReviewRun] = useState(0);
  const [busy, setBusy] = useState<Record<string, "checking" | "publishing" | undefined>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  // Pending automatic checks per domain, and a clock to count down to them.
  const [schedules, setSchedules] = useState<Record<string, ScheduledCheck[]>>({});
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (addRequest > 0) setShowAdd(true);
  }, [addRequest]);

  useEffect(() => {
    if (!sendersRequest) return;
    const target = domains.find((d) => d.id === sendersRequest.domainId);
    if (target) setSendersTarget(target);
    // Only a new request opens the dialog, not a refreshed domain list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendersRequest]);

  const sendersByDomain = useMemo(() => {
    const map = new Map<string, PostShibaSender[]>();
    for (const s of senders) {
      if (!s.sending_domain_id) continue;
      map.set(s.sending_domain_id, [...(map.get(s.sending_domain_id) ?? []), s]);
    }
    return map;
  }, [senders]);

  const sorted = useMemo(
    () =>
      domains
        .map((d) => ({ domain: d, stage: getDomainStage(d) }))
        .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]),
    [domains],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: sorted.length, action: 0, waiting: 0, ready: 0 };
    for (const { stage } of sorted) c[STAGE_FILTER[stage]] += 1;
    return c;
  }, [sorted]);
  const visible = filter === "all" ? sorted : sorted.filter(({ stage }) => STAGE_FILTER[stage] === filter);

  const setBusyFor = (id: string, value: "checking" | "publishing" | undefined) =>
    setBusy((prev) => ({ ...prev, [id]: value }));

  const scheduleChecks = useCallback((id: string) => {
    const start = Date.now();
    setSchedules((prev) => ({ ...prev, [id]: AUTO_CHECKS.map((c) => ({ at: start + c.delayMs, force: c.force })) }));
  }, []);

  const clearChecks = useCallback((id: string) => {
    setSchedules((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const refreshDomains = () =>
    queryClient.invalidateQueries({ queryKey: ["postshiba-domains", currentOrganization?.id] });

  /**
   * Write the domain's records to Cloudflare in one click. The push only stops
   * to ask when it would delete records already in the zone; then the review
   * dialog shows the diff.
   */
  const publish = async (d: PostShibaDomain) => {
    setBusyFor(d.id, "publishing");
    try {
      const res = await push.mutateAsync({ domain_id: d.id });
      if (res.requires_confirmation) {
        setReviewTarget(d);
        setReviewRun((n) => n + 1);
        return;
      }
      if (res.success) {
        refreshDomains();
        scheduleChecks(d.id);
      } else if (res.error) {
        toast.error(res.error_title ?? "Publishing failed", { description: res.error });
      }
    } catch {
      // usePushDnsToCloudflare toasts the failure.
    } finally {
      setBusyFor(d.id, undefined);
    }
  };

  const runCheck = async (d: PostShibaDomain, opts: { auto?: boolean; force?: boolean } = {}) => {
    if (busyRef.current[d.id]) return;
    setBusyFor(d.id, "checking");
    try {
      const res = await verify.mutateAsync({ id: d.id, force: opts.force ?? true });
      const updated = res.domain;
      const stage = getDomainStage(updated);

      if (stage === "ready") {
        clearChecks(d.id);
        toast.success(`${updated.domain} is ready`, {
          description: (sendersByDomain.get(d.id)?.length ?? 0) === 0 ? "Add the people who will send from it." : undefined,
        });
        return;
      }

      if (res.dns_changed) {
        // The reply inbox was just created and its MX record added. On a
        // Cloudflare-managed domain ACA publishes it straight away.
        if (updated.dns_managed && cloudflareConnected) {
          toast.success("Reply inbox created", { description: "Publishing its MX record to Cloudflare." });
          await publish(updated);
        } else {
          clearChecks(d.id);
          setExpanded((prev) => ({ ...prev, [d.id]: true }));
          toast.success("Reply inbox created", {
            description: `Add its MX record so replies to ${updated.domain} reach ACA.`,
          });
        }
        return;
      }

      if (!opts.auto) {
        toast.info("Not verified yet", {
          description: updated.last_error ?? "PostShiba hasn't seen the records yet. DNS can take a few minutes.",
        });
      }
    } catch (err) {
      if (!opts.auto) toast.error("Check failed", { description: getPostShibaProvisionError(err).message });
    } finally {
      setBusyFor(d.id, undefined);
    }
  };

  // Tick once a second while any automatic check is pending, and fire the due ones.
  const hasSchedules = Object.keys(schedules).length > 0;
  useEffect(() => {
    if (!hasSchedules) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasSchedules]);

  useEffect(() => {
    for (const [id, checks] of Object.entries(schedules)) {
      const due = checks[0];
      if (!due || due.at > now || busy[id]) continue;
      setSchedules((prev) => {
        const rest = (prev[id] ?? []).slice(1);
        const next = { ...prev };
        if (rest.length) next[id] = rest;
        else delete next[id];
        return next;
      });
      const domain = domains.find((d) => d.id === id);
      if (domain) runCheck(domain, { auto: true, force: due.force });
    }
    // runCheck is recreated each render; the schedule and clock are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, schedules, domains, busy]);

  // Bring a just-added domain into view once the refreshed list renders it.
  useEffect(() => {
    if (!scrollTo || !domains.some((d) => d.id === scrollTo)) return;
    document.getElementById(`postshiba-domain-${scrollTo}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollTo(null);
  }, [scrollTo, domains]);

  const handleAdded = (d: PostShibaDomain) => {
    setFilter("all");
    setExpanded((prev) => ({ ...prev, [d.id]: true }));
    setScrollTo(d.id);
    if (cloudflareConnected && zoneMatches(d.domain, zoneNames) !== false) publish(d);
  };

  const removeSenderCount = removeTarget ? sendersByDomain.get(removeTarget.id)?.length ?? 0 : 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Globe className="h-5 w-5" />
            Sending domains
          </h3>
          <p className="text-sm text-muted-foreground">
            Domains used only for cold email. Each gets a catch-all inbox, so every reply lands in ACA.
          </p>
        </div>
        {domains.length > 0 && (
          <Button variant="cta" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add domain
          </Button>
        )}
      </div>

      {domains.length >= FILTER_MIN && (
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          className="flex-wrap justify-start gap-1.5"
        >
          {(
            [
              ["all", "All"],
              ["action", "Needs you"],
              ["waiting", "Verifying"],
              ["ready", "Ready"],
            ] as const
          ).map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              disabled={value !== "all" && counts[value] === 0}
              className="h-8 gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
            >
              {label}
              <span className="tabular-nums opacity-70">{counts[value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i} className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-72" />
            </Card>
          ))}
        </div>
      )}

      {!isLoading && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Couldn't load your PostShiba domains. {getPostShibaProvisionError(error).message}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && domains.length === 0 && (
        <Card className="flex flex-col items-center border-dashed px-6 py-10 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Globe className="h-6 w-6 text-muted-foreground" />
          </div>
          <h4 className="text-base font-semibold">Add your first sending domain</h4>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Use a domain that only sends cold email, like <span className="font-mono text-xs">acme-mail.com</span>.
            ACA sets it up in PostShiba
            {cloudflareConnected ? " and publishes its DNS records to Cloudflare." : " and lists the DNS records to add."}
          </p>
          <Button variant="cta" className="mt-5" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add domain
          </Button>
        </Card>
      )}

      {!isLoading && (
        <div className="space-y-3">
          {visible.map(({ domain: d, stage }) => (
            <PostShibaDomainCard
              key={d.id}
              id={`postshiba-domain-${d.id}`}
              domain={d}
              senders={sendersByDomain.get(d.id) ?? []}
              canPublish={cloudflareConnected && zoneMatches(d.domain, zoneNames) !== false}
              busy={busy[d.id]}
              nextCheckAt={schedules[d.id]?.[0]?.at ?? null}
              now={now}
              expanded={expanded[d.id] ?? (stage !== "ready" && domains.length <= AUTO_EXPAND_MAX)}
              onExpandedChange={(open) => setExpanded((prev) => ({ ...prev, [d.id]: open }))}
              onPublish={() => publish(d)}
              onCheck={() => runCheck(d)}
              onAddedManually={() => {
                scheduleChecks(d.id);
                runCheck(d);
              }}
              onAddSenders={() => setSendersTarget(d)}
              onRemove={() => setRemoveTarget(d)}
            />
          ))}
        </div>
      )}

      <AddPostShibaDomainDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        cloudflareConnected={cloudflareConnected}
        zoneNames={zoneNames}
        onAdded={handleAdded}
      />

      {sendersTarget && (
        <AddPostShibaSendersDialog
          open={!!sendersTarget}
          onOpenChange={(open) => !open && setSendersTarget(null)}
          domain={sendersTarget}
          existingSenders={sendersByDomain.get(sendersTarget.id) ?? []}
        />
      )}

      {reviewTarget && (
        <MigrateDomainToCloudflareDialog
          key={reviewRun}
          open={!!reviewTarget}
          onOpenChange={(open) => !open && setReviewTarget(null)}
          domain={reviewTarget}
          title={`Review DNS changes for ${reviewTarget.domain}`}
          onMigrated={() => {
            refreshDomains();
            scheduleChecks(reviewTarget.id);
          }}
        />
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && !remove.isPending && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.domain}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  ACA turns off its reply inbox and deletes it from PostShiba.
                  {removeSenderCount > 0 &&
                    ` Its ${removeSenderCount} sender${removeSenderCount === 1 ? "" : "s"} stop sending; their history stays in ACA.`}
                </p>
                <p>DNS records already published are left in place.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!removeTarget) return;
                try {
                  await remove.mutateAsync(removeTarget);
                  clearChecks(removeTarget.id);
                  setRemoveTarget(null);
                } catch {
                  // useRemovePostShibaDomain toasts the error; keep the dialog open.
                }
              }}
            >
              {remove.isPending ? "Removing..." : "Remove domain"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
