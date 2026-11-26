import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/use-analytics";
import { useTemplateSettings } from "@/hooks/useTemplateSettings";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import { SportsForm } from "./SportsForm";
import { type VoiceId, type GeneratedPodcast, type Voice, type VoiceQuality } from "@shared/schema";
import { VoiceSelectionModal, PodcastMood, type VoiceAccent } from "../voice-selection-modal";
import { MorpheusWizard } from "@/components/MorpheusWizard";

export function SportsTemplateForm({ regenerateParams, onRegenerateUsed }: { regenerateParams?: any; onRegenerateUsed?: () => void }) {

  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [languageComplexity, setLanguageComplexity] = useState(5);
  const [numPeople, setNumPeople] = useState(2);
  const [format, setFormat] = useState("recap");
  const [podcastStyle, setPodcastStyle] = useState("conversational");
  const [timeFrame, setTimeFrame] = useState("past24h");
  const [coHostPersonality, setCoHostPersonality] = useState("casual");
  const [podcastMood, setPodcastMood] = useState<PodcastMood>("balanced");
  const [language, setLanguage] = useState("en");
  const [selectedVoicePool, setSelectedVoicePool] = useState<string[]>([]);
  const [assignedVoices, setAssignedVoices] = useState<string[]>(() => []);
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

  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showMorpheus, setShowMorpheus] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const processedRegenerateRef = useRef<any>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { startBrewing } = useGlobalBrewing();
  const { trackBrewClicked, trackAuthTriggeredFromBrew } = useAnalytics();

  const { data: voices = [] } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
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
  useTemplateSettings('sports', {
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
        regenerateParams.templateCategory === 'sports' &&
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
      if (regenerateParams.format) setFormat(regenerateParams.format);
      
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

  const selectedVoices = voices.filter((v) => selectedVoiceIds.includes(v.id));

  const triggerGlobalBrew = async (requestBody: any) => {
    try {
      const podcast = await startBrewing({
        templateName: 'Sports',
        durationMinutes: requestBody.durationMinutes,
        requestBody,
      });
      
      if (podcast) {
        setTopic("");
        toast({
          title: "Sports podcast brewed!",
          description: "Your sports recap is ready in your library.",
        });
      }
    } catch (error: any) {
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        
      } else {
        toast({
          title: "Brew failed",
          description: error.message || "Failed to generate sports podcast. Please try again.",
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
        description: `Sports event: "${transcript}"`,
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

  const handleEnhanceTopic = async () => {
    if (!topic.trim() || isEnhancing) return;

    setIsEnhancing(true);
    try {
      const response = await apiRequest("POST", "/api/podcasts/enhance-topic", {
        topic: topic.trim(),
        format,
        timeFrame,
        languageComplexity,
        numPeople,
        templateCategory: 'sports',
      });

      const data = await response.json();
      if (data.enhancedTopic) {
        setTopic(data.enhancedTopic);
        toast({
          title: "Topic enhanced",
          description: "AI has enriched your sports event!",
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

  const handleMorpheusComplete = (refinedTopic: string, _context: string) => {
    setTopic(refinedTopic);
    setShowMorpheus(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Track Brew button click
    trackBrewClicked(true, durationMinutes);
    if (topic.trim()) {
      if (selectedVoicePool.length === 0 && selectedVoiceIds.length === 0) {
        toast({
          title: "No voices selected",
          description: "Please select at least one voice for your sports podcast",
          variant: "destructive",
        });
        return;
      }
      
      const trimmedVoiceIds = selectedVoiceIds.slice(0, numPeople);
      
      // Filter accents to only include currently selected voice IDs
      const filteredAccents: Record<string, VoiceAccent | null> = {};
      trimmedVoiceIds.forEach(voiceId => {
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
        topic: topic.trim(), 
        durationMinutes, 
        languageComplexity, 
        numPeople,
        format,
        podcastStyle,
        timeFrame,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoicePool,
        assignedVoices: assignedVoices.slice(0, numPeople),
        templateCategory: "sports",
        selectedVoiceIds: trimmedVoiceIds.length > 0 ? trimmedVoiceIds : undefined,
        selectedAccents: Object.keys(filteredAccents).length > 0 ? filteredAccents : undefined
      });
    }
  };

  return (
    <div className="space-y-6">
      <SportsForm
        topic={topic}
        setTopic={setTopic}
        durationMinutes={durationMinutes}
        setDurationMinutes={setDurationMinutes}
        languageComplexity={languageComplexity}
        setLanguageComplexity={setLanguageComplexity}
        numPeople={numPeople}
        setNumPeople={setNumPeople}
        format={format}
        setFormat={setFormat}
        timeFrame={timeFrame}
        setTimeFrame={setTimeFrame}
        podcastStyle={podcastStyle}
        setPodcastStyle={setPodcastStyle}
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
        creditsData={creditsData}
        setShowVoiceModal={setShowVoiceModal}
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
      />

      <MorpheusWizard
        open={showMorpheus}
        onOpenChange={setShowMorpheus}
        initialTopic={topic}
        templateCategory="sports"
        onRefinedTopic={handleMorpheusComplete}
        isVoiceMode={isListening}
      />

      <VoiceSelectionModal
        open={showVoiceModal}
        onOpenChange={setShowVoiceModal}
        selectedVoiceIds={selectedVoiceIds}
        selectedAccents={selectedAccents}
        mood={podcastMood}
        onConfirm={(voiceIds, accents) => {
          setSelectedVoiceIds(voiceIds);
          setSelectedAccents(accents);
        }}
        numHosts={numPeople}
      />
    </div>
  );
}
