import { cn } from "@/lib/utils";

interface Step {
  number: number;
  label: string;
  sublabel?: string;
  active: boolean;
}

const steps: Step[] = [
  { number: 1, label: "Choose", sublabel: "Type", active: true },
  { number: 2, label: "Select", sublabel: "Ideas", active: false },
  { number: 3, label: "Choose", sublabel: "Blueprint", active: false },
  { number: 4, label: "Generate", active: false },
];

export function StepIndicator() {
  return (
    <div className="flex items-center gap-8 mb-8">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center font-medium transition-colors",
              step.active 
                ? "bg-foreground text-background" 
                : "bg-muted text-muted-foreground"
            )}>
              {step.number}
            </div>
            <div>
              <div className={cn(
                "text-sm font-medium",
                step.active ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </div>
              {step.sublabel && (
                <div className={cn(
                  "text-xs",
                  step.active ? "text-muted-foreground" : "text-muted-foreground/60"
                )}>
                  {step.sublabel}
                </div>
              )}
            </div>
          </div>
          {index < steps.length - 1 && (
            <div className="w-12 h-px bg-border" />
          )}
        </div>
      ))}
    </div>
  );
}
