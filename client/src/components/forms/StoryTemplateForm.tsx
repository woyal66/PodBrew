import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/use-analytics";
import { useTemplateSettings } from "@/hooks/useTemplateSettings";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import { StoryForm } from "./StoryForm";
import { type VoiceId, type GeneratedPodcast, type Voice, VoiceQuality } from "@shared/schema";
import { VoiceSelectionModal, PodcastMood, type VoiceAccent } from "../voice-selection-modal";
import { MorpheusWizard } from "@/components/MorpheusWizard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function StoryTemplateForm({ regenerateParams, onRegenerateUsed }: { regenerateParams?: any; onRegenerateUsed?: () => void }) {

  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [languageComplexity, setLanguageComplexity] = useState(6);
  const [numPeople, setNumPeople] = useState(1);
  const [storyGenre, setStoryGenre] = useState("fantasy");
  const [podcastStyle, setPodcastStyle] = useState("narrative");
  const [timeFrame, setTimeFrame] = useState("allTime");
  const [coHostPersonality, setCoHostPersonality] = useState("storyteller");
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
  const [showAgeVerificationDialog, setShowAgeVerificationDialog] = useState(false);
  const [pendingGenerationData, setPendingGenerationData] = useState<any>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const recognitionRef = useRef<any>(null);
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

  // Load and save template settings
  useTemplateSettings('stories', {
    durationMinutes,
    languageComplexity,
    numPeople,
    podcastStyle,
    timeFrame,
    coHostPersonality,
    podcastMood,
    language,
    selectedVoiceIds,
    storyGenre,
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
    setStoryGenre,
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
        regenerateParams.templateCategory === 'stories' &&
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
      if (regenerateParams.storyGenre) setStoryGenre(regenerateParams.storyGenre);
      
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

  const selectedVoices = voices.filter(v => selectedVoiceIds.includes(v.id));

  const triggerGlobalBrew = async (requestBody: any) => {
    try {
      const podcast = await startBrewing({
        templateName: 'Audiobook',
        durationMinutes: requestBody.durationMinutes,
        requestBody,
      });
      if (podcast) {
        setTopic("");
        toast({
          title: "Audiobook crafted!",
          description: "Your audiobook is ready in your library.",
        });
      }
    } catch (error: any) {
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        
      } else {
        toast({
          title: "Generation failed",
          description: error.message || "Failed to generate audiobook. Please try again.",
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
        description: `Premise: "${transcript}"`,
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
        storyGenre,
        languageComplexity,
        numPeople,
        templateCategory: 'stories',
      });

      const data = await response.json();
      if (data.enhancedTopic) {
        setTopic(data.enhancedTopic);
        toast({
          title: "Premise enhanced",
          description: "AI has enriched your audiobook premise!",
        });
      }
    } catch (error) {
      console.error("Error enhancing topic:", error);
      toast({
        title: "Enhancement failed",
        description: "Could not enhance premise. Please try again.",
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
          description: "Please select at least one voice for your audiobook",
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

      // Check if NSFW Erotica is selected
      if (storyGenre === 'erotic') {
        setPendingGenerationData({
          topic: topic.trim(),
          durationMinutes,
          languageComplexity,
          numPeople,
          storyGenre,
          podcastStyle,
          timeFrame,
          coHostPersonality,
          podcastMood,
          language,
          selectedVoicePool,
          assignedVoices: assignedVoices.slice(0, numPeople),
          templateCategory: "stories",
          selectedVoiceIds: trimmedVoiceIds.length > 0 ? trimmedVoiceIds : undefined,
          selectedAccents: Object.keys(filteredAccents).length > 0 ? filteredAccents : undefined
        });
        setShowAgeVerificationDialog(true);
        return;
      }
      
      triggerGlobalBrew({ 
        topic: topic.trim(), 
        durationMinutes, 
        languageComplexity, 
        numPeople,
        storyGenre,
        podcastStyle,
        timeFrame,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoicePool,
        assignedVoices: assignedVoices.slice(0, numPeople),
        templateCategory: "stories",
        selectedVoiceIds: trimmedVoiceIds.length > 0 ? trimmedVoiceIds : undefined,
        selectedAccents: Object.keys(filteredAccents).length > 0 ? filteredAccents : undefined
      });
    }
  };

  const handleAgeVerificationConfirm = () => {
    if (!ageConfirmed) return;
    setShowAgeVerificationDialog(false);
    setAgeConfirmed(false);
    if (pendingGenerationData) {
      triggerGlobalBrew(pendingGenerationData);
      setPendingGenerationData(null);
    }
  };

  const handleAgeVerificationCancel = () => {
    setShowAgeVerificationDialog(false);
    setAgeConfirmed(false);
    setPendingGenerationData(null);
  };

  return (
    <div className="space-y-6">
      <StoryForm
        topic={topic}
        setTopic={setTopic}
        durationMinutes={durationMinutes}
        setDurationMinutes={setDurationMinutes}
        languageComplexity={languageComplexity}
        setLanguageComplexity={setLanguageComplexity}
        numPeople={numPeople}
        setNumPeople={setNumPeople}
        storyGenre={storyGenre}
        setStoryGenre={setStoryGenre}
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
      />

      <MorpheusWizard
        open={showMorpheus}
        onOpenChange={setShowMorpheus}
        initialTopic={topic}
        templateCategory="stories"
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

      <Dialog open={showAgeVerificationDialog} onOpenChange={(open) => {
        if (!open) handleAgeVerificationCancel();
      }}>
        <DialogContent className="w-full max-w-md mx-auto gap-4 p-4 sm:p-6" data-testid="dialog-age-verification">
          <DialogHeader>
            <DialogTitle className="text-xl sm:text-2xl" data-testid="text-age-verification-title">R18 Content Warning</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <DialogDescription className="text-base" data-testid="text-age-verification-description">
              This audiobook contains explicit adult content intended for mature audiences only.
            </DialogDescription>
            
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4">
              <p className="text-sm font-medium text-destructive">
                By confirming below, you legally certify that you are 18 years of age or older and consent to access this explicit content.
              </p>
            </div>

            <div className="flex items-start gap-3 pt-2">
              <Checkbox
                id="age-confirmation"
                checked={ageConfirmed}
                onCheckedChange={(checked) => setAgeConfirmed(checked === true)}
                data-testid="checkbox-age-confirmation"
              />
              <label
                htmlFor="age-confirmation"
                className="text-sm cursor-pointer leading-tight pt-1"
              >
                I confirm I am 18 years or older and understand this content is explicit adult material
              </label>
            </div>
          </div>

          <DialogFooter className="flex gap-2 justify-end pt-4">
            <Button
              variant="outline"
              onClick={handleAgeVerificationCancel}
              data-testid="button-age-verify-no"
              className="w-full sm:w-auto"
            >
              Decline
            </Button>
            <Button
              onClick={handleAgeVerificationConfirm}
              disabled={!ageConfirmed}
              data-testid="button-age-verify-yes"
              className="w-full sm:w-auto"
            >
              I Confirm & Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
