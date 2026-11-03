import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingStep } from "@/hooks/useOnboardingState";

// New streamlined 4-step flow
const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'setup', label: 'Your keys' },
  { id: 'quick-win', label: 'First Idea' },
  { id: 'success', label: 'Ready!' },
];

interface OnboardingProgressProps {
  currentStep: OnboardingStep;
}

export function OnboardingProgress({ currentStep }: OnboardingProgressProps) {
  const currentIndex = STEPS.findIndex(s => s.id === currentStep);

  return (
    <div className="w-full max-w-4xl mx-auto px-8 py-6">
      <div className="flex items-center justify-between relative">
        {/* Progress line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-border">
          <div 
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${(currentIndex / (STEPS.length - 1)) * 100}%` }}
          />
        </div>

        {/* Step indicators */}
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          
          return (
            <div key={step.id} className="flex flex-col items-center gap-2 relative z-10">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110",
                  !isCompleted && !isCurrent && "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors whitespace-nowrap",
                  isCurrent && "text-foreground",
                  !isCurrent && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
