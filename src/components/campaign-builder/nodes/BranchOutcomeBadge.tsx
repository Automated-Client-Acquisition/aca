import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BranchOutcomeTone = "positive" | "negative" | "neutral";

interface BranchOutcomeBadgeProps {
  label: ReactNode;
  tone: BranchOutcomeTone;
  selected?: boolean;
}

const TONE_STYLES: Record<BranchOutcomeTone, string> = {
  positive: "bg-[#e8f3eb] text-[#2c7a4b] dark:bg-emerald-950 dark:text-emerald-300",
  negative: "bg-[#fbe6de] text-[#a8492c] dark:bg-orange-950 dark:text-orange-300",
  neutral: "bg-[#f1eee5] text-[#64655d] dark:bg-stone-800 dark:text-stone-300",
};

export function BranchOutcomeBadge({ label, tone, selected }: BranchOutcomeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[180px] items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4 shadow-[0_0_0_3px_hsl(var(--background))]",
        TONE_STYLES[tone],
        selected && "ring-1 ring-amber-500/80",
      )}
    >
      <span className="min-w-0 break-words text-center">{label}</span>
    </span>
  );
}
