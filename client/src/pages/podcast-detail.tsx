import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PodcastModal } from "@/components/podcast-modal";
import { Loader2 } from "lucide-react";
import type { GeneratedPodcast } from "@shared/schema";
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";

function formatDurationISO(duration: string): string {
  if (duration.startsWith('PT')) {
    return duration;
  }
  const parts = duration.split(':');
  if (parts.length === 3) {
    const [hours, mins, secs] = parts.map(Number);
    if (hours > 0) return `PT${hours}H${mins}M${secs}S`;
    return `PT${mins}M${secs}S`;
  }
  if (parts.length === 2) {
    const [mins, secs] = parts.map(Number);
    return `PT${mins}M${secs}S`;
  }
  return 'PT5M';
}

export default function PodcastDetail() {
  const [, params] = useRoute("/podcasts/:id");
  const [showModal, setShowModal] = useState(false);
  
  // Fetch the specific podcast by ID instead of searching in public list
  const { data: podcast, isLoading, error } = useQuery<GeneratedPodcast>({
    queryKey: ["/api/podcasts", params?.id],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${params?.id}`);
      if (!res.ok) {
        throw new Error("Podcast not found");
      }
      return res.json();
    },
    enabled: !!params?.id,
    retry: 2,
  });

  useEffect(() => {
    if (podcast) {
      setShowModal(true);
    }
  }, [podcast]);
  
  const podcastSchema = podcast ? {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    "url": `https://podbrew.pro/podcasts/${podcast.id}`,
    "name": podcast.title || podcast.topic,
    "description": `AI-generated podcast about ${podcast.topic}. Created with PodBrew's advanced text-to-speech technology.`,
    "datePublished": podcast.timestamp ? new Date(podcast.timestamp).toISOString() : new Date().toISOString(),
    "timeRequired": formatDurationISO(podcast.duration),
    "image": podcast.coverImageUrl || "https://podbrew.pro/og-image.png",
    "associatedMedia": {
      "@type": "AudioObject",
      "contentUrl": podcast.audioUrl,
      "encodingFormat": "audio/mpeg"
    },
    "partOfSeries": {
      "@type": "PodcastSeries",
      "name": "PodBrew AI Podcasts",
      "url": "https://podbrew.pro/listen"
    },
    "creator": {
      "@type": "Organization",
      "name": "PodBrew",
      "url": "https://podbrew.pro"
    },
    "keywords": podcast.tags?.join(", ") || "AI podcast, text to speech"
  } : null;

  const [, setLocation] = useLocation();
  
  const handleClose = () => {
    setShowModal(false);
    setLocation("/listen");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !podcast) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <h1 className="text-2xl font-bold mb-2">Podcast Not Found</h1>
        <p className="text-muted-foreground mb-4">This podcast may be private or no longer available.</p>
        <a href="/listen" className="text-primary hover:underline">Browse public podcasts</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {podcastSchema && (
        <Helmet>
          <title>{podcast?.title || podcast?.topic} - PodBrew AI Podcast</title>
          <meta name="description" content={`Listen to this AI-generated podcast about ${podcast?.topic}. Created with PodBrew's advanced text-to-speech technology.`} />
          <meta property="og:title" content={`${podcast?.title || podcast?.topic} - PodBrew AI Podcast`} />
          <meta property="og:description" content={`AI-generated podcast about ${podcast?.topic}`} />
          <meta property="og:image" content={podcast?.coverImageUrl || "https://podbrew.pro/og-image.png"} />
          <meta property="og:url" content={`https://podbrew.pro/podcasts/${podcast?.id}`} />
          <meta property="og:type" content="music.song" />
          <link rel="canonical" href={`https://podbrew.pro/podcasts/${podcast?.id}`} />
          <script type="application/ld+json">
            {JSON.stringify(podcastSchema)}
          </script>
        </Helmet>
      )}
      <PodcastModal podcast={podcast} open={showModal} onOpenChange={handleClose} />
      {!showModal && (
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-muted-foreground">Redirecting to Listen...</p>
        </div>
      )}
    </div>
  );
}
