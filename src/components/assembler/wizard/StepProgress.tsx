import { WizardStep } from "@/types/wizard";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepProgressProps {
  steps: WizardStep[];
  currentStepIndex: number;
  onStepClick: (index: number) => void;
}

export function StepProgress({ steps, currentStepIndex, onStepClick }: StepProgressProps) {
  return (
    <div className="w-full py-4 px-4 sm:px-6 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center">
          {steps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isComplete = step.isComplete;
            const isPast = index < currentStepIndex;
            const isClickable = isPast || isComplete;

            return (
              <div key={step.id} className="flex items-center flex-1 last:flex-none min-w-0">
                {/* Step Circle + Label */}
                <button
                  onClick={() => isClickable && onStepClick(index)}
                  disabled={!isClickable}
                  className={cn(
                    "flex items-center gap-2 group transition-all shrink-0",
                    isClickable && "cursor-pointer hover:scale-105"
                  )}
                >
                  <div
                    className={cn(
                      "relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all shrink-0",
                      isActive && "border-cta bg-cta text-cta-foreground shadow-lg shadow-cta/20",
                      isComplete && !isActive && "border-cta bg-cta text-cta-foreground",
                      !isActive && !isComplete && "border-border bg-muted text-muted-foreground"
                    )}
                  >
                    <span className="text-xs font-medium">{index + 1}</span>
                    {isComplete && (
                      <Check className="h-3.5 w-3.5 absolute -bottom-0.5 -right-0.5 bg-white text-cta rounded-full p-0.5 border border-cta/30" />
                    )}
                  </div>

                  {/* Step Label - Only show title on md+, description on xl+ */}
                  <div className="text-left hidden md:block max-w-[140px] xl:max-w-[180px]">
                    <p
                      className={cn(
                        "text-xs font-medium leading-tight transition-colors truncate",
                        isActive && "text-foreground",
                        !isActive && "text-muted-foreground group-hover:text-foreground"
                      )}
                    >
                      {step.title}
                    </p>
                    <p className="text-[10px] leading-tight text-muted-foreground hidden xl:block truncate mt-0.5">
                      {step.description}
                    </p>
                  </div>
                </button>

                {/* Connector Line */}
                {index < steps.length - 1 && (
                  <div className="flex-1 h-0.5 mx-2 sm:mx-3 bg-border relative min-w-[16px]">
                    <div
                      className={cn(
                        "absolute inset-0 bg-cta transition-all duration-500",
                        isPast ? "w-full" : "w-0"
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
