import { useMemo, useRef } from "react";
import { AlertTriangle, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VARIABLE_CATALOG, analyzePrompt, promptProblems, replaceVariable, type VariableGroup } from "@/lib/prompt-variables";
import { cn } from "@/lib/utils";

const GROUP_STYLE: Record<VariableGroup, string> = {
  Topic: "bg-muted text-foreground",
  "AI angle": "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Brand: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Audience: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Product: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Person: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Date: "bg-muted text-muted-foreground",
  Video: "bg-muted text-muted-foreground",
};

const GROUP_ORDER: VariableGroup[] = ["Topic", "AI angle", "Brand", "Audience", "Product", "Person", "Date", "Video"];

interface PromptPillEditorProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
}

/**
 * A prompt textarea that names its variables in plain words: an insert menu
 * instead of remembering {{syntax}}, the variables in use shown as labelled
 * chips, and anything nothing will fill called out with a one-click fix.
 */
export function PromptPillEditor({ id, label, value, onChange, placeholder, minRows = 12 }: PromptPillEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const used = useMemo(() => {
    const seen = new Map<string, { label: string; group: VariableGroup }>();
    for (const t of analyzePrompt(value)) {
      if (t.kind !== "variable" || t.status !== "ok" || !t.group || seen.has(t.path)) continue;
      seen.set(t.path, { label: t.label, group: t.group });
    }
    return [...seen.entries()];
  }, [value]);
  const problems = useMemo(() => promptProblems(value), [value]);

  const insert = (token: string) => {
    const el = ref.current;
    const text = `{{${token}}}`;
    if (!el) return onChange(value + text);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-foreground/80">
          {label}
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
              <Braces className="mr-1 h-3.5 w-3.5" />
              Insert
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
            {GROUP_ORDER.map((group, gi) => (
              <div key={group}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">{group}</DropdownMenuLabel>
                {VARIABLE_CATALOG.filter((v) => v.group === group).map((v) => (
                  <DropdownMenuItem key={v.token} onClick={() => insert(v.token)} className="text-xs">
                    {v.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={minRows}
        className="font-mono text-xs leading-relaxed"
        spellCheck={false}
      />

      {used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Uses</span>
          {used.map(([path, v]) => (
            <span key={path} title={`{{${path}}}`} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", GROUP_STYLE[v.group])}>
              {v.label}
            </span>
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <ul className="space-y-1.5 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
          {problems.map((p) => (
            <li key={p.path} className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <code className="rounded bg-background/60 px-1">{`{{${p.path}}}`}</code>
              {p.status === "alias" && p.suggestion ? (
                <>
                  <span>is an old name.</span>
                  <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onChange(replaceVariable(value, p.path, p.suggestion!))}>
                    Use {`{{${p.suggestion}}}`}
                  </button>
                </>
              ) : (
                <span>Nothing fills this, so it's removed when the blueprint runs.</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
