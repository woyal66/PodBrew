import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  MoreVertical,
  Download,
  Share2,
  ListPlus,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  RefreshCw,
  Music2,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { sharePodcast } from "@/lib/share";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useMediaSession } from "@/hooks/use-media-session";
import { SidebarContext } from "@/components/ui/sidebar";
import { useContext } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Playlist } from "@shared/schema";
import { useAuth } from "@/contexts/auth-context";
import { regenerateFromPodcast } from "@/lib/regenerate";

// Check if plan allows downloads
function canDownload(plan: string | undefined): boolean {
  // Free and Starter plans do not allow downloads
  return plan !== 'free' && plan !== 'starter';
}

// Check if plan allows sharing
function canShare(plan: string | undefined): boolean {
  // Free plan does not allow sharing
  return plan !== 'free';
}

interface AudioPlayerProps {
  title?: string;
  topic?: string;
  coverImage?: string;
  podcastId?: string;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  title = "PodBrew",
  topic = "Podcast",
  coverImage,
  podcastId,
}: AudioPlayerProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { state, play, pause, seek, skipForward, skipBackward, setSpeed, setVolume, clearAutoExpand } = useAudioPlayer();
  
  // Check if user's plan allows downloads and sharing
  const allowDownload = canDownload(user?.subscriptionPlan);
  const allowShare = canShare(user?.subscriptionPlan);
  
  // Get sidebar state for responsive positioning (safe access via useContext)
  const sidebarContext = useContext(SidebarContext);
  const sidebarState = sidebarContext?.state ?? 'expanded';
  const isMobile = useIsMobile();
  
  // Auto-expand when triggered by podcast generation
  useEffect(() => {
    if (state.shouldAutoExpand) {
      clearAutoExpand();
    }
  }, [state.shouldAutoExpand, clearAutoExpand]);
  
  // Local state for volume slider (synced with context)
  const [localVolume, setLocalVolume] = useState(state.volume);
  const [volumeBeforeMute, setVolumeBeforeMute] = useState(state.volume > 0 ? state.volume : 75);
  
  // Local state for seek slider during drag
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Local state for menu visibility
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  
  // Local state for player expanded view - default to false (minimized on page load)
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Local state for minimized footer player (slim bar mode)
  const [isMinimized, setIsMinimized] = useState(false);

  // Derive mute state directly from volume (no separate state needed)
  const isMuted = state.volume === 0;

  // Sync local volume with context volume
  useEffect(() => {
    setLocalVolume(state.volume);
    // Track last non-zero volume for unmute restoration
    if (state.volume > 0) {
      setVolumeBeforeMute(state.volume);
    }
  }, [state.volume]);
  
  // Sync drag state with playback when not dragging
  useEffect(() => {
    if (!isDragging) {
      setDragTime(null);
    }
  }, [state.currentTime, isDragging]);

  // State for playlist adding
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);

  // Fetch user's playlists (only when authenticated)
  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ["/api/playlists"],
    enabled: !!user, // Only fetch when user is logged in to avoid 401 errors
  });

  // Add to playlist mutation
  const addToPlaylistMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      if (!podcastId) return;
      await apiRequest("POST", `/api/playlists/${playlistId}/items`, {
        podcastId,
      });
    },
    onSuccess: (_, playlistId) => {
      const playlistName = playlists?.find(p => p.id === playlistId)?.name || "playlist";
      queryClient.invalidateQueries({ queryKey: ["/api/playlists", playlistId] });
      toast({
        title: "Added to playlist",
        description: `Added to ${playlistName}`,
      });
      setAddingToPlaylist(null);
    },
    onError: (error: any) => {
      {
        toast({
          title: "Error",
          description: error.message || "Could not add to playlist",
          variant: "destructive",
        });
      }
      setAddingToPlaylist(null);
    },
  });

  const handleAddToPlaylist = (playlistId: string) => {
    setAddingToPlaylist(playlistId);
    addToPlaylistMutation.mutate(playlistId);
  };

  // Memoized media session options to prevent effect churn
  const mediaSessionOptions = useMemo(() => {
    if (!state.currentPodcast) return null;
    return {
      title: topic,
      artist: title,
      album: 'PodBrew',
      artwork: coverImage,
      onPlay: play,
      onPause: pause,
      onSeekBackward: skipBackward,
      onSeekForward: skipForward,
    };
  }, [state.currentPodcast, topic, title, coverImage, play, pause, skipBackward, skipForward]);

  // Media Session for lock screen controls and background audio
  const { updatePositionState, setPlaybackState } = useMediaSession(mediaSessionOptions);

  // Update media session playback state
  useEffect(() => {
    setPlaybackState(state.isPlaying ? 'playing' : 'paused');
  }, [state.isPlaying, setPlaybackState]);

  // Update media session position
  useEffect(() => {
    if (state.duration > 0) {
      updatePositionState(state.duration, state.currentTime, state.playbackSpeed);
    }
  }, [state.currentTime, state.duration, state.playbackSpeed, updatePositionState]);

  const handlePlayPause = () => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const handleSeekChange = (value: number[]) => {
    // Update local state during drag without triggering audio seek
    setIsDragging(true);
    setDragTime(value[0]);
  };
  
  const handleSeekCommit = (value: number[]) => {
    // Use the fresh value from the slider directly (not batched state)
    seek(value[0]);
    setIsDragging(false);
    setDragTime(null);
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setLocalVolume(newVolume);
    setVolume(newVolume);
    // volumeBeforeMute will be updated by the useEffect when newVolume > 0
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      // Unmute - restore last non-zero volume
      const restoreVolume = volumeBeforeMute > 0 ? volumeBeforeMute : 75;
      setVolume(restoreVolume);
      setLocalVolume(restoreVolume);
    } else {
      // Mute - set to 0 (volumeBeforeMute already tracked by useEffect)
      setVolume(0);
      setLocalVolume(0);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setSpeed(speed);
    toast({
      title: "Playback speed changed",
      description: `Now playing at ${speed}x speed`,
    });
  };

  const handleShare = async () => {
    if (!podcastId) return;
    const podcast = state.currentPodcast;
    if (!podcast) return;
    await sharePodcast({
      podcast: { id: podcast.id, title: podcast.title, topic: podcast.topic },
      toast,
    });
  };

  const handleDownload = async () => {
    if (!state.currentPodcast?.audioUrl) return;
    
    try {
      const response = await fetch(state.currentPodcast.audioUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${topic.replace(/[^a-z0-9]/gi, "_")}.mp3`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download started",
        description: "Your podcast is being downloaded",
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Could not download the podcast",
        variant: "destructive",
      });
    }
  };


  const handleRegenerate = async () => {
    const podcast = state.currentPodcast;
    if (!podcast) return;

    // The currently-playing podcast may have come from the slim
    // `/api/podcasts/mine` payload (no `generationParams`). The helper
    // lazily fetches the full row via `GET /api/podcasts/:id` when
    // needed and seeds the Create form.
    await regenerateFromPodcast(podcast, { setLocation, toast });
  };

  // Add RAF-based progress update for smooth bar animation
  const [rafProgress, setRafProgress] = useState(0);
  
  useEffect(() => {
    let rafId: number;
    const updateProgress = () => {
      if (state.duration > 0 && !isDragging) {
        setRafProgress((state.currentTime / state.duration) * 100);
      }
      rafId = requestAnimationFrame(updateProgress);
    };
    
    rafId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(rafId);
  }, [state.currentTime, state.duration, isDragging]);

  // Calculate progress percentage
  const progressPercentage = isDragging && dragTime !== null 
    ? (dragTime / state.duration) * 100 
    : rafProgress;

  // Waveform bars for visual feedback
  const WaveformBars = ({ isPlaying }: { isPlaying: boolean }) => (
    <div className="flex items-center gap-0.5 h-4" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-0.5 bg-primary rounded-full transition-all ${
            isPlaying ? 'animate-waveform' : 'h-1'
          }`}
          style={{
            animationDelay: isPlaying ? `${i * 0.1}s` : '0s',
            height: isPlaying ? undefined : '4px',
          }}
        />
      ))}
    </div>
  );

  // SPOTIFY-STYLE PLAYER - Expanded floating phone-size tile or footer
  if (isExpanded && state.currentPodcast) {
    return (
      <>
        {/* Backdrop - click to minimize */}
        <div 
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsExpanded(false)}
          data-testid="player-backdrop"
        />
        
        {/* Floating phone-size tile */}
        <div 
          className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-[360px] h-[600px] bg-background rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-border/20"
          data-testid="audio-player-expanded"
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between p-4 border-b border-border/20">
            <div className="text-sm font-medium text-muted-foreground">Now Playing</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsExpanded(false)}
                  data-testid="button-player-collapse"
                >
                  <ChevronDown className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Minimize player</TooltipContent>
            </Tooltip>
          </div>

          {/* Expanded content - scrollable */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-6 overflow-y-auto">
          {/* Large album art */}
          <div className="relative w-48 h-48 rounded-xl overflow-hidden shadow-lg cursor-pointer hover:shadow-xl transition-shadow">
            {coverImage ? (
              <img
                src={coverImage}
                alt={topic}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                <Volume2 className="w-16 h-16 text-primary opacity-50" />
              </div>
            )}
          </div>

          {/* Title and topic - clickable to expand */}
          <div 
            className="text-center max-w-sm cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => state.currentPodcast && setIsExpanded(true)}
            data-testid="player-title-expand"
          >
            <h1 className="text-2xl font-bold text-foreground mb-1 line-clamp-2">{state.currentPodcast?.title || topic}</h1>
            <p className="text-sm text-muted-foreground line-clamp-2">{state.currentPodcast?.description || title}</p>
            {(state.currentPodcast as any)?.generationParams?.musicStyle &&
              (state.currentPodcast as any).generationParams.musicStyle !== 'none' && (
              <span
                className="inline-flex items-center gap-1 mt-1 text-xs text-muted-foreground"
                data-testid="player-music-badge"
                title={`Background music: ${(state.currentPodcast as any).generationParams.musicStyle}`}
              >
                <Music2 className="h-3 w-3" />
                {(state.currentPodcast as any).generationParams.musicStyle}
              </span>
            )}
          </div>

          {/* Time display */}
          <div className="text-center w-full px-4">
            <div className="text-lg font-semibold text-foreground mb-3">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </div>
            
            {/* Progress slider */}
            <Slider
              value={[isDragging && dragTime !== null ? dragTime : state.currentTime]}
              onValueChange={handleSeekChange}
              onValueCommit={handleSeekCommit}
              min={0}
              max={state.duration || 100}
              step={0.1}
              className="w-full"
            />
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={skipBackward}
                  data-testid="button-skip-backward-expanded"
                >
                  <SkipBack className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Skip back 15 seconds</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="h-14 w-14 rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/50"
                  onClick={handlePlayPause}
                  data-testid="button-play-pause-expanded"
                >
                  {state.isPlaying ? (
                    <Pause className="h-6 w-6" />
                  ) : (
                    <Play className="h-6 w-6 ml-0.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{state.isPlaying ? "Pause" : "Play"}</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={skipForward}
                  data-testid="button-skip-forward-expanded"
                >
                  <SkipForward className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Skip forward 15 seconds</TooltipContent>
            </Tooltip>
          </div>

          {/* Secondary controls */}
          <div className="flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={handleMuteToggle}
                  data-testid="button-volume-toggle-expanded"
                >
                  {isMuted || state.volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isMuted ? "Unmute" : "Mute"}</TooltipContent>
            </Tooltip>

            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 text-muted-foreground hover:text-foreground"
                      data-testid="button-player-menu-expanded"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>More options</TooltipContent>
              </Tooltip>
              <PopoverContent side="top" align="center" className="w-56 p-3 bg-card/95 backdrop-blur-lg border-border/30">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground px-2 pb-2">Playback Speed</div>
                  <div className="grid grid-cols-3 gap-1">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                      <Button
                        key={speed}
                        size="sm"
                        variant={state.playbackSpeed === speed ? "default" : "ghost"}
                        onClick={() => handleSpeedChange(speed)}
                        className="text-xs"
                        data-testid={`button-speed-${speed}-expanded`}
                      >
                        {speed}x
                      </Button>
                    ))}
                  </div>

                  <div className="h-px bg-border/30 my-3" />

                  {allowDownload && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start text-xs gap-2"
                      onClick={handleDownload}
                      data-testid="button-download-expanded"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  )}

                  {allowShare && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start text-xs gap-2"
                      onClick={handleShare}
                      data-testid="button-share-expanded"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start text-xs gap-2"
                    onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}
                    data-testid="button-add-playlist-expanded"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                    Add to Playlist
                  </Button>

                  {showPlaylistMenu && playlists && playlists.length > 0 && (
                    <div className="border-t border-border/30 pt-2 mt-2">
                      <div className="text-xs font-semibold text-muted-foreground px-2 pb-1">Playlists</div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {playlists.map((playlist) => (
                          <Button
                            key={playlist.id}
                            size="sm"
                            variant="ghost"
                            className="w-full justify-start text-xs"
                            onClick={() => handleAddToPlaylist(playlist.id)}
                            disabled={addingToPlaylist === playlist.id}
                            data-testid={`button-playlist-${playlist.id}-expanded`}
                          >
                            {addingToPlaylist === playlist.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                            ) : null}
                            {playlist.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-border/30 my-1" />

                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start text-xs gap-2"
                    onClick={handleRegenerate}
                    disabled={!state.currentPodcast}
                    data-testid="button-regenerate-expanded"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
      </>
    );
  }

  // SPOTIFY-STYLE FOOTER PLAYER - Always visible when collapsed
  // Positioned above mobile nav (72px + safe area)
  
  // Handler for expanding player - used for click areas that should expand
  const handleExpandClick = (e: React.MouseEvent) => {
    // Only expand if we have a podcast loaded
    if (state.currentPodcast) {
      setIsExpanded(true);
    }
  };
  
  // Stop propagation for interactive elements (buttons, sliders)
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  
  // Minimized player - slim bar with progress, title, and play/pause (mobile only)
  if (isMinimized && isMobile) {
    return (
      <div 
        className="fixed inset-x-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border/20 shadow-2xl bottom-[56px] cursor-pointer"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        onClick={() => setIsMinimized(false)}
        data-testid="audio-player-minimized"
      >
        {/* Thin progress bar at the very top */}
        <div className="w-full h-0.5 bg-muted">
          <div 
            className="h-full bg-primary transition-all duration-150"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        
        <div className="flex items-center gap-2 px-3 py-1.5">
          {/* Play/Pause */}
          <Button
            size="icon"
            className="rounded-full bg-primary shrink-0"
            onClick={(e) => { stopPropagation(e); handlePlayPause(); }}
            data-testid="button-play-pause-minimized"
          >
            {state.isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </Button>
          
          {/* Title */}
          <div className="flex-1 min-w-0" data-testid="text-minimized-track-info">
            <div className="font-medium text-xs truncate text-foreground">
              {state.currentPodcast?.title || title}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </div>
          </div>
          
          {/* Expand button */}
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            onClick={(e) => { stopPropagation(e); setIsMinimized(false); }}
            data-testid="button-expand-player"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-x-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border/20 shadow-2xl md:bottom-0 bottom-[56px] cursor-pointer"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      onClick={handleExpandClick}
      data-testid="audio-player-footer"
    >
      {/* Minimize handle at top center - mobile only */}
      <div className="flex justify-center md:hidden -mt-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => { stopPropagation(e); setIsMinimized(true); }}
          data-testid="button-minimize-player"
          aria-label="Minimize player"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>

      {/* Interactive progress bar at the top with time labels */}
      <div 
        className="flex items-center gap-2 px-3 pt-1 md:pt-2"
        onClick={stopPropagation}
      >
        <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right shrink-0" data-testid="footer-current-time">
          {formatTime(isDragging && dragTime !== null ? dragTime : state.currentTime)}
        </span>
        <Slider
          value={[isDragging && dragTime !== null ? dragTime : state.currentTime]}
          min={0}
          max={state.duration > 0 ? state.duration : 100}
          step={0.1}
          onValueChange={handleSeekChange}
          onValueCommit={(value) => {
            // Only seek if we have valid duration
            if (state.duration > 0) {
              handleSeekCommit(value);
            }
          }}
          className="flex-1 h-1.5 cursor-pointer"
          disabled={state.duration <= 0}
          data-testid="footer-progress-slider"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums w-8 shrink-0" data-testid="footer-duration">
          {formatTime(state.duration)}
        </span>
      </div>

      {/* 3-column grid: left info | center controls | right actions */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 h-16">
        {/* LEFT: Album Art and Track Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Album Art */}
          <div className="relative shrink-0">
            {coverImage ? (
              <img
                src={coverImage}
                alt={topic}
                className="w-11 h-11 rounded-md object-cover shadow-lg ring-1 ring-border/30"
              />
            ) : (
              <div className="w-11 h-11 rounded-md bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shadow-lg ring-1 ring-border/30">
                <Volume2 className="w-5 h-5 text-primary" />
              </div>
            )}
          </div>

          {/* Track Info - Title first, description/topic below */}
          <div 
            className="flex-1 min-w-0"
            data-testid="footer-title-expand"
          >
            <div className="font-semibold text-sm truncate text-foreground">{state.currentPodcast?.title || title}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{state.currentPodcast?.description || topic}</span>
              {(state.currentPodcast as any)?.generationParams?.musicStyle &&
                (state.currentPodcast as any).generationParams.musicStyle !== 'none' && (
                <span
                  className="shrink-0 inline-flex items-center gap-0.5"
                  data-testid="footer-music-badge"
                  title={`Background music: ${(state.currentPodcast as any).generationParams.musicStyle}`}
                >
                  <Music2 className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>
        </div>

        {/* CENTER: Playback Controls - Truly centered */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={(e) => { stopPropagation(e); skipBackward(); }}
                data-testid="button-skip-backward"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Skip back 15 seconds</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                className="h-11 w-11 rounded-full bg-primary hover:bg-primary/90"
                onClick={(e) => { stopPropagation(e); handlePlayPause(); }}
                data-testid="button-play-pause"
              >
                {state.isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 ml-0.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{state.isPlaying ? "Pause" : "Play"}</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={(e) => { stopPropagation(e); skipForward(); }}
                data-testid="button-skip-forward"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Skip forward 15 seconds</TooltipContent>
          </Tooltip>
        </div>

        {/* RIGHT: Secondary Controls */}
        <div className="flex items-center gap-1 justify-end">
          {/* Mute/Volume Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={(e) => { stopPropagation(e); handleMuteToggle(); }}
                aria-label={isMuted || state.volume === 0 ? "Unmute" : "Mute"}
                data-testid="button-volume-toggle"
              >
                {isMuted || state.volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isMuted ? "Unmute" : "Mute"}</TooltipContent>
          </Tooltip>

          {/* More Options - Speed, Download, Share */}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    onClick={stopPropagation}
                    data-testid="button-player-menu"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Speed, download & share options</TooltipContent>
            </Tooltip>
            <PopoverContent side="top" align="end" className="w-56 p-3 bg-card/95 backdrop-blur-lg border-border/30">
              <div className="space-y-2">
                {/* Speed Control */}
                <div className="text-xs font-semibold text-muted-foreground px-2 pb-2">Playback Speed</div>
                <div className="grid grid-cols-3 gap-1">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                    <Button
                      key={speed}
                      size="sm"
                      variant={state.playbackSpeed === speed ? "default" : "ghost"}
                      onClick={() => handleSpeedChange(speed)}
                      className="text-xs"
                      data-testid={`button-speed-${speed}`}
                    >
                      {speed}x
                    </Button>
                  ))}
                </div>

                {/* Divider */}
                <div className="h-px bg-border/30 my-3" />

                {/* Download Button */}
                {allowDownload && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start text-xs gap-2"
                    onClick={handleDownload}
                    disabled={!state.currentPodcast}
                    data-testid="button-download"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                )}

                {/* Share Button */}
                {allowShare && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start text-xs gap-2"
                    onClick={handleShare}
                    disabled={!podcastId}
                    data-testid="button-share"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </Button>
                )}

                {/* Add to Playlist */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start text-xs gap-2"
                  onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}
                  disabled={!state.currentPodcast || !podcastId}
                  data-testid="button-add-playlist"
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  Add to Playlist
                </Button>

                {/* Playlist Menu */}
                {showPlaylistMenu && playlists && playlists.length > 0 && (
                  <div className="border-t border-border/30 pt-2 mt-2">
                    <div className="text-xs font-semibold text-muted-foreground px-2 pb-1">Playlists</div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {playlists.map((playlist) => (
                        <Button
                          key={playlist.id}
                          size="sm"
                          variant="ghost"
                          className="w-full justify-start text-xs"
                          onClick={() => handleAddToPlaylist(playlist.id)}
                          disabled={addingToPlaylist === playlist.id}
                          data-testid={`button-playlist-${playlist.id}`}
                        >
                          {addingToPlaylist === playlist.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                          ) : null}
                          {playlist.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="h-px bg-border/30 my-1" />

                {/* Regenerate */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start text-xs gap-2"
                  onClick={handleRegenerate}
                  disabled={!state.currentPodcast}
                  data-testid="button-regenerate"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
