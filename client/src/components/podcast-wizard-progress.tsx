import { StepProgress } from "./step-progress";

interface PodcastWizardProgressProps {
  topic: string;
  durationMinutes: number;
  selectedVoiceIds: string[];
  hasAutoVoices?: boolean; // Indicates if auto-assigned voices are available
}

const WIZARD_STEPS = [
  {
    number: 1,
    title: "Topic & Template",
    description: "Choose what to create"
  },
  {
    number: 2,
    title: "Customize Settings",
    description: "Duration, style & mood"
  },
  {
    number: 3,
    title: "Select Voices",
    description: "Pick your hosts"
  },
  {
    number: 4,
    title: "Ready to Brew",
    description: "Generate podcast"
  }
];

export function PodcastWizardProgress({ 
  topic, 
  durationMinutes,
  selectedVoiceIds,
  hasAutoVoices = true // Default to true - auto-voices are always available
}: PodcastWizardProgressProps) {
  // Auto-calculate current step based on form completion
  // This provides visual guidance without forcing navigation
  const calculateCurrentStep = (): number => {
    const hasTopic = topic && topic.trim().length >= 10; // At least 10 chars for meaningful topic
    const hasCustomizedDuration = durationMinutes !== 2; // Default is 2 mins
    // Consider both manually selected voices AND auto-assigned voices
    const hasVoices = selectedVoiceIds.length > 0 || hasAutoVoices;
    
    if (!hasTopic) {
      return 1; // Still on topic/template
    }
    
    if (!hasCustomizedDuration && !hasVoices) {
      return 2; // Has topic, working on customization
    }
    
    if (!hasVoices) {
      return 3; // Has topic and customization, selecting voices
    }
    
    return 4; // Everything ready to brew (with manual or auto voices)
  };

  const currentStep = calculateCurrentStep();

  return (
    <div className="mb-4 md:mb-8" data-testid="container-wizard-progress">
      <StepProgress 
        steps={WIZARD_STEPS} 
        currentStep={currentStep}
      />
    </div>
  );
}
