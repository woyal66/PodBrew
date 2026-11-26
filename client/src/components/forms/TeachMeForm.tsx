import { type VoiceId, type Voice } from "@shared/schema";
import { TemplateFormLayout } from "./TemplateFormLayout";
import { teachMeTemplateConfig } from "./templateFormConfigs";

interface TeachMeFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
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
  onMorpheus?: () => void;
  showMorpheus?: boolean;
  isMorpheusOpen?: boolean;
  beforeCommonControls?: React.ReactNode;
}

export function TeachMeForm(props: TeachMeFormProps) {
  return (
    <TemplateFormLayout
      config={teachMeTemplateConfig}
      {...props}
    />
  );
}
