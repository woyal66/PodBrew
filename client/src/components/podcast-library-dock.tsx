import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Pause, MoreHorizontal, Library, Search, Clock, Headphones, RefreshCw } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useState, useMemo } from "react";
import type { GeneratedPodcast } from "@shared/schema";
import { regenerateFromPodcast } from "@/lib/regenerate";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function CompactPodcastCard({ podcast }: { podcast: GeneratedPodcast }) {
  const { state, play, pause, isCurrentPodcast } = useAudioPlayer();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const isCurrent = isCurrentPodcast(podcast.id);
  const isPlaying = isCurrent && state.isPlaying;

  const handlePlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isCurrent) {
      if (state.isPlaying) {
        pause();
      } else {
        play(podcast, false, true);
      }
    } else {
      play(podcast, false, true);
    }
  };

  const handleViewDetails = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocation(`/podcasts/${podcast.id}`);
  };

  const handleRegenerate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Slim `/api/podcasts/mine` payload no longer ships `generationParams`;
    // the helper lazily fetches the full row via `GET /api/podcasts/:id`
    // when needed and seeds the Create form.
    void regenerateFromPodcast(podcast, { setLocation, toast });
  };

  const formatDuration = (durationStr: string) => {
    let totalSeconds = 0;
    
    if (durationStr.includes(':')) {
      const parts = durationStr.split(':').map(p => parseInt(p, 10) || 0);
      if (parts.length === 2) {
        totalSeconds = parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    } else {
      totalSeconds = parseInt(durationStr) || 0;
    }
    
    const mins = Math.floor(totalSeconds / 60);
    return mins > 0 ? `${mins} min` : '<1 min';
  };

  return (
    <div 
      className={`group flex items-start gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer border ${
        isCurrent 
          ? 'bg-primary/10 border-primary/30 shadow-md' 
          : 'bg-card/60 border-border/40 hover:bg-card hover:border-border/60 hover:shadow-sm'
      }`}
      data-testid={`dock-podcast-${podcast.id}`}
    >
      <div className="relative shrink-0 group/image">
        {podcast.coverImageUrl ? (
          <img
            src={podcast.coverImageUrl}
            alt={podcast.topic}
            className="w-14 h-14 rounded-xl object-cover shadow-md cursor-pointer"
            onClick={handlePlayClick}
            data-testid={`image-dock-podcast-${podcast.id}`}
          />
        ) : (
          <div 
            className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shadow-md cursor-pointer"
            onClick={handlePlayClick}
            data-testid={`placeholder-dock-podcast-${podcast.id}`}
          >
            <Headphones className="w-6 h-6 text-primary" />
          </div>
        )}
        
        <div className="absolute inset-0 w-14 h-14 rounded-xl bg-black/60 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          {isPlaying ? (
            <Pause className="w-6 h-6 text-white fill-white" />
          ) : (
            <Play className="w-6 h-6 text-white fill-white ml-0.5" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 py-0.5">
        <h4 className="font-medium text-sm line-clamp-2 leading-snug mb-1.5">
          {podcast.topic}
        </h4>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{formatDuration(podcast.duration)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="truncate">
            {formatDistanceToNow(new Date(podcast.timestamp), { addSuffix: true })}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleRegenerate}
          title="Regenerate with same topic"
          data-testid={`button-dock-regenerate-${podcast.id}`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={(e) => e.stopPropagation()}
              data-testid={`button-dock-menu-${podcast.id}`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleViewDetails} data-testid="button-view-details">
              View Details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function CompactSkeleton() {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border/40 bg-card/60 animate-pulse">
      <div className="w-14 h-14 rounded-xl bg-muted" />
      <div className="flex-1 space-y-2 py-0.5">
        <div className="h-4 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
    </div>
  );
}

export function PodcastLibraryDock() {
  const [searchQuery, setSearchQuery] = useState("");
  
  const { data: mineResponse, isLoading, error, refetch } = useQuery<{ podcasts: GeneratedPodcast[], total: number }>({
    queryKey: ["/api/podcasts/mine", "preview"],
    queryFn: async () => {
      const res = await fetch('/api/podcasts/mine?limit=50&offset=0', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    // Bumped staleTime to 5min (Task #102 parity). Mutations invalidate
    // this key explicitly so users still see fresh data after edits.
    staleTime: 5 * 60 * 1000,
  });

  const podcasts = mineResponse?.podcasts ?? [];

  const filteredPodcasts = useMemo(() => {
    if (!searchQuery.trim()) return podcasts;
    const query = searchQuery.toLowerCase();
    return podcasts.filter(p =>
      p.topic.toLowerCase().includes(query) ||
      (p.description?.toLowerCase().includes(query))
    );
  }, [podcasts, searchQuery]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 shadow-lg overflow-hidden">
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Library className="w-5 h-5 text-primary" />
            Your Library
          </h3>
          <Link href="/listen/library">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" data-testid="link-view-all-library">
              View All
            </Button>
          </Link>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search podcasts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-background/50 border-border/50"
            data-testid="input-dock-search"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <RefreshCw className="w-8 h-8 text-destructive" />
              </div>
              <p className="text-sm font-medium mb-1">Failed to load library</p>
              <p className="text-xs text-muted-foreground mb-3">
                Check your connection and try again
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetch()}
                data-testid="button-retry-library"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          ) : isLoading ? (
            <>
              {[1, 2, 3, 4, 5].map((i) => (
                <CompactSkeleton key={i} />
              ))}
            </>
          ) : filteredPodcasts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Headphones className="w-8 h-8 text-primary" />
              </div>
              {podcasts.length === 0 ? (
                <>
                  <p className="text-sm font-medium mb-1">No podcasts yet</p>
                  <p className="text-xs text-muted-foreground">
                    Create your first podcast to see it here
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium mb-1">No results</p>
                  <p className="text-xs text-muted-foreground">
                    Try a different search term
                  </p>
                </>
              )}
            </div>
          ) : (
            filteredPodcasts.map((podcast) => (
              <CompactPodcastCard key={podcast.id} podcast={podcast} />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border/30">
        <p className="text-xs text-muted-foreground text-center">
          {podcasts.length} podcast{podcasts.length !== 1 ? 's' : ''} in library
        </p>
      </div>
    </div>
  );
}
