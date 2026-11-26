import { type Voice } from "@shared/schema";
import { TemplateFormLayout } from "./TemplateFormLayout";
import { newsTemplateConfig } from "./templateFormConfigs";

interface NewsFormProps {
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
  setShowVoiceModal: (show: boolean) => void;
  creditsData?: { credits: number; plan: string };
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
  discoverySection?: React.ReactNode;
}

export function NewsForm(props: NewsFormProps) {
  return (
    <TemplateFormLayout
      config={newsTemplateConfig}
      {...props}
    />
  );
}
