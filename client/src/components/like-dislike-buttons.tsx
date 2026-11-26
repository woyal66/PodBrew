import { useState, useLayoutEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getGuestToken } from "@/lib/guestIdentity";
import type { PodcastLike, PodcastEngagement } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LikeDislikeButtonsProps {
  podcastId: string;
  isAuthenticated?: boolean;
  compact?: boolean;
  className?: string;
  prefetchedEngagement?: PodcastEngagement | null;
  prefetchedUserLike?: PodcastLike | null;
}

function formatCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

export function LikeDislikeButtons({
  podcastId,
  isAuthenticated,
  compact = false,
  className,
  prefetchedEngagement,
  prefetchedUserLike,
}: LikeDislikeButtonsProps) {
  const { toast } = useToast();
  const [optimisticValue, setOptimisticValue] = useState<number | null>(null);
  const [optimisticEngagement, setOptimisticEngagement] = useState<Partial<PodcastEngagement> | null>(null);

  // Prime the query cache with prefetched data so per-card queries skip an
  // initial network round trip. Only seed when nothing is already cached so we
  // don't clobber fresher mutation results. We do this in useLayoutEffect
  // *and* via initialData below; the layout effect is a belt-and-suspenders
  // guarantee for cases where the parent never primed the cache.
  useLayoutEffect(() => {
    if (prefetchedEngagement !== undefined) {
      const cached = queryClient.getQueryData(["/api/podcasts", podcastId, "engagement"]);
      if (!cached) {
        queryClient.setQueryData(["/api/podcasts", podcastId, "engagement"], { engagement: prefetchedEngagement });
      }
    }
    if (prefetchedUserLike !== undefined) {
      const cached = queryClient.getQueryData(["/api/podcasts", podcastId, "like"]);
      if (!cached) {
        queryClient.setQueryData(["/api/podcasts", podcastId, "like"], { like: prefetchedUserLike });
      }
    }
  }, [podcastId]);

  // When prefetched data is available, hand it to useQuery as initialData with
  // a fresh initialDataUpdatedAt. Combined with staleTime > 0 this tells
  // React Query the data is already-loaded-and-fresh, so it won't fire an
  // initial network request when the observer subscribes. Without this the
  // observer would still fetch on mount in cases where setQueryData hadn't
  // populated the cache before the observer's subscribe phase ran.
  const hasPrefetchedLike = prefetchedUserLike !== undefined;
  const hasPrefetchedEngagement = prefetchedEngagement !== undefined;

  const { data: likeData } = useQuery<{ like: PodcastLike | null }>({
    queryKey: ["/api/podcasts", podcastId, "like"],
    queryFn: async () => {
      const guestId = getGuestToken();
      const headers: Record<string, string> = {};
      if (guestId) headers["x-guest-id"] = guestId;
      const response = await fetch(`/api/podcasts/${podcastId}/like`, {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        if (response.status === 401) {
          return { like: null };
        }
        throw new Error("Failed to fetch like status");
      }
      return response.json();
    },
    enabled: true,
    staleTime: 60000,
    initialData: hasPrefetchedLike ? { like: prefetchedUserLike ?? null } : undefined,
    initialDataUpdatedAt: hasPrefetchedLike ? Date.now() : undefined,
  });

  const { data: engagementData } = useQuery<{ engagement: PodcastEngagement | null }>({
    queryKey: ["/api/podcasts", podcastId, "engagement"],
    queryFn: async () => {
      const response = await fetch(`/api/podcasts/${podcastId}/engagement`);
      if (!response.ok) {
        throw new Error("Failed to fetch engagement");
      }
      return response.json();
    },
    enabled: true,
    staleTime: 60000,
    initialData: hasPrefetchedEngagement ? { engagement: prefetchedEngagement ?? null } : undefined,
    initialDataUpdatedAt: hasPrefetchedEngagement ? Date.now() : undefined,
  });

  const likeMutation = useMutation<
    { like: PodcastLike | null; engagement: PodcastEngagement },
    Error,
    1 | -1
  >({
    mutationFn: async (value: 1 | -1) => {
      const response = await apiRequest("POST", `/api/podcasts/${podcastId}/like`, { value });
      return response.json();
    },
    onMutate: async (value) => {
      setOptimisticValue(value);
      const currentReaction = likeData?.like?.reactionType;
      const currentValue = currentReaction === 'listen' ? 1 : currentReaction === 'skip' ? -1 : 0;
      const currentLikes = engagementData?.engagement?.likes || 0;
      const currentDislikes = engagementData?.engagement?.dislikes || 0;

      let newLikes = currentLikes;
      let newDislikes = currentDislikes;

      if (currentValue === value) {
        if (value === 1) newLikes--;
        else newDislikes--;
        setOptimisticValue(0);
      } else if (currentValue === 0) {
        if (value === 1) newLikes++;
        else newDislikes++;
      } else {
        if (value === 1) {
          newLikes++;
          newDislikes--;
        } else {
          newLikes--;
          newDislikes++;
        }
      }

      setOptimisticEngagement({ likes: newLikes, dislikes: newDislikes });
    },
    onSuccess: (result) => {
      setOptimisticValue(null);
      setOptimisticEngagement(null);
      queryClient.setQueryData(["/api/podcasts", podcastId, "like"], { like: result.like });
      queryClient.setQueryData(["/api/podcasts", podcastId, "engagement"], { engagement: result.engagement });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/trending"] });
    },
    onError: () => {
      setOptimisticValue(null);
      setOptimisticEngagement(null);
      toast({
        title: "Action failed",
        description: "Could not update your reaction. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleLike = () => {
    likeMutation.mutate(1);
  };

  const handleDislike = () => {
    likeMutation.mutate(-1);
  };

  const persistedValue = likeData?.like?.reactionType === 'listen'
    ? 1
    : likeData?.like?.reactionType === 'skip'
      ? -1
      : 0;
  const currentValue = optimisticValue !== null ? optimisticValue : persistedValue;

  const likes = optimisticEngagement?.likes ?? engagementData?.engagement?.likes ?? 0;
  const dislikes = optimisticEngagement?.dislikes ?? engagementData?.engagement?.dislikes ?? 0;

  const isLiked = currentValue === 1;
  const isDisliked = currentValue === -1;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={isLiked ? "default" : "outline"}
              onClick={handleLike}
              disabled={likeMutation.isPending}
              data-testid={`button-like-${podcastId}`}
              aria-label={`Like podcast (${likes} likes)`}
              aria-pressed={isLiked}
              className={cn(
                "h-9 px-2 gap-1 transition-all",
                isLiked && "bg-primary/10 text-primary border-primary/30",
              )}
            >
              <ThumbsUp className={cn("h-4 w-4", isLiked && "fill-current")} />
              {likes > 0 && <span className="text-xs font-medium">{formatCount(likes)}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isLiked ? "Remove like" : "Like"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={isDisliked ? "default" : "outline"}
              onClick={handleDislike}
              disabled={likeMutation.isPending}
              data-testid={`button-dislike-${podcastId}`}
              aria-label={`Dislike podcast (${dislikes} dislikes)`}
              aria-pressed={isDisliked}
              className={cn(
                "h-9 px-2 gap-1 transition-all",
                isDisliked && "bg-destructive/10 text-destructive border-destructive/30",
              )}
            >
              <ThumbsDown className={cn("h-4 w-4", isDisliked && "fill-current")} />
              {dislikes > 0 && <span className="text-xs font-medium">{formatCount(dislikes)}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isDisliked ? "Remove dislike" : "Dislike"}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center rounded-full border bg-muted/30 overflow-hidden", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLike}
        disabled={likeMutation.isPending}
        data-testid={`button-like-${podcastId}`}
        aria-label={`Like podcast (${likes} likes)`}
        aria-pressed={isLiked}
        className={cn(
          "h-9 px-3 rounded-none gap-1.5 transition-all hover:bg-muted/50",
          isLiked && "text-primary bg-primary/10"
        )}
      >
        <ThumbsUp className={cn("h-4 w-4", isLiked && "fill-current")} />
        <span className="text-sm font-medium">{formatCount(likes)}</span>
      </Button>

      <div className="w-px h-5 bg-border" />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleDislike}
        disabled={likeMutation.isPending}
        data-testid={`button-dislike-${podcastId}`}
        aria-label={`Dislike podcast (${dislikes} dislikes)`}
        aria-pressed={isDisliked}
        className={cn(
          "h-9 px-3 rounded-none gap-1.5 transition-all hover:bg-muted/50",
          isDisliked && "text-destructive bg-destructive/10"
        )}
      >
        <ThumbsDown className={cn("h-4 w-4", isDisliked && "fill-current")} />
        {dislikes > 0 && <span className="text-sm font-medium">{formatCount(dislikes)}</span>}
      </Button>
    </div>
  );
}
