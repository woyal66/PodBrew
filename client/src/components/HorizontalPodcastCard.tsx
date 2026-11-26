import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  ListPlus,
  Share2,
  MoreVertical,
  Clock,
  Users,
  Headphones,
  Globe,
  Lock,
  RotateCw,
  Check,
  Loader2,
  PlusCircle,
  Download,
  Pause,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sharePodcast } from "@/lib/share";
import { useAuth } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GeneratedPodcast, EnrichedPodcast, PodcastEngagement, Playlist } from "@shared/schema";
import { TEMPLATE_CATEGORIES } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageSquare, Share } from "lucide-react";
import { LikeDislikeButtons } from "@/components/like-dislike-buttons";
import { CommentsDialog } from "@/components/comments-dialog";
import { regenerateFromPodcast } from "@/lib/regenerate";

interface HorizontalPodcastCardProps {
  podcast: GeneratedPodcast;
  onPlay: (podcast: GeneratedPodcast) => void;
  onOpenDetails?: (podcast: GeneratedPodcast) => void;
  showEngagement?: boolean;
  engagement?: PodcastEngagement;
  /**
   * Mark the cover image as `fetchpriority="high"` for above-the-fold tiles
   * (LCP candidate). Caller passes `index === 0` for the first card in each
   * rail.
   */
  priority?: boolean;
}

export function HorizontalPodcastCard({ 
  podcast, 
  onPlay, 
  onOpenDetails,
  showEngagement = true,
  engagement,
  priority = false,
}: HorizontalPodcastCardProps) {
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const { data: session } = useQuery<{ userId: string | null }>({
    queryKey: ["/api/session"],
  });

  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ["/api/playlists"],
    enabled: !!session?.userId,
  });

  const isOwner = session?.userId === podcast.userId;

  // Prefer the slim list-payload scalar (`_numPeople`, projected by
  // `podcastMineColumns` server-side). Fall back to the legacy
  // `generationParams.numPeople` shape for callers that still pass full
  // rows (detail page, single-podcast endpoints).
  const enrichedPodcast = podcast as EnrichedPodcast;
  const numPeople = typeof enrichedPodcast._numPeople === 'number'
    ? enrichedPodcast._numPeople
    : (podcast.generationParams &&
       typeof podcast.generationParams === 'object' &&
       'numPeople' in podcast.generationParams &&
       typeof (podcast.generationParams as { numPeople: unknown }).numPeople === 'number'
        ? (podcast.generationParams as { numPeople: number }).numPeople
        : null);

  const toggleVisibilityMutation = useMutation<GeneratedPodcast, Error>({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/podcasts/${podcast.id}/toggle-visibility`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/continue-listening"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/recommended"] });
    },
  });

  const addToPlaylistMutation = useMutation<void, Error, string>({
    mutationFn: async (playlistId: string) => {
      await apiRequest("POST", `/api/playlists/${playlistId}/items`, {
        podcastId: podcast.id,
      });
    },
    onSuccess: (_, playlistId) => {
      const playlistName = playlists?.find(p => p.id === playlistId)?.name || "playlist";
      queryClient.invalidateQueries({ queryKey: ["/api/playlists", playlistId] });
      toast({
        title: "Added to playlist",
        description: `"${podcast.title || podcast.topic}" added to ${playlistName}`,
      });
      setAddingToPlaylist(null);
    },
    onError: (error) => {
      toast({
        title: "Failed to add",
        description: error.message || "Could not add to playlist. Please try again.",
        variant: "destructive",
      });
      setAddingToPlaylist(null);
    },
  });

  const handleAddToPlaylist = (playlistId: string) => {
    setAddingToPlaylist(playlistId);
    addToPlaylistMutation.mutate(playlistId);
  };

  const handleShare = async () => {
    await sharePodcast({ podcast, toast });
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = podcast.audioUrl;
    link.download = `podcast-${(podcast.title || podcast.topic).substring(0, 30).replace(/\s+/g, "-")}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({
      title: "Download started",
      description: "Your podcast is being downloaded.",
    });
  };

  const toggleVisibility = () => {
    toggleVisibilityMutation.mutate();
  };

  const handleRegenerate = async () => {
    // The slim `/api/podcasts/mine` payload no longer carries
    // `generationParams`; the helper lazily fetches the full row via
    // `GET /api/podcasts/:id` when needed and seeds the Create form.
    await regenerateFromPodcast(podcast, { setLocation, toast });
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const getTemplateInfo = (category: string) => {
    const categoryKey = category as keyof typeof TEMPLATE_CATEGORIES;
    const template = TEMPLATE_CATEGORIES[categoryKey] || TEMPLATE_CATEGORIES.custom;
    return {
      name: template.name,
      color: template.color,
    };
  };

  return (
    <Card 
      className="group overflow-hidden hover-elevate"
      data-testid={`podcast-card-${podcast.id}`}
    >
      {/* Responsive layout - vertical on mobile, horizontal on desktop */}
      <div className="flex flex-col md:flex-row md:gap-3 md:p-3">
        {/* Cover art - full width 2:1 on mobile, square on desktop */}
        <div className="relative w-full md:w-32 aspect-[2/1] md:aspect-square flex-shrink-0 overflow-hidden bg-muted group/cover md:rounded-lg">
          {podcast.coverImageUrl ? (
            // React 18.3 doesn't recognize `fetchPriority` (added in React 19);
            // spread the lowercase HTML attribute instead so browsers that
            // support Priority Hints can prioritize this LCP candidate. We
            // keep `loading="lazy"` on every cover — Priority Hints layer on
            // top of lazy loading.
            <img
              src={podcast.coverImageUrl}
              alt={podcast.title || podcast.topic}
              className="w-full h-full object-cover"
              width={600}
              height={600}
              decoding="async"
              loading="lazy"
              {...({ fetchpriority: priority ? "high" : "auto" } as Record<string, string>)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-primary/10 to-muted">
              <svg className="w-8 h-8 opacity-40" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M10,50 Q20,30 30,50 T50,50 T70,50 T90,50"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  className="text-primary"
                />
              </svg>
            </div>
          )}
          
          {/* Play button overlay - desktop hover only */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay(podcast);
            }}
            data-testid={`button-play-overlay-${podcast.id}`}
            aria-label="Play podcast"
            className="hidden md:flex absolute inset-0 items-center justify-center bg-black/0 group-hover/cover:bg-black/40 transition-all cursor-pointer"
          >
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center transition-opacity opacity-0 group-hover/cover:opacity-100">
              <Play className="h-5 w-5 text-primary-foreground ml-0.5 fill-current" />
            </div>
          </button>
        </div>

        {/* Content section */}
        <div className="flex-1 flex flex-col justify-between min-w-0 p-3 md:p-0 space-y-2 md:space-y-1">
          {/* Title and Description */}
          <div 
            className="cursor-pointer" 
            onClick={() => onOpenDetails?.(podcast)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDetails?.(podcast);
              }
            }}
            data-testid={`card-details-${podcast.id}`}
          >
            <h3 className="font-semibold text-sm md:text-base line-clamp-2 text-foreground leading-tight">
              {podcast.title || podcast.topic}
            </h3>
            {/* Description - prefer AI-generated description, fall back to topic or template info */}
            {(() => {
              // Use the AI-generated description when available
              const aiDescription = podcast.description?.trim();
              if (aiDescription) {
                return (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1" data-testid={`description-${podcast.id}`}>
                    {aiDescription}
                  </p>
                );
              }

              // Legacy fallback: show topic if different from title
              if (podcast.title && podcast.topic && podcast.title !== podcast.topic) {
                return (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1" data-testid={`description-${podcast.id}`}>
                    {podcast.topic}
                  </p>
                );
              }
              
              // Otherwise, create a description from template and params if available
              const templateInfo = getTemplateInfo(podcast.templateCategory || 'custom');
              const params = podcast.generationParams as Record<string, unknown> | null;

              // Build description parts based on available data
              const parts: string[] = [`${templateInfo.name} podcast`];

              // Prefer the slim `_numPeople` scalar projected by the list
              // endpoint; fall back to the legacy `generationParams.numPeople`
              // for callers that still pass full rows.
              if (typeof numPeople === 'number') {
                parts.push(numPeople === 1 ? 'Solo' : `${numPeople} hosts`);
              }

              // Only add style if we have actual data (full-row callers only)
              if (params && typeof params.podcastStyle === 'string') {
                const style = params.podcastStyle;
                parts.push(style.charAt(0).toUpperCase() + style.slice(1));
              }
              
              // Add duration as fallback descriptive info
              if (parts.length === 1 && podcast.duration) {
                parts.push(`${podcast.duration} min`);
              }
              
              return (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-1" data-testid={`description-${podcast.id}`}>
                  {parts.join(' • ')}
                </p>
              );
            })()}
          </div>
          
          {/* Metadata row */}
          <div className="flex items-center gap-2 flex-wrap">
            {(() => {
              const templateInfo = getTemplateInfo(podcast.templateCategory || 'custom');
              return (
                <Badge 
                  variant="secondary" 
                  className="text-xs px-1.5 py-0 font-medium border h-5"
                  style={{
                    backgroundColor: `${templateInfo.color}15`,
                    color: templateInfo.color,
                    borderColor: `${templateInfo.color}40`,
                  }}
                  data-testid={`badge-template-${podcast.id}`}
                >
                  {templateInfo.name}
                </Badge>
              );
            })()}
            
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(podcast.timestamp), { addSuffix: true })} • {podcast.duration}
            </span>

            {showEngagement && podcast.plays > 0 && (
              <span className="flex items-center gap-1 text-xs text-primary">
                <Headphones className="h-3 w-3" />
                {formatPlayCount(podcast.plays)}
              </span>
            )}
          </div>

          {/* Action bar - menu on left, play on right for right-hand usability */}
          <div className="flex items-center gap-1 mt-auto">
            {/* 3-dot overflow menu - on left */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-8 w-8"
                  data-testid={`button-menu-${podcast.id}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => { void handleRegenerate(); }} data-testid={`menu-regenerate-${podcast.id}`}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Regenerate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownload} data-testid={`menu-download-${podcast.id}`}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </DropdownMenuItem>
                {user?.subscriptionPlan !== 'free' && (
                  <DropdownMenuItem onClick={handleShare} data-testid={`menu-share-${podcast.id}`}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share
                  </DropdownMenuItem>
                )}
                {session?.userId && playlists && playlists.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Add to Playlist</DropdownMenuLabel>
                    {playlists.map((playlist) => (
                      <DropdownMenuItem
                        key={playlist.id}
                        onClick={() => handleAddToPlaylist(playlist.id)}
                        disabled={addingToPlaylist === playlist.id}
                        data-testid={`menu-item-playlist-${playlist.id}`}
                      >
                        {addingToPlaylist === playlist.id ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <ListPlus className="h-4 w-4 mr-2" />
                        )}
                        <span className="truncate">{playlist.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Regenerate button - always visible, positioned prominently */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRegenerate();
                  }}
                  data-testid={`button-regenerate-${podcast.id}`}
                  aria-label="Regenerate podcast"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Regenerate with same topic</TooltipContent>
            </Tooltip>

            {/* Like/Dislike */}
            <LikeDislikeButtons
              podcastId={podcast.id}
              isAuthenticated={!!session?.userId}
              compact
              prefetchedEngagement={engagement}
            />

            {/* Comments */}
            {podcast.isPublic && (
              <CommentsDialog
                podcastId={podcast.id}
                podcastTitle={podcast.title || podcast.topic}
                podcastOwnerId={podcast.userId || undefined}
                isPublic={podcast.isPublic}
                compact
              />
            )}

            {/* Public/Private toggle (owner only) */}
            {isOwner && (
              (podcast.templateCategory !== 'medical' && podcast.templateCategory !== 'documents') ||
              (podcast.isPublic && (podcast.templateCategory === 'medical' || podcast.templateCategory === 'documents'))
            ) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisibility();
                    }}
                    data-testid={`button-toggle-visibility-${podcast.id}`}
                  >
                    {podcast.isPublic ? (
                      <Globe className="h-4 w-4 text-primary" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {(podcast.templateCategory === 'medical' || podcast.templateCategory === 'documents')
                    ? "Make private (required)"
                    : podcast.isPublic ? "Public (tap to make private)" : "Private (tap to make public)"}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Play button - mobile only (inline), on right for right-hand usability */}
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(podcast);
              }}
              data-testid={`button-play-${podcast.id}`}
              aria-label="Play podcast"
              className="h-8 w-8 md:hidden"
            >
              <Play className="h-4 w-4 text-primary" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
