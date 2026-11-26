import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Mic, Settings2, Clock, Palette } from "lucide-react";
import { VoiceSelectionModal, PodcastMood, type VoiceAccent } from "./voice-selection-modal";
import { type Voice, type NewsPreset } from "@shared/schema";

const PODCAST_STYLES = [
  { value: "news", label: "News Report", description: "Professional news delivery" },
  { value: "conversational", label: "Conversational", description: "Casual discussion" },
  { value: "narrative", label: "Narrative", description: "Storytelling format" },
  { value: "executive-briefing", label: "Executive Briefing", description: "Concise business updates" },
];

const TIME_FRAMES = [
  { value: "past24h", label: "Past 24 Hours" },
  { value: "pastWeek", label: "Past Week" },
  { value: "pastMonth", label: "Past Month" },
];

const PERSONALITIES = [
  { value: "executive", label: "Executive" },
  { value: "casual", label: "Casual" },
  { value: "academic", label: "Academic" },
  { value: "storyteller", label: "Storyteller" },
  { value: "investigative", label: "Investigative" },
];

const MOODS: { value: PodcastMood; label: string }[] = [
  { value: "balanced", label: "Balanced" },
  { value: "uplifting", label: "Uplifting" },
  { value: "serious", label: "Serious" },
  { value: "humorous", label: "Humorous" },
  { value: "mysterious", label: "Mysterious" },
  { value: "energetic", label: "Energetic" },
];

interface PresetSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: {
    durationMinutes?: number;
    languageComplexity?: number;
    numPeople?: number;
    podcastStyle?: string;
    timeFrame?: string;
    coHostPersonality?: string;
    podcastMood?: string;
    language?: string;
    selectedVoiceIds?: string[];
  };
  onSave?: (preset: NewsPreset) => void;
  isQuickBrewMode?: boolean;
}

export function PresetSetupModal({ open, onOpenChange, initialValues, onSave, isQuickBrewMode = false }: PresetSetupModalProps) {
  const { toast } = useToast();
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  
  const [durationMinutes, setDurationMinutes] = useState(initialValues?.durationMinutes ?? 5);
  const [languageComplexity, setLanguageComplexity] = useState(initialValues?.languageComplexity ?? 6);
  const [numPeople, setNumPeople] = useState(initialValues?.numPeople ?? 1);
  const [podcastStyle, setPodcastStyle] = useState(initialValues?.podcastStyle ?? "news");
  const [timeFrame, setTimeFrame] = useState(initialValues?.timeFrame ?? "past24h");
  const [coHostPersonality, setCoHostPersonality] = useState(initialValues?.coHostPersonality ?? "executive");
  const [podcastMood, setPodcastMood] = useState<PodcastMood>((initialValues?.podcastMood as PodcastMood) ?? "balanced");
  const [language, setLanguage] = useState(initialValues?.language ?? "en");
  const [selectedVoiceIds, setSelectedVoiceIds] = useState<string[]>(initialValues?.selectedVoiceIds ?? []);
  const [selectedAccents, setSelectedAccents] = useState<Record<string, VoiceAccent | null>>({});

  const { data: voices = [] } = useQuery<Voice[]>({
    queryKey: ['/api/voices'],
    staleTime: 600_000,
  });

  useEffect(() => {
    if (initialValues) {
      if (initialValues.durationMinutes !== undefined) setDurationMinutes(initialValues.durationMinutes);
      if (initialValues.languageComplexity !== undefined) setLanguageComplexity(initialValues.languageComplexity);
      if (initialValues.numPeople !== undefined) setNumPeople(initialValues.numPeople);
      if (initialValues.podcastStyle !== undefined) setPodcastStyle(initialValues.podcastStyle);
      if (initialValues.timeFrame !== undefined) setTimeFrame(initialValues.timeFrame);
      if (initialValues.coHostPersonality !== undefined) setCoHostPersonality(initialValues.coHostPersonality);
      if (initialValues.podcastMood !== undefined) setPodcastMood(initialValues.podcastMood as PodcastMood);
      if (initialValues.language !== undefined) setLanguage(initialValues.language);
      if (initialValues.selectedVoiceIds !== undefined) setSelectedVoiceIds(initialValues.selectedVoiceIds);
    }
  }, [initialValues]);

  useEffect(() => {
    if (voices.length > 0 && selectedVoiceIds.length === 0) {
      setSelectedVoiceIds([voices[0].id]);
    }
  }, [voices.length, selectedVoiceIds.length]);

  const savePresetMutation = useMutation({
    mutationFn: async () => {
      let payload: Record<string, any>;
      
      if (isQuickBrewMode) {
        // Save to Quick Brew specific fields
        payload = {
          quickBrewEnabled: true,
          quickBrewDurationMinutes: durationMinutes,
          quickBrewNumPeople: numPeople,
          quickBrewPodcastStyle: podcastStyle,
          quickBrewPodcastMood: podcastMood,
          quickBrewVoiceIds: selectedVoiceIds,
        };
      } else {
        // Save to main News Preset fields
        payload = {
          durationMinutes,
          languageComplexity,
          numPeople,
          podcastStyle,
          timeFrame,
          coHostPersonality,
          podcastMood,
          language,
          selectedVoiceIds,
        };
      }
      
      const response = await apiRequest("POST", "/api/news-preset", payload);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/news-preset'] });
      toast({
        title: isQuickBrewMode ? "Quick Brew Settings Saved" : "Preset Saved",
        description: isQuickBrewMode 
          ? "Your Quick Brew custom settings have been saved" 
          : "Your news preferences have been saved for quick brewing",
      });
      if (onSave && data.preset) {
        onSave(data.preset);
      }
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save preset",
        variant: "destructive",
      });
    },
  });

  const selectedVoices = voices.filter(v => selectedVoiceIds.includes(v.id));

  const getComplexityLabel = (value: number) => {
    if (value <= 3) return "Simple";
    if (value <= 5) return "Easy";
    if (value <= 7) return "Standard";
    if (value <= 9) return "Advanced";
    return "Expert";
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              {isQuickBrewMode ? 'Quick Brew Settings' : 'News Brief Preset'}
            </DialogTitle>
            <DialogDescription>
              {isQuickBrewMode 
                ? 'Configure your custom Quick Brew settings (independent from News template)' 
                : 'Configure your default settings for quick Daily Brief generation'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Format
              </div>
              
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label>Duration</Label>
                    <span className="text-sm text-muted-foreground">{durationMinutes} min</span>
                  </div>
                  <Slider
                    value={[durationMinutes]}
                    onValueChange={([val]) => setDurationMinutes(val)}
                    min={2}
                    max={30}
                    step={1}
                    data-testid="slider-duration"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label>Language Complexity</Label>
                    <span className="text-sm text-muted-foreground">{getComplexityLabel(languageComplexity)}</span>
                  </div>
                  <Slider
                    value={[languageComplexity]}
                    onValueChange={([val]) => setLanguageComplexity(val)}
                    min={1}
                    max={10}
                    step={1}
                    data-testid="slider-complexity"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Palette className="h-4 w-4" />
                Style
              </div>

              <div className="grid gap-3">
                <div className="space-y-2">
                  <Label>Podcast Style</Label>
                  <Select value={podcastStyle} onValueChange={setPodcastStyle}>
                    <SelectTrigger data-testid="select-style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PODCAST_STYLES.map(style => (
                        <SelectItem key={style.value} value={style.value}>
                          {style.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Time Frame</Label>
                  <Select value={timeFrame} onValueChange={setTimeFrame}>
                    <SelectTrigger data-testid="select-timeframe">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_FRAMES.map(tf => (
                        <SelectItem key={tf.value} value={tf.value}>
                          {tf.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Mood</Label>
                  <RadioGroup
                    value={podcastMood}
                    onValueChange={(val) => setPodcastMood(val as PodcastMood)}
                    className="flex flex-wrap gap-2"
                  >
                    {MOODS.map(mood => (
                      <div key={mood.value} className="flex items-center space-x-1">
                        <RadioGroupItem value={mood.value} id={`mood-${mood.value}`} data-testid={`radio-mood-${mood.value}`} />
                        <Label htmlFor={`mood-${mood.value}`} className="text-sm cursor-pointer">
                          {mood.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label>Host Count</Label>
                  <RadioGroup
                    value={numPeople.toString()}
                    onValueChange={(val) => setNumPeople(parseInt(val))}
                    className="flex gap-4"
                  >
                    {[1, 2, 3].map(num => (
                      <div key={num} className="flex items-center space-x-1">
                        <RadioGroupItem value={num.toString()} id={`hosts-${num}`} data-testid={`radio-hosts-${num}`} />
                        <Label htmlFor={`hosts-${num}`} className="text-sm cursor-pointer">
                          {num} {num === 1 ? 'Host' : 'Hosts'}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                {numPeople > 1 && (
                  <div className="space-y-2">
                    <Label>Co-Host Personality</Label>
                    <Select value={coHostPersonality} onValueChange={setCoHostPersonality}>
                      <SelectTrigger data-testid="select-personality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERSONALITIES.map(p => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Mic className="h-4 w-4" />
                Voice
              </div>

              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => setShowVoiceModal(true)}
                data-testid="button-select-voices"
              >
                <span className="flex items-center gap-2">
                  <Mic className="h-4 w-4" />
                  {selectedVoices.length > 0 
                    ? selectedVoices.map(v => v.aliasName || v.displayName).join(", ")
                    : "Select voice(s)"
                  }
                </span>
              </Button>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-preset"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => savePresetMutation.mutate()}
              disabled={savePresetMutation.isPending}
              data-testid="button-save-preset"
            >
              {savePresetMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Preset"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <VoiceSelectionModal
        open={showVoiceModal}
        onOpenChange={setShowVoiceModal}
        selectedVoiceIds={selectedVoiceIds}
        selectedAccents={selectedAccents}
        onConfirm={(voiceIds, accents) => {
          setSelectedVoiceIds(voiceIds);
          setSelectedAccents(accents);
        }}
        numHosts={numPeople}
        mood={podcastMood}
      />
    </>
  );
}
