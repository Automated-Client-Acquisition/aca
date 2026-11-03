import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  FileText,
  Gauge,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  PartyPopper,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useDeleteMailboxes } from "@/hooks/useEmailMailboxes";
import { toast } from "sonner";
import {
  useSetPostShibaDailyVolume,
  getPostShibaProvisionError,
  type PostShibaDomain,
  type PostShibaSender,
} from "@/hooks/usePostShibaDomains";
import {
  CopyValue,
  RECORD_PURPOSE,
  RecordStatusIcon,
  SectionLabel,
  StagePill,
  StatusPill,
  StepTrack,
  domainSteps,
  getDomainStage,
  initials,
  recordKind,
  recordVerified,
  recordsAsZoneFile,
  relativeTime,
  useCopy,
  type DomainStage,
} from "./postshiba-shared";

type Busy = "checking" | "publishing" | undefined;

interface Props {
  id?: string;
  domain: PostShibaDomain;
  senders: PostShibaSender[];
  /** Cloudflare is connected and this domain is (or may be) one of its zones. */
  canPublish: boolean;
  busy: Busy;
  nextCheckAt: number | null;
  now: number;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onPublish: () => void;
  onCheck: () => void;
  onAddedManually: () => void;
  onAddSenders: () => void;
  onRemove: () => void;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PostShibaDomainCard(props: Props) {
  const { domain, senders, canPublish, busy, nextCheckAt, now, expanded, onExpandedChange } = props;
  const stage = getDomainStage(domain);
  const steps = domainSteps(domain);
  const doneSteps = steps.filter((s) => s.done).length;
  const waiting = nextCheckAt !== null;
  const { copiedKey, copy } = useCopy();

  const summary = [
    stage === "ready" ? "All set up" : `${doneSteps} of ${steps.length} steps done`,
    `${senders.length} sender${senders.length === 1 ? "" : "s"}`,
    ...(domain.daily_volume !== null ? [`${domain.daily_volume.toLocaleString()} a day`] : []),
    waiting
      ? `Checking again in ${countdown(nextCheckAt - now)}`
      : domain.last_dns_check_at
        ? `Checked ${relativeTime(domain.last_dns_check_at)}`
        : "Not checked yet",
  ];

  return (
    <Card id={props.id} className={cn("scroll-mt-6 overflow-hidden transition-shadow", expanded && "shadow-sm")}>
      <Collapsible open={expanded} onOpenChange={onExpandedChange}>
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full min-w-0 flex-1 items-center gap-3 text-left"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${domain.domain}`}
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
                  expanded && "rotate-90",
                )}
              />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{domain.domain}</span>
                  <StagePill stage={stage} />
                  {domain.dns_managed && (
                    <StatusPill tone="neutral" icon={Cloud}>
                      Cloudflare
                    </StatusPill>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {summary.map((part, i) => (
                    <span key={part} className="flex items-center gap-2">
                      {i > 0 && <span aria-hidden>·</span>}
                      {part}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          </CollapsibleTrigger>

          <div className="flex items-center justify-between gap-2 pl-7 sm:justify-end sm:pl-0">
            {/* Open cards carry their actions in the next-step callout below. */}
            {!expanded && <PrimaryAction {...props} stage={stage} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${domain.domain}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={props.onCheck} disabled={!!busy}>
                  <RefreshCw className="h-4 w-4" />
                  Check DNS now
                </DropdownMenuItem>
                {canPublish && (
                  <DropdownMenuItem onSelect={props.onPublish} disabled={!!busy}>
                    <Cloud className="h-4 w-4" />
                    Publish DNS to Cloudflare
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => copy(recordsAsZoneFile(domain.dns_records), "zone")}>
                  <FileText className="h-4 w-4" />
                  Copy DNS records
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={props.onAddSenders}>
                  <Users className="h-4 w-4" />
                  Add senders
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={props.onRemove} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Remove domain
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-5 border-t bg-muted/10 px-4 py-5 sm:px-5">
            <StepTrack steps={steps} />
            <NextStep {...props} stage={stage} waiting={waiting} />
            <RecordsSection domain={domain} stage={stage} copiedZone={copiedKey === "zone"} onCopyZone={() => copy(recordsAsZoneFile(domain.dns_records), "zone")} />
            <SendersSection domain={domain} senders={senders} stage={stage} onAddSenders={props.onAddSenders} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// The one button that moves this domain forward
// ----------------------------------------------------------------------------

function PrimaryAction({
  stage,
  canPublish,
  busy,
  senders,
  expanded,
  onExpandedChange,
  onPublish,
  onCheck,
  onAddSenders,
}: Props & { stage: DomainStage }) {
  const spinner = <Loader2 className="h-3.5 w-3.5 animate-spin" />;

  if (busy === "publishing") {
    return (
      <Button size="sm" variant="cta" disabled>
        {spinner}
        Publishing...
      </Button>
    );
  }
  if (busy === "checking") {
    return (
      <Button size="sm" variant="outline" disabled>
        {spinner}
        Checking...
      </Button>
    );
  }

  if ((stage === "records" || stage === "mx") && canPublish) {
    return (
      <Button size="sm" variant="cta" onClick={onPublish}>
        <Cloud className="h-3.5 w-3.5" />
        {stage === "mx" ? "Publish MX record" : "Publish to Cloudflare"}
      </Button>
    );
  }
  if (stage === "records" || stage === "mx") {
    return (
      <Button size="sm" variant="outline" onClick={() => onExpandedChange(!expanded)}>
        <FileText className="h-3.5 w-3.5" />
        {expanded ? "Hide records" : stage === "mx" ? "Show MX record" : "Show DNS records"}
      </Button>
    );
  }
  if (stage === "inbox") {
    return (
      <Button size="sm" variant="cta" onClick={onCheck}>
        <Mail className="h-3.5 w-3.5" />
        Create reply inbox
      </Button>
    );
  }
  if (stage === "verifying") {
    return (
      <Button size="sm" variant="outline" onClick={onCheck}>
        <RefreshCw className="h-3.5 w-3.5" />
        Check now
      </Button>
    );
  }
  return (
    <Button size="sm" variant={senders.length === 0 ? "cta" : "outline"} onClick={onAddSenders}>
      <Plus className="h-3.5 w-3.5" />
      Add senders
    </Button>
  );
}

// ----------------------------------------------------------------------------
// What to do next, in words
// ----------------------------------------------------------------------------

function Callout({
  icon: Icon,
  tone,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  tone: "amber" | "blue" | "green";
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const toneClasses = {
    amber: "border-amber-500/30 bg-amber-500/[0.06]",
    blue: "border-sky-500/30 bg-sky-500/[0.06]",
    green: "border-green-500/30 bg-green-500/[0.06]",
  }[tone];
  const iconClasses = {
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    green: "bg-green-500/15 text-green-700 dark:text-green-400",
  }[tone];
  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center", toneClasses)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg", iconClasses)}>
          <Icon className={cn("h-4 w-4", tone === "blue" && Icon === Loader2 && "animate-spin")} />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-semibold">{title}</div>
          {children && <div className="text-sm text-muted-foreground">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}

function NextStep({
  domain,
  stage,
  waiting,
  canPublish,
  busy,
  nextCheckAt,
  now,
  senders,
  onPublish,
  onCheck,
  onAddedManually,
  onAddSenders,
}: Props & { stage: DomainStage; waiting: boolean }) {
  const pendingRecords = domain.dns_records.filter((r) => recordKind(r) !== "mx").length;
  const mxRecord = domain.dns_records.find((r) => recordKind(r) === "mx");
  const providerNote = domain.last_error ? (
    <span className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>PostShiba says: {domain.last_error}</span>
    </span>
  ) : null;
  const checkButton = (
    <Button size="sm" variant="outline" onClick={onCheck} disabled={!!busy}>
      {busy === "checking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      Check now
    </Button>
  );
  const nextCheck = waiting && nextCheckAt ? ` ACA checks again in ${countdown(nextCheckAt - now)}.` : "";

  if (stage === "ready") {
    if (senders.length > 0) return null;
    return (
      <Callout
        icon={PartyPopper}
        tone="green"
        title={`${domain.domain} is ready`}
        actions={
          <Button size="sm" variant="cta" onClick={onAddSenders}>
            <Plus className="h-3.5 w-3.5" />
            Add senders
          </Button>
        }
      >
        DNS is verified and replies route back to ACA. Add the people who will send from this domain.
      </Callout>
    );
  }

  if (stage === "verifying" || (waiting && (stage === "records" || stage === "mx"))) {
    const forMx = stage === "mx";
    return (
      <Callout
        icon={Loader2}
        tone="blue"
        title={forMx ? "Waiting for the MX record" : "PostShiba is verifying your DNS"}
        actions={checkButton}
      >
        {forMx
          ? "Once the MX record resolves, replies to this domain come back to ACA."
          : "This usually takes a few minutes. DNS changes can take up to an hour to spread."}
        {nextCheck}
        {providerNote}
      </Callout>
    );
  }

  if (stage === "records") {
    return canPublish ? (
      <Callout
        icon={Cloud}
        tone="amber"
        title="Publish the DNS records"
        actions={
          <Button size="sm" variant="cta" onClick={onPublish} disabled={!!busy}>
            <Cloud className="h-3.5 w-3.5" />
            Publish to Cloudflare
          </Button>
        }
      >
        ACA writes the {pendingRecords} records below to this domain's Cloudflare zone. PostShiba then
        verifies them, usually within minutes.
      </Callout>
    ) : (
      <Callout
        icon={FileText}
        tone="amber"
        title={`Add these ${pendingRecords} records at your DNS provider`}
        actions={
          <Button size="sm" variant="cta" onClick={onAddedManually} disabled={!!busy}>
            <Check className="h-3.5 w-3.5" />
            I've added them
          </Button>
        }
      >
        Copy each record below, or use Copy all to paste a zone file. ACA then checks with PostShiba for you.
      </Callout>
    );
  }

  if (stage === "inbox") {
    return (
      <Callout
        icon={Mail}
        tone="amber"
        title="Create the reply inbox"
        actions={
          <Button size="sm" variant="cta" onClick={onCheck} disabled={!!busy}>
            <Mail className="h-3.5 w-3.5" />
            Create reply inbox
          </Button>
        }
      >
        PostShiba approved the domain. A catch-all inbox sends every reply to this domain back to ACA.
        {providerNote}
      </Callout>
    );
  }

  // stage === "mx"
  return canPublish ? (
    <Callout
      icon={Mail}
      tone="amber"
      title="Publish the reply MX record"
      actions={
        <Button size="sm" variant="cta" onClick={onPublish} disabled={!!busy}>
          <Cloud className="h-3.5 w-3.5" />
          Publish MX record
        </Button>
      }
    >
      The reply inbox is ready. Its MX record points this domain's mail at PostShiba, which passes replies to ACA.
      {providerNote}
    </Callout>
  ) : (
    <Callout
      icon={Mail}
      tone="amber"
      title="Add the reply MX record"
      actions={
        <Button size="sm" variant="cta" onClick={onAddedManually} disabled={!!busy}>
          <Check className="h-3.5 w-3.5" />
          I've added it
        </Button>
      }
    >
      Add this record at your DNS provider so replies to {domain.domain} reach ACA.
      {mxRecord && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-[64px_1fr] sm:items-center">
          <span className="text-[11px] uppercase tracking-wider">Type</span>
          <span className="font-mono text-xs text-foreground">MX · priority {mxRecord.priority ?? 10}</span>
          <span className="text-[11px] uppercase tracking-wider">Name</span>
          <CopyValue value={mxRecord.name} label="MX name" />
          <span className="text-[11px] uppercase tracking-wider">Value</span>
          <CopyValue value={mxRecord.value} label="MX value" />
        </div>
      )}
      {providerNote}
    </Callout>
  );
}

// ----------------------------------------------------------------------------
// DNS records
// ----------------------------------------------------------------------------

function RecordsSection({
  domain,
  stage,
  copiedZone,
  onCopyZone,
}: {
  domain: PostShibaDomain;
  stage: DomainStage;
  copiedZone: boolean;
  onCopyZone: () => void;
}) {
  // Once the sending records are verified the list is reference material (the
  // MX record, if still needed, is shown in the next-step callout), so fold it.
  const [open, setOpen] = useState(stage === "records" || stage === "verifying");
  const verifiedCount = domain.dns_records.filter((r) => recordVerified(domain, r)).length;

  if (domain.dns_records.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2.5">
      <SectionLabel
        icon={FileText}
        action={
          <div className="flex items-center gap-1">
            {open && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCopyZone}>
                {copiedZone ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedZone ? "Copied" : "Copy all"}
              </Button>
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                {open ? "Hide" : "Show"}
              </Button>
            </CollapsibleTrigger>
          </div>
        }
      >
        DNS records
        <span className="font-normal normal-case tracking-normal">
          · {verifiedCount} of {domain.dns_records.length} verified
        </span>
      </SectionLabel>
      <CollapsibleContent>
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {domain.dns_records.map((r, i) => {
            const verified = recordVerified(domain, r);
            return (
              <div key={`${r.type}-${r.name}-${i}`} className="grid gap-3 p-3 md:grid-cols-[180px_1fr] md:gap-4">
                <div className="flex items-center gap-2.5 md:items-start">
                  <RecordStatusIcon verified={verified} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded border bg-muted/50 px-1.5 py-px font-mono text-[10px] font-semibold">
                        {r.type}
                      </span>
                      <span className="text-sm font-medium">{RECORD_PURPOSE[recordKind(r)]}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {verified ? "Verified" : "Not verified yet"}
                      {r.type === "MX" ? ` · priority ${r.priority ?? 10}` : ""}
                    </div>
                  </div>
                </div>
                <div className="grid min-w-0 gap-1.5 sm:grid-cols-[52px_1fr] sm:items-center">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</span>
                  <CopyValue value={r.name} label={`${r.type} name`} />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Value</span>
                  <CopyValue value={r.value} label={`${r.type} value`} />
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ----------------------------------------------------------------------------
// Senders
// ----------------------------------------------------------------------------

function SendersSection({
  domain,
  senders,
  stage,
  onAddSenders,
}: {
  domain: PostShibaDomain;
  senders: PostShibaSender[];
  stage: DomainStage;
  onAddSenders: () => void;
}) {
  const notSending = senders.filter((s) => !s.imap_connected && s.status !== "disconnected").length;

  return (
    <div className="space-y-2.5">
      <SectionLabel
        icon={Users}
        action={
          senders.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onAddSenders}>
              <Plus className="h-3.5 w-3.5" />
              Add senders
            </Button>
          ) : undefined
        }
      >
        Senders
        {senders.length > 0 && (
          <span className="font-normal normal-case tracking-normal"> · {senders.length}</span>
        )}
      </SectionLabel>

      {(senders.length > 0 || domain.daily_volume !== null) && <DailyVolumeControl domain={domain} senders={senders} />}

      {senders.length === 0 ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            No senders yet.{" "}
            {stage === "ready"
              ? "Add the people who will send from this domain."
              : "You can add them now; they start once the domain is ready."}
          </p>
          {stage !== "ready" && (
            <Button size="sm" variant="outline" onClick={onAddSenders}>
              <Plus className="h-3.5 w-3.5" />
              Add senders
            </Button>
          )}
        </div>
      ) : (
        <>
          {notSending > 0 && (
            <p className="text-xs text-muted-foreground">
              {stage === "ready"
                ? "Senders start sending once PostShiba's delivery events are connected, so bounces reach ACA."
                : `Senders can send once ${domain.domain} is ready, so replies and bounces reach ACA.`}
            </p>
          )}
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {senders.map((s) => (
              <SenderRow key={s.id} sender={s} domainVolume={domain.daily_volume} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACTIVE_SENDER_STATUSES = new Set(["ready", "active", "warming"]);

/**
 * The domain's emails a day. Auto (the default) sizes it to the cluster: a
 * share of the cluster's daily limit, at most sender_cap a sender, recomputed
 * by the database whenever senders, domains or the cluster change. Manual keeps
 * a typed number. Either way it is split evenly across the active senders.
 */
function DailyVolumeControl({ domain, senders }: { domain: PostShibaDomain; senders: PostShibaSender[] }) {
  const setVolume = useSetPostShibaDailyVolume();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">(domain.volume_mode);
  const [draft, setDraft] = useState("");
  const active = senders.filter((s) => ACTIVE_SENDER_STATUSES.has(s.status)).length;
  const volume = domain.daily_volume;
  const auto = domain.volume_mode === "auto";
  const capacity = active * domain.sender_cap;
  const draftValue = /^\d+$/.test(draft.trim()) ? parseInt(draft.trim(), 10) : NaN;
  const draftValid = Number.isInteger(draftValue) && draftValue >= 1;

  const save = async () => {
    if (!draftValid) return;
    try {
      const saved = await setVolume.mutateAsync(
        mode === "auto"
          ? { domainId: domain.id, mode: "auto", senderCap: draftValue }
          : { domainId: domain.id, mode: "manual", dailyVolume: draftValue },
      );
      setOpen(false);
      toast.success(
        mode === "auto"
          ? `${domain.domain}: auto, up to ${draftValue.toLocaleString()} a sender a day`
          : `${domain.domain}: ${draftValue.toLocaleString()} emails a day`,
        {
          description:
            mode === "auto" && saved.daily_volume !== null
              ? `${saved.daily_volume.toLocaleString()} a day from the domain right now.`
              : active > 0
                ? `Split across ${active} sender${active === 1 ? "" : "s"}.`
                : undefined,
        },
      );
    } catch (err) {
      toast.error("Couldn't save the daily volume", { description: getPostShibaProvisionError(err).message });
    }
  };

  const summary = auto
    ? active === 0
      ? `Auto: up to ${domain.sender_cap.toLocaleString()} a sender. Add senders to start using it.`
      : volume !== null && volume < capacity
        ? `Auto: the cluster is full, so ${active} sender${active === 1 ? "" : "s"} share ${volume.toLocaleString()} (about ${Math.floor(volume / active).toLocaleString()} each, cap ${domain.sender_cap.toLocaleString()}).`
        : `Auto: ${active} sender${active === 1 ? "" : "s"} at up to ${domain.sender_cap.toLocaleString()} each.`
    : volume === null
      ? "Not set. Each sender keeps its own limit until you set one."
      : active > 0
        ? `Manual: split across ${active} sender${active === 1 ? "" : "s"}, about ${Math.floor(volume / active).toLocaleString()} each.`
        : "Manual. Add senders to start using it.";

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2.5 text-sm">
        <Gauge className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="font-medium">Daily volume</span>
        <span className="text-muted-foreground">{summary}</span>
      </div>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setMode(domain.volume_mode);
            setDraft(auto ? String(domain.sender_cap) : volume !== null ? String(volume) : "");
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={!auto && volume === null ? "cta" : "outline"}
            className="flex-shrink-0 self-start tabular-nums sm:self-auto"
          >
            {!auto && volume === null ? (
              "Set daily volume"
            ) : (
              <>
                {(volume ?? 0).toLocaleString()} a day
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Emails a day from {domain.domain}</div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(["auto", "manual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors",
                    mode === m && "bg-background text-foreground shadow-sm",
                  )}
                  onClick={() => {
                    setMode(m);
                    setDraft(m === "auto" ? String(domain.sender_cap) : volume !== null ? String(volume) : "");
                  }}
                >
                  {m === "auto" ? "Auto (cluster)" : "Manual"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "auto"
                ? "Sized to your cluster's daily limit, shared with your other auto domains. Each sender sends at most this many a day."
                : "A fixed number for the domain, shared evenly by its senders. It comes off the cluster's limit before the auto domains share the rest."}
            </p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Input
              type="number"
              min={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={mode === "auto" ? "500" : "e.g. 250"}
              className="h-8"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
            <span className="flex-shrink-0 text-xs text-muted-foreground">{mode === "auto" ? "a sender" : "a day"}</span>
            <Button type="submit" size="sm" variant="cta" disabled={!draftValid || setVolume.isPending}>
              {setVolume.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </form>
          {draftValid && active > 0 && (
            <p className="text-xs text-muted-foreground">
              {mode === "auto"
                ? `Up to ${(draftValue * active).toLocaleString()} a day from ${active} sender${active === 1 ? "" : "s"}, less if the cluster is full.`
                : `About ${Math.floor(draftValue / active).toLocaleString()} per sender.`}
            </p>
          )}
          {mode === "auto" && draftValid && draftValue > 500 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              Over 500 a day from one mailbox can hurt the domain's reputation on a shared cluster.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SenderRow({ sender, domainVolume }: { sender: PostShibaSender; domainVolume: number | null }) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const deleteMailboxes = useDeleteMailboxes();
  const { copiedKey, copy } = useCopy();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const name = sender.display_name || [sender.first_name, sender.last_name].filter(Boolean).join(" ") || sender.email_address;
  const disconnected = sender.status === "disconnected";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["postshiba-senders", currentOrganization?.id] });
    queryClient.invalidateQueries({ queryKey: ["postshiba-domains", currentOrganization?.id] });
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          disconnected ? "bg-muted text-muted-foreground" : "bg-cta/30 text-foreground",
        )}
        aria-hidden
      >
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{sender.email_address}</div>
      </div>

      {!disconnected && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden cursor-default text-xs tabular-nums text-muted-foreground sm:block">
                <span className="font-medium text-foreground">{sender.daily_limit.toLocaleString()}</span> a day
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {domainVolume !== null
                ? `This sender's share of the domain's ${domainVolume.toLocaleString()} a day.`
                : "Set the domain's daily volume to split it across senders."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <SenderStatus sender={sender} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${sender.email_address}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => copy(sender.email_address, "email")}>
            {copiedKey === "email" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmRemove(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4" />
            Remove sender
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmRemove} onOpenChange={(open) => !deleteMailboxes.isPending && setConfirmRemove(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {sender.email_address}?</AlertDialogTitle>
            <AlertDialogDescription>
              The sender is deleted from ACA and the domain's daily volume is re-split across the
              others. Emails it already sent keep their history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMailboxes.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMailboxes.isPending}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await deleteMailboxes.mutateAsync([sender.id]);
                  refresh();
                  setConfirmRemove(false);
                } catch {
                  // useDeleteMailboxes toasts the error.
                }
              }}
            >
              {deleteMailboxes.isPending ? "Removing..." : "Remove sender"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SenderStatus({ sender }: { sender: PostShibaSender }) {
  if (sender.status === "disconnected") {
    return <StatusPill tone="red">Disconnected</StatusPill>;
  }
  if (sender.status === "paused") {
    return <StatusPill tone="neutral">Paused</StatusPill>;
  }
  if (!sender.imap_connected) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <StatusPill tone="neutral">Not sending yet</StatusPill>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            Starts once the domain is ready, so replies and bounces reach ACA.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <StatusPill tone="green">Sending</StatusPill>;
}
