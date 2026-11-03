import { useDeferredValue, useMemo, useState } from "react";
import {
  ChevronDown,
  XCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Type,
  Link2,
  Image as ImageIcon,
  Shuffle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isEmailBodyEmpty } from "@/lib/email-sequence-utils";
import {
  checkSequenceEmailSpam,
  DEFAULT_BLOCK_THRESHOLD,
  type ContentScoreWarning,
} from "@/lib/email-spam-check";

interface SpamCheckPanelProps {
  subject: string;
  body: string;
  bodyFormat?: "html" | "text";
  isFirstStep: boolean;
}

type Tone = "good" | "warn" | "bad";

const TONE: Record<Tone, { label: string; ring: string; text: string; pill: string }> = {
  good: {
    label: "Looks clean",
    ring: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
  },
  warn: {
    label: "Some risk",
    ring: "stroke-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
  },
  bad: {
    label: "High risk",
    ring: "stroke-red-500",
    text: "text-red-600 dark:text-red-400",
    pill: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20",
  },
};

const SEVERITY: Record<
  ContentScoreWarning["severity"],
  { order: number; Icon: React.ElementType; className: string }
> = {
  critical: { order: 0, Icon: XCircle, className: "text-red-500" },
  major: { order: 1, Icon: AlertTriangle, className: "text-amber-500" },
  minor: { order: 2, Icon: Info, className: "text-muted-foreground" },
};

function toneFor(score: number): Tone {
  return score < DEFAULT_BLOCK_THRESHOLD ? "bad" : score < 80 ? "warn" : "good";
}

function formatCount(n: number): string {
  return n > 9999 ? "10,000+" : n.toLocaleString();
}

function ScoreRing({ score, tone }: { score: number; tone: Tone }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-10 w-10 flex-shrink-0">
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className={cn("transition-[stroke-dashoffset] duration-500 ease-out", TONE[tone].ring)}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums",
          TONE[tone].text,
        )}
      >
        {score}
      </span>
    </div>
  );
}

export function SpamCheckPanel({ subject, body, bodyFormat, isFirstStep }: SpamCheckPanelProps) {
  const [open, setOpen] = useState(false);
  // Scoring renders and scores up to 64 spintax variations; defer it so
  // typing stays snappy.
  const deferredSubject = useDeferredValue(subject);
  const deferredBody = useDeferredValue(body);

  const check = useMemo(
    () =>
      checkSequenceEmailSpam({
        subject: deferredSubject,
        body: deferredBody,
        bodyFormat,
        isFirstStep,
      }),
    [deferredSubject, deferredBody, bodyFormat, isFirstStep],
  );

  if (!subject.trim() && isEmailBodyEmpty(body)) return null;

  const { worst, bestScore, triggers, spintaxGroups, totalVariations, checkedVariations } = check;
  const score = worst.score;
  const tone = toneFor(score);
  const hasSpintax = spintaxGroups > 0;
  // Trigger words get their own chip row, so keep them out of the issue list.
  const issues = worst.warnings
    .filter((w) => w.code !== "spam_triggers")
    .sort((a, b) => SEVERITY[a.severity].order - SEVERITY[b.severity].order);
  const triggerPenalty = worst.warnings.find((w) => w.code === "spam_triggers")?.delta ?? 0;

  const summary = [
    triggers.length > 0 && `${triggers.length} trigger ${triggers.length === 1 ? "word" : "words"}`,
    issues.length > 0 && `${issues.length} other ${issues.length === 1 ? "issue" : "issues"}`,
    hasSpintax && `worst of ${formatCount(totalVariations)} variations`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <ScoreRing score={score} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="whitespace-nowrap text-sm font-medium">Spam check</span>
            <span
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
                TONE[tone].pill,
              )}
            >
              {TONE[tone].label}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {summary || "No spam trigger words or deliverability issues found"}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Trigger words stay visible without expanding: they're the fix people act on. */}
      {triggers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
          {triggers.map((t) => {
            const partial = t.variations < checkedVariations;
            return (
              <span
                key={t.phrase}
                title={
                  partial
                    ? `Only in some spintax options: ${t.variations} of ${checkedVariations} checked variations`
                    : undefined
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                  partial
                    ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
                    : "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
                )}
              >
                {t.phrase}
                {partial && <Shuffle className="h-2.5 w-2.5 opacity-70" />}
              </span>
            );
          })}
          {triggerPenalty > 0 && (
            <span className="text-[11px] text-muted-foreground">-{triggerPenalty} pts</span>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t bg-muted/20 px-3 py-3">
          {hasSpintax && (
            <div className="flex items-start gap-2 rounded-md bg-background px-2.5 py-2 text-xs ring-1 ring-inset ring-border">
              <Shuffle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-purple-500" />
              <div className="flex-1 leading-relaxed">
                <span className="font-medium">
                  {spintaxGroups} spintax {spintaxGroups === 1 ? "group" : "groups"}
                </span>{" "}
                · {formatCount(totalVariations)} possible{" "}
                {totalVariations === 1 ? "email" : "emails"}
                {checkedVariations < totalVariations && `, ${checkedVariations} checked`}.{" "}
                <span className="text-muted-foreground">
                  {score === bestScore
                    ? `Every variation scores ${score}.`
                    : `Scores range ${score}–${bestScore}; the headline is the worst one a lead could get.`}
                  {triggers.some((t) => t.variations < checkedVariations) &&
                    " Amber words only appear in some options."}
                </span>
              </div>
            </div>
          )}

          {issues.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              {triggers.length > 0
                ? "No other issues. Rewrite the trigger words above to clear the score."
                : "Nothing to fix."}
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.map((w, i) => {
                const { Icon, className } = SEVERITY[w.severity];
                return (
                  <li key={`${w.code}-${i}`} className="flex items-start gap-2 text-xs">
                    <Icon className={cn("mt-px h-3.5 w-3.5 flex-shrink-0", className)} />
                    <span className="flex-1 leading-relaxed">{w.message}</span>
                    <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      -{w.delta}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Type className="h-3 w-3" />
              {worst.metrics.word_count} words
            </span>
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3 w-3" />
              {worst.metrics.link_count} {worst.metrics.link_count === 1 ? "link" : "links"}
            </span>
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="h-3 w-3" />
              {worst.metrics.image_count} {worst.metrics.image_count === 1 ? "image" : "images"}
            </span>
            <span className="ml-auto">Variables filled with sample data</span>
          </div>
        </div>
      )}
    </div>
  );
}
