import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface StudioSectionProps {
  step?: number;
  title: string;
  question: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  dashed?: boolean;
}

/** One numbered, collapsible part of the blueprint: summary visible when closed. */
export function StudioSection({ step, title, question, summary, open, onOpenChange, children, dashed }: StudioSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn("rounded-xl border bg-card", open && "border-foreground/15 shadow-sm")}>
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px]",
            dashed ? "border border-dashed border-muted-foreground/50" : open ? "bg-foreground text-background" : "bg-muted",
          )}
        >
          {step ?? ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{question}</span>
        </span>
        {summary && !open && <span className="hidden max-w-[45%] truncate text-right text-xs text-muted-foreground sm:block">{summary}</span>}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 px-4 pb-5 sm:pl-[3.25rem]">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-xs font-semibold text-foreground/80">{children}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

interface ChoiceChipsProps<T extends string> {
  options: Array<{ id: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Single-choice chips. */
export function ChoiceChips<T extends string>({ options, value, onChange, ariaLabel }: ChoiceChipsProps<T>) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === o.id ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = "md" }: SegmentedProps<T>) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border bg-background" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "transition-colors",
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
            i > 0 && "border-l",
            value === o.id ? "bg-foreground font-semibold text-background" : "hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
