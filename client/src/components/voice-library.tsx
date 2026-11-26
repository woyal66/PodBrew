import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Play, 
  Pause, 
  Volume2,
  Heart,
  Loader2,
  Globe
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { VoiceFavorite } from "@shared/schema";

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

export function VoiceLibrary() {
  const [selectedGender, setSelectedGender] = useState<string>("all");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioHandlerRef = useRef<(() => void) | null>(null);
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

  const filteredVoices = useMemo(() => {
    return voices.filter((voice) => {
      const matchesGender = selectedGender === "all" || voice.gender === selectedGender;
      const matchesFavorite = !showFavoritesOnly || favoriteVoiceIds.has(voice.id);
      return matchesGender && matchesFavorite;
    });
  }, [voices, selectedGender, showFavoritesOnly, favoriteVoiceIds]);

  const handlePlayPreview = async (voice: Voice) => {
    if (playingVoiceId === voice.id) {
      cleanupAudio();
      setPlayingVoiceId(null);
      return;
    }

    cleanupAudio();

    let previewUrl = voice.previewUrl;
    
    if (!previewUrl) {
      setLoadingPreviewId(voice.id);
      try {
        const response = await fetch(`/api/voices/${voice.id}/preview`);
        if (!response.ok) throw new Error('Failed to generate preview');
        const data = await response.json();
        previewUrl = data.previewUrl;
        voice.previewUrl = data.previewUrl;
      } catch (error) {
        console.error('Error generating preview:', error);
        setLoadingPreviewId(null);
        return;
      }
      setLoadingPreviewId(null);
    }

    if (!previewUrl) return;

    const audio = new Audio(previewUrl);
    const onEnded = () => setPlayingVoiceId(null);
    audio.addEventListener('ended', onEnded);
    audioRef.current = audio;
    audioHandlerRef.current = onEnded;
    audio.play();
    setPlayingVoiceId(voice.id);
  };

  const getVoiceInitials = (displayName: string) => {
    const parts = displayName.split('-');
    return parts[parts.length - 1].substring(0, 2).toUpperCase();
  };

  const getVoiceAvatarUrl = (voice: Voice) => voice.avatarUrl || null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
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
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={selectedGender} onValueChange={setSelectedGender}>
          <SelectTrigger className="w-full sm:w-[140px]" data-testid="select-voice-gender">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Voices</SelectItem>
            <SelectItem value="MALE">Male</SelectItem>
            <SelectItem value="FEMALE">Female</SelectItem>
          </SelectContent>
        </Select>

        <Button
          data-testid="button-toggle-voice-favorites"
          size="sm"
          variant={showFavoritesOnly ? "default" : "outline"}
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          className="h-9"
        >
          <Heart className={`w-4 h-4 mr-2 ${showFavoritesOnly ? 'fill-current' : ''}`} />
            {showFavoritesOnly ? 'Favorites' : 'All Voices'}
        </Button>

        <p className="text-sm text-muted-foreground self-center ml-auto">
          {filteredVoices.length} voice{filteredVoices.length !== 1 ? 's' : ''}
        </p>
      </div>

      {filteredVoices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Volume2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No voices found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {showFavoritesOnly 
                ? "You haven't favorited any voices yet" 
                : "Try adjusting your filters"}
            </p>
            {showFavoritesOnly && (
              <Button 
                variant="outline" 
                onClick={() => setShowFavoritesOnly(false)}
                data-testid="button-show-all-voices"
              >
                Show All Voices
              </Button>
            )}
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <CardTitle className="text-sm sm:text-base truncate">
                          {voice.aliasName}
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {voice.gender === 'MALE' ? 'M' : 'F'}
                        </Badge>
                        {voice.accent && voice.accent !== 'Neutral' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 flex items-center">
                            <Globe className="w-3 h-3" />
                            {voice.accent}
                          </Badge>
                        )}
                        {voice.toneArchetype && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {voice.toneArchetype}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => toggleFavorite(e, voice.id)}
                    data-testid={`button-favorite-voice-${voice.id}`}
                    className="p-1.5 rounded-md hover:bg-accent transition-colors shrink-0"
                    type="button"
                  >
                    <Heart 
                      className={`h-4 w-4 ${
                        favoriteVoiceIds.has(voice.id) 
                          ? 'fill-red-500 text-red-500' 
                          : 'text-muted-foreground'
                      }`}
                    />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pb-3">
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {voice.description}
                </p>

                <Button
                  variant={playingVoiceId === voice.id ? "default" : "outline"}
                  className="w-full text-xs h-8"
                  onClick={() => handlePlayPreview(voice)}
                  data-testid={`button-preview-voice-${voice.id}`}
                  size="sm"
                  disabled={loadingPreviewId === voice.id}
                >
                  {loadingPreviewId === voice.id ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      Loading...
                    </>
                  ) : playingVoiceId === voice.id ? (
                    <>
                      <Pause className="h-3 w-3 mr-1.5" />
                      Playing
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 mr-1.5" />
                      Preview
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
