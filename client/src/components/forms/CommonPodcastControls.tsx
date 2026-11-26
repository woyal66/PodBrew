import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoodAndLanguageControls } from "./MoodAndLanguageControls";

interface CommonPodcastControlsProps {
  podcastStyle: string;
  setPodcastStyle: (style: string) => void;
  timeFrame: string;
  setTimeFrame: (frame: string) => void;
  podcastMood: string;
  setPodcastMood: (mood: string) => void;
  language: string;
  setLanguage: (lang: string) => void;
  isGenerating?: boolean;
  styleOptions?: Array<{ value: string; label: string; description?: string }>;
  timeFrameOptions?: Array<{ value: string; label: string }>;
  showPodcastStyle?: boolean;
  showTimeFrame?: boolean;
  hideLanguage?: boolean;
}

const DEFAULT_STYLE_OPTIONS = [
  { value: "conversational", label: "Conversational" },
  { value: "narrative", label: "Narrative" },
  { value: "debate", label: "Debate" },
  { value: "interview", label: "Interview" },
  { value: "news", label: "News" },
  { value: "executive-briefing", label: "Executive Briefing" },
  { value: "tutor", label: "Tutor" },
  { value: "lecturer", label: "Lecturer" },
  { value: "coach", label: "Coach" },
];

const DEFAULT_TIME_FRAME_OPTIONS = [
  { value: "past24h", label: "Last 24 Hours" },
  { value: "pastWeek", label: "Past Week" },
  { value: "pastMonth", label: "Past Month" },
  { value: "pastYear", label: "Past Year" },
  { value: "allTime", label: "All Time" },
];

export function CommonPodcastControls({
  podcastStyle,
  setPodcastStyle,
  timeFrame,
  setTimeFrame,
  podcastMood,
  setPodcastMood,
  language,
  setLanguage,
  isGenerating = false,
  styleOptions = DEFAULT_STYLE_OPTIONS,
  timeFrameOptions = DEFAULT_TIME_FRAME_OPTIONS,
  showPodcastStyle = true,
  showTimeFrame = true,
  hideLanguage = false,
}: CommonPodcastControlsProps) {
  return (
    <div className="space-y-3">
      {(showPodcastStyle || showTimeFrame) && (
        <div className={`grid ${showPodcastStyle && showTimeFrame ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
          {showPodcastStyle && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Podcast Style</Label>
              <Select value={podcastStyle} onValueChange={setPodcastStyle} disabled={isGenerating}>
                <SelectTrigger data-testid="select-podcast-style" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {styleOptions.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showTimeFrame && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Time Frame</Label>
              <Select value={timeFrame} onValueChange={setTimeFrame} disabled={isGenerating}>
                <SelectTrigger data-testid="select-time-frame" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeFrameOptions.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      
      <MoodAndLanguageControls
        podcastMood={podcastMood}
        setPodcastMood={setPodcastMood}
        language={language}
        setLanguage={setLanguage}
        isGenerating={isGenerating}
        hideLanguage={hideLanguage}
      />
    </div>
  );
}
