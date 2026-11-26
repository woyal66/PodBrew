import { Stethoscope, Users2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type VoiceId, type Voice } from "@shared/schema";
import { TemplateFormLayout } from "./TemplateFormLayout";
import { medicalTemplateConfig } from "./templateFormConfigs";

interface MedicalFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
  focusArea: string;
  setFocusArea: (style: string) => void;
  audienceType: string;
  setAudienceType: (type: string) => void;
  disclaimerAccepted: boolean;
  setDisclaimerAccepted: (accepted: boolean) => void;
  podcastStyle: string;
  setPodcastStyle: (style: string) => void;
  timeFrame: string;
  setTimeFrame: (frame: string) => void;
  coHostPersonality: string;
  setCoHostPersonality: (personality: string) => void;
  podcastMood: string;
  setPodcastMood: (mood: string) => void;
  language: string;
  setLanguage: (lang: string) => void;
  selectedVoicePool: string[];
  setSelectedVoicePool: (voices: string[]) => void;
  assignedVoices: string[];
  selectedVoiceIds: string[];
  selectedVoices: Voice[];
  creditsData: { credits: number; plan: string } | undefined;
  setShowVoiceModal: (show: boolean) => void;
  isListening: boolean;
  onVoiceInput: () => void;
  onEnhanceTopic: () => void;
  onMorpheus?: () => void;
  showMorpheus?: boolean;
  isMorpheusOpen?: boolean;
  isEnhancing: boolean;
  onSubmit: (e: React.FormEvent) => void;
  isGenerating: boolean;
  topicRef?: React.RefObject<HTMLTextAreaElement>;
  locationEnabled?: boolean;
  locationCity?: string | null;
  brewProgress?: number;
  brewStatus?: string;
  onCancelBrew?: () => void;
  onToggleLocation?: () => void;
}

const FOCUS_AREAS = [
  { value: "overview", label: "Overview", description: "General introduction" },
  { value: "symptoms", label: "Symptoms & Diagnosis", description: "Signs and identification" },
  { value: "treatment", label: "Treatment Options", description: "Management approaches" },
  { value: "prevention", label: "Prevention", description: "Risk reduction strategies" },
];

const AUDIENCE_TYPES = [
  { value: "patients", label: "Patients/General Public", description: "Easy to understand" },
  { value: "students", label: "Medical Students", description: "Educational focus" },
  { value: "professionals", label: "Healthcare Professionals", description: "Technical detail" },
];

export function MedicalForm({
  focusArea,
  setFocusArea,
  audienceType,
  setAudienceType,
  disclaimerAccepted,
  setDisclaimerAccepted,
  isGenerating,
  ...commonProps
}: MedicalFormProps) {
  return (
    <>
      {/* Medical Disclaimer Alert (appears before the form) */}
      <Alert className="border-yellow-500/50 bg-yellow-500/10">
        <AlertTriangle className="h-4 w-4 text-yellow-500" />
        <AlertDescription className="text-sm">
          Medical podcasts are for educational purposes only. Always consult qualified healthcare professionals for medical advice.
        </AlertDescription>
      </Alert>

      <TemplateFormLayout
        config={medicalTemplateConfig}
        {...commonProps}
        isGenerating={isGenerating}
      >
        {/* Template-specific fields for Medical */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="focus-area" className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-primary" />
              Focus Area
            </Label>
            <Select value={focusArea} onValueChange={setFocusArea} disabled={isGenerating}>
              <SelectTrigger id="focus-area" data-testid="select-focus-area">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOCUS_AREAS.map(({ value, label, description }) => (
                  <SelectItem key={value} value={value}>
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audience-type" className="flex items-center gap-2">
              <Users2 className="w-4 h-4 text-primary" />
              Audience Type
            </Label>
            <Select value={audienceType} onValueChange={setAudienceType} disabled={isGenerating}>
              <SelectTrigger id="audience-type" data-testid="select-audience-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIENCE_TYPES.map(({ value, label, description }) => (
                  <SelectItem key={value} value={value}>
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Disclaimer Checkbox */}
        <div className="flex items-start space-x-2 pt-2">
          <Checkbox
            id="disclaimer"
            checked={disclaimerAccepted}
            onCheckedChange={setDisclaimerAccepted}
            disabled={isGenerating}
            data-testid="checkbox-disclaimer"
          />
          <label
            htmlFor="disclaimer"
            className="text-sm text-muted-foreground leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            I understand this content is for educational purposes only and not a substitute for professional medical advice.
          </label>
        </div>
      </TemplateFormLayout>
    </>
  );
}
