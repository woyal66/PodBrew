import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, MessageSquare, Palette, Mic2, Headphones, ChevronRight, 
  Gift, HelpCircle, type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAnalytics } from "@/hooks/use-analytics";
import { useToast } from "@/hooks/use-toast";

interface SpotlightTourProps {
  onClose: () => void;
  onComplete: () => void;
}

interface Step {
  stepNumber: number;
  title: string;
  description: string;
  icon: LucideIcon;
  targetSelector?: string;
  position: "top" | "bottom" | "left" | "right" | "center";
  highlightClass?: string;
}

export function SpotlightTour({ onClose, onComplete }: SpotlightTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightPosition, setSpotlightPosition] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const { trackTourStarted, trackTourCompleted, trackTourSkipped } = useAnalytics();
  const { toast } = useToast();

  // Lock scroll when tour is active
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    
    trackTourStarted();
    
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.width = '';
      document.body.style.height = '';
    };
  }, []);

  const steps: Step[] = [
    {
      stepNumber: 1,
      title: "Start with Any Topic",
      description: "Type any topic, upload a document, or choose from trending topics. The AI will research and create engaging content for your podcast.",
      icon: MessageSquare,
      targetSelector: '[data-testid="input-topic"]',
      position: "bottom",
    },
    {
      stepNumber: 2,
      title: "Choose Your Style",
      description: "Select from 9 podcast styles: Conversational, News, Debate, Interview, Tutor, and more. Each style creates a unique listening experience.",
      icon: Palette,
      targetSelector: '[data-testid="select-podcast-style"]',
      position: "bottom",
    },
    {
      stepNumber: 3,
      title: "Pick Premium Voices",
      description: "Choose from 59 professional AI voices across 4 quality tiers. Mix up to 5 hosts for dynamic conversations.",
      icon: Mic2,
      targetSelector: '[data-testid="button-choose-voices"]',
      position: "bottom",
    },
    {
      stepNumber: 4,
      title: "Explore & Listen",
      description: "Discover unlimited free podcasts created by the community. Listen, favorite, and get inspired for your own creations.",
      icon: Headphones,
      targetSelector: '[data-testid="nav-listen"]',
      position: "bottom",
    },
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  // Calculate spotlight position and ensure element is visible
  useEffect(() => {
    if (currentStepData.targetSelector) {
      const target = document.querySelector(currentStepData.targetSelector) as HTMLElement;
      if (target) {
        // Add highlight class
        target.classList.add('spotlight-highlight');
        
        // Scroll element into view smoothly
        target.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'center'
        });
        
        // Use requestAnimationFrame to measure after scroll completes
        const measurePosition = () => {
          requestAnimationFrame(() => {
            const rect = target.getBoundingClientRect();
            const padding = 8;
            
            // Guard against zero-size rects
            if (rect.width > 0 && rect.height > 0) {
              setSpotlightPosition({
                x: Math.max(0, rect.left - padding),
                y: Math.max(0, rect.top - padding),
                width: rect.width + padding * 2,
                height: rect.height + padding * 2,
              });
            }
          });
        };
        
        // Initial measurement
        measurePosition();
        
        // Re-measure after scroll animation completes (typical smooth scroll is ~300ms)
        const scrollTimeout = setTimeout(measurePosition, 400);
        
        return () => {
          target.classList.remove('spotlight-highlight');
          clearTimeout(scrollTimeout);
        };
      }
    }
  }, [currentStep, currentStepData.targetSelector]);

  const handleNext = () => {
    if (isLastStep) {
      trackTourCompleted(steps.length);
      onComplete();
      
      // Show toast nudge to explore Listen page (no emoji - using icon instead)
      setTimeout(() => {
        toast({
          title: "Explore Free Podcasts",
          description: "Check out the Listen tab to discover unlimited free podcasts created by the community.",
          duration: 8000,
        });
      }, 2000);
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleSkip = () => {
    trackTourSkipped(currentStep + 1);
    onClose();
  };

  // Calculate tooltip position with viewport bounds checking
  const getTooltipPosition = () => {
    const isMobile = window.innerWidth < 640;
    
    // Mobile: always top-center
    if (isMobile) {
      return {
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
      };
    }
    
    // Desktop positioning
    const { position } = currentStepData;
    const offset = 16;
    const tooltipEstimatedHeight = 280;
    const tooltipEstimatedWidth = 384;
    const viewportPadding = 20;
    
    // Center in viewport if no target
    if (!currentStepData.targetSelector || spotlightPosition.width === 0) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Calculate position based on preferred direction
    let top = 0;
    let left = 0;
    let transform = '';

    // Determine if we need to use transform for centering
    const useHorizontalCenter = position === 'top' || position === 'bottom';
    const useVerticalCenter = position === 'left' || position === 'right';

    // Calculate base position
    if (position === 'bottom') {
      top = spotlightPosition.y + spotlightPosition.height + offset;
      left = spotlightPosition.x + spotlightPosition.width / 2;
      transform = 'translateX(-50%)';
    } else if (position === 'top') {
      top = spotlightPosition.y - tooltipEstimatedHeight - offset;
      left = spotlightPosition.x + spotlightPosition.width / 2;
      transform = 'translateX(-50%)';
    } else if (position === 'left') {
      top = spotlightPosition.y + spotlightPosition.height / 2;
      left = spotlightPosition.x - tooltipEstimatedWidth - offset;
      transform = 'translateY(-50%)';
    } else if (position === 'right') {
      top = spotlightPosition.y + spotlightPosition.height / 2;
      left = spotlightPosition.x + spotlightPosition.width + offset;
      transform = 'translateY(-50%)';
    }

    // Clamp to viewport bounds and adjust transform accordingly
    let finalTop = top;
    let finalLeft = left;
    let finalTransform = transform;

    // Vertical clamping
    if (useVerticalCenter) {
      const halfHeight = tooltipEstimatedHeight / 2;
      if (top - halfHeight < viewportPadding) {
        finalTop = viewportPadding;
        finalTransform = ''; // Remove vertical centering
      } else if (top + halfHeight > viewportHeight - viewportPadding) {
        finalTop = viewportHeight - tooltipEstimatedHeight - viewportPadding;
        finalTransform = ''; // Remove vertical centering
      }
    } else {
      if (top < viewportPadding) {
        finalTop = viewportPadding;
      } else if (top + tooltipEstimatedHeight > viewportHeight - viewportPadding) {
        finalTop = viewportHeight - tooltipEstimatedHeight - viewportPadding;
      }
    }

    // Horizontal clamping
    if (useHorizontalCenter) {
      const halfWidth = tooltipEstimatedWidth / 2;
      if (left - halfWidth < viewportPadding) {
        finalLeft = viewportPadding + halfWidth;
      } else if (left + halfWidth > viewportWidth - viewportPadding) {
        finalLeft = viewportWidth - halfWidth - viewportPadding;
      }
    } else {
      if (left < viewportPadding) {
        finalLeft = viewportPadding;
        finalTransform = ''; // Remove horizontal centering
      } else if (left + tooltipEstimatedWidth > viewportWidth - viewportPadding) {
        finalLeft = viewportWidth - tooltipEstimatedWidth - viewportPadding;
        finalTransform = ''; // Remove horizontal centering
      }
    }

    return {
      top: `${finalTop}px`,
      left: `${finalLeft}px`,
      transform: finalTransform || undefined,
    };
  };

  // Don't render until spotlight position is calculated
  const isPositionReady = !currentStepData.targetSelector || spotlightPosition.width > 0;

  if (!isPositionReady) {
    return null;
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] pointer-events-none" data-testid="spotlight-tour-overlay">
        {/* Semi-transparent overlay with spotlight cutout */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          style={{
            clipPath: currentStepData.targetSelector && spotlightPosition.width > 0
              ? `polygon(
                  0% 0%, 0% 100%, ${spotlightPosition.x}px 100%, 
                  ${spotlightPosition.x}px ${spotlightPosition.y}px, 
                  ${spotlightPosition.x + spotlightPosition.width}px ${spotlightPosition.y}px, 
                  ${spotlightPosition.x + spotlightPosition.width}px ${spotlightPosition.y + spotlightPosition.height}px, 
                  ${spotlightPosition.x}px ${spotlightPosition.y + spotlightPosition.height}px, 
                  ${spotlightPosition.x}px 100%, 100% 100%, 100% 0%
                )`
              : 'none',
          }}
        />

        {/* Spotlight highlight ring */}
        {currentStepData.targetSelector && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background/10 pointer-events-none"
            style={{
              left: `${spotlightPosition.x}px`,
              top: `${spotlightPosition.y}px`,
              width: `${spotlightPosition.width}px`,
              height: `${spotlightPosition.height}px`,
            }}
          />
        )}

        {/* Tooltip Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: "spring", duration: 0.4 }}
          className="absolute pointer-events-auto w-[min(calc(100vw-2rem),24rem)] sm:w-[min(90vw,24rem)]"
          style={getTooltipPosition()}
          data-testid="spotlight-tour-tooltip"
        >
          <Card className="bg-background/95 backdrop-blur-md border-primary/30 shadow-2xl">
            <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2 sm:gap-3">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
                    <currentStepData.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="bg-primary/10 border-primary text-primary text-xs mb-1 sm:mb-2">
                      Step {currentStepData.stepNumber} of {steps.length}
                    </Badge>
                    <h3 className="text-base sm:text-lg font-bold truncate" data-testid="text-spotlight-title">
                      {currentStepData.title}
                    </h3>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSkip}
                  className="shrink-0 h-7 w-7 sm:h-8 sm:w-8"
                  data-testid="button-close-spotlight"
                >
                  <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              </div>

              {/* Description */}
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {currentStepData.description}
              </p>

              {/* Progress Dots */}
              <div className="flex justify-center gap-2 pt-1">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 rounded-full transition-all ${
                      index === currentStep
                        ? "w-6 bg-primary"
                        : index < currentStep
                        ? "w-1.5 bg-primary/50"
                        : "w-1.5 bg-muted-foreground/30"
                    }`}
                    data-testid={`progress-dot-${index}`}
                  />
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1 sm:pt-2">
                <Button
                  variant="outline"
                  onClick={handleSkip}
                  className="flex-1 text-xs sm:text-sm h-9"
                  data-testid="button-skip-spotlight"
                >
                  Skip Tour
                </Button>
                <Button
                  onClick={handleNext}
                  className="flex-1 text-xs sm:text-sm h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                  data-testid="button-spotlight-next"
                >
                  {isLastStep ? (
                    <>
                      <Gift className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                      Got It!
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-0.5 sm:ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// Restart Tour Button Component
export function RestartTourButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="fixed bottom-24 md:bottom-8 right-4 z-40 rounded-full w-12 h-12 shadow-lg bg-primary/10 hover:bg-primary/20 border border-primary/30"
      data-testid="button-restart-tour"
    >
      <HelpCircle className="w-6 h-6 text-primary" />
    </Button>
  );
}
