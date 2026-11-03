import { useEffect, useRef } from "react";
import {
  AlertCircle,
  FileText,
  Users,
  Send,
  GitBranch,
  Settings2,
  ListChecks,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardStep } from "@/hooks/useCampaignBuilder";
import { WIZARD_STEPS, STEP_LABELS } from "@/hooks/useCampaignBuilder";

interface WizardNavigationProps {
  currentStep: WizardStep;
  onStepClick: (step: WizardStep) => void;
  isStepValid: (step: WizardStep) => boolean;
  completedSteps?: WizardStep[];
  compact?: boolean;
  showIssues?: boolean;
}

const ICONS = {
  name: FileText,
  leads: Users,
  triggers: Zap,
  senders: Send,
  sequence: GitBranch,
  settings: Settings2,
  review: ListChecks,
};

export function WizardNavigation({
  currentStep,
  onStepClick,
  isStepValid,
  showIssues = true,
}: WizardNavigationProps) {
  const activeSectionRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeSectionRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [currentStep]);
  return (
    <nav
      aria-label="Campaign editor sections"
      className="shrink-0 overflow-x-auto border-b bg-card px-3 sm:px-6"
    >
      <div className="flex w-max min-w-full gap-1 sm:gap-4">
        {WIZARD_STEPS.map((step) => {
          const Icon = ICONS[step];
          const isActive = step === currentStep;
          const hasIssue = showIssues && !isStepValid(step) && step !== "review";
          return (
            <button
              key={step}
              ref={isActive ? activeSectionRef : undefined}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onStepClick(step)}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isActive
                  ? "border-amber-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {STEP_LABELS[step]}
              {hasIssue && (
                <AlertCircle
                  className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
                  aria-label="Needs attention"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
