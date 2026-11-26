import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Check, Sparkles, Settings2, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CostSummary } from "@/components/CostSummary";

export interface WizardStep {
  id: string;
  title: string;
  shortTitle: string;
  icon: React.ReactNode;
  content: React.ReactNode;
  isValid?: boolean;
}

interface FormWizardProps {
  steps: WizardStep[];
  onSubmit: (e: React.FormEvent, ...args: any[]) => void;
  isGenerating: boolean;
  submitButtonText: string;
  submitButtonGeneratingText: string;
  submitArgs?: any[];
  creditsData?: { credits: number; plan: string };
  durationMinutes?: number;
  templateName?: string;
  hasSubmittedWithoutChanges?: boolean;
  showBrewPulse?: boolean;
}

export function FormWizard({
  steps,
  onSubmit,
  isGenerating,
  submitButtonText,
  submitButtonGeneratingText,
  submitArgs = [],
  creditsData,
  durationMinutes = 2,
  templateName = "custom",
  hasSubmittedWithoutChanges = false,
  showBrewPulse = false,
}: FormWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const hasUserNavigated = useRef(false);

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const currentStepData = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  const canProceed = currentStepData.isValid !== false && !hasSubmittedWithoutChanges;

  // Scroll to progress bar only when user manually navigates steps (not on initial load)
  useEffect(() => {
    if (hasUserNavigated.current && progressBarRef.current) {
      progressBarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentStep]);

  const handleNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLastStep && canProceed) {
      hasUserNavigated.current = true;
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isFirstStep) {
      hasUserNavigated.current = true;
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleStepClick = (index: number) => {
    if (index < currentStep || (index === currentStep + 1 && canProceed)) {
      hasUserNavigated.current = true;
      setCurrentStep(index);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLastStep && canProceed) {
      onSubmit(e, ...submitArgs);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 overflow-x-hidden">
      {/* Progress Bar */}
      <div ref={progressBarRef} className="space-y-2">
        <Progress value={progress} className="h-1.5 w-full" />
        
        {/* Step Indicators */}
        <div className="flex justify-between items-center px-1">
          {steps.map((step, index) => {
            const isCompleted = index < currentStep;
            const isCurrent = index === currentStep;
            const isClickable = index < currentStep || (index === currentStep + 1 && canProceed);
            
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => handleStepClick(index)}
                disabled={!isClickable && !isCurrent}
                className={cn(
                  "flex flex-col items-center gap-1 transition-all",
                  isClickable || isCurrent ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                )}
                data-testid={`wizard-step-${step.id}`}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                    isCompleted && "bg-primary text-primary-foreground",
                    isCurrent && "bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    step.icon
                  )}
                </div>
                <span className={cn(
                  "text-xs font-medium hidden sm:block",
                  isCurrent ? "text-primary" : "text-muted-foreground"
                )}>
                  {step.shortTitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step Title */}
      <div className="flex items-center gap-2 pt-2">
        <span className="text-lg font-semibold">{currentStepData.title}</span>
      </div>

      {/* Step Content */}
      <div>
        {currentStepData.content}
      </div>

      {/* Costing Tile - Only on last step above submit button */}
      {isLastStep && creditsData && durationMinutes && !isGenerating && (
        <CostSummary durationMinutes={durationMinutes} creditsData={creditsData} templateName={templateName} />
      )}

      {/* Navigation Buttons */}
      <div className="flex gap-3 pt-2 pb-2">
        {!isFirstStep && (
          <Button
            type="button"
            variant="outline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handlePrev(e);
            }}
            disabled={isGenerating}
            className="flex-1"
            data-testid="wizard-prev"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        )}
        
        {isLastStep ? (
          <Button
            type="submit"
            disabled={!canProceed || isGenerating}
            className={cn(
              "flex-1 text-base font-semibold",
              showBrewPulse ? "animate-pulsate-finite" : canProceed && !isGenerating && "animate-pulsate"
            )}
            data-testid="wizard-submit"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {isGenerating ? submitButtonGeneratingText : submitButtonText}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleNext(e);
            }}
            disabled={!canProceed || isGenerating}
            className="flex-1"
            data-testid="wizard-next"
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </form>
  );
}

export const WIZARD_STEP_ICONS = {
  topic: <Sparkles className="w-4 h-4" />,
  settings: <Settings2 className="w-4 h-4" />,
  voice: <Mic2 className="w-4 h-4" />,
};
