import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/use-analytics";
import { useTemplateSettings } from "@/hooks/useTemplateSettings";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import { TeachMeForm } from "./TeachMeForm";
import { type VoiceId, type GeneratedPodcast, type Voice, type VoiceQuality } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { VoiceSelectionModal, PodcastMood, type VoiceAccent } from "../voice-selection-modal";
import { MorpheusWizard } from "../MorpheusWizard";
import { CourseSettingsPanel, type DeliveryMode, type DailyScheduleSettings } from "./CourseSettingsPanel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

interface SyllabusEpisode {
  episodeNumber: number;
  title: string;
  focusTopic: string;
  keyPoints: string[];
  generated: boolean;
  podcastId?: string;
}

export function TeachMeTemplateForm({ regenerateParams, onRegenerateUsed }: { regenerateParams?: any; onRegenerateUsed?: () => void }) {

  const [topic, setTopic] = useState("");
  const [refinedContext, setRefinedContext] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [languageComplexity, setLanguageComplexity] = useState(5);
  const [numPeople, setNumPeople] = useState(1);
  const [podcastStyle, setPodcastStyle] = useState("tutor");
  const [timeFrame, setTimeFrame] = useState("allTime");
  const [coHostPersonality, setCoHostPersonality] = useState("academic");
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
  
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("single");
  const [episodeCount, setEpisodeCount] = useState(5);
  const [episodeDuration, setEpisodeDuration] = useState(10);
  const [showCourseSettings, setShowCourseSettings] = useState(false);
  const [dailySchedule, setDailySchedule] = useState<DailyScheduleSettings>({
    autoGenerateEnabled: true,
    autoGenerateTime: "08:00",
    autoGenerateTimezone: "UTC",
    autoGeneratePublic: true,
  });
  const [dailyPresetProgress, setDailyPresetProgress] = useState(0);
  const [dailyPresetStatus, setDailyPresetStatus] = useState("");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [generateStatus, setGenerateStatus] = useState("");
  const recognitionRef = useRef<any>(null);
  const dailyPresetIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
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


  // Load and save template settings
  useTemplateSettings('teach', {
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
        regenerateParams.templateCategory === 'teachme' &&
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

  const selectedVoices = voices.filter((v) => selectedVoiceIds.includes(v.id));

  const triggerGlobalBrew = async (requestBody: any) => {
    try {
      const podcast = await startBrewing({
        templateName: 'TeachMe',
        durationMinutes: requestBody.durationMinutes,
        requestBody,
      });
      if (podcast) {
        setTopic("");
        const isCourse = (podcast as any)?.type === 'course';
        if (isCourse) {
          toast({
            title: `Course created! ${(podcast as any).episodeCount} episodes`,
            description: `Your ${(podcast as any).episodeCount}-episode course is ready in your library.`,
          });
        } else {
          toast({
            title: "Learning podcast created!",
            description: "Your educational podcast is ready in your library.",
          });
        }
      }
    } catch (error: any) {
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        
      } else {
        toast({
          title: "Generation failed",
          description: error.message || "Failed to generate learning podcast. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  // Daily Micro-Learning preset mutation
  const dailyPresetMutation = useMutation<{ preset: any; message: string }, Error, {
    topic: string;
    episodeCount: number;
    episodeDuration: number;
    languageComplexity: number;
    numPeople: number;
    podcastStyle: string;
    coHostPersonality: string;
    podcastMood: string;
    language: string;
    selectedVoiceIds: string[];
    autoGenerateEnabled: boolean;
    autoGenerateTime: string;
    autoGenerateTimezone: string;
    autoGeneratePublic: boolean;
    refinedContext?: string;
  }>({
    mutationFn: async (data) => {
      setGenerateProgress(0);
      setGenerateStatus("Creating course syllabus...");
      
      const progressSteps = [
        { progress: 20, status: "Generating episode outlines..." },
        { progress: 50, status: "Building course structure..." },
        { progress: 80, status: "Scheduling daily delivery..." },
        { progress: 100, status: "Course scheduled!" },
      ];
      
      let stepIndex = 0;
      progressIntervalRef.current = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          setGenerateProgress(progressSteps[stepIndex].progress);
          setGenerateStatus(progressSteps[stepIndex].status);
          stepIndex++;
        }
      }, 1500);
      
      const response = await apiRequest("POST", "/api/teachme-preset/generate-syllabus", data);
      return response.json();
    },
    onSuccess: (data) => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      setGenerateProgress(100);
      setGenerateStatus("Daily course scheduled!");
      
      queryClient.invalidateQueries({ queryKey: ['/api/teachme-preset'] });
      queryClient.invalidateQueries({ queryKey: ['/api/teachme-presets'] });
      setTopic("");
      
      setTimeout(() => {
        setGenerateProgress(0);
        setGenerateStatus("");
      }, 2000);

      toast({
        title: "Daily Micro-Learning Scheduled!",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      setGenerateProgress(0);
      setGenerateStatus("");
      
      toast({
        title: "Failed to create course",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });


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
        description: `Learning topic: "${transcript}"`,
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
        languageComplexity,
        numPeople,
        templateCategory: 'teachme',
      });

      const data = await response.json();
      if (data.enhancedTopic) {
        setTopic(data.enhancedTopic);
        toast({
          title: "Topic enhanced",
          description: "AI has enriched your learning topic!",
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const effectiveDurationForTracking = deliveryMode === "single" ? durationMinutes : episodeDuration;
    // Track Brew button click
    trackBrewClicked(true, effectiveDurationForTracking);
    if (topic.trim()) {
      if (selectedVoicePool.length === 0 && selectedVoiceIds.length === 0) {
        toast({
          title: "No voices selected",
          description: "Please select at least one voice for your learning podcast",
          variant: "destructive",
        });
        return;
      }
      
      const trimmedVoiceIds = selectedVoiceIds.slice(0, numPeople);
      
      // Handle Daily Micro-Learning mode - create a scheduled preset
      if (deliveryMode === "daily") {
        dailyPresetMutation.mutate({
          topic: topic.trim(),
          episodeCount,
          episodeDuration,
          languageComplexity,
          numPeople,
          podcastStyle,
          coHostPersonality,
          podcastMood,
          language,
          selectedVoiceIds: trimmedVoiceIds,
          autoGenerateEnabled: dailySchedule.autoGenerateEnabled,
          autoGenerateTime: dailySchedule.autoGenerateTime,
          autoGenerateTimezone: dailySchedule.autoGenerateTimezone,
          autoGeneratePublic: dailySchedule.autoGeneratePublic,
          refinedContext: refinedContext || undefined,
        });
        return;
      }
      
      // Handle Single and Binge Course modes - generate immediately
      const effectiveDuration = deliveryMode === "single" ? durationMinutes : episodeDuration;
      
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
        durationMinutes: effectiveDuration,
        languageComplexity, 
        numPeople,
        podcastStyle,
        timeFrame,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoicePool,
        assignedVoices: assignedVoices.slice(0, numPeople),
        templateCategory: "teachme",
        selectedVoiceIds: trimmedVoiceIds.length > 0 ? trimmedVoiceIds : undefined,
        selectedAccents: Object.keys(filteredAccents).length > 0 ? filteredAccents : undefined,
        courseSettings: deliveryMode !== "single" ? {
          deliveryMode,
          episodeCount,
          episodeDuration,
        } : undefined,
        refinedContext: refinedContext || undefined,
      });
    }
  };

  const handleMorpheusComplete = (refinedTopic: string, context: string) => {
    setTopic(refinedTopic);
    setRefinedContext(context);
    setShowMorpheus(false);
  };

  return (
    <div className="space-y-6">
      <TeachMeForm
        topic={topic}
        setTopic={setTopic}
        durationMinutes={deliveryMode === "single" ? durationMinutes : episodeDuration}
        setDurationMinutes={deliveryMode === "single" ? setDurationMinutes : setEpisodeDuration}
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
        creditsData={creditsData}
        setShowVoiceModal={setShowVoiceModal}
        isListening={isListening}
        onVoiceInput={handleVoiceInput}
        onEnhanceTopic={handleEnhanceTopic}
        isEnhancing={isEnhancing}
        onSubmit={handleSubmit}
        isGenerating={false}
        topicRef={topicRef}
        onMorpheus={() => setShowMorpheus(true)}
        showMorpheus={true}
        isMorpheusOpen={showMorpheus}
        beforeCommonControls={
          <Collapsible open={showCourseSettings} onOpenChange={setShowCourseSettings}>
            <CollapsibleTrigger className="w-full flex items-center justify-between p-3 rounded-md border border-border hover-elevate cursor-pointer">
              <div className="flex items-center gap-2 font-medium text-sm">
                <span>Course Structure</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform" style={{
                transform: showCourseSettings ? 'rotate(180deg)' : 'rotate(0deg)'
              }} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <CourseSettingsPanel
                deliveryMode={deliveryMode}
                setDeliveryMode={setDeliveryMode}
                episodeCount={episodeCount}
                setEpisodeCount={setEpisodeCount}
                episodeDuration={episodeDuration}
                setEpisodeDuration={setEpisodeDuration}
                isGenerating={false}
                dailySchedule={dailySchedule}
                setDailySchedule={setDailySchedule}
              />
            </CollapsibleContent>
          </Collapsible>
        }
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

      <MorpheusWizard
        open={showMorpheus}
        onOpenChange={setShowMorpheus}
        initialTopic={topic}
        templateCategory="teachme"
        onRefinedTopic={handleMorpheusComplete}
        isVoiceMode={isListening}
      />
    </div>
  );
}
