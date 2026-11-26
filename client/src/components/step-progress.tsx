import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  number: number;
  title: string;
  description: string;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function StepProgress({ steps, currentStep, className }: StepProgressProps) {
  return (
    <div className={cn("w-full", className)} data-testid="container-step-progress">
      {/* Mobile: Sleek Pill Segment Progress */}
      <div className="md:hidden">
        <div className="flex items-center gap-1.5">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isComplete = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;
            
            return (
              <div
                key={step.number}
                className={cn(
                  "flex-1 h-1.5 rounded-full transition-all duration-300",
                  isComplete && "bg-primary",
                  isCurrent && "bg-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
                  !isComplete && !isCurrent && "bg-muted/40"
                )}
                data-testid={`progress-segment-${stepNumber}`}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-muted-foreground">
            {currentStep}/{steps.length}
          </span>
          <span className="text-[10px] font-medium text-foreground/80">
            {steps[currentStep - 1]?.title}
          </span>
        </div>
      </div>

      {/* Desktop: Full Steps */}
      <div className="hidden md:block">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isComplete = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;
            const isUpcoming = stepNumber > currentStep;

            return (
              <div key={step.number} className="flex items-center flex-1">
                <div className="flex items-center gap-3">
                  {/* Circle */}
                  <div
                    className={cn(
                      "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all",
                      isComplete && "bg-primary border-primary text-primary-foreground",
                      isCurrent && "border-primary bg-primary/10 text-primary",
                      isUpcoming && "border-border bg-background text-muted-foreground"
                    )}
                    data-testid={`step-circle-${stepNumber}`}
                  >
                    {isComplete ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <span className="font-semibold">{stepNumber}</span>
                    )}
                  </div>

                  {/* Text */}
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        (isComplete || isCurrent) && "text-foreground",
                        isUpcoming && "text-muted-foreground"
                      )}
                      data-testid={`step-title-${stepNumber}`}
                    >
                      {step.title}
                    </div>
                    <div
                      className={cn(
                        "text-xs",
                        (isComplete || isCurrent) && "text-muted-foreground",
                        isUpcoming && "text-muted-foreground/60"
                      )}
                    >
                      {step.description}
                    </div>
                  </div>
                </div>

                {/* Connector Line */}
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-0.5 mx-4 transition-all",
                      isComplete ? "bg-primary" : "bg-border"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
