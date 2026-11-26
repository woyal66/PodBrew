import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Play, Pause, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { GeneratedPodcast } from "@shared/schema";
import { Slider } from "@/components/ui/slider";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function Embed() {
  const params = useParams();
  const id = params.id || "";
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(new Audio());

  const { data: podcast, isLoading } = useQuery<GeneratedPodcast>({
    queryKey: [`/api/podcasts/${id}/public`],
    enabled: !!id,
  });

  useEffect(() => {
    const audio = audioRef.current;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
    };
  }, []);

  useEffect(() => {
    if (!podcast) return;
    
    const audio = audioRef.current;
    if (audio.src !== podcast.audioUrl) {
      audio.src = podcast.audioUrl;
      audio.load();
    }
  }, [podcast]);

  useEffect(() => {
    const audio = audioRef.current;
    
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    const newTime = value[0];
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!podcast) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-muted-foreground">Podcast not found</p>
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-950 flex items-center justify-center p-4">
      <div 
        className="w-full max-w-md bg-card border border-border rounded-lg overflow-hidden shadow-2xl"
        data-testid="embed-player"
      >
        <div className="relative aspect-square bg-muted">
          <img
            src={podcast.coverImageUrl || "/placeholder.png"}
            alt={podcast.topic}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={togglePlayPause}
              className="h-16 w-16 rounded-full bg-primary hover-elevate active-elevate-2 flex items-center justify-center transition-transform"
              data-testid="button-play-pause"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-7 w-7 text-primary-foreground" fill="currentColor" />
              ) : (
                <Play className="h-7 w-7 text-primary-foreground ml-1" fill="currentColor" />
              )}
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <h2 className="text-xl font-bold line-clamp-2 mb-1" data-testid="text-podcast-title">
              {podcast.topic}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatTime(typeof podcast.duration === 'string' ? parseFloat(podcast.duration) : podcast.duration)}
            </p>
          </div>

          <div className="space-y-2">
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="cursor-pointer"
              data-testid="slider-progress"
            />
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span data-testid="text-current-time">{formatTime(currentTime)}</span>
              <span data-testid="text-duration">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-podbrew"
            >
              <span className="font-semibold text-primary">PodBrew</span>
              <span>•</span>
              <span>Create your own AI podcast</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
