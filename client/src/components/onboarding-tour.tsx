import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, MessageSquare, Sliders, Wand2, ChevronRight, 
  Gift, Clock, Users, type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface OnboardingTourProps {
  onClose: () => void;
  onStartFreeTrial: () => void;
}

interface Step {
  stepNumber: number;
  title: string;
  description: string;
  icon: LucideIcon;
  demoContent: React.ReactNode;
}

export function OnboardingTour({ onClose, onStartFreeTrial }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps: Step[] = [
    {
      stepNumber: 1,
      title: "Prompt Your Idea",
      description: "Simply type any topic you want to turn into a podcast. Our AI will research and create engaging content.",
      icon: MessageSquare,
      demoContent: (
        <div className="space-y-3">
          <div className="p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-2">Example Topic:</p>
            <p className="text-sm font-medium">"The Future of Electric Vehicles"</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 bg-card rounded border border-border/50">
              <Gift className="w-3 h-3 text-primary mb-1" />
              <p className="font-semibold">3 Free credits</p>
            </div>
            <div className="p-2 bg-card rounded border border-border/50">
              <Clock className="w-3 h-3 text-primary mb-1" />
              <p className="font-semibold">2-60 Minutes</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      stepNumber: 2,
      title: "Set Your Custom Controls",
      description: "Choose podcast style, voices, duration, and mood. Customize everything to match your vision.",
      icon: Sliders,
      demoContent: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 bg-muted/50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground mb-1">Style</p>
              <p className="text-xs font-semibold">News Report</p>
            </div>
            <div className="p-2.5 bg-muted/50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground mb-1">Duration</p>
              <p className="text-xs font-semibold">5 minutes</p>
            </div>
          </div>
          <div className="p-2.5 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-1.5">Voice Selection</p>
            <div className="flex gap-1.5">
              <Badge variant="secondary" className="text-xs px-2 py-0.5">Sarah</Badge>
              <Badge variant="secondary" className="text-xs px-2 py-0.5">Marcus</Badge>
            </div>
          </div>
          <div className="p-2 bg-card rounded border border-border/50 text-center">
            <Users className="w-3 h-3 text-primary mx-auto mb-1" />
            <p className="text-xs font-semibold">59 Premium Voices</p>
          </div>
        </div>
      ),
    },
    {
      stepNumber: 3,
      title: "Brew Your Podcast",
      description: "Click generate and our AI creates your complete podcast with voices, script, music, and cover art in minutes.",
      icon: Wand2,
      demoContent: (
        <div className="space-y-3">
          <div className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
                <Wand2 className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">Ready to Create?</p>
                <p className="text-xs text-muted-foreground">Start with 3 FREE credits</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>AI Script</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Voice Acting</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Cover Art</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Background Music</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onStartFreeTrial();
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 md:p-4"
        data-testid="onboarding-tour-overlay"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="relative w-full max-w-md bg-gradient-to-br from-background via-background to-primary/5 rounded-2xl shadow-2xl border border-primary/20 overflow-hidden max-h-[90vh] flex flex-col"
          data-testid="onboarding-tour-modal"
        >
          {/* Premium gradient accent */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-green-400 to-primary" />
          
          {/* Close button */}
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 z-10 p-1.5 rounded-full hover-elevate active-elevate-2 text-muted-foreground hover:text-foreground transition-colors bg-background/50 backdrop-blur-sm"
            data-testid="button-close-tour"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Scrollable Content */}
          <div className="overflow-y-auto flex-1 p-5 md:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                {/* Step Indicator */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-primary/10 border-primary text-primary text-xs px-2 py-1">
                    Step {currentStepData.stepNumber} of {steps.length}
                  </Badge>
                </div>

                {/* Icon & Title */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                      <currentStepData.icon className="w-7 h-7 text-primary" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold" data-testid="text-tour-title">
                      {currentStepData.title}
                    </h2>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {currentStepData.description}
                  </p>
                </div>

                {/* Demo Content */}
                <div className="bg-card/30 rounded-xl p-4 border border-border/50">
                  {currentStepData.demoContent}
                </div>

                {/* Progress Dots */}
                <div className="flex justify-center gap-2 pt-2">
                  {steps.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentStep(index)}
                      className={`h-1.5 rounded-full transition-all ${
                        index === currentStep
                          ? "w-6 bg-primary"
                          : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                      }`}
                      data-testid={`progress-dot-${index}`}
                      aria-label={`Go to step ${index + 1}`}
                    />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Fixed Footer with Actions */}
          <div className="border-t border-border/50 p-4 bg-background/50 backdrop-blur-sm">
            <div className="flex gap-2">
              {!isLastStep ? (
                <>
                  <Button
                    variant="outline"
                    onClick={handleSkip}
                    className="flex-1"
                    data-testid="button-skip-onboarding"
                  >
                    Skip
                  </Button>
                  <Button
                    onClick={handleNext}
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    data-testid="button-onboarding-next"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleNext}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-11 relative overflow-hidden group"
                  data-testid="button-start-free-trial"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <Gift className="w-5 h-5" />
                    Start FREE Trial Now
                  </span>
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-green-400/20 to-primary/20"
                    animate={{
                      x: ["-100%", "100%"],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 2,
                      ease: "linear",
                    }}
                  />
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
