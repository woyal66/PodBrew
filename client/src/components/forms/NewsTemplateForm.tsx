import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/use-analytics";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import { useTemplateSettings } from "@/hooks/useTemplateSettings";
import { NewsForm } from "./NewsForm";
import { type GeneratedPodcast, type Voice, type VoiceQuality, type NewsPreset } from "@shared/schema";
import { VoiceSelectionModal, PodcastMood, type VoiceAccent } from "@/components/voice-selection-modal";
import { MorpheusWizard } from "@/components/MorpheusWizard";
import { PresetSetupModal } from "../PresetSetupModal";
import { TrendingTopics } from "../TrendingTopics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, Flame } from "lucide-react";



export function NewsTemplateForm({ regenerateParams, onRegenerateUsed }: { regenerateParams?: any; onRegenerateUsed?: () => void }) {
  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [languageComplexity, setLanguageComplexity] = useState(6);
  const [numPeople, setNumPeople] = useState(1);
  const [podcastStyle, setPodcastStyle] = useState("news");
  const [timeFrame, setTimeFrame] = useState("past24h");
  const [coHostPersonality, setCoHostPersonality] = useState("executive");
  const [podcastMood, setPodcastMood] = useState<PodcastMood>("balanced");
  const [language, setLanguage] = useState("en");
  const [selectedVoicePool, setSelectedVoicePool] = useState<string[]>([]);
  const [assignedVoices, setAssignedVoices] = useState<string[]>([]);
  const [selectedVoiceIds, setSelectedVoiceIds] = useState<string[]>([]);
  const [selectedAccents, setSelectedAccents] = useState<Record<string, VoiceAccent | null>>({});
  
  // Load selected accents from localStorage on mount
  useEffect(() => {
    const savedAccents = localStorage.getItem('podbrewLastAccents');
    if (savedAccents) {
      try {
        const parsedAccents = JSON.parse(savedAccents);
        if (typeof parsedAccents === 'object' && parsedAccents !== null) {
          setSelectedAccents(parsedAccents);
        }
      } catch (e) {
        console.error('Failed to parse saved accents from localStorage', e);
      }
    }
  }, []);

  // Save selected accents to localStorage whenever they change
  useEffect(() => {
    if (Object.keys(selectedAccents).length > 0) {
      localStorage.setItem('podbrewLastAccents', JSON.stringify(selectedAccents));
    }
  }, [selectedAccents]);

  const [showTrendingTopics, setShowTrendingTopics] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showMorpheus, setShowMorpheus] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [usePresets, setUsePresets] = useState(() => {
    const saved = localStorage.getItem('podbrew-use-presets');
    return saved ? JSON.parse(saved) : true;
  });
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetApplied, setPresetApplied] = useState(false);
  const recognitionRef = useRef<any>(null);
  const lastProcessedIndexRef = useRef<number>(0);
  const processedRegenerateRef = useRef<any>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { startBrewing } = useGlobalBrewing();
  const { trackBrewClicked, trackAuthTriggeredFromBrew } = useAnalytics();

  const { data: voices = [] } = useQuery<Voice[]>({
    queryKey: ['/api/voices'],
    staleTime: 600_000,
  });

  // Synchronize accents when selectedVoiceIds change - ensure we have accent entries for all selected voices
  useEffect(() => {
    if (selectedVoiceIds.length > 0 && voices.length > 0) {
      setSelectedAccents(prev => {
        const updated = { ...prev };
        let hasChanges = false;
        
        // Ensure each selected voice has an accent entry
        selectedVoiceIds.forEach(voiceId => {
          if (!(voiceId in updated)) {
            // Get default accent from voice data
            const voice = voices.find(v => v.id === voiceId);
            if (voice) {
              updated[voiceId] = (voice.accent as VoiceAccent) || 'American';
              hasChanges = true;
            }
          }
        });
        
        return hasChanges ? updated : prev;
      });
    }
  }, [selectedVoiceIds, voices]);

  const { data: creditsData } = useQuery<{ credits: number; plan: string }>({
    queryKey: ['/api/user/credits'],
  });

  // Fetch location settings
  const { data: locationSettings } = useQuery<{ locationEnabled: boolean; locationCity: string | null }>({
    queryKey: ['/api/user/location'],
    enabled: true,
  });

  // Fetch news preset
  const { data: presetData } = useQuery<{ preset: NewsPreset | null }>({
    queryKey: ['/api/news-preset'],
    enabled: true,
  });

  // Toggle location mutation
  const toggleLocationMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await apiRequest("PATCH", "/api/user/location", { locationEnabled: enabled });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/location'] });
      toast({
        title: data.locationEnabled ? "Location Enabled" : "Location Disabled",
        description: data.locationEnabled 
          ? `Podcasts will include local content for ${data.locationCity || 'your area'}`
          : "Location-based content disabled",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update location settings",
        variant: "destructive",
      });
    },
  });

  const handleToggleLocation = () => {
    
    if (!locationSettings?.locationCity) {
      toast({
        title: "Set your city first",
        description: "Go to Settings > Preferences to set your city before enabling location",
      });
      return;
    }
    
    toggleLocationMutation.mutate(!locationSettings?.locationEnabled);
  };

  // Load and save template settings
  useTemplateSettings('news', {
    durationMinutes,
    languageComplexity,
    numPeople,
    podcastStyle,
    timeFrame,
    coHostPersonality,
    podcastMood,
    language,
    selectedVoiceIds,
  }, {
    setDurationMinutes,
    setLanguageComplexity,
    setNumPeople,
    setPodcastStyle,
    setTimeFrame,
    setCoHostPersonality,
    setPodcastMood: (value: string) => setPodcastMood(value as PodcastMood),
    setLanguage,
    setSelectedVoiceIds,
  });

  // Set default voice if no voices selected
  useEffect(() => {
    if (voices.length > 0 && selectedVoiceIds.length === 0) {
      setSelectedVoiceIds([voices[0].id]);
    }
  }, [voices.length, selectedVoiceIds.length]);

  // Regenerate: Initialize form from saved parameters
  useEffect(() => {
    if (regenerateParams && 
        regenerateParams.templateCategory === 'news' &&
        processedRegenerateRef.current !== regenerateParams) {
      
      processedRegenerateRef.current = regenerateParams;
      
      if (regenerateParams.topic) setTopic(regenerateParams.topic);
      if (regenerateParams.durationMinutes) setDurationMinutes(regenerateParams.durationMinutes);
      if (regenerateParams.languageComplexity) setLanguageComplexity(regenerateParams.languageComplexity);
      if (regenerateParams.numPeople) setNumPeople(regenerateParams.numPeople);
      if (regenerateParams.podcastStyle) setPodcastStyle(regenerateParams.podcastStyle);
      if (regenerateParams.timeFrame) setTimeFrame(regenerateParams.timeFrame);
      if (regenerateParams.coHostPersonality) setCoHostPersonality(regenerateParams.coHostPersonality);
      if (regenerateParams.podcastMood) setPodcastMood(regenerateParams.podcastMood);
      if (regenerateParams.language) setLanguage(regenerateParams.language);
      if (regenerateParams.hostVoices && regenerateParams.hostVoices.length > 0) {
        setSelectedVoiceIds(regenerateParams.hostVoices);
      }
      
      if (onRegenerateUsed) {
        onRegenerateUsed();
      }
      
      // Focus and scroll to topic field
      setTimeout(() => {
        if (topicRef.current) {
          topicRef.current.focus();
          topicRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [regenerateParams, onRegenerateUsed]);

  // Apply preset values when usePresets is enabled
  useEffect(() => {
    if (usePresets && presetData?.preset && !presetApplied) {
      const preset = presetData.preset;
      setDurationMinutes(preset.durationMinutes);
      setLanguageComplexity(preset.languageComplexity);
      setNumPeople(preset.numPeople);
      setPodcastStyle(preset.podcastStyle);
      setTimeFrame(preset.timeFrame);
      setCoHostPersonality(preset.coHostPersonality);
      setPodcastMood(preset.podcastMood as PodcastMood);
      setLanguage(preset.language);
      if (preset.selectedVoiceIds && preset.selectedVoiceIds.length > 0) {
        setSelectedVoiceIds(preset.selectedVoiceIds);
      }
      setPresetApplied(true);
    }
  }, [usePresets, presetData?.preset, presetApplied]);

  // Handle toggle change - show modal if enabling presets but none saved
  const handleTogglePresets = (enabled: boolean) => {
    localStorage.setItem('podbrew-use-presets', JSON.stringify(enabled));
    setUsePresets(enabled);
    
    if (enabled) {
      if (!presetData?.preset) {
        setShowPresetModal(true);
      } else {
        const preset = presetData.preset;
        setDurationMinutes(preset.durationMinutes);
        setLanguageComplexity(preset.languageComplexity);
        setNumPeople(preset.numPeople);
        setPodcastStyle(preset.podcastStyle);
        setTimeFrame(preset.timeFrame);
        setCoHostPersonality(preset.coHostPersonality);
        setPodcastMood(preset.podcastMood as PodcastMood);
        setLanguage(preset.language);
        if (preset.selectedVoiceIds && preset.selectedVoiceIds.length > 0) {
          setSelectedVoiceIds(preset.selectedVoiceIds);
        }
        toast({
          title: "Preset Applied",
          description: "Your saved preferences have been applied",
        });
      }
    }
  };

  // Handle preset saved - apply values to form
  const handlePresetSaved = (preset: NewsPreset) => {
    setDurationMinutes(preset.durationMinutes);
    setLanguageComplexity(preset.languageComplexity);
    setNumPeople(preset.numPeople);
    setPodcastStyle(preset.podcastStyle);
    setTimeFrame(preset.timeFrame);
    setCoHostPersonality(preset.coHostPersonality);
    setPodcastMood(preset.podcastMood as PodcastMood);
    setLanguage(preset.language);
    if (preset.selectedVoiceIds && preset.selectedVoiceIds.length > 0) {
      setSelectedVoiceIds(preset.selectedVoiceIds);
    }
    setPresetApplied(true);
  };

  const selectedVoices = voices.filter(v => selectedVoiceIds.includes(v.id));

  const triggerGlobalBrew = async (requestBody: any) => {
    try {
      const podcast = await startBrewing({
        templateName: 'News',
        durationMinutes: requestBody.durationMinutes,
        requestBody,
      });
      
      if (podcast) {
        setTopic("");
        toast({
          title: "News podcast brewed!",
          description: "Your news podcast is ready in your library.",
        });
      }
    } catch (error: any) {
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        
      } else {
        toast({
          title: "Brew failed",
          description: error.message || "Failed to generate news podcast. Please try again.",
          variant: "destructive",
        });
      }
    }
  };


  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: "Not supported",
        description: "Speech recognition is not supported in your browser.",
        variant: "destructive",
      });
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setTopic(transcript);
      toast({
        title: "Voice captured",
        description: `Topic: "${transcript}"`,
      });
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      toast({
        title: "Voice input failed",
        description: "Could not capture voice input. Please try again.",
        variant: "destructive",
      });
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const enhanceTopicAsync = async (topicText: string, category?: string): Promise<string> => {
    try {
      const response = await apiRequest("POST", "/api/podcasts/enhance-topic", {
        topic: topicText,
        templateCategory: category || 'news',
        podcastStyle,
        languageComplexity,
        numPeople,
        timeFrame,
        coHostPersonality,
      });
      const data = await response.json();
      return data.enhancedTopic || topicText;
    } catch (error) {
      console.error("Failed to enhance topic:", error);
      return topicText;
    }
  };

  const handleEnhanceTopic = async () => {
    if (!topic.trim() || isEnhancing) return;

    setIsEnhancing(true);
    try {
      const response = await apiRequest("POST", "/api/podcasts/enhance-topic", {
        topic: topic.trim(),
        podcastStyle,
        languageComplexity,
        numPeople,
        timeFrame,
        coHostPersonality,
        templateCategory: 'news',
      });

      const data = await response.json();
      if (data.enhancedTopic) {
        setTopic(data.enhancedTopic);
        toast({
          title: "Topic enhanced",
          description: "Your brief prompt has been expanded into a detailed podcast description",
        });
      }
    } catch (error) {
      console.error("Error enhancing topic:", error);
      toast({
        title: "Enhancement failed",
        description: "Could not enhance topic. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  // Build comprehensive topic text from trending topic data
  const buildTopicText = (topics: any[]) => {
    return topics.map((t: any, idx: number) => {
      const parts = [];
      if (topics.length > 1) parts.push(`Topic ${idx + 1}:`);
      parts.push(t.title);
      if (t.description) parts.push(`- ${t.description}`);
      if (t.category) parts.push(`[Category: ${t.category}]`);
      return parts.join(' ');
    }).join('\n\n');
  };

  // Handle single topic selection from TrendingTopics
  const handleTrendingTopicSelect = (selectedTopic: string) => {
    setTopic(selectedTopic);
    setShowTrendingTopics(false);
  };

  // Handle multiple topics from trending discovery with auto-enhancement
  const handleMultipleTopicsSelect = async (selectedTopics: any[]) => {
    if (selectedTopics.length === 0) return;

    // Build comprehensive topic text including ALL available information
    const initialTopic = buildTopicText(selectedTopics);

    setShowTrendingTopics(false);

    // Auto-enhance the topic with full context
    setIsEnhancing(true);
    const enhancedTopic = await enhanceTopicAsync(initialTopic, 'news');
    setTopic(enhancedTopic);
    setIsEnhancing(false);

    toast({
      title: "Topics selected & enhanced",
      description: `${selectedTopics.length} topic${selectedTopics.length !== 1 ? 's' : ''} added and AI enriched!`,
    });

    setTimeout(() => {
      if (topicRef.current) {
        topicRef.current.focus();
        topicRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const handleMorpheusComplete = (refinedTopic: string, _context: string) => {
    setTopic(refinedTopic);
    setShowMorpheus(false);
  };

  const handleSubmit = (e: React.FormEvent, overrideTopic?: string) => {
    e.preventDefault();
    
    // Track Brew button click
    trackBrewClicked(true, durationMinutes);
    const topicToUse = overrideTopic || topic;
    
    if (topicToUse.trim()) {
      if (selectedVoicePool.length === 0 && selectedVoiceIds.length === 0) {
        toast({
          title: "No voices selected",
          description: "Please select at least one voice for your news podcast",
          variant: "destructive",
        });
        return;
      }
      
      // Filter accents to only include currently selected voice IDs
      const voiceIdsToUse = selectedVoiceIds.length > 0 ? selectedVoiceIds.slice(0, numPeople) : [];
      const filteredAccents: Record<string, VoiceAccent | null> = {};
      voiceIdsToUse.forEach(voiceId => {
        if (selectedAccents[voiceId]) {
          filteredAccents[voiceId] = selectedAccents[voiceId];
        } else {
          // Fallback to voice's default accent
          const voice = voices.find(v => v.id === voiceId);
          if (voice?.accent) {
            filteredAccents[voiceId] = voice.accent as VoiceAccent;
          }
        }
      });

      triggerGlobalBrew({ 
        topic: topicToUse.trim(), 
        durationMinutes, 
        languageComplexity, 
        numPeople,
        podcastStyle,
        timeFrame,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoicePool,
        assignedVoices: assignedVoices.slice(0, numPeople),
        selectedVoiceIds: voiceIdsToUse.length > 0 ? voiceIdsToUse : undefined,
        selectedAccents: Object.keys(filteredAccents).length > 0 ? filteredAccents : undefined,
        templateCategory: "news"
      });
    }
  };

  const trendingTopicsSection = (
    <div className="space-y-4">
      <Collapsible open={showTrendingTopics} onOpenChange={setShowTrendingTopics}>
        <Card className="overflow-visible">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Flame className="h-4 w-4 text-primary" />
                  Trending Topics
                </CardTitle>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-toggle-trending">
                  <ChevronDown className={`h-4 w-4 transition-transform ${showTrendingTopics ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <TrendingTopics
                onTopicSelect={handleTrendingTopicSelect}
                onMultipleTopicsSelect={handleMultipleTopicsSelect}
                locationEnabled={locationSettings?.locationEnabled}
                locationCity={locationSettings?.locationCity}
                onToggleLocation={handleToggleLocation}
              />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );

  return (
    <div className="space-y-6">
      <NewsForm
        topic={topic}
        setTopic={setTopic}
        durationMinutes={durationMinutes}
        setDurationMinutes={setDurationMinutes}
        languageComplexity={languageComplexity}
        setLanguageComplexity={setLanguageComplexity}
        numPeople={numPeople}
        setNumPeople={setNumPeople}
        podcastStyle={podcastStyle}
        setPodcastStyle={setPodcastStyle}
        timeFrame={timeFrame}
        setTimeFrame={setTimeFrame}
        coHostPersonality={coHostPersonality}
        setCoHostPersonality={setCoHostPersonality}
        podcastMood={podcastMood}
        setPodcastMood={(mood: string) => setPodcastMood(mood as PodcastMood)}
        language={language}
        setLanguage={setLanguage}
        selectedVoicePool={selectedVoicePool}
        setSelectedVoicePool={setSelectedVoicePool}
        assignedVoices={assignedVoices}
        selectedVoiceIds={selectedVoiceIds}
        selectedVoices={selectedVoices}
        setShowVoiceModal={setShowVoiceModal}
        creditsData={creditsData}
        isListening={isListening}
        onVoiceInput={handleVoiceInput}
        onEnhanceTopic={handleEnhanceTopic}
        isEnhancing={isEnhancing}
        onSubmit={handleSubmit}
        isGenerating={false}
        topicRef={topicRef}
        locationEnabled={locationSettings?.locationEnabled}
        locationCity={locationSettings?.locationCity}
        onToggleLocation={handleToggleLocation}
        onMorpheus={() => setShowMorpheus(true)}
        showMorpheus={true}
        isMorpheusOpen={showMorpheus}
        discoverySection={trendingTopicsSection}
      />

      <MorpheusWizard
        open={showMorpheus}
        onOpenChange={setShowMorpheus}
        initialTopic={topic}
        templateCategory="news"
        onRefinedTopic={handleMorpheusComplete}
        isVoiceMode={isListening}
      />

      <VoiceSelectionModal
        open={showVoiceModal}
        onOpenChange={setShowVoiceModal}
        numHosts={numPeople}
        selectedVoiceIds={selectedVoiceIds}
        selectedAccents={selectedAccents}
        mood={podcastMood}
        onConfirm={(voiceIds, accents) => {
          setSelectedVoiceIds(voiceIds);
          setSelectedAccents(accents);
        }}
      />

      <PresetSetupModal
        open={showPresetModal}
        onOpenChange={setShowPresetModal}
        initialValues={{
          durationMinutes,
          languageComplexity,
          numPeople,
          podcastStyle,
          timeFrame,
          coHostPersonality,
          podcastMood,
          language,
          selectedVoiceIds,
        }}
        onSave={handlePresetSaved}
      />
    </div>
  );
}
