import { useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; instruction: string }[] = [
  { label: "Shorter", instruction: "Make it about 30% shorter. Keep the strongest points and the ending." },
  { label: "Stronger opening", instruction: "Rewrite the first two lines so they stop the scroll. Keep the rest close to the original." },
  { label: "More casual", instruction: "Make the tone more casual and conversational, like talking to a peer." },
  { label: "More expert", instruction: "Make it sound more expert and specific: concrete numbers, precise wording, no fluff." },
  { label: "Fix grammar", instruction: "Fix grammar, spelling and punctuation only. Change nothing else." },
];

interface RewriteBarProps {
  text: string;
  disabled?: boolean;
  rewrite: (instruction: string) => Promise<string>;
  onUse: (text: string) => Promise<unknown>;
  saving: boolean;
}

/**
 * One-click rewrites. The result is a suggestion shown next to nothing else;
 * the post only changes when the person picks "Use this".
 */
export function RewriteBar({ text, disabled, rewrite, onUse, saving }: RewriteBarProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ label: string; instruction: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);

  const run = async (label: string, instruction: string) => {
    setPending(label);
    setError(null);
    try {
      const out = await rewrite(instruction);
      setSuggestion({ label, instruction, text: out });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The rewrite failed");
    } finally {
      setPending(null);
    }
  };

  const busy = !!pending || disabled || !text.trim();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Rewrite
        </span>
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-3 text-xs"
            disabled={busy}
            onClick={() => run(p.label, p.instruction)}
          >
            {pending === p.label && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {p.label}
          </Button>
        ))}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 rounded-full px-3 text-xs" disabled={busy}>
              {pending === "Your way" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Your way…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-2">
            <Input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. end with a question, mention our webinar"
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  setCustomOpen(false);
                  run("Your way", custom.trim());
                }
              }}
            />
            <div className="flex justify-end">
              <Button
                variant="cta"
                size="sm"
                disabled={!custom.trim()}
                onClick={() => {
                  setCustomOpen(false);
                  run("Your way", custom.trim());
                }}
              >
                Rewrite
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {suggestion && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold">Suggestion · {suggestion.label}</span>
            <span className="text-xs text-muted-foreground">
              {suggestion.text.length.toLocaleString()} characters (was {text.length.toLocaleString()})
            </span>
          </div>
          <div className={cn("max-h-80 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed")}>{suggestion.text}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="cta"
              size="sm"
              disabled={saving}
              onClick={() => onUse(suggestion.text).then(() => setSuggestion(null))}
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Use this
            </Button>
            <Button variant="outline" size="sm" disabled={!!pending} onClick={() => run(suggestion.label, suggestion.instruction)}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              Another take
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSuggestion(null)}>
              Keep mine
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
