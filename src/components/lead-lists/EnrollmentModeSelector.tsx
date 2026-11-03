import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle } from "lucide-react";
import { isLivingLeadList, type LeadList } from "@/hooks/useLeadLists";

interface EnrollmentModeSelectorProps {
  value: boolean;
  onChange: (ongoing: boolean) => void;
  /** Source counts are context only; matching members are not guaranteed recipients. */
  leadCount: number;
  list?: Pick<LeadList, "is_smart" | "source_type"> | null;
  awaitingProcessing?: number;
  disabled?: boolean;
  className?: string;
  context?: "campaign" | "sequence";
}

/** Both builders use the destination-wide auto_enroll_new_members setting. */
export function EnrollmentModeSelector({
  value,
  onChange,
  list,
  awaitingProcessing = 0,
  disabled,
  className,
  context,
}: EnrollmentModeSelectorProps) {
  const recommendOngoing = isLivingLeadList(list) || awaitingProcessing > 0;
  const options = [
    {
      ongoing: true,
      label: "Continuous enrollment",
      recommended: recommendOngoing,
      desc: "Evaluate current members, then automatically check new additions and new segment matches while outreach is active.",
    },
    {
      ongoing: false,
      label: "One-time audience",
      recommended: !recommendOngoing,
      desc: context === "campaign"
        ? "Evaluate the current audience when you launch. Later additions and new segment matches are not enrolled automatically."
        : "Review and enroll the current audience when ready. Later additions and new segment matches are not enrolled automatically.",
    },
  ];

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm font-medium">When should members enter?</p>
      <div role="radiogroup" aria-label="Audience enrollment mode" className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = value === option.ongoing;
          const SelectionIcon = selected ? CheckCircle2 : Circle;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-ongoing={option.ongoing}
              disabled={disabled}
              onClick={() => onChange(option.ongoing)}
              onKeyDown={(event) => {
                if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const ongoing = event.key === "Home" ? true : event.key === "End" ? false : !option.ongoing;
                onChange(ongoing);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-ongoing="${ongoing}"]`)?.focus();
              }}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                selected ? "border-amber-500/50 bg-amber-500/5" : "hover:border-foreground/25 hover:bg-muted/40",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <SelectionIcon className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.recommended && <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px]">Recommended</Badge>}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{option.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {context === "campaign"
          ? "Direct sources use the campaign’s exclusions, enrollment filters and product fit rules."
          : "Direct sources use the sequence’s enrollment filters, suppression rules and email availability checks."}
        {awaitingProcessing > 0 && ` ${awaitingProcessing.toLocaleString()} source memberships are still in lead processing; processing routes admit members only after approval.`}
      </p>
    </div>
  );
}
