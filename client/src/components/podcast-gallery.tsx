import { useQuery } from "@tanstack/react-query";
import { PodcastCard } from "./podcast-card";
import { PodcastCardSkeleton } from "./podcast-card-skeleton";
import { Mic } from "lucide-react";
import type { GeneratedPodcast } from "@shared/schema";

export function PodcastGallery() {
  const { data: mineResponse, isLoading } = useQuery<{ podcasts: GeneratedPodcast[], total: number }>({
    queryKey: ["/api/podcasts/mine", "preview"],
    queryFn: async () => {
      const res = await fetch('/api/podcasts/mine?limit=50&offset=0', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    // Bumped staleTime to 5min (Task #102 parity). Mutations invalidate
    // this key explicitly so users still see fresh data after edits.
    staleTime: 5 * 60 * 1000,
  });
  const podcasts = mineResponse?.podcasts ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="loading-podcasts">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <PodcastCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (podcasts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-4" data-testid="empty-state">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 mb-6">
          <Mic className="h-12 w-12 text-primary" />
        </div>
        <h3 className="text-2xl font-semibold mb-2">Your Podcast Studio Awaits</h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Create your first AI-generated podcast to get started. Just enter a topic above and let the magic happen!
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="podcast-gallery">
      {podcasts.map((podcast) => (
        <PodcastCard key={podcast.id} podcast={podcast} />
      ))}
    </div>
  );
}
