import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GeneratedPodcast } from "@shared/schema";

type ToastFn = (opts: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => void;

export function buildShareUrl(podcastId: string): string {
  return `${window.location.origin}/podcast/${podcastId}`;
}

interface SharePodcastOptions {
  podcast: Pick<GeneratedPodcast, "id" | "title" | "topic">;
  toast: ToastFn;
}

export async function sharePodcast({
  podcast,
  toast,
}: SharePodcastOptions): Promise<void> {
  const url = buildShareUrl(podcast.id);
  const podcastTitle = podcast.title || podcast.topic;
  let platform: "native" | "clipboard" = "clipboard";

  const canUseNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (canUseNativeShare) {
    try {
      await navigator.share({
        title: podcastTitle,
        text: `Check out this podcast: ${podcastTitle}`,
        url,
      });
      platform = "native";
    } catch (err) {
      const error = err as { name?: string };
      if (error?.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: "Link copied!",
          description: "Podcast link copied to clipboard",
        });
        platform = "clipboard";
      } catch {
        toast({
          title: "Couldn't share",
          description: "Please copy the link manually.",
          variant: "destructive",
        });
        return;
      }
    }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied!",
        description: "Podcast link copied to clipboard",
      });
      platform = "clipboard";
    } catch {
      toast({
        title: "Couldn't copy link",
        description: "Please copy the link manually.",
        variant: "destructive",
      });
      return;
    }
  }

  try {
    await apiRequest("POST", `/api/podcasts/${podcast.id}/share`, {
      platform,
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/podcasts", podcast.id, "engagement"],
    });
  } catch {
    // Silently fail — share tracking is non-critical
  }
}
