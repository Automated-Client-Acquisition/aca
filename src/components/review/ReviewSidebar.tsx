import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertCircle, Check, CheckCircle2, Circle, Copy, Download, Loader2, Send, Settings2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanizeGenerationError } from "@/lib/generation-errors";
import { STATE_LABEL, type Piece, type PieceStep } from "@/lib/piece";
import { cn } from "@/lib/utils";

export interface PublishInfo {
  published: number;
  scheduled: number;
  platforms?: string[];
  nextScheduledAt?: string;
  autopilotName?: string;
}

export interface MadeWith {
  blueprint?: { id: string; name: string } | null;
  idea?: string | null;
  elements: { label: string; name: string }[];
  cost?: number | null;
}

interface ReviewSidebarProps {
  piece: Piece;
  publish?: PublishInfo;
  madeWith: MadeWith;
  busy: { continue: boolean; retry: boolean; status: boolean };
  onPublish: () => void;
  onCopy: () => void;
  onDownloadImage?: () => void;
  onContinue: (stageId: string) => void;
  onRetry: (stageId?: string) => void;
  onSetStatus: (status: "approved" | "rejected" | "review") => void;
  onBehindTheScenes: () => void;
}

const STATE_TONE: Record<Piece["state"], string> = {
  generating: "text-blue-600 dark:text-blue-400",
  waiting: "text-amber-600 dark:text-amber-400",
  failed: "text-destructive",
  ready: "text-emerald-600 dark:text-emerald-400",
  done: "text-emerald-600 dark:text-emerald-400",
  discarded: "text-muted-foreground",
};

function StepIcon({ status }: { status: PieceStep["status"] }) {
  if (status === "done") return <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
  if (status === "active") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "waiting") return <Circle className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

function Steps({ steps }: { steps: PieceStep[] }) {
  if (steps.length < 2) return null;
  return (
    <ol className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.id} className={cn("flex items-center gap-2 text-[13px]", s.status === "todo" && "text-muted-foreground")}>
          <StepIcon status={s.status} />
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border bg-card p-4", className)}>{children}</section>;
}

export function ReviewSidebar(props: ReviewSidebarProps) {
  const { piece, publish, madeWith, busy } = props;
  const ready = piece.state === "ready" || piece.state === "done";
  const needsKeys = piece.failure && /api key|settings/i.test(humanizeGenerationError(piece.failure.message));

  return (
    <div className="space-y-3">
      <Card>
        <div className={cn("mb-1 flex items-center gap-1.5 text-sm font-semibold", STATE_TONE[piece.state])}>
          {piece.state === "generating" && <Loader2 className="h-4 w-4 animate-spin" />}
          {ready && <CheckCircle2 className="h-4 w-4" />}
          {piece.state === "failed" && <AlertCircle className="h-4 w-4" />}
          {piece.state === "ready" ? "Ready to post" : piece.state === "waiting" && piece.waitingOn?.stalled ? "Stopped part-way" : STATE_LABEL[piece.state]}
        </div>

        {piece.state === "generating" && (
          <>
            <p className="mb-3 text-[13px] text-muted-foreground">This page updates on its own. You can leave and come back.</p>
            <Steps steps={piece.steps} />
          </>
        )}

        {piece.state === "waiting" && piece.waitingOn && (
          <>
            <p className="mb-3 text-[13px] text-muted-foreground">
              {piece.waitingOn.stalled
                ? `The run stopped after "${piece.waitingOn.label.toLowerCase()}".`
                : `Check the draft on the left.`}
              {piece.waitingOn.next ? ` "${piece.waitingOn.next}" runs when you continue.` : ""}
            </p>
            <Steps steps={piece.steps} />
            <Button variant="cta" className="mt-4 w-full" disabled={busy.continue} onClick={() => props.onContinue(piece.waitingOn!.stageId)}>
              {busy.continue && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {piece.waitingOn.next ? "Looks good, continue" : "Looks good, finish"}
            </Button>
          </>
        )}

        {piece.state === "failed" && piece.failure && (
          <>
            <p className="mb-1 text-[13px]">{humanizeGenerationError(piece.failure.message)}</p>
            <details className="mb-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <p className="mt-1 break-words">{piece.failure.message}</p>
            </details>
            <Steps steps={piece.steps} />
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="cta" disabled={busy.retry} onClick={() => props.onRetry(piece.failure?.stageId)}>
                {busy.retry && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Try again
              </Button>
              {needsKeys && (
                <Button variant="outline" asChild>
                  <Link to="/settings?tab=integrations">
                    <Settings2 className="mr-2 h-4 w-4" />
                    Open Settings
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}

        {ready && (
          <>
            <p className="mb-3 text-[13px] text-muted-foreground">
              {piece.state === "done" ? "You marked this as done." : "Edit anything on the left, then post it or schedule it."}
            </p>
            <Button variant="cta" className="w-full" onClick={props.onPublish}>
              <Send className="mr-2 h-4 w-4" />
              Post or schedule
            </Button>
            <div className={cn("mt-2 grid gap-2", props.onDownloadImage ? "grid-cols-2" : "grid-cols-1")}>
              <Button variant="outline" size="sm" onClick={props.onCopy} disabled={!piece.text}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy text
              </Button>
              {props.onDownloadImage && (
                <Button variant="outline" size="sm" onClick={props.onDownloadImage}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Image
                </Button>
              )}
            </div>
          </>
        )}

        {piece.state === "discarded" && (
          <>
            <p className="mb-3 text-[13px] text-muted-foreground">Hidden from “ready” lists. Nothing was deleted.</p>
            <Button variant="outline" className="w-full" disabled={busy.status} onClick={() => props.onSetStatus("review")}>
              <Undo2 className="mr-2 h-4 w-4" />
              Restore
            </Button>
          </>
        )}
      </Card>

      {publish && (publish.published > 0 || publish.scheduled > 0) && (
        <Card>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posting</div>
          {publish.published > 0 && (
            <p className="text-[13px]">
              Posted {publish.published} time{publish.published === 1 ? "" : "s"}
              {publish.platforms?.length ? ` on ${publish.platforms.join(", ")}` : ""}
            </p>
          )}
          {publish.scheduled > 0 && (
            <p className="text-[13px]">
              {publish.scheduled} scheduled
              {publish.nextScheduledAt ? `, next ${format(new Date(publish.nextScheduledAt), "EEE d MMM, HH:mm")}` : ""}
              {publish.autopilotName ? ` by ${publish.autopilotName}` : ""}
            </p>
          )}
        </Card>
      )}

      <Card>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Made with</div>
        <dl className="space-y-1.5 text-[13px]">
          {madeWith.blueprint && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Blueprint</dt>
              <dd className="min-w-0 truncate">
                <Link to={`/blueprints/${madeWith.blueprint.id}`} className="underline-offset-2 hover:underline">
                  {madeWith.blueprint.name}
                </Link>
              </dd>
            </div>
          )}
          {madeWith.idea && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Idea</dt>
              <dd className="min-w-0 line-clamp-2">{madeWith.idea}</dd>
            </div>
          )}
          {madeWith.elements.map((e) => (
            <div key={e.label} className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">{e.label}</dt>
              <dd className="min-w-0 truncate">{e.name}</dd>
            </div>
          ))}
          {piece.models.map((m) => (
            <div key={m.label} className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">{m.label}</dt>
              <dd className="min-w-0 truncate font-mono text-[11px] leading-5">{m.model}</dd>
            </div>
          ))}
          {typeof madeWith.cost === "number" && madeWith.cost > 0 && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Cost</dt>
              <dd>{madeWith.cost < 0.01 ? "under $0.01" : `$${madeWith.cost.toFixed(2)}`}</dd>
            </div>
          )}
        </dl>
        <Button variant="ghost" size="sm" className="-ml-2 mt-2 h-8 text-xs text-muted-foreground" onClick={props.onBehindTheScenes}>
          Behind the scenes: steps, prompts, models
        </Button>
      </Card>

      {piece.state !== "discarded" && piece.state !== "generating" && (
        <div className="flex justify-between px-1">
          {piece.state === "ready" ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={busy.status} onClick={() => props.onSetStatus("approved")}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Mark as done
            </Button>
          ) : piece.state === "done" ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={busy.status} onClick={() => props.onSetStatus("review")}>
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Not done yet
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive" disabled={busy.status} onClick={() => props.onSetStatus("rejected")}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}
