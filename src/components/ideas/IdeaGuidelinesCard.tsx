import { useId, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Check, Link2, Loader2, Plus, ShieldCheck, ShoppingBag, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { findUnsupportedNumbers, readGuidelines, type IdeaAnalysis } from "@/lib/idea-guidelines";

export interface GuidelineSourceChip {
  kind: "link" | "product" | "knowledge";
  label: string;
  href?: string;
}

interface IdeaGuidelinesCardProps {
  ideaId: string;
  /** The idea's ai_analysis, including unsaved edits. */
  analysis: IdeaAnalysis;
  onAnalysisChange: (next: IdeaAnalysis) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  /** Text the number check reads: topic, notes, links, product. */
  sourceText: string;
  sourceChips: GuidelineSourceChip[];
  approvedAt: string | null;
  onApprove: () => void;
  onUnapprove: () => void;
  isApproving: boolean;
  onSuggest: () => void;
  isSuggesting: boolean;
}

/** A textarea that grows with its text, so a point reads like a line, not a box. */
function PointInput({ value, onChange, disabled, autoFocus, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; autoFocus?: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // The row gets wider when its "AI draft" tag goes away: refit then too.
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <Textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      placeholder="A point the post has to make"
      className="min-h-0 resize-none overflow-hidden rounded-sm border-0 bg-transparent px-0 py-0.5 text-sm leading-relaxed shadow-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
    />
  );
}

export function IdeaGuidelinesCard({
  ideaId,
  analysis,
  onAnalysisChange,
  notes,
  onNotesChange,
  sourceText,
  sourceChips,
  approvedAt,
  onApprove,
  onUnapprove,
  isApproving,
  onSuggest,
  isSuggesting,
}: IdeaGuidelinesCardProps) {
  const { points, drafts, avoid } = readGuidelines(analysis);
  const draftSet = new Set(drafts);
  const [newAvoid, setNewAvoid] = useState("");
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const fieldId = useId();

  // Only AI drafts get checked: a point someone wrote or kept is theirs.
  const flags = points.map((p) => (draftSet.has(p.trim()) ? findUnsupportedNumbers(p, sourceText) : []));
  const flaggedCount = flags.filter((f) => f.length > 0).length;
  const approved = !!approvedAt && drafts.length === 0;
  const busy = isSuggesting || isApproving || rewriting !== null;

  const write = (nextPoints: string[], nextDrafts: string[], nextAvoid: string[] = avoid) => {
    setApproveError(null);
    onAnalysisChange({ ...analysis, talking_points: nextPoints, talking_points_ai: nextDrafts, avoid: nextAvoid });
  };

  const editPoint = (index: number, text: string) => {
    const old = points[index].trim();
    const next = [...points];
    next[index] = text;
    // Editing a draft makes it yours.
    write(next, drafts.filter((d) => d !== old));
  };

  const removePoint = (index: number) => {
    const old = points[index].trim();
    write(points.filter((_, i) => i !== index), drafts.filter((d) => d !== old));
  };

  const keepPoint = (index: number) => {
    const old = points[index].trim();
    write(points, drafts.filter((d) => d !== old));
  };

  const addPoint = () => {
    setFocusIndex(points.length);
    write([...points, ""], drafts);
  };

  const rewriteWithoutNumbers = async (index: number) => {
    const point = points[index];
    const numbers = flags[index];
    setRewriting(index);
    try {
      const { data, error } = await supabase.functions.invoke("rewrite-text", {
        body: {
          idea_id: ideaId,
          text: point,
          instruction: `Remove ${numbers.join(", ")}: none of the sources back it up. Make the same point without that figure and without any other number, date or statistic. Keep it to one sentence.`,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "The rewrite failed. Try again.");
      const rewritten = String(data.text).trim();
      const old = point.trim();
      const next = [...points];
      next[index] = rewritten;
      // Still AI text: it stays a draft until someone approves it.
      write(next, [...drafts.filter((d) => d !== old), rewritten]);
    } catch (e) {
      toast.error("Couldn't rewrite that point", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setRewriting(null);
    }
  };

  const addAvoid = () => {
    if (busy) return;
    const value = newAvoid.trim();
    if (!value) return;
    if (!avoid.some((a) => a.toLowerCase() === value.toLowerCase())) write(points, drafts, [...avoid, value]);
    setNewAvoid("");
  };

  const handleApprove = () => {
    if (flaggedCount > 0) {
      setApproveError(
        flaggedCount === 1 ? "Fix the flagged number first." : `Fix the ${flaggedCount} flagged numbers first.`,
      );
      return;
    }
    setApproveError(null);
    onApprove();
  };

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Guidelines</span>
          <span role="status" aria-live="polite">
            {approved ? (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Approved
              </span>
            ) : (
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Needs review
              </span>
            )}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Review the points every post should cover. Facts come from your notes, sources and product details.
      </p>

      {/* Points to make */}
      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Points to make</span>
          {!approved && drafts.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {drafts.length} AI draft{drafts.length !== 1 ? "s" : ""} to check
            </span>
          )}
        </div>
        {points.length > 0 ? (
          <ol className={cn("divide-y rounded-md border", busy && "opacity-60")}>
            {points.map((point, index) => {
              const isDraft = draftSet.has(point.trim());
              const flagged = flags[index];
              return (
                <li key={index} className="flex items-start gap-2 px-3 py-3 sm:gap-3">
                  <span className="w-4 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <PointInput
                      value={point}
                      onChange={(v) => editPoint(index, v)}
                      disabled={busy || rewriting === index}
                      autoFocus={focusIndex === index}
                      label={`Point ${index + 1}`}
                    />
                    {isDraft && !approved && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Sparkles className="h-3 w-3" /> AI draft
                        </span>
                        {flagged.length === 0 && <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => keepPoint(index)}
                          disabled={busy}
                          aria-label={`Keep point ${index + 1} as reviewed`}
                        >
                          <Check className="h-3 w-3" /> Keep point
                        </Button>}
                      </div>
                    )}
                    {flagged.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-700 dark:text-amber-400">
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {flagged.map((n) => `"${n}"`).join(", ")} {flagged.length === 1 ? "isn't" : "aren't"} in any of your sources
                        </span>
                        <button
                          type="button"
                          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          onClick={() => rewriteWithoutNumbers(index)}
                          disabled={busy}
                        >
                          {rewriting === index ? "Rewriting…" : "Remove the number"}
                        </button>
                        <button
                          type="button"
                          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          onClick={() => keepPoint(index)}
                          disabled={busy}
                        >
                          It's correct, keep point
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove point ${index + 1}`}
                    title={`Remove point ${index + 1}`}
                    className="-mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => removePoint(index)}
                    disabled={busy}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            No points yet. Add the points this post has to make, or let AI suggest some from your notes and sources.
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={addPoint} disabled={busy}>
            <Plus className="h-3.5 w-3.5" /> Add point
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onSuggest} disabled={busy}>
            {isSuggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isSuggesting ? "Suggesting…" : "Suggest points"}
          </Button>
        </div>
      </div>

      {/* Don't mention */}
      <section className="mt-6 border-t pt-5" aria-labelledby={`${fieldId}-avoid-heading`}>
        <h3 id={`${fieldId}-avoid-heading`} className="text-sm font-medium">Don't mention</h3>
        <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">Topics, claims or details to leave out of every post.</p>
        {avoid.length > 0 ? (
          <ul className="divide-y overflow-hidden rounded-md border">
            {avoid.map((item, index) => (
              <li key={item} className="flex items-start gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-1.5 text-xs leading-relaxed [overflow-wrap:anywhere]">{item}</span>
                <button
                  type="button"
                  aria-label={`Remove exclusion ${index + 1}: ${item}`}
                  title="Remove exclusion"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  onClick={() => write(points, drafts, avoid.filter((a) => a !== item))}
                  disabled={busy}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-4 text-xs leading-relaxed text-muted-foreground">No exclusions yet. Add anything these posts should avoid.</div>
        )}
        <div className="mt-3 space-y-2">
          <label htmlFor={`${fieldId}-avoid`} className="block text-xs font-medium">New exclusion</label>
          <Textarea
            id={`${fieldId}-avoid`}
            aria-describedby={`${fieldId}-avoid-help`}
            disabled={busy}
            value={newAvoid}
            onChange={(e) => setNewAvoid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addAvoid();
              }
            }}
            placeholder="e.g. Pricing, competitor names or unsupported results"
            rows={2}
            className="min-h-[68px] resize-y text-xs leading-relaxed"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${fieldId}-avoid-help`} className="text-[11px] text-muted-foreground">Enter to add · Shift + Enter for a new line</p>
            <Button type="button" variant="cta" size="sm" className="h-8 gap-1.5 text-xs" onClick={addAvoid} disabled={busy || !newAvoid.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add exclusion
            </Button>
          </div>
        </div>
      </section>

      {/* Where facts may come from */}
      <div className="mt-6 border-t pt-5">
        <label htmlFor={`${fieldId}-notes`} className="mb-2 block text-sm font-medium">Notes and facts</label>
        <p id={`${fieldId}-notes-help`} className="mb-2 text-xs text-muted-foreground">Add the facts, numbers or stories posts can use.</p>
        <Textarea
          id={`${fieldId}-notes`}
          aria-describedby={`${fieldId}-notes-help`}
          disabled={busy}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={5}
          className="min-h-[120px] resize-y text-sm leading-relaxed"
          placeholder="Add your notes…"
        />
        {sourceChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sourceChips.map((chip) => {
              const Icon = chip.kind === "link" ? Link2 : chip.kind === "product" ? ShoppingBag : BookOpen;
              const body = (
                <>
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{chip.label}</span>
                </>
              );
              const cls = "inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs leading-relaxed text-muted-foreground";
              return chip.href ? (
                <a key={chip.label} href={chip.href} title={chip.href} target="_blank" rel="noopener noreferrer" className={cn(cls, "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
                  {body}
                </a>
              ) : (
                <span key={chip.label} className={cls}>
                  {body}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          {approved ? "These guidelines are approved for content creation." : "Check the points, notes and exclusions before approving these guidelines."}
          {approveError && <p role="alert" className="mt-1 text-destructive">{approveError}</p>}
        </div>
        {approved ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onUnapprove} disabled={busy}>
            {isApproving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Undo approval
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={handleApprove} disabled={busy}>
            {isApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {isApproving ? "Approving…" : "Approve guidelines"}
          </Button>
        )}
      </div>
    </div>
  );
}
