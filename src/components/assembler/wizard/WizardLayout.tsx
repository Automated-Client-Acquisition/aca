import { ReactNode, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StepProgress } from "./StepProgress";
import { WizardState, WizardActions } from "@/types/wizard";
import { ArrowLeft, ArrowRight, Zap } from "lucide-react";

interface WizardLayoutProps extends WizardState, WizardActions {
  children: ReactNode;
  onLastStepAction?: () => void;
  isLastStepPending?: boolean;
}

export function WizardLayout({
  steps,
  currentStepIndex,
  goToStep,
  nextStep,
  prevStep,
  canProceed,
  children,
  onLastStepAction,
  isLastStepPending = false,
}: WizardLayoutProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  // Scroll to top when step changes
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [currentStepIndex]);

  return (
    <div className="flex flex-col h-full">
      {/* Progress Header */}
      <StepProgress
        steps={steps}
        currentStepIndex={currentStepIndex}
        onStepClick={goToStep}
      />

      {/* Main Content Area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Step {currentStepIndex + 1} of {steps.length}
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={prevStep}
                disabled={isFirstStep}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>

              {isLastStep ? (
                <Button
                  size="lg"
                  onClick={onLastStepAction}
                  disabled={(!canProceed() || !onLastStepAction) || isLastStepPending}
                  variant="cta"
                  className="font-semibold px-8 shadow-lg"
                >
                  {isLastStepPending ? (
                    <>
                      <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-cta-foreground border-t-transparent" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Zap className="h-5 w-5 mr-2" />
                      Generate Content
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  variant="cta"
                  onClick={nextStep}
                  disabled={!canProceed()}
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
