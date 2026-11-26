import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/use-analytics";
import { useTemplateSettings } from "@/hooks/useTemplateSettings";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import { EventForm } from "./EventForm";
import { type GeneratedPodcast, type Voice, VoiceQuality } from "@shared/schema";
import { VoiceSelectionModal, PodcastMood, type VoiceAccent } from "../voice-selection-modal";
import { MorpheusWizard } from "@/components/MorpheusWizard";
import { LocalEventDiscovery } from "../LocalEventDiscovery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, MapPin } from "lucide-react";

export function EventTemplateForm({ regenerateParams, onRegenerateUsed }: { regenerateParams?: any; onRegenerateUsed?: () => void }) {

  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [languageComplexity, setLanguageComplexity] = useState(5);
  const [numPeople, setNumPeople] = useState(1);
  const [eventFormat, setEventFormat] = useState("preview");
  const [eventType, setEventType] = useState("conference");
  const [podcastStyle, setPodcastStyle] = useState("conversational");
  const [timeFrame, setTimeFrame] = useState("past24h");
  const [coHostPersonality, setCoHostPersonality] = useState("casual");
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

  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showMorpheus, setShowMorpheus] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showEventDiscovery, setShowEventDiscovery] = useState(false);
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
  useTemplateSettings('events', {
    durationMinutes,
    languageComplexity,
    numPeople,
    podcastStyle,
    timeFrame,
    coHostPersonality,
    podcastMood,
    language,
    selectedVoiceIds,
    eventFormat,
    eventType,
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
    setEventFormat,
    setEventType,
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
        regenerateParams.templateCategory === 'events' &&
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
      if (regenerateParams.eventFormat) setEventFormat(regenerateParams.eventFormat);
      if (regenerateParams.eventType) setEventType(regenerateParams.eventType);
      
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
        templateName: 'Event',
        durationMinutes: requestBody.durationMinutes,
        requestBody,
      });
      if (podcast) {
        setTopic("");
        toast({
          title: "Event podcast brewed!",
          description: "Your event guide is ready in your library.",
        });
      }
    } catch (error: any) {
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        
      } else {
        toast({
          title: "Brew failed",
          description: error.message || "Failed to generate event podcast. Please try again.",
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
        description: `Event: "${transcript}"`,
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
        eventFormat,
        eventType,
        languageComplexity,
        numPeople,
        templateCategory: 'events',
      });

      const data = await response.json();
      if (data.enhancedTopic) {
        setTopic(data.enhancedTopic);
        toast({
          title: "Topic enhanced",
          description: "AI has enriched your event information!",
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

  const enhanceTopicAsync = async (topicText: string, detectedEventType: string) => {
    try {
      const response = await apiRequest("POST", "/api/podcasts/enhance-topic", {
        topic: topicText.trim(),
        eventFormat: 'preview',
        eventType: detectedEventType,
        languageComplexity,
        numPeople,
        templateCategory: 'events',
      });

      const data = await response.json();
      return data.enhancedTopic || topicText;
    } catch (error) {
      console.error("Error auto-enhancing topic:", error);
      return topicText;
    }
  };

  // Handle event selection from discovery panel (single or multiple events)
  const handleEventSelect = async (events: { name: string; venue: string; date: string; time?: string; description: string; category: string }[], discoveryDateRange?: string, discoveryEventType?: string) => {
    const eventArray = Array.isArray(events) ? events : [events];
    if (eventArray.length === 0) return;

    // Build topic combining all selected events
    let initialTopic = '';
    if (eventArray.length === 1) {
      const event = eventArray[0];
      const eventDetails = [
        event.name,
        `at ${event.venue}`,
        `on ${event.date}`,
        event.time ? `at ${event.time}` : '',
        event.description
      ].filter(Boolean).join(' - ');
      initialTopic = eventDetails;
    } else {
      const eventSummary = eventArray.map(e => `${e.name} on ${e.date}`).join('; ');
      initialTopic = `Multiple events: ${eventSummary}`;
    }

    // Map discovery dateRange to timeFrame
    const mapDateRangeToTimeFrame = (dateRange: string | undefined): string => {
      switch (dateRange) {
        case 'today': return 'next24h';
        case 'this_week': return 'nextWeek';
        case 'this_month': return 'nextMonth';
        default: return 'nextWeek';
      }
    };

    // Determine event type: use discovery type if provided, otherwise auto-detect from category
    let detectedEventType = discoveryEventType || 'conference';
    if (!discoveryEventType) {
      const firstEvent = eventArray[0];
      const categoryLower = firstEvent.category.toLowerCase().trim();
      const typeKeywords: Array<{ type: string; keywords: string[] }> = [
        { type: 'comedy', keywords: ['comedy', 'stand-up', 'standup', 'comedian', 'improv', 'funny', 'humor', 'humour', 'comic', 'laugh'] },
        { type: 'concert', keywords: ['concert', 'gig', 'band', 'orchestra', 'symphony', 'recital', 'dj', 'rock', 'jazz', 'pop', 'classical'] },
        { type: 'local-gigs', keywords: ['live music', 'live band', 'open mic', 'acoustic', 'jam session', 'music night'] },
        { type: 'festival', keywords: ['festival', 'fest', 'fair', 'carnival', 'celebration'] },
        { type: 'sports', keywords: ['sport', 'sports', 'game', 'match', 'tournament', 'race', 'championship', 'league', 'cup', 'athletics', 'football', 'soccer', 'basketball', 'tennis', 'cricket', 'rugby'] },
        { type: 'conference', keywords: ['conference', 'summit', 'symposium', 'convention', 'congress', 'forum', 'meetup', 'networking', 'expo', 'tradeshow', 'trade show', 'tech', 'business', 'industry'] },
        { type: 'exhibition', keywords: ['exhibition', 'exhibit', 'museum', 'gallery', 'art', 'display', 'showcase', 'art show', 'art exhibition'] },
        { type: 'workshop', keywords: ['workshop', 'seminar', 'class', 'training', 'course', 'masterclass', 'tutorial', 'lecture'] },
        { type: 'local-gigs', keywords: ['theater', 'theatre', 'play', 'drama', 'musical', 'opera', 'ballet', 'dance', 'performance', 'show', 'local', 'entertainment', 'event', 'live'] },
      ];
      
      let matchedType: string | null = null;
      for (const { type, keywords } of typeKeywords) {
        if (keywords.includes(categoryLower)) {
          matchedType = type;
          break;
        }
      }
      if (!matchedType) {
        for (const { type, keywords } of typeKeywords) {
          for (const keyword of keywords) {
            if (categoryLower.includes(keyword) || keyword.includes(categoryLower)) {
              matchedType = type;
              break;
            }
          }
          if (matchedType) break;
        }
      }
      detectedEventType = matchedType || 'local-gigs';
    }
    
    setEventType(detectedEventType);
    setTimeFrame(mapDateRangeToTimeFrame(discoveryDateRange));
    setEventFormat('preview');
    setShowEventDiscovery(false);
    
    // Auto-enhance the topic
    setIsEnhancing(true);
    const enhancedTopic = await enhanceTopicAsync(initialTopic, detectedEventType);
    setTopic(enhancedTopic);
    setIsEnhancing(false);
    
    toast({
      title: "Event(s) selected & enhanced",
      description: `${eventArray.length} event${eventArray.length !== 1 ? 's' : ''} added and AI enriched!`,
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Track Brew button click
    trackBrewClicked(true, durationMinutes);
    if (topic.trim()) {
      if (selectedVoicePool.length === 0 && selectedVoiceIds.length === 0) {
        toast({
          title: "No voices selected",
          description: "Please select at least one voice for your event podcast",
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
        eventFormat,
        eventType,
        podcastStyle,
        timeFrame,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoicePool,
        assignedVoices: assignedVoices.slice(0, numPeople),
        templateCategory: "events",
        selectedVoiceIds: trimmedVoiceIds.length > 0 ? trimmedVoiceIds : undefined,
        selectedAccents: Object.keys(filteredAccents).length > 0 ? filteredAccents : undefined
      });
    }
  };

  const eventDiscoverySection = (
    <Collapsible open={showEventDiscovery} onOpenChange={setShowEventDiscovery}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover-elevate py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Discover Local Events
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronDown className={`h-4 w-4 transition-transform ${showEventDiscovery ? 'rotate-180' : ''}`} />
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <LocalEventDiscovery
              onEventSelect={handleEventSelect}
              locationEnabled={locationSettings?.locationEnabled}
              locationCity={locationSettings?.locationCity}
            />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );

  return (
    <div className="space-y-6">
      <EventForm
        topic={topic}
        setTopic={setTopic}
        durationMinutes={durationMinutes}
        setDurationMinutes={setDurationMinutes}
        languageComplexity={languageComplexity}
        setLanguageComplexity={setLanguageComplexity}
        numPeople={numPeople}
        setNumPeople={setNumPeople}
        eventFormat={eventFormat}
        setEventFormat={setEventFormat}
        eventType={eventType}
        setEventType={setEventType}
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
        locationEnabled={locationSettings?.locationEnabled}
        locationCity={locationSettings?.locationCity}
        onToggleLocation={handleToggleLocation}
        discoverySection={eventDiscoverySection}
        onMorpheus={() => setShowMorpheus(true)}
        showMorpheus={true}
        isMorpheusOpen={showMorpheus}
      />

      <MorpheusWizard
        open={showMorpheus}
        onOpenChange={setShowMorpheus}
        initialTopic={topic}
        templateCategory="events"
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
