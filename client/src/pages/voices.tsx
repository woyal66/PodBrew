import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Play, 
  Pause, 
  Mic2, 
  Filter,
  Volume2,
  Heart,
  Heart as HeartFilled,
  Globe,
  Loader2
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VoiceFavorite } from "@shared/schema";
import { AVAILABLE_ACCENTS, type VoiceAccent } from "@/components/voice-selection-modal";

interface Voice {
  id: string;
  googleVoiceName: string;
  displayName: string;
  aliasName: string;
  description: string;
  accent: string;
  gender: string;
  modelType: string;
  tier: string;
  category: string;
  toneArchetype: string | null;
  previewUrl: string | null;
  avatarUrl: string | null;
  supportedStyles: string[];
  isActive: boolean;
  sortOrder: number;
}

export default function VoiceBrowsePage() {
  const [selectedTone, setSelectedTone] = useState<string>("all");
  const [selectedGender, setSelectedGender] = useState<string>("all");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioHandlerRef = useRef<(() => void) | null>(null);
  const [voiceAccents, setVoiceAccents] = useState<Record<string, VoiceAccent>>({});
  const { toast } = useToast();

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioHandlerRef.current) {
        audioRef.current.removeEventListener('ended', audioHandlerRef.current);
        audioHandlerRef.current = null;
      }
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanupAudio;
  }, [cleanupAudio]);

  const { data: voices = [], isLoading } = useQuery<Voice[]>({
    queryKey: ['/api/voices'],
    staleTime: 600_000,
  });

  const { data: favorites = [] } = useQuery<VoiceFavorite[]>({
    queryKey: ['/api/voices/favorites'],
  });

  const favoriteVoiceIds = useMemo(() => {
    return new Set(favorites.map(f => f.voiceId));
  }, [favorites]);

  const addFavoriteMutation = useMutation({
    mutationFn: async (voiceId: string) => {
      return await apiRequest('POST', '/api/voices/favorites', { voiceId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/voices/favorites'] });
    },
  });

  const removeFavoriteMutation = useMutation({
    mutationFn: async (voiceId: string) => {
      return await apiRequest('DELETE', `/api/voices/favorites/${encodeURIComponent(voiceId)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/voices/favorites'] });
    },
  });

  const toggleFavorite = (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();
    if (favoriteVoiceIds.has(voiceId)) {
      removeFavoriteMutation.mutate(voiceId);
    } else {
      addFavoriteMutation.mutate(voiceId);
    }
  };

  // Extract unique tones from voice library
  const availableTones = useMemo(() => {
    const tones = new Set<string>();
    voices.forEach(voice => {
      if (voice.toneArchetype) {
        tones.add(voice.toneArchetype);
      }
    });
    return Array.from(tones).sort();
  }, [voices]);

  const filteredVoices = useMemo(() => {
    return voices.filter((voice) => {
      const matchesTone = selectedTone === "all" || voice.toneArchetype === selectedTone;
      const matchesGender = selectedGender === "all" || voice.gender === selectedGender;
      const matchesFavorite = !showFavoritesOnly || favoriteVoiceIds.has(voice.id);

      return matchesTone && matchesGender && matchesFavorite;
    });
  }, [voices, selectedTone, selectedGender, showFavoritesOnly, favoriteVoiceIds]);

  const updateVoiceAccent = (voiceId: string, accent: VoiceAccent) => {
    setVoiceAccents(prev => ({
      ...prev,
      [voiceId]: accent,
    }));
  };

  const handlePlayPreview = async (voice: Voice) => {
    if (playingVoiceId === voice.id) {
      cleanupAudio();
      setPlayingVoiceId(null);
      return;
    }

    cleanupAudio();

    setLoadingPreviewId(voice.id);
    
    try {
      // Check if user has selected a custom accent for this voice
      const selectedAccent = voiceAccents[voice.id];
      const voiceDefaultAccent = voice.accent || 'American';
      
      let previewUrl: string | null = null;
      
      // If user selected a different accent than voice's default, try to fetch accent-specific preview
      if (selectedAccent && selectedAccent !== voiceDefaultAccent) {
        const accentParam = selectedAccent.toLowerCase();
        const accentResponse = await fetch(`/api/voices/${voice.id}/preview/accent/${encodeURIComponent(accentParam)}`);
        
        if (accentResponse.ok) {
          const accentData = await accentResponse.json();
          previewUrl = accentData.previewUrl;
        } else {
          // Accent preview not cached, show toast and fall back to default
          toast({
            title: "Accent Preview Not Available",
            description: `The ${selectedAccent} accent preview is not cached yet. Playing default voice.`,
            duration: 3000,
          });
        }
      }
      
      // Fall back to default preview if no accent-specific preview found
      if (!previewUrl) {
        previewUrl = voice.previewUrl;
        
        if (!previewUrl) {
          const response = await fetch(`/api/voices/${voice.id}/preview`);
          if (!response.ok) throw new Error('Failed to generate preview');
          const data = await response.json();
          previewUrl = data.previewUrl;
          voice.previewUrl = data.previewUrl;
        }
      }

      if (!previewUrl) return;

      const audio = new Audio(previewUrl);
      const onEnded = () => setPlayingVoiceId(null);
      audio.addEventListener('ended', onEnded);
      audioRef.current = audio;
      audioHandlerRef.current = onEnded;
      audio.play();
      setPlayingVoiceId(voice.id);
    } catch (error) {
      console.error('Error generating preview:', error);
      toast({
        title: "Preview Error",
        description: "Failed to play voice preview. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const getVoiceInitials = (displayName: string) => {
    const parts = displayName.split('-');
    return parts[parts.length - 1].substring(0, 2).toUpperCase();
  };

  const getVoiceAvatarUrl = (voice: Voice) => voice.avatarUrl || null;

  const resetFilters = () => {
    setSelectedTone("all");
    setSelectedGender("all");
    setShowFavoritesOnly(false);
  };

  const activeFiltersCount = [selectedTone, selectedGender, showFavoritesOnly ? "favorites" : null]
    .filter(f => f !== "all" && f !== null).length;

  return (
    <>
      <Helmet>
        <title>AI Voice Library for Podcasts - 30+ Premium Voices | PodBrew</title>
        <meta name="description" content="Preview and choose from 30+ premium AI voices for your podcasts. Natural-sounding voices with diverse accents, tones, and emotion-driven prosody. Try free." />
        <meta property="og:title" content="AI Voice Library for Podcasts - 30+ Premium Voices | PodBrew" />
        <meta property="og:description" content="Explore 30+ premium AI voices for podcast generation. Natural-sounding voices with diverse accents and emotion-driven prosody." />
        <meta property="og:url" content="https://podbrew.pro/voices" />
        <meta name="twitter:title" content="AI Voice Library for Podcasts - 30+ Premium Voices | PodBrew" />
        <meta name="twitter:description" content="Explore 30+ premium AI voices for podcast generation. Natural-sounding with diverse accents and styles." />
        <link rel="canonical" href="https://podbrew.pro/voices" />
      </Helmet>
      <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background pb-20 md:pb-8 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(29,185,84,0.15),transparent_50%)] pointer-events-none" />
        <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pt-14 md:pt-16 max-w-7xl">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Mic2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">AI Voice Library for Podcasts</h1>
                <p className="text-sm text-muted-foreground">
                  Choose from {voices.length} premium AI voices
                </p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Select value={selectedTone} onValueChange={setSelectedTone}>
                <SelectTrigger data-testid="select-tone">
                  <SelectValue placeholder="Tone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tones</SelectItem>
                  {availableTones.map(tone => (
                    <SelectItem key={tone} value={tone}>
                      {tone.charAt(0).toUpperCase() + tone.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedGender} onValueChange={setSelectedGender}>
                <SelectTrigger data-testid="select-gender">
                  <SelectValue placeholder="Gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              data-testid="button-toggle-favorites-only"
              size="sm"
              variant={showFavoritesOnly ? "default" : "outline"}
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className="w-full"
            >
              <Heart className={`w-4 h-4 mr-2 ${showFavoritesOnly ? 'fill-current' : ''}`} />
              {showFavoritesOnly ? 'Favorites Only' : 'Show All Voices'}
            </Button>

            {activeFiltersCount > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="gap-1">
                  <Filter className="h-3 w-3" />
                  {activeFiltersCount} active
                </Badge>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={resetFilters}
                  data-testid="button-reset-filters"
                  className="h-6 text-xs"
                >
                  Clear
                </Button>
                <p className="text-xs text-muted-foreground">
                  Showing {filteredVoices.length} voice{filteredVoices.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>

          {/* Voice Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredVoices.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Volume2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No voices found</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Try adjusting your filters or search query
                </p>
                <Button variant="outline" onClick={resetFilters} data-testid="button-reset-empty">
                  Clear filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredVoices.map((voice) => (
                <Card 
                  key={voice.id} 
                  className="hover-elevate transition-all"
                  data-testid={`card-voice-${voice.id}`}
                >
                  <CardHeader className="pb-2 pt-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Avatar className="h-12 w-12 bg-primary/10">
                          {getVoiceAvatarUrl(voice) ? (
                            <AvatarImage 
                              src={getVoiceAvatarUrl(voice)!} 
                              alt={voice.displayName}
                            />
                          ) : null}
                          <AvatarFallback className="bg-primary/20 text-primary font-semibold text-xs">
                            {getVoiceInitials(voice.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <CardTitle className="text-sm sm:text-base truncate">
                            {voice.aliasName}
                          </CardTitle>
                          {voice.toneArchetype && (
                            <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0">
                              {voice.toneArchetype}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(e, voice.id)}
                        data-testid={`button-favorite-${voice.id}`}
                        className="p-1 rounded-md hover:bg-accent transition-colors shrink-0"
                        type="button"
                      >
                        <Heart 
                          className={`h-4 w-4 sm:h-5 sm:w-5 ${
                              favoriteVoiceIds.has(voice.id) 
                                ? 'fill-red-500 text-red-500' 
                                : 'text-muted-foreground'
                            }`}
                          />
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-3">
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
                      {voice.description}
                    </p>

                    {/* Accent selector and preview button */}
                    <div className="flex items-center gap-2">
                      <Select
                        value={voiceAccents[voice.id] || voice.accent || 'American'}
                        onValueChange={(value) => updateVoiceAccent(voice.id, value as VoiceAccent)}
                      >
                        <SelectTrigger 
                          data-testid={`select-accent-library-${voice.id}`}
                          className="w-[120px] sm:w-[140px] h-8 sm:h-9 text-xs"
                        >
                          <Globe className="w-3 h-3 mr-1 shrink-0" />
                          <SelectValue placeholder="Accent" />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_ACCENTS.map((accent) => (
                            <SelectItem key={accent} value={accent} className="text-xs">
                              {accent}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        variant={playingVoiceId === voice.id ? "default" : "outline"}
                        className="flex-1 text-xs sm:text-sm h-8 sm:h-9"
                        onClick={() => handlePlayPreview(voice)}
                        data-testid={`button-preview-${voice.id}`}
                        size="sm"
                        disabled={loadingPreviewId === voice.id}
                      >
                        {loadingPreviewId === voice.id ? (
                          <>
                            <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 animate-spin" />
                            Loading...
                          </>
                        ) : playingVoiceId === voice.id ? (
                          <>
                            <Pause className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" />
                            Playing
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" />
                            Preview
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
