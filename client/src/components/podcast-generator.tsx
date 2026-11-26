import { useState, useRef, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Loader2, Mic, MicOff, Sparkles, Mic2, Clock, Info, Music2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GeneratedPodcast, InsertGeneratedPodcast, VoiceId, TemplateCategory, VoiceQuality, Voice, MusicStyleId } from "@shared/schema";
import { MUSIC_STYLE_IDS } from "@shared/schema";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";

type VoiceAccent = 'American' | 'British' | 'Australian' | 'Southern American' | 'Irish' | 'Scottish' | 'Canadian' | 'New Zealand' | 'Indian' | null;
import { AVAILABLE_VOICES, VOICE_QUALITY_TIERS } from "@shared/schema";
import { getTemplateConfig } from "@/lib/templateRegistry";
import { VoiceSelectionModal, PodcastMood } from "@/components/voice-selection-modal";
import { MorpheusWizard } from "@/components/MorpheusWizard";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useAnalytics } from "@/hooks/use-analytics";
import { CustomForm } from "@/components/forms/CustomForm";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { MicPermissionRecoveryDialog } from "@/components/mic-permission-recovery-dialog";
import { isNativeMobile } from "@/lib/nativeBridge";

const MUSIC_STYLE_LABELS: Record<string, string> = {
  none: 'No Music',
  ambient: 'Ambient',
  news: 'News',
  upbeat: 'Upbeat',
  cinematic: 'Cinematic',
  jazz: 'Jazz',
  acoustic: 'Acoustic',
  inspiring: 'Inspiring',
};

function MusicStylePicker({ value, onChange }: { value: MusicStyleId; onChange: (v: MusicStyleId) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Music2 className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Background Music</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MUSIC_STYLE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`button-music-style-${id}`}
            onClick={() => onChange(id)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
              value === id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-muted-foreground border-border hover-elevate'
            }`}
          >
            {MUSIC_STYLE_LABELS[id]}
          </button>
        ))}
      </div>
    </div>
  );
}

function getAutomaticVoiceQuality(voices: Voice[]): { quality: VoiceQuality; creditsPerMinute: number } {
  // All voices use Gemini 2.5 Flash TTS (Premium tier only)
  return {
    quality: 'premium',
    creditsPerMinute: VOICE_QUALITY_TIERS.premium.creditsPerMinute
  };
}

interface PodcastGeneratorProps {
  selectedTemplate: TemplateCategory;
  regenerateParams?: any;
  onRegenerateUsed?: () => void;
}

export function PodcastGenerator({ selectedTemplate, regenerateParams, onRegenerateUsed }: PodcastGeneratorProps) {
  const templateConfig = getTemplateConfig(selectedTemplate);
  const { FormComponent } = templateConfig;

  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [languageComplexity, setLanguageComplexity] = useState(5);
  const [numPeople, setNumPeople] = useState(2);
  const [podcastStyle, setPodcastStyle] = useState("conversational");
  const [timeFrame, setTimeFrame] = useState("pastMonth");
  const [coHostPersonality, setCoHostPersonality] = useState("casual");
  const [podcastMood, setPodcastMood] = useState<PodcastMood>("balanced");
  const [language, setLanguage] = useState("en");
  const [selectedVoicePool, setSelectedVoicePool] = useState<string[]>([]);
  const [assignedVoices, setAssignedVoices] = useState<string[]>([]);
  const [selectedVoiceIds, setSelectedVoiceIds] = useState<string[]>([]);
  const [selectedAccents, setSelectedAccents] = useState<Record<string, VoiceAccent | null>>({});
  const [musicStyle, setMusicStyle] = useState<MusicStyleId>('ambient');
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showMorpheus, setShowMorpheus] = useState(false);
  const [, setLocation] = useLocation();
  const [isListening, setIsListening] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [micRecoveryOpen, setMicRecoveryOpen] = useState(false);
  const [lastEnhanceTime, setLastEnhanceTime] = useState(0);
  const recognitionRef = useRef<any>(null);
  const lastProcessedIndexRef = useRef<number>(0);
  const accumulatedTranscriptRef = useRef<string>('');
  const processedRegenerateRef = useRef<any>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  // Per-form submit lock: prevents duplicate generation from rapid Brew clicks
  const isSubmittingRef = useRef(false);
  const { toast } = useToast();
  const { trackBrewClicked } = useAnalytics();
  const { play: playPodcast } = useAudioPlayer();
  const { startBrewing, activeBrewCount } = useGlobalBrewing();

  // Fetch user credits
  const { data: creditsData, isLoading: isLoadingCredits, isError: isCreditsError } = useQuery<{ credits: number; plan: string }>({
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

  // Fetch voices for custom selection
  const { data: voices = [] } = useQuery<Voice[]>({
    queryKey: ['/api/voices'],
    staleTime: 600_000,
  });

  // Load last used voices from localStorage or set default voice (Morpheus)
  useEffect(() => {
    if (voices.length > 0 && selectedVoiceIds.length === 0) {
      // Try to load from localStorage first
      const savedVoiceIds = localStorage.getItem('podbrewLastVoices');
      if (savedVoiceIds) {
        try {
          const parsedIds = JSON.parse(savedVoiceIds) as string[];
          // Validate that the saved IDs still exist in the voice list
          const validIds = parsedIds.filter(id => voices.some(v => v.id === id));
          if (validIds.length > 0) {
            setSelectedVoiceIds(validIds);
            return;
          }
        } catch (e) {
          console.error('Failed to parse saved voice IDs from localStorage', e);
        }
      }
      
      // Fallback to Morpheus voice (sadachbia) - the default for all new users
      const morpheusVoice = voices.find(v => v.googleVoiceName === 'sadachbia' || v.aliasName === 'Morpheus');
      if (morpheusVoice) {
        setSelectedVoiceIds([morpheusVoice.id]);
        return;
      }
      
      // Final fallback: use first available voice if Morpheus not found
      if (voices.length > 0) {
        setSelectedVoiceIds([voices[0].id]);
      }
    }
  }, [voices.length]);
  
  // Save selected voices to localStorage whenever they change
  useEffect(() => {
    if (selectedVoiceIds.length > 0) {
      localStorage.setItem('podbrewLastVoices', JSON.stringify(selectedVoiceIds));
    }
  }, [selectedVoiceIds]);

  // Load selected accents from localStorage on mount
  useEffect(() => {
    const savedAccents = localStorage.getItem('podbrewLastAccents');
    if (savedAccents) {
      try {
        const parsedAccents = JSON.parse(savedAccents);
        if (typeof parsedAccents === 'object' && parsedAccents !== null) {
          if (import.meta.env.DEV) console.log('[PodcastGenerator] Loaded accents from localStorage:', parsedAccents);
          setSelectedAccents(parsedAccents);
        }
      } catch (e) {
        console.error('Failed to parse saved accents from localStorage', e);
      }
    }
  }, []);

  // Synchronize accents when selectedVoiceIds change - ensure we have accent entries for all selected voices
  // This also checks localStorage for previously saved accents to preserve custom selections
  useEffect(() => {
    if (selectedVoiceIds.length > 0 && voices.length > 0) {
      // Load saved accents from localStorage to preserve custom selections
      let savedAccents: Record<string, VoiceAccent | null> = {};
      try {
        const stored = localStorage.getItem('podbrewLastAccents');
        if (stored) {
          savedAccents = JSON.parse(stored);
        }
      } catch (e) {
        console.error('[PodcastGenerator] Failed to parse localStorage accents:', e);
      }
      
      setSelectedAccents(prev => {
        const updated = { ...prev };
        let hasChanges = false;
        
        // Ensure each selected voice has an accent entry
        selectedVoiceIds.forEach(voiceId => {
          if (!(voiceId in updated) || updated[voiceId] === null) {
            // Priority: 1) localStorage saved accent, 2) voice default accent
            if (savedAccents[voiceId]) {
              updated[voiceId] = savedAccents[voiceId];
              hasChanges = true;
              console.log(`[PodcastGenerator] Restored saved accent for ${voiceId}: ${savedAccents[voiceId]}`);
            } else {
              // Get default accent from voice data
              const voice = voices.find(v => v.id === voiceId);
              if (voice) {
                updated[voiceId] = (voice.accent as VoiceAccent) || 'American';
                hasChanges = true;
                console.log(`[PodcastGenerator] Added default accent for ${voice.aliasName || voice.displayName}: ${updated[voiceId]}`);
              }
            }
          }
        });
        
        // Log current accent state for debugging
        if (hasChanges) {
          console.log('[PodcastGenerator] Synced accents with selected voices:', updated);
        }
        
        return hasChanges ? updated : prev;
      });
    }
  }, [selectedVoiceIds, voices]);

  // Save selected accents to localStorage whenever they change
  useEffect(() => {
    if (Object.keys(selectedAccents).length > 0) {
      if (import.meta.env.DEV) console.log('[PodcastGenerator] Saving accents to localStorage:', selectedAccents);
      localStorage.setItem('podbrewLastAccents', JSON.stringify(selectedAccents));
    }
  }, [selectedAccents]);

  // Load custom podcast settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('podbrewCustomSettings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        // Only apply saved settings if not coming from regenerate params
        if (!regenerateParams) {
          if (settings.durationMinutes !== undefined) setDurationMinutes(settings.durationMinutes);
          if (settings.languageComplexity !== undefined) setLanguageComplexity(settings.languageComplexity);
          if (settings.numPeople !== undefined) setNumPeople(settings.numPeople);
          if (settings.podcastStyle !== undefined) setPodcastStyle(settings.podcastStyle);
          if (settings.timeFrame !== undefined) setTimeFrame(settings.timeFrame);
          if (settings.coHostPersonality !== undefined) setCoHostPersonality(settings.coHostPersonality);
          if (settings.podcastMood !== undefined) setPodcastMood(settings.podcastMood);
          if (settings.language !== undefined) setLanguage(settings.language);
        }
      } catch (e) {
        console.error('Failed to parse saved custom settings from localStorage', e);
      }
    }
  }, []); // Run only on mount

  // Save custom podcast settings to localStorage whenever they change
  useEffect(() => {
    const settings = {
      durationMinutes,
      languageComplexity,
      numPeople,
      podcastStyle,
      timeFrame,
      coHostPersonality,
      podcastMood,
      language,
    };
    localStorage.setItem('podbrewCustomSettings', JSON.stringify(settings));
  }, [durationMinutes, languageComplexity, numPeople, podcastStyle, timeFrame, coHostPersonality, podcastMood, language]);

  // Regenerate: Initialize custom template form from saved parameters
  useEffect(() => {
    // Only process regenerate params once by checking if we've already processed this instance
    if (regenerateParams && 
        selectedTemplate === 'custom' && 
        regenerateParams.templateCategory === 'custom' &&
        processedRegenerateRef.current !== regenerateParams) {
      
      processedRegenerateRef.current = regenerateParams;
      
      if (regenerateParams.topic) setTopic(regenerateParams.topic);
      if (regenerateParams.durationMinutes) setDurationMinutes(regenerateParams.durationMinutes);
      if (regenerateParams.languageComplexity) setLanguageComplexity(regenerateParams.languageComplexity);
      if (regenerateParams.numPeople) setNumPeople(regenerateParams.numPeople);
      if (regenerateParams.podcastStyle) setPodcastStyle(regenerateParams.podcastStyle);
      if (regenerateParams.timeFrame) setTimeFrame(regenerateParams.timeFrame);
      if (regenerateParams.coHostPersonality) setCoHostPersonality(regenerateParams.coHostPersonality);
      if (regenerateParams.podcastMood) setPodcastMood(regenerateParams.podcastMood as any);
      if (regenerateParams.language) setLanguage(regenerateParams.language);
      if (regenerateParams.hostVoices && regenerateParams.hostVoices.length > 0) {
        setSelectedVoiceIds(regenerateParams.hostVoices);
      }
      
      // Clear regenerate params after using
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
  }, [regenerateParams, selectedTemplate, onRegenerateUsed]);

  const selectedVoices = voices.filter(v => selectedVoiceIds.includes(v.id));

  // Get voice objects for auto-assigned voices (when no custom voices selected)
  const autoAssignedVoiceObjects = useMemo(() => {
    if (selectedVoiceIds.length > 0 || voices.length === 0) return [];
    // Find voice objects for the assigned voice IDs from the voices array
    // assignedVoices contains voice IDs from the database
    const voiceMap = new Map(voices.map((v: Voice) => [v.id.toLowerCase(), v]));
    return assignedVoices.slice(0, numPeople).map(id => {
      // Try to find by ID from the database
      return voiceMap.get(id as string);
    }).filter(Boolean) as Voice[];
  }, [selectedVoiceIds.length, assignedVoices, numPeople, voices]);

  // Auto-calculate voice quality from selected OR auto-assigned voices
  const { quality: autoQuality, creditsPerMinute } = useMemo(() => {
    // Use custom voices if selected, otherwise use auto-assigned voices
    const voicesToUse = selectedVoiceIds.length > 0 
      ? selectedVoices.slice(0, numPeople)
      : autoAssignedVoiceObjects;
    
    const result = getAutomaticVoiceQuality(voicesToUse);
    
    // Fallback: If no voices found, default to Premium tier
    // This matches backend behavior where voices use Gemini 2.5 Flash TTS (Premium tier)
    if (voicesToUse.length === 0 && selectedVoiceIds.length === 0) {
      return {
        quality: 'premium' as VoiceQuality,
        creditsPerMinute: VOICE_QUALITY_TIERS.premium.creditsPerMinute
      };
    }
    
    return result;
  }, [selectedVoices, selectedVoiceIds.length, autoAssignedVoiceObjects, numPeople]);

  // Helper function to trigger brew with GlobalBrewingContext
  const triggerGlobalBrew = async (requestBody: any) => {
    try {
      const podcast = await startBrewing({
        templateName: 'Custom',
        topic: requestBody.topic,
        durationMinutes: requestBody.durationMinutes,
        requestBody,
      });
      
      if (podcast) {
        setTopic("");
        const navigateOnComplete = localStorage.getItem('podbrew_navigate_on_complete') !== 'false';
        const autoPlayEnabled = localStorage.getItem('podbrew_autoplay') === 'true';
        
        if (navigateOnComplete && podcast.id) {
          toast({
            title: "Podcast Brewed!",
            description: `"${podcast.title || podcast.topic}" is ready.`,
          });
          setTimeout(() => {
            playPodcast(podcast, true, autoPlayEnabled);
          }, 500);
        } else {
          toast({
            title: "Podcast Brewed!",
            description: `Your ${requestBody.durationMinutes}-minute podcast is ready to listen.`,
            action: podcast.id ? (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => playPodcast(podcast, true)}
                data-testid="button-toast-open-podcast"
              >
                Open
              </Button>
            ) : undefined,
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Brew failed",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };
  

  useEffect(() => {
    const handler = (e: Event) => {
      const params = (e as CustomEvent).detail;
      if (!params) return;
      if (params.topic) setTopic(params.topic);
      if (params.durationMinutes) setDurationMinutes(params.durationMinutes);
      if (params.numPeople) setNumPeople(params.numPeople);
      if (params.podcastStyle) setPodcastStyle(params.podcastStyle);
      if (params.podcastMood) setPodcastMood(params.podcastMood as PodcastMood);
      if (params.coHostPersonality) setCoHostPersonality(params.coHostPersonality);
      if (params.language) setLanguage(params.language);
      toast({
        title: "Voice Command",
        description: `Ready to brew: ${params.topic}`,
      });
    };
    window.addEventListener("podbrew-voice-create", handler);
    return () => window.removeEventListener("podbrew-voice-create", handler);
  }, [toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Per-form single-submit guard: synchronously blocks re-entry before UI re-renders
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    
    // Track Brew button click
    trackBrewClicked(true, durationMinutes);
    
    if (topic.trim()) {
      if (selectedVoicePool.length === 0 && selectedVoiceIds.length === 0) {
        toast({
          title: "No voices selected",
          description: "Please select at least one voice for your podcast",
          variant: "destructive",
        });
        isSubmittingRef.current = false;
        return;
      }
      
      // Check if number of hosts exceeds number of selected voices
      // This ensures there's one individual voice per host
      if (selectedVoiceIds.length > 0 && numPeople > selectedVoiceIds.length) {
        setShowVoiceModal(true);
        toast({
          title: "More voices needed",
          description: `You need ${numPeople} voice${numPeople > 1 ? 's' : ''} for ${numPeople} host${numPeople > 1 ? 's' : ''}. Please select ${numPeople - selectedVoiceIds.length} more.`,
          variant: "default",
        });
        isSubmittingRef.current = false;
        return;
      }
      
      // Scroll to progress slider on mobile when Brew is clicked
      setTimeout(() => {
        const progressSection = document.getElementById('brew-progress-section');
        if (progressSection && window.innerWidth < 768) {
          progressSection.scrollIntoView({ behavior: 'smooth' });
        }
      }, 50);
      
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
      
      console.log('[PodcastGenerator] Submitting brew with accents:', {
        selectedVoiceIds: voiceIdsToUse,
        filteredAccents,
        originalAccents: selectedAccents
      });
      
      triggerGlobalBrew({ 
        topic: topic.trim(), 
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
        templateCategory: selectedTemplate,
        musicStyle: musicStyle,
      });
    } else {
      // No topic — release the lock immediately
      isSubmittingRef.current = false;
    }
  };
  
  const toggleVoiceInPool = (voiceId: VoiceId) => {
    setSelectedVoicePool(prev => {
      if (prev.includes(voiceId)) {
        const newPool = prev.filter(v => v !== voiceId);
        if (newPool.length === 0) {
          toast({
            title: "At least one voice required",
            description: "You must select at least one voice",
            variant: "destructive",
          });
          return prev;
        }
        return newPool;
      } else {
        return [...prev, voiceId];
      }
    });
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      toast({
        title: "Voice Input Not Supported",
        description: "Your browser doesn't support voice input. Try Chrome or Edge.",
        variant: "destructive",
      });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      lastProcessedIndexRef.current = 0;
      accumulatedTranscriptRef.current = topic || ''; // Start with existing topic
      toast({
        title: "Listening...",
        description: "Start speaking your podcast topic.",
      });
    };

    recognition.onresult = (event: any) => {
      // Only process new final results
      for (let i = lastProcessedIndexRef.current; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          // Append to accumulated transcript
          accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + ' ' + transcript).trim();
          lastProcessedIndexRef.current = i + 1;
        }
      }
      
      // Update topic state with accumulated transcript
      setTopic(accumulatedTranscriptRef.current);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);

      if (event.error === 'not-allowed') {
        // On native Android or iOS, give the user a working recovery path
        // (open settings, auto-detect grant on resume) instead of a dead-end
        // toast. On web, fall back to a clear toast.
        if (isNativeMobile()) {
          setMicRecoveryOpen(true);
        } else {
          toast({
            title: "Microphone Access Denied",
            description: "Please allow microphone access and try again.",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Voice Input Error",
          description: "Something went wrong. Please try typing instead.",
          variant: "destructive",
        });
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      lastProcessedIndexRef.current = 0;
      accumulatedTranscriptRef.current = '';
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleAIEnhance = async () => {
    if (!topic.trim()) {
      toast({
        title: "No Topic to Enhance",
        description: "Please enter a topic first.",
        variant: "destructive",
      });
      return;
    }

    const now = Date.now();
    const cooldownTime = 5000;
    
    if (now - lastEnhanceTime < cooldownTime) {
      const remaining = Math.ceil((cooldownTime - (now - lastEnhanceTime)) / 1000);
      toast({
        title: "Please Wait",
        description: `Try again in ${remaining} second${remaining === 1 ? '' : 's'}.`,
        variant: "destructive",
      });
      return;
    }

    setIsEnhancing(true);

    try {
      const response = await apiRequest("POST", "/api/podcasts/enhance-topic", {
        topic: topic.trim(),
        podcastStyle,
        languageComplexity,
        numPeople,
        timeFrame,
        coHostPersonality,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to enhance topic");
      }
      
      const data = await response.json();
      
      if (!data.enhancedTopic) {
        throw new Error("No enhanced topic received");
      }
      
      setTopic(data.enhancedTopic);
      setLastEnhanceTime(now);
      
      toast({
        title: "Topic Enhanced!",
        description: "Your topic has been refined by AI.",
      });
    } catch (error: any) {
      toast({
        title: "Enhancement Failed",
        description: error.message || "Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const charCount = topic.length;
  const isValid = charCount >= 10 && charCount <= 500;

  const handleMorpheusComplete = (refinedTopic: string, _context: string) => {
    setTopic(refinedTopic);
    setShowMorpheus(false);
  };

  // Show template-specific form for non-custom templates
  if (selectedTemplate !== 'custom') {
    return (
      <div className="space-y-6">
        <FormComponent 
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
          setPodcastMood={(mood) => setPodcastMood(mood as PodcastMood)}
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
          onVoiceInput={toggleVoiceInput}
          onEnhanceTopic={handleAIEnhance}
          isEnhancing={isEnhancing}
          onSubmit={handleSubmit}
          isGenerating={activeBrewCount > 0}
          topicRef={topicRef}
          regenerateParams={regenerateParams} 
          onRegenerateUsed={onRegenerateUsed}
          locationEnabled={locationSettings?.locationEnabled}
          locationCity={locationSettings?.locationCity}
          onToggleLocation={handleToggleLocation}
        />
        <MusicStylePicker value={musicStyle} onChange={setMusicStyle} />
        <MicPermissionRecoveryDialog
          open={micRecoveryOpen}
          onOpenChange={setMicRecoveryOpen}
          onGranted={() => toggleVoiceInput()}
        />
      </div>
    );
  }

  // Show unified custom template form using TemplateFormLayout
  return (
    <div className="space-y-6">
      <CustomForm
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
        setPodcastMood={(mood) => setPodcastMood(mood as PodcastMood)}
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
        onVoiceInput={toggleVoiceInput}
        onEnhanceTopic={handleAIEnhance}
        isEnhancing={isEnhancing}
        onSubmit={handleSubmit}
        isGenerating={activeBrewCount > 0}
        topicRef={topicRef}
        locationEnabled={locationSettings?.locationEnabled}
        locationCity={locationSettings?.locationCity}
        onToggleLocation={handleToggleLocation}
        onMorpheus={() => setShowMorpheus(true)}
        isMorpheusOpen={showMorpheus}
      />
      <MusicStylePicker value={musicStyle} onChange={setMusicStyle} />

      <MorpheusWizard
        open={showMorpheus}
        onOpenChange={setShowMorpheus}
        initialTopic={topic}
        templateCategory="custom"
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
          if (accents) {
            setSelectedAccents(accents);
          }
          toast({
            title: "Voices Selected",
            description: `${voiceIds.length} custom voice${voiceIds.length > 1 ? 's' : ''} selected for your podcast.`,
          });
        }}
      />

      <MicPermissionRecoveryDialog
        open={micRecoveryOpen}
        onOpenChange={setMicRecoveryOpen}
        onGranted={() => toggleVoiceInput()}
      />
    </div>
  );
}
