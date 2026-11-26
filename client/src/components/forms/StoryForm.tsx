import { BookMarked } from "lucide-react";
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
import { storiesTemplateConfig } from "./templateFormConfigs";

interface StoryFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
  storyGenre: string;
  setStoryGenre: (genre: string) => void;
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

const STORY_GENRES = [
  { value: "scifi", label: "Science Fiction (Sci-Fi)", description: "Futuristic worlds and technology" },
  { value: "fantasy", label: "Fantasy", description: "Magical realms and epic quests" },
  { value: "romance", label: "Romance", description: "Love stories and relationships" },
  { value: "mystery", label: "Mystery / Crime", description: "Puzzles, investigations, and suspense" },
  { value: "horror", label: "Horror", description: "Dark tales and supernatural frights" },
  { value: "thriller", label: "Thriller / Suspense", description: "Heart-pounding tension and danger" },
  { value: "biography", label: "Biography / Autobiography", description: "Real-life stories and journeys" },
  { value: "historical", label: "Historical Fiction", description: "Stories set in the past" },
  { value: "comedy", label: "Comedy / Satire", description: "Humor and wit" },
  { value: "erotic", label: "NSFW Erotica", description: "Adult romantic narratives (18+)" },
];

export function StoryForm({
  storyGenre,
  setStoryGenre,
  isGenerating,
  ...commonProps
}: StoryFormProps) {
  return (
    <TemplateFormLayout
      config={storiesTemplateConfig}
      {...commonProps}
      isGenerating={isGenerating}
    >
      {/* Template-specific field for Stories */}
      <div className="space-y-2">
        <Label htmlFor="story-genre" className="flex items-center gap-2">
          <BookMarked className="w-4 h-4 text-primary" />
          Story Genre
        </Label>
        <Select value={storyGenre} onValueChange={setStoryGenre} disabled={isGenerating}>
          <SelectTrigger id="story-genre" data-testid="select-story-genre">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STORY_GENRES.map(({ value, label, description }) => (
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
