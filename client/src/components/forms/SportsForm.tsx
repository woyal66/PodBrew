import { Wand2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type VoiceId, type Voice } from "@shared/schema";
import { TemplateFormLayout } from "./TemplateFormLayout";
import { sportsTemplateConfig } from "./templateFormConfigs";

interface SportsFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
  format: string;
  setFormat: (style: string) => void;
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

const COVERAGE_FORMATS = [
  { value: "recap", label: "Game Recap", description: "Post-game highlights and analysis" },
  { value: "preview", label: "Game Preview", description: "Pre-game analysis and predictions" },
  { value: "analysis", label: "Deep Analysis", description: "Tactical breakdown" },
];

export function SportsForm({
  format,
  setFormat,
  isGenerating,
  ...commonProps
}: SportsFormProps) {
  return (
    <TemplateFormLayout
      config={sportsTemplateConfig}
      {...commonProps}
      isGenerating={isGenerating}
    >
      {/* Template-specific field for Sports */}
      <div className="space-y-2">
        <Label htmlFor="coverage-format" className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-primary" />
          Coverage Format
        </Label>
        <Select value={format} onValueChange={setFormat} disabled={isGenerating}>
          <SelectTrigger id="coverage-format" data-testid="select-coverage-format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COVERAGE_FORMATS.map(({ value, label, description }) => (
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
    </TemplateFormLayout>
  );
}
