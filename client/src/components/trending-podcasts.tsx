import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HorizontalPodcastCard } from "@/components/HorizontalPodcastCard";
import { HorizontalPodcastCardSkeleton } from "@/components/HorizontalPodcastCardSkeleton";
import { Button } from "@/components/ui/button";
import { Flame, TrendingUp, Clock, Calendar } from "lucide-react";
import type { GeneratedPodcast, PodcastWithEngagement } from "@shared/schema";
import { cn } from "@/lib/utils";

interface TrendingPodcastsProps {
  onPlay: (podcast: GeneratedPodcast) => void;
  onOpenDetails: (podcast: GeneratedPodcast) => void;
}

type TimeframeType = 'hour' | 'day' | 'week';

export function TrendingPodcasts({ onPlay, onOpenDetails }: TrendingPodcastsProps) {
  const [timeframe, setTimeframe] = useState<TimeframeType>('day');

  const { data, isLoading, error } = useQuery<PodcastWithEngagement[]>({
    queryKey: ["/api/podcasts/trending", timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/podcasts/trending?limit=20&timeframe=${timeframe}`);
      if (!response.ok) {
        throw new Error("Failed to fetch trending podcasts");
      }
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });

  const timeframes: { id: TimeframeType; label: string; icon: typeof Clock }[] = [
    { id: 'hour', label: 'Hour', icon: Clock },
    { id: 'day', label: 'Today', icon: TrendingUp },
    { id: 'week', label: 'Week', icon: Calendar },
  ];

  const podcasts = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Trending Podcasts</h2>
        </div>

        <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
          {timeframes.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={timeframe === id ? "default" : "ghost"}
              onClick={() => setTimeframe(id)}
              className={cn(
                "h-8 gap-1.5 px-3",
                timeframe === id && "bg-primary text-primary-foreground"
              )}
              data-testid={`button-timeframe-${id}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" data-testid="loading-trending">
          {Array.from({ length: 5 }).map((_, index) => (
            <HorizontalPodcastCardSkeleton key={index} />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center px-4" data-testid="error-trending">
          <p className="text-sm text-muted-foreground">
            Failed to load trending podcasts. Please try again later.
          </p>
        </div>
      ) : podcasts.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] text-center px-4" data-testid="empty-trending">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-500/10 mb-4">
            <Flame className="h-10 w-10 text-orange-500" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No Trending Podcasts Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Be the first to create a viral podcast! Podcasts with likes and comments will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="trending-feed">
          {podcasts.map((podcast, index) => (
            <div key={podcast.id} className="relative">
              {index < 3 && (
                <div 
                  className={cn(
                    "absolute -left-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold z-10",
                    index === 0 && "bg-yellow-500 text-yellow-950",
                    index === 1 && "bg-gray-300 text-gray-800",
                    index === 2 && "bg-amber-600 text-amber-950"
                  )}
                  data-testid={`badge-rank-${index + 1}`}
                >
                  {index + 1}
                </div>
              )}
              <HorizontalPodcastCard
                podcast={podcast}
                onPlay={onPlay}
                onOpenDetails={onOpenDetails}
                showEngagement={true}
                engagement={podcast.engagement}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
