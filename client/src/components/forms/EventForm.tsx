import { Wand2, MapPin } from "lucide-react";
import { Label } from "@/components/ui/label";
import { useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Voice } from "@shared/schema";
import { TemplateFormLayout } from "./TemplateFormLayout";
import { eventsTemplateConfig } from "./templateFormConfigs";

interface EventFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
  eventFormat: string;
  setEventFormat: (style: string) => void;
  eventType: string;
  setEventType: (type: string) => void;
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
  discoverySection?: React.ReactNode;
}

const EVENT_STYLES = [
  { value: "recap", label: "Event Recap", description: "Post-event summary and highlights" },
  { value: "preview", label: "Event Preview", description: "What to expect before the event" },
  { value: "guide", label: "Attendee Guide", description: "Practical information for attendees" },
];

const EVENT_TYPES = [
  { value: "conference", label: "Conference" },
  { value: "concert", label: "Concert" },
  { value: "festival", label: "Festival" },
  { value: "sports", label: "Sports Event" },
  { value: "exhibition", label: "Exhibition" },
  { value: "workshop", label: "Workshop" },
  { value: "comedy", label: "Comedy Show" },
  { value: "local-gigs", label: "Local Gigs" },
];

// Past timeframes for Event Recap
const PAST_TIMEFRAME_OPTIONS = [
  { value: "past24h", label: "Last 24 Hours" },
  { value: "pastWeek", label: "Past Week" },
  { value: "pastMonth", label: "Past Month" },
  { value: "pastYear", label: "Past Year" },
];

// Future timeframes for Event Preview and Guide
const FUTURE_TIMEFRAME_OPTIONS = [
  { value: "next24h", label: "Next 24 Hours" },
  { value: "nextWeek", label: "Upcoming Week" },
  { value: "nextMonth", label: "Upcoming Month" },
  { value: "nextYear", label: "Upcoming Year" },
];

export function EventForm({
  eventFormat,
  setEventFormat,
  eventType,
  setEventType,
  timeFrame,
  setTimeFrame,
  isGenerating,
  ...commonProps
}: EventFormProps) {
  // Determine timeframe options based on eventFormat
  const timeFrameOptions = useMemo(() => {
    if (eventFormat === "recap") {
      return PAST_TIMEFRAME_OPTIONS;
    } else if (eventFormat === "preview" || eventFormat === "guide") {
      return FUTURE_TIMEFRAME_OPTIONS;
    }
    return PAST_TIMEFRAME_OPTIONS; // Default to past
  }, [eventFormat]);

  // Reset timeFrame when eventFormat changes if current timeFrame is invalid
  useEffect(() => {
    const validValues = timeFrameOptions.map(opt => opt.value);
    if (!validValues.includes(timeFrame)) {
      setTimeFrame(timeFrameOptions[0].value);
    }
  }, [eventFormat, timeFrame, setTimeFrame, timeFrameOptions]);

  const configWithConditionalTimeFrame = {
    ...eventsTemplateConfig,
    timeFrameOptions,
  };

  return (
    <TemplateFormLayout
      config={configWithConditionalTimeFrame}
      timeFrame={timeFrame}
      setTimeFrame={setTimeFrame}
      {...commonProps}
      isGenerating={isGenerating}
    >
      {/* Template-specific fields for Event */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="event-format" className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            Event Format
          </Label>
          <Select value={eventFormat} onValueChange={setEventFormat} disabled={isGenerating}>
            <SelectTrigger id="event-format" data-testid="select-event-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_STYLES.map(({ value, label, description }) => (
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
          <Label htmlFor="event-type" className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Event Type
          </Label>
          <Select value={eventType} onValueChange={setEventType} disabled={isGenerating}>
            <SelectTrigger id="event-type" data-testid="select-event-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPES.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </TemplateFormLayout>
  );
}
