import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mic2, X, Check, Heart, Play, Square, Loader2, Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Voice, VoiceFavorite, VoiceQuality } from "@shared/schema";
import { VOICE_QUALITY_TIERS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type PodcastMood = 'uplifting' | 'serious' | 'humorous' | 'mysterious' | 'balanced' | 'energetic';

export const AVAILABLE_ACCENTS = [
  'American',
  'British', 
  'Australian',
  'Southern American',
  'Irish',
  'Scottish',
  'Canadian',
  'New Zealand',
  'Indian',
] as const;

export type VoiceAccent = typeof AVAILABLE_ACCENTS[number];

export interface VoiceAccentSelection {
  voiceId: string;
  accent: VoiceAccent | null;
}

interface VoiceSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  numHosts: number;
  selectedVoiceIds: string[];
  selectedAccents?: Record<string, VoiceAccent | null>;
  onConfirm: (voiceIds: string[], accents: Record<string, VoiceAccent | null>) => void;
  mood?: PodcastMood;
}

const getVoiceInitials = (displayName: string) => {
  const parts = displayName.split('-');
  return parts[parts.length - 1].substring(0, 2).toUpperCase();
};

const getVoiceAvatarUrl = (voice: Voice) => voice.avatarUrl || null;

export function VoiceSelectionModal({
  open,
  onOpenChange,
  numHosts,
  selectedVoiceIds,
  selectedAccents = {},
  onConfirm,
  mood,
}: VoiceSelectionModalProps) {
  const [selectedGender, setSelectedGender] = useState<string>("all");
  const [selectedTone, setSelectedTone] = useState<string>("all");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(selectedVoiceIds);
  const [localAccents, setLocalAccents] = useState<Record<string, VoiceAccent | null>>(selectedAccents);
  const [prevMood, setPrevMood] = useState<PodcastMood | undefined>(mood);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Sync local state when selectedVoiceIds or numHosts change from parent
  // Don't sync on modal open/close to preserve user selections
  useEffect(() => {
    setLocalSelectedIds(prev => {
      // If parent selection changed, use it
      const newSelection = selectedVoiceIds.slice(0, numHosts);
      if (JSON.stringify(prev.slice(0, numHosts)) !== JSON.stringify(newSelection)) {
        return newSelection;
      }
      // If numHosts decreased, trim the selection
      if (prev.length > numHosts) {
        return prev.slice(0, numHosts);
      }
      // Otherwise preserve local state (user's selections)
      return prev;
    });
  }, [selectedVoiceIds, numHosts]);

  // Detect mood changes and show notification
  useEffect(() => {
    if (mood && prevMood && mood !== prevMood && open) {
      toast({
        title: "Voice recommendations updated",
        description: `Voices re-ranked for "${mood}" mood. Your selections are preserved.`,
        duration: 3000,
      });
      setPrevMood(mood);
    } else if (open && mood) {
      // Update prevMood when modal opens to track for next change
      setPrevMood(mood);
    }
  }, [mood, prevMood, open, toast]);

  const { data: voices = [], isLoading } = useQuery<Voice[]>({
    queryKey: ['/api/voices'],
    staleTime: 600_000,
  });

  // Sync accent selections from parent and ensure all selected voices have accent entries
  // Also check localStorage for previously saved custom accents
  useEffect(() => {
    if (voices.length === 0) return; // Wait for voices to load
    
    // Load saved accents from localStorage to preserve custom selections
    let savedAccents: Record<string, VoiceAccent | null> = {};
    try {
      const stored = localStorage.getItem('podbrewLastAccents');
      if (stored) {
        savedAccents = JSON.parse(stored);
      }
    } catch (e) {
      console.error('[VoiceModal] Failed to parse localStorage accents:', e);
    }
    
    setLocalAccents(prev => {
      const merged = { ...selectedAccents };
      
      // Ensure all selected voices have an accent entry
      localSelectedIds.forEach(voiceId => {
        if (!(voiceId in merged) || merged[voiceId] === null) {
          // Priority: 1) previous local accent, 2) localStorage saved accent, 3) voice default
          if (prev[voiceId]) {
            merged[voiceId] = prev[voiceId];
          } else if (savedAccents[voiceId]) {
            merged[voiceId] = savedAccents[voiceId];
            console.log(`[VoiceModal] Restored saved accent for ${voiceId}: ${savedAccents[voiceId]}`);
          } else {
            const voice = voices.find(v => v.id === voiceId);
            if (voice?.accent) {
              merged[voiceId] = voice.accent as VoiceAccent;
            }
          }
        }
      });
      
      if (import.meta.env.DEV) console.log('[VoiceModal] Synced accents:', merged);
      return merged;
    });
  }, [selectedAccents, localSelectedIds, voices]);

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

  // Fetch mood-ranked voice collections when mood is provided
  interface VoiceCollection {
    name: string;
    description: string;
    voices: Voice[];
  }

  const { data: moodCollections } = useQuery<VoiceCollection[]>({
    queryKey: mood ? [`/api/voices/mood/collections?mood=${mood}`] : [],
    enabled: !!mood,
    staleTime: 600_000,
  });

  // Build mood ranking map: voiceId -> { rank, compatibility }
  // Mood sorting is always enabled by default
  const moodRankMap = useMemo(() => {
    const map = new Map<string, { rank: number; compatibility: string }>();
    
    if (moodCollections && mood) {
      let rank = 0;
      moodCollections.forEach(collection => {
        collection.voices.forEach(voice => {
          if (!map.has(voice.id)) {
            // Determine compatibility based on position
            let compatibility = 'Compatible';
            if (rank < 10) {
              compatibility = 'Perfect match';
            } else if (rank < 30) {
              compatibility = 'Good match';
            }
            map.set(voice.id, { rank, compatibility });
            rank++;
          }
        });
      });
    }
    
    return map;
  }, [moodCollections, mood]);

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
    // First apply filters
    let filtered = voices.filter((voice) => {
      const matchesGender = selectedGender === "all" || voice.gender.toLowerCase() === selectedGender;
      const matchesTone = selectedTone === "all" || voice.toneArchetype === selectedTone;
      const matchesFavorite = !showFavoritesOnly || favoriteVoiceIds.has(voice.id);

      return matchesGender && matchesTone && matchesFavorite;
    });

    // Then sort by mood ranking if mood is provided (always enabled by default)
    if (mood && moodRankMap.size > 0) {
      filtered = [...filtered].sort((a, b) => {
        const aRank = moodRankMap.get(a.id)?.rank ?? 9999;
        const bRank = moodRankMap.get(b.id)?.rank ?? 9999;
        
        // Stable sort: if ranks are equal, preserve original order
        if (aRank === bRank) {
          return 0;
        }
        return aRank - bRank;
      });
    }

    return filtered;
  }, [voices, selectedGender, selectedTone, showFavoritesOnly, favoriteVoiceIds, mood, moodRankMap]);

  const selectedVoices = useMemo(() => {
    return voices.filter(v => localSelectedIds.includes(v.id));
  }, [voices, localSelectedIds]);

  const toggleVoice = (voiceId: string) => {
    // If deselecting, just remove it
    if (localSelectedIds.includes(voiceId)) {
      setLocalSelectedIds(prev => prev.filter(id => id !== voiceId));
      return;
    }
    
    // Add voice (all voices are premium tier)
    setLocalSelectedIds(prev => {
      if (prev.length >= numHosts) {
        return [...prev.slice(1), voiceId];
      }
      return [...prev, voiceId];
    });
  };


  const handleConfirm = () => {
    onConfirm(localSelectedIds, localAccents);
    onOpenChange(false);
  };

  const updateVoiceAccent = (voiceId: string, accent: VoiceAccent | null) => {
    setLocalAccents(prev => ({
      ...prev,
      [voiceId]: accent,
    }));
  };

  const getTierColor = (tier: string) => {
    // All voices use premium tier (Gemini 2.5 Flash TTS)
    return 'bg-primary/20 text-primary';
  };

  const getTierPrice = (tier: string): number => {
    // All voices use premium tier pricing
    return VOICE_QUALITY_TIERS.premium.creditsPerMinute;
  };

  const handlePlayPreview = async (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();
    
    // If this voice is already playing, stop it
    if (playingVoiceId === voiceId && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingVoiceId(null);
      return;
    }
    
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    
    try {
      setLoadingPreviewId(voiceId);
      
      // Check if user has selected a custom accent for this voice
      const voice = voices.find(v => v.id === voiceId);
      const selectedAccent = localAccents[voiceId];
      const voiceDefaultAccent = voice?.accent || 'American';
      
      let previewUrl: string | null = null;
      
      // If user selected a different accent than voice's default, try to fetch accent-specific preview
      if (selectedAccent && selectedAccent !== voiceDefaultAccent) {
        const accentParam = selectedAccent.toLowerCase();
        const accentResponse = await fetch(`/api/voices/${voiceId}/preview/accent/${encodeURIComponent(accentParam)}`);
        
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
        const response = await fetch(`/api/voices/${voiceId}/preview`);
        if (!response.ok) {
          throw new Error('Failed to generate voice preview');
        }
        const data = await response.json();
        previewUrl = data.previewUrl;
      }
      
      if (!previewUrl) {
        throw new Error('No preview URL available');
      }
      
      // Create or reuse audio element
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.addEventListener('ended', () => {
          setPlayingVoiceId(null);
        });
      }
      
      audioRef.current.src = previewUrl;
      setPlayingVoiceId(voiceId);
      
      await audioRef.current.play();
    } catch (error) {
      console.error('Error playing voice preview:', error);
      toast({
        title: "Preview Error",
        description: "Failed to play voice preview. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingPreviewId(null);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const isSelectionComplete = localSelectedIds.length === numHosts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100vw-1rem)] h-[calc(100vh-1rem)] sm:w-auto sm:h-[85vh] p-0 flex flex-col overflow-hidden">
        <div className="flex flex-col h-full min-h-0">
          {/* Sticky Header with Backdrop */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-md border-b">
            <div className="px-3 sm:px-6 pt-3 sm:pt-6 pb-2 sm:pb-4">
              {/* Header Row: Title on left, Cancel + Confirm buttons on right */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <DialogHeader className="space-y-0.5 flex-1 min-w-0">
                  <DialogTitle className="flex items-center gap-2 text-base sm:text-lg truncate">
                    <Mic2 className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />
                    <span className="truncate">Choose Voices</span>
                  </DialogTitle>
                  <DialogDescription className="text-xs sm:text-sm hidden sm:block">
                    Select {numHosts} voice{numHosts > 1 ? 's' : ''} for your podcast hosts
                  </DialogDescription>
                </DialogHeader>
                
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <Button
                    data-testid="button-cancel-voice-selection"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    className="text-xs sm:text-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    data-testid="button-confirm-voice-selection"
                    size="sm"
                    variant={isSelectionComplete ? "default" : "ghost"}
                    onClick={handleConfirm}
                    disabled={!isSelectionComplete}
                    aria-disabled={!isSelectionComplete}
                    className="text-xs sm:text-sm font-medium whitespace-nowrap"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Confirm ({localSelectedIds.length}/{numHosts})
                  </Button>
                </div>
              </div>
            </div>

            {/* Sticky Filters */}
            <div className="px-3 sm:px-6 py-2 sm:py-4 space-y-2 sm:space-y-3">
              {/* Gender pill chips */}
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {(["all", "female", "male"] as const).map((g) => (
                  <button
                    key={g}
                    data-testid={`button-gender-filter-${g}`}
                    onClick={() => setSelectedGender(g)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedGender === g
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:border-primary/60 hover:text-foreground"
                    }`}
                  >
                    {g === "all" ? "All Genders" : g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tone pill chips */}
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {[{ value: "all", label: "All Tones" }, ...availableTones.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))].map(({ value, label }) => (
                  <button
                    key={value}
                    data-testid={`button-tone-filter-${value}`}
                    onClick={() => setSelectedTone(value)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedTone === value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:border-primary/60 hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Status row: selection count · complete badge · result count · clear · favorites */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {localSelectedIds.length} of {numHosts} selected
                  </span>
                  {localSelectedIds.length === numHosts && (
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">
                      <Check className="w-3 h-3 mr-1" />
                      Complete
                    </Badge>
                  )}
                  {(selectedTone !== "all" || selectedGender !== "all" || showFavoritesOnly) && (
                    <span className="text-xs text-muted-foreground">
                      Showing {filteredVoices.length} of {voices.length}{" "}
                      <button
                        data-testid="button-clear-filters"
                        onClick={() => { setSelectedTone("all"); setSelectedGender("all"); setShowFavoritesOnly(false); }}
                        className="text-primary underline cursor-pointer"
                      >
                        Clear filters
                      </button>
                    </span>
                  )}
                </div>
                {/* Favorites toggle — always visible */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      data-testid="button-toggle-favorites-only"
                      size="icon"
                      variant={showFavoritesOnly ? "default" : "ghost"}
                      onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                      className="h-6 w-6 shrink-0"
                    >
                      <Heart className={`w-3 h-3 ${showFavoritesOnly ? "fill-current" : ""}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{showFavoritesOnly ? "Show all voices" : "Show favorites only"}</TooltipContent>
                </Tooltip>
              </div>

              {localSelectedIds.length > 0 && (
                <div className="space-y-2">
                  {selectedVoices.map((voice, idx) => (
                    <div key={voice.id} className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="secondary"
                        className="gap-1.5 pr-0.5 text-xs"
                      >
                        <span className="font-medium">Host {idx + 1}:</span>
                        <span className="truncate max-w-[120px]">{voice.aliasName || voice.displayName}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              data-testid={`button-remove-voice-${voice.id}`}
                              size="icon"
                              variant="ghost"
                              className="h-4 w-4 p-0 hover:bg-destructive/20"
                              onClick={() => toggleVoice(voice.id)}
                            >
                              <X className="w-2.5 h-2.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove this voice</TooltipContent>
                        </Tooltip>
                      </Badge>
                      <Select
                        value={localAccents[voice.id] || voice.accent || 'American'}
                        onValueChange={(value) => updateVoiceAccent(voice.id, value as VoiceAccent)}
                      >
                        <SelectTrigger 
                          data-testid={`select-accent-${voice.id}`}
                          className="w-[140px] h-7 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe className="w-3 h-3 mr-1" />
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Scrollable Voice List */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-3 sm:px-6 py-2 pb-4 sm:pb-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center space-y-2">
                    <Mic2 className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto animate-pulse" />
                    <p className="text-xs sm:text-sm text-muted-foreground">Loading voices...</p>
                  </div>
                </div>
              ) : filteredVoices.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center space-y-2">
                    <Mic2 className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto" />
                    <p className="text-xs sm:text-sm text-muted-foreground">No voices match your filters</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-1.5 sm:gap-3 pb-4">
                  {filteredVoices.map((voice) => {
                    const isSelected = localSelectedIds.includes(voice.id);
                    const selectionIndex = localSelectedIds.indexOf(voice.id);
                    const isDisabled = false; // All voices are premium tier
                    
                    return (
                      <div
                        key={voice.id}
                        data-testid={`button-select-voice-${voice.id}`}
                        onClick={() => !isDisabled && toggleVoice(voice.id)}
                        role="button"
                        tabIndex={isDisabled ? -1 : 0}
                        onKeyDown={(e) => {
                          if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleVoice(voice.id);
                          }
                        }}
                        className={`
                          flex items-center gap-2.5 sm:gap-4 p-2 sm:p-4 rounded-lg border transition-all text-left
                          ${isDisabled 
                            ? 'opacity-50 cursor-not-allowed border-border bg-muted/30' 
                            : isSelected 
                              ? 'border-primary bg-primary/5 ring-2 ring-primary/20 cursor-pointer' 
                              : 'border-border hover-elevate active-elevate-2 cursor-pointer'
                          }
                        `}
                      >
                        <Avatar className="h-10 w-10 sm:h-12 sm:w-12 shrink-0">
                          {getVoiceAvatarUrl(voice) ? (
                            <AvatarImage 
                              src={getVoiceAvatarUrl(voice)!} 
                              alt={voice.displayName}
                            />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs sm:text-sm font-medium">
                            {getVoiceInitials(voice.displayName)}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1 flex-wrap">
                            <h4 className="font-semibold text-sm sm:text-base truncate">
                              {voice.aliasName || voice.displayName}
                            </h4>
                            {voice.toneArchetype && (
                              <Badge
                                variant="secondary"
                                className="text-xs whitespace-nowrap flex-shrink-0 cursor-pointer hover-elevate"
                                data-testid={`button-tone-badge-${voice.id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTone(voice.toneArchetype!);
                                }}
                              >
                                {voice.toneArchetype}
                              </Badge>
                            )}
                            <div className="ml-auto shrink-0 flex items-center gap-0.5 sm:gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={(e) => handlePlayPreview(e, voice.id)}
                                    data-testid={`button-preview-${voice.id}`}
                                    className="p-0.5 sm:p-1 rounded-md hover:bg-accent transition-colors"
                                    type="button"
                                    disabled={loadingPreviewId === voice.id}
                                  >
                                    {loadingPreviewId === voice.id ? (
                                      <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground animate-spin" />
                                    ) : playingVoiceId === voice.id ? (
                                      <Square className="w-3 h-3 sm:w-4 sm:h-4 text-primary fill-primary" />
                                    ) : (
                                      <Play className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{playingVoiceId === voice.id ? "Stop preview" : "Preview voice"}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFavorite(e, voice.googleVoiceName);
                                    }}
                                    data-testid={`button-favorite-${voice.id}`}
                                    className="p-0.5 sm:p-1 rounded-md hover:bg-accent transition-colors"
                                    type="button"
                                  >
                                    <Heart 
                                      className={`w-3 h-3 sm:w-4 sm:h-4 ${
                                        favoriteVoiceIds.has(voice.googleVoiceName) 
                                          ? 'fill-red-500 text-red-500' 
                                          : 'text-muted-foreground'
                                      }`}
                                    />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{favoriteVoiceIds.has(voice.googleVoiceName) ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                          {voice.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {voice.description}
                            </p>
                          )}
                        </div>

                        {isSelected && (
                          <div className="shrink-0">
                            <Badge variant="default" className="bg-primary text-xs">
                              {selectionIndex + 1}
                            </Badge>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>

        </div>
      </DialogContent>
    </Dialog>
  );
}
