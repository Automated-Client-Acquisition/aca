import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X, Wand2, PenLine, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { FORMATS, GOALS, OPENINGS, RULE_PRESETS, defaultBrief, type BlueprintBrief, type BriefLength } from "@/lib/blueprint-brief";
import { DEFAULT_CONTEXT } from "@/lib/blueprint-context";
import { cn } from "@/lib/utils";
import { ChoiceChips, FieldLabel, Segmented } from "./StudioSection";
import { PromptPillEditor } from "./PromptPillEditor";
import { draftFormat, isGuided, recompile, type StudioDraft } from "./draft";

const VIDEO_SECONDS: Record<BriefLength, number> = { short: 30, medium: 45, long: 60 };

interface BriefSectionProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
  onCopyFromPost: () => void;
}

export function BriefSection({ draft, onChange, onCopyFromPost }: BriefSectionProps) {
  const format = draftFormat(draft);
  const [confirm, setConfirm] = useState<"to_guided" | "to_custom" | null>(null);
  const [newPart, setNewPart] = useState("");
  const [newRule, setNewRule] = useState("");

  const guided = isGuided(draft);
  const brief = draft.brief;

  const setBrief = (patch: Partial<BlueprintBrief>) => {
    if (!brief) return;
    let next: StudioDraft = { ...draft, brief: { ...brief, ...patch } };
    if (patch.length && format === "video") {
      next = {
        ...next,
        model_config: {
          ...next.model_config,
          video_config_defaults: { ...(next.model_config.video_config_defaults ?? {}), targetDuration: VIDEO_SECONDS[patch.length] },
        },
      };
    }
    onChange(recompile(next));
  };

  const switchToGuided = () => {
    if (!format) return;
    onChange(recompile({ ...draft, brief: { ...defaultBrief(format), custom_prompt: false }, context: draft.context ?? DEFAULT_CONTEXT }));
  };

  const confirmDialog = (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm === "to_custom" ? "Edit the prompt by hand?" : "Replace the prompt with a guided brief?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirm === "to_custom"
              ? "The brief fields stop updating the prompt until you switch back. Switching back rebuilds the prompt from the fields and drops your hand edits."
              : "The prompt will be rebuilt from simple fields (goal, opening, shape, length, call to action). Your current wording is replaced."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (confirm === "to_custom" && brief) onChange({ ...draft, brief: { ...brief, custom_prompt: true } });
              if (confirm === "to_guided") {
                if (brief) onChange(recompile({ ...draft, brief: { ...brief, custom_prompt: false } }));
                else switchToGuided();
              }
              setConfirm(null);
            }}
          >
            {confirm === "to_custom" ? "Edit by hand" : "Use the brief"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!guided) {
    const isImage = draft.pipeline === "image_only";
    return (
      <>
        <PromptPillEditor
          id="studio-prompt"
          label={isImage ? "Image prompt" : "Prompt"}
          value={isImage ? draft.image_prompt : draft.master_prompt}
          onChange={(v) => onChange(isImage ? { ...draft, image_prompt: v } : { ...draft, master_prompt: v })}
          minRows={14}
        />
        {format && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            <span className="flex-1 min-w-[200px]">
              {brief ? "You're editing the prompt by hand. The brief fields are paused." : "This blueprint uses a hand-written prompt."}
            </span>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfirm("to_guided")}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {brief ? "Back to brief fields" : "Switch to a guided brief"}
            </Button>
          </div>
        )}
        {confirmDialog}
      </>
    );
  }

  const b = brief!;
  const f = format!;
  const customRules = b.rules.filter((r) => !RULE_PRESETS.includes(r) && !(f === "image" && r === "No text in the image"));
  const presetRules = f === "image" ? ["No text in the image", "No logos", "No watermarks"] : RULE_PRESETS;

  const moveShape = (i: number, dir: -1 | 1) => {
    const next = [...b.shape];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setBrief({ shape: next });
  };

  return (
    <>
      {f === "image" ? (
        <div>
          <FieldLabel hint="The topic is added automatically. Describe what's in the frame.">What should the picture show?</FieldLabel>
          <Textarea
            value={b.notes}
            onChange={(e) => setBrief({ notes: e.target.value })}
            placeholder="e.g. A founder at a desk late at night, lit by a laptop, looking relieved"
            rows={3}
          />
        </div>
      ) : (
        <>
          <div>
            <FieldLabel>Goal</FieldLabel>
            <ChoiceChips ariaLabel="Goal" options={GOALS} value={b.goal} onChange={(goal) => setBrief({ goal })} />
          </div>

          <div>
            <FieldLabel hint="The AI writes a fresh opening for each topic in this style.">
              {f === "carousel" ? "Cover slide" : f === "article" ? "First paragraph" : "Opening line"}
            </FieldLabel>
            <ChoiceChips ariaLabel="Opening" options={OPENINGS} value={b.opening} onChange={(opening) => setBrief({ opening })} />
          </div>

          <div>
            <FieldLabel>{f === "carousel" ? "Slides" : f === "article" ? "Sections" : f === "thread" ? "Sequence" : "Shape"}</FieldLabel>
            <ol className="space-y-1.5">
              {b.shape.map((part, i) => (
                <li key={i} className="flex items-center gap-1.5 rounded-md border bg-background pl-2.5 pr-1">
                  <span className="w-4 font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                  <input
                    value={part}
                    onChange={(e) => setBrief({ shape: b.shape.map((p, k) => (k === i ? e.target.value : p)) })}
                    className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none"
                    aria-label={`Part ${i + 1}`}
                  />
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => moveShape(i, -1)} aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === b.shape.length - 1} onClick={() => moveShape(i, 1)} aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setBrief({ shape: b.shape.filter((_, k) => k !== i) })} aria-label="Remove part">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
            <form
              className="mt-1.5 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newPart.trim()) return;
                setBrief({ shape: [...b.shape, newPart.trim()] });
                setNewPart("");
              }}
            >
              <Input value={newPart} onChange={(e) => setNewPart(e.target.value)} placeholder="Add a part, e.g. A surprising stat" className="h-8 text-xs" aria-label="New part" />
              <Button type="submit" variant="outline" size="sm" className="h-8" disabled={!newPart.trim()}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>

          <div>
            <FieldLabel>Length</FieldLabel>
            <Segmented
              ariaLabel="Length"
              options={(["short", "medium", "long"] as BriefLength[]).map((id) => ({
                id,
                label: `${id[0].toUpperCase()}${id.slice(1)} · ${FORMATS[f].lengths[id]}`,
              }))}
              value={b.length}
              onChange={(length) => setBrief({ length })}
            />
          </div>

          <div>
            <FieldLabel hint="Leave empty and the AI picks one that fits each topic.">Call to action</FieldLabel>
            <Input value={b.cta} onChange={(e) => setBrief({ cta: e.target.value })} placeholder="e.g. Comment PLAYBOOK and I'll send you the script" />
          </div>
        </>
      )}

      <div>
        <FieldLabel>House rules</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {presetRules.map((r) => {
            const on = b.rules.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => setBrief({ rules: on ? b.rules.filter((x) => x !== r) : [...b.rules, r] })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
                )}
              >
                {r}
              </button>
            );
          })}
          {customRules.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded-full border border-foreground bg-foreground py-1 pl-3 pr-1.5 text-xs text-background">
              {r}
              <button type="button" onClick={() => setBrief({ rules: b.rules.filter((x) => x !== r) })} aria-label={`Remove rule ${r}`} className="rounded-full p-0.5 hover:bg-background/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-1.5 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const r = newRule.trim().replace(/\.$/, "");
            if (!r || b.rules.includes(r)) return;
            setBrief({ rules: [...b.rules, r] });
            setNewRule("");
          }}
        >
          <Input value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="Add your own rule, e.g. Always mention a real number" className="h-8 text-xs" aria-label="New rule" />
          <Button type="submit" variant="outline" size="sm" className="h-8" disabled={!newRule.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>

      {f !== "image" && (
        <div>
          <FieldLabel>Anything else?</FieldLabel>
          <Textarea value={b.notes} onChange={(e) => setBrief({ notes: e.target.value })} placeholder="Extra instructions, in plain words" rows={2} />
        </div>
      )}

      <div className="flex flex-wrap gap-4 pt-1">
        <button type="button" className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline" onClick={onCopyFromPost}>
          <Wand2 className="h-3.5 w-3.5" />
          Build a blueprint from a post I like
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setConfirm("to_custom")}>
          <PenLine className="h-3.5 w-3.5" />
          Edit as prompt
        </button>
      </div>
      {confirmDialog}
    </>
  );
}
