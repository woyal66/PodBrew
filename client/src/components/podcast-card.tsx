import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Play, Pause, Download, RotateCw, Share2, Trash2, Globe, Lock, ListPlus, Check, Loader2, MessageSquare, MoreHorizontal, Pencil, Headphones, Music2, BrainCircuit } from "lucide-react";
import { PodcastEditModal } from "@/components/podcast-edit-modal";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GeneratedPodcast, EnrichedPodcast, Playlist } from "@shared/schema";
import { TEMPLATE_CATEGORIES } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { sharePodcast } from "@/lib/share";
import { useAuth } from "@/contexts/auth-context";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { LikeDislikeButtons } from "@/components/like-dislike-buttons";
import { CommentsDialog } from "@/components/comments-dialog";
import { regenerateFromPodcast } from "@/lib/regenerate";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function formatPlayCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

interface PodcastCardProps {
  podcast: EnrichedPodcast;
  enrichmentPending?: boolean;
  /**
   * Mark this card's cover image as the LCP candidate for above-the-fold
   * tiles (typically the first card in a rail or grid). Caller passes
   * `index === 0`.
   */
  priority?: boolean;
}

export function PodcastCard({ podcast, enrichmentPending = false, priority = false }: PodcastCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [optimisticIsPublic, setOptimisticIsPublic] = useState<boolean | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const { state, play, pause, isCurrentPodcast } = useAudioPlayer();
  const [, setLocation] = useLocation();

  const { data: session } = useQuery<{ userId: string | null }>({
    queryKey: ["/api/session"],
  });

  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ["/api/playlists"],
    enabled: !!session?.userId,
  });

  // Use pre-fetched top comment data from batch API if available, otherwise fetch individually
  // Check if the key exists (even if value is null) to distinguish "no comments" from "not prefetched"
  const hasPrefetchedTopComment = '_topComment' in podcast;
  const prefetchedTopComment = podcast._topComment;
  const { data: topCommentData } = useQuery<{
    comment: {
      id: string;
      body: string;
      user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null };
      upvotes: number;
    } | null;
  }>({
    queryKey: ["/api/podcasts", podcast.id, "top-comment"],
    // Don't fire individual query when enrichment is loading globally (batch-enrichment will cover it)
    enabled: podcast.isPublic && !hasPrefetchedTopComment && !enrichmentPending,
    staleTime: 120000, // 2 minutes with pre-fetched data
  });
  
  // Merge pre-fetched data with fetched data
  const topComment = hasPrefetchedTopComment ? prefetchedTopComment : topCommentData?.comment;

  const [showCommentsFromPreview, setShowCommentsFromPreview] = useState(false);

  const isOwner = session?.userId === podcast.userId;
  const isThisPodcastPlaying = isCurrentPodcast(podcast.id) && state.isPlaying;
  
  // Use optimistic state if updating, otherwise use actual podcast state
  const displayIsPublic = optimisticIsPublic !== null ? optimisticIsPublic : podcast.isPublic;

  const toggleVisibilityMutation = useMutation<GeneratedPodcast, Error>({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/podcasts/${podcast.id}/toggle-visibility`, {});
      return response.json();
    },
    onSuccess: (updatedPodcast) => {
      setOptimisticIsPublic(null); // Clear optimistic state
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/favorites"] });
      toast({
        title: updatedPodcast.isPublic ? "Now Public" : "Now Private",
        description: updatedPodcast.isPublic 
          ? "Your podcast is now visible to everyone." 
          : "Your podcast is now only visible to you.",
      });
    },
    onError: (error) => {
      setOptimisticIsPublic(null); // Rollback optimistic state
      toast({
        title: "Failed to update visibility",
        description: error instanceof Error ? error.message : "Could not change visibility. Please check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation<void, Error>({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/podcasts/${podcast.id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/favorites"] });
      toast({
        title: "Podcast deleted",
        description: "Your podcast has been permanently deleted.",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete podcast. Please try again.",
        variant: "destructive",
      });
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

  const handlePlayPause = () => {
    if (isThisPodcastPlaying) {
      pause();
    } else {
      // Explicitly pass autoPlay: true to ensure playback starts on mobile
      play(podcast, false, true);
    }
  };

  const toggleVisibility = () => {
    // Set optimistic state immediately for instant UI feedback
    setOptimisticIsPublic(!podcast.isPublic);
    // Then make the API request in the background
    toggleVisibilityMutation.mutate();
  };

  const handleRegenerate = async () => {
    // Slim `/api/podcasts/mine` payload no longer ships `generationParams`;
    // the helper lazily fetches the full row via `GET /api/podcasts/:id`
    // when needed and seeds the Create form.
    await regenerateFromPodcast(podcast, { setLocation, toast });
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = podcast.audioUrl;
    link.download = `podcast-${podcast.topic.substring(0, 30).replace(/\s+/g, "-")}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    await sharePodcast({ podcast, toast });
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate();
    setShowDeleteDialog(false);
  };

  // Use the AI-generated description when available; fall back to topic-derived string
  const topicFallback = podcast.topic.length > 60
    ? podcast.topic
    : `A ${(podcast.duration || '').replace(/^(\d+).*/, '$1-minute')} podcast about ${podcast.topic}`;
  const shortDescription = podcast.description?.trim() || topicFallback;

  // Get template info
  const categoryKey = (podcast.templateCategory || 'custom') as keyof typeof TEMPLATE_CATEGORIES;
  const template = TEMPLATE_CATEGORIES[categoryKey] || TEMPLATE_CATEGORIES.custom;

  return (
    <>
      <Card className="bg-card/80 backdrop-blur-sm podcast-card-enhanced transition-all duration-300 ease-out overflow-hidden shadow-md hover:shadow-xl border-border/50" data-testid={`card-podcast-${podcast.id}`}>
        {/* Single responsive layout - vertical on mobile, horizontal on desktop */}
        <div className="flex flex-col md:flex-row md:gap-4 md:p-4">
          {/* Cover art - full width on mobile (2.67:1 ratio, reduced 25% from 2:1), square on desktop */}
          <div 
            className="relative w-full md:w-44 aspect-[8/3] md:aspect-square flex-shrink-0 overflow-hidden bg-muted group md:rounded-xl shadow-lg cursor-pointer"
            onClick={() => handlePlayPause()}
          >
            {podcast.coverImageUrl ? (
              <>
                {/*
                  React 18.3 doesn't recognize the `fetchPriority` camelCase
                  JSX prop (added in React 19), so we spread the lowercase
                  HTML attribute via `{...{fetchpriority}}` instead. Browsers
                  that support Priority Hints honor `high` for the LCP image
                  even with `loading="lazy"`, so we keep lazy loading on
                  every cover and only nudge the first card up the priority
                  queue.
                */}
                <img
                  src={podcast.coverImageUrl}
                  alt={`Cover art for ${podcast.topic}`}
                  className="w-full h-full object-cover"
                  width={600}
                  height={600}
                  decoding="async"
                  loading="lazy"
                  {...({ fetchpriority: priority ? "high" : "auto" } as Record<string, string>)}
                  data-testid={`img-cover-${podcast.id}`}
                />
                {/* Gradient overlay for polish */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/30 via-primary/15 to-muted">
                <svg className="w-10 h-10 opacity-50" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
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
              onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
              data-testid={`button-play-overlay-${podcast.id}`}
              aria-label={isThisPodcastPlaying ? "Pause podcast" : "Play podcast"}
              className="hidden md:flex absolute inset-0 items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-full bg-primary flex items-center justify-center transition-opacity ${isThisPodcastPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                {isThisPodcastPlaying ? (
                  <Pause className="h-5 w-5 text-primary-foreground" />
                ) : (
                  <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
                )}
              </div>
            </button>
            {/* Resume-from-position progress bar (Continue Listening) */}
            {podcast._progress && podcast._progress.percent > 0 && (
              <div
                className="absolute bottom-0 left-0 right-0 h-1 bg-black/30"
                data-testid={`progress-resume-${podcast.id}`}
                aria-label={`${podcast._progress.percent}% played`}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.max(2, podcast._progress.percent))}%` }}
                />
              </div>
            )}
          </div>

          {/* Content section */}
          <div className="flex-1 flex flex-col justify-between min-w-0 p-3 md:p-0 space-y-2 md:space-y-1">
            {/* Title - clickable to navigate to podcast detail */}
            <h3 
              className="font-semibold text-sm md:text-base line-clamp-2 text-foreground leading-tight cursor-pointer hover:text-primary transition-colors" 
              data-testid={`text-topic-${podcast.id}`}
              onClick={() => setLocation(`/podcasts/${podcast.id}`)}
            >
              {podcast.title || podcast.topic}
            </h3>
            
            {/* Short description */}
            <p className="text-xs text-muted-foreground line-clamp-3">
              {shortDescription}
            </p>
            
            {/* Metadata row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge 
                variant="secondary" 
                className="text-xs px-1.5 py-0 font-medium border h-5"
                style={{
                  backgroundColor: `${template.color}15`,
                  color: template.color,
                  borderColor: `${template.color}40`,
                }}
                data-testid={`badge-template-${podcast.id}`}
              >
                {template.name}
              </Badge>
              <span className="text-xs text-muted-foreground" data-testid={`text-timestamp-${podcast.id}`}>
                {formatDistanceToNow(new Date(podcast.timestamp), { addSuffix: true })} • {podcast.duration}
              </span>
              {podcast.plays > 0 && (
                <span className="flex items-center gap-1 text-xs text-primary" data-testid={`text-plays-${podcast.id}`}>
                  <Headphones className="h-3 w-3" />
                  {formatPlayCount(podcast.plays)}
                </span>
              )}
              {(podcast.generationParams as any)?.musicStyle && (podcast.generationParams as any).musicStyle !== 'none' && (
                <span
                  className="flex items-center gap-0.5 text-xs text-muted-foreground"
                  data-testid={`badge-music-${podcast.id}`}
                  title={`Background music: ${(podcast.generationParams as any).musicStyle}`}
                >
                  <Music2 className="h-3 w-3" />
                </span>
              )}
              {podcast.templateCategory === 'deepdive' && (
                <span
                  className="flex items-center gap-1 text-xs font-medium rounded px-1.5 py-0.5"
                  data-testid={`badge-notebooklm-${podcast.id}`}
                  style={{ color: '#818CF8', backgroundColor: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}
                >
                  <BrainCircuit className="h-3 w-3 shrink-0" />
                  Powered by NotebookLM
                </span>
              )}
            </div>

            {/* Hot Comments Preview - always reserves row space to avoid layout shift */}
            {/* While enrichment is pending: show skeleton. After: show top comment or hide invisibly */}
            <div
              style={{ visibility: enrichmentPending || topComment ? 'visible' : 'hidden' }}
              className="flex items-center gap-1.5 w-full px-1 py-0.5"
            >
              {enrichmentPending ? (
                <>
                  <div className="h-4 w-4 rounded-full bg-muted flex-shrink-0 animate-pulse" />
                  <div className="h-3 bg-muted rounded flex-1 animate-pulse" />
                </>
              ) : topComment ? (
                <button
                  onClick={() => setShowCommentsFromPreview(true)}
                  className="flex items-center gap-1.5 w-full text-left hover-elevate rounded transition-colors -mx-1 px-1"
                  data-testid={`button-hot-comment-preview-${podcast.id}`}
                >
                  <Avatar className="h-4 w-4 flex-shrink-0">
                    <AvatarImage 
                      src={topComment.user.profileImageUrl || undefined} 
                      alt={`${topComment.user.firstName || 'User'}'s avatar`}
                    />
                    <AvatarFallback className="text-[8px]">
                      {(topComment.user.firstName?.[0] || topComment.user.lastName?.[0] || 'U').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    <span className="font-medium text-foreground/80">
                      {topComment.user.firstName || 'User'}
                    </span>
                    {': '}
                    {topComment.body.length > 60 
                      ? topComment.body.slice(0, 60) + '...' 
                      : topComment.body}
                  </span>
                  <MessageSquare className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </button>
              ) : null}
            </div>
            
            {/* Action bar - swapped order: menu on left, play on right for right-hand usability */}
            <div className="flex items-center gap-1 mt-auto">
              {/* 3-dot overflow menu - on left */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-more-${podcast.id}`}
                        aria-label="More options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>More actions</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-48">
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

                  <DropdownMenuSeparator />
                  {isOwner && (
                    <DropdownMenuItem 
                      onClick={() => setShowEditModal(true)}
                      data-testid={`menu-edit-${podcast.id}`}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem 
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    data-testid={`menu-delete-${podcast.id}`}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Regenerate button - always visible, positioned prominently */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => { void handleRegenerate(); }}
                    data-testid={`button-regenerate-${podcast.id}`}
                    aria-label="Regenerate podcast"
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Regenerate with same topic</TooltipContent>
              </Tooltip>

              {/* Like/Reaction + Comments - skeleton while enrichment is loading to avoid per-card queries.
                  Skip skeleton if engagement counts are already inlined from the slim response. */}
              {enrichmentPending && !podcast._engagement ? (
                <>
                  <div className="h-9 w-16 rounded-md bg-muted animate-pulse" />
                  {podcast.isPublic && <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />}
                </>
              ) : (
                <>
                  <LikeDislikeButtons
                    podcastId={podcast.id}
                    isAuthenticated={!!session?.userId}
                    compact
                    prefetchedEngagement={podcast._engagement}
                    prefetchedUserLike={podcast._userLike}
                  />
                  {podcast.isPublic && (
                    <CommentsDialog
                      podcastId={podcast.id}
                      podcastTitle={podcast.title || podcast.topic}
                      podcastOwnerId={podcast.userId || undefined}
                      isPublic={podcast.isPublic}
                    />
                  )}
                </>
              )}

              {/* Public/Private toggle (owner only) */}
              {isOwner && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={toggleVisibility}
                      disabled={toggleVisibilityMutation.isPending}
                      data-testid={`button-toggle-visibility-${podcast.id}`}
                      aria-label={displayIsPublic ? "Make private" : "Make public"}
                    >
                      {displayIsPublic ? (
                        <Globe className="h-4 w-4 text-primary" />
                      ) : (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {displayIsPublic ? "Public (tap to make private)" : "Private (tap to make public)"}
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Play button - mobile only (inline), on right for right-hand usability */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    onClick={handlePlayPause}
                    data-testid={`button-play-${podcast.id}`}
                    aria-label={isThisPodcastPlaying ? "Pause podcast" : "Play podcast"}
                    className="md:hidden bg-primary text-primary-foreground rounded-full hover:bg-primary/90"
                  >
                    {isThisPodcastPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isThisPodcastPlaying ? "Pause" : "Play this podcast"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Podcast?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{podcast.topic}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-delete-cancel-${podcast.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              data-testid={`button-delete-confirm-${podcast.id}`}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PodcastEditModal
        podcast={podcast}
        open={showEditModal}
        onOpenChange={setShowEditModal}
      />

      {/* Controlled CommentsDialog for hot comments preview - only mount when enrichment is done */}
      {podcast.isPublic && !enrichmentPending && (
        <CommentsDialog
          podcastId={podcast.id}
          podcastTitle={podcast.title || podcast.topic}
          podcastOwnerId={podcast.userId || undefined}
          isPublic={podcast.isPublic}
          open={showCommentsFromPreview}
          onOpenChange={setShowCommentsFromPreview}
          hideTrigger
        />
      )}
    </>
  );
}
