import type { StepType } from "@/types/email";

/** One color per action type throughout the sequence workspace. */
export const SEQUENCE_STEP_STYLES: Record<
  StepType,
  {
    icon: string;
    label: string;
    row: string;
    selected: string;
    accent: string;
  }
> = {
  email: {
    icon: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    label: "text-blue-700 dark:text-blue-300",
    row: "bg-blue-500/[0.035] hover:bg-blue-500/[0.08]",
    selected: "border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/15",
    accent: "border-t-blue-500/70",
  },
  delay: {
    icon: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    label: "text-amber-800 dark:text-amber-300",
    row: "bg-amber-500/[0.035] hover:bg-amber-500/[0.08]",
    selected: "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/15",
    accent: "border-t-amber-500/70",
  },
  condition: {
    icon: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    label: "text-violet-700 dark:text-violet-300",
    row: "bg-violet-500/[0.035] hover:bg-violet-500/[0.08]",
    selected: "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/15",
    accent: "border-t-violet-500/70",
  },
  ab_test: {
    icon: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    label: "text-emerald-700 dark:text-emerald-300",
    row: "bg-emerald-500/[0.035] hover:bg-emerald-500/[0.08]",
    selected:
      "border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/15",
    accent: "border-t-emerald-500/70",
  },
};
