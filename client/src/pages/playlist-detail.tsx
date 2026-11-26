import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { ArrowLeft, Play, Pause, Shuffle, MoreHorizontal, Pencil, Trash2, Music2, Clock, ListMusic, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlaylistWithItems, GeneratedPodcast } from "@shared/schema";
import { useAuth } from "@/contexts/auth-context";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlaylistItemCardProps {
  item: { podcast: GeneratedPodcast; position: number };
  isPlaying: boolean;
  isCurrentTrack: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

function PlaylistItemCard({ item, isPlaying, isCurrentTrack, onPlay, onRemove }: PlaylistItemCardProps) {
  const { podcast, position } = item;
  
  return (
    <Card 
      className={`group hover-elevate transition-all ${isCurrentTrack ? 'ring-2 ring-primary' : ''}`}
      data-testid={`card-playlist-item-${podcast.id}`}
    >
      <CardContent className="p-3 flex items-center gap-3">
        <div className="text-sm text-muted-foreground w-6 text-center shrink-0">
          {position + 1}
        </div>
        
        <div 
          className="relative w-12 h-12 rounded overflow-hidden shrink-0 cursor-pointer"
          onClick={onPlay}
        >
          {podcast.coverImageUrl ? (
            <img 
              src={podcast.coverImageUrl} 
              alt={podcast.title ?? 'Podcast'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-primary/20 flex items-center justify-center">
              <Music2 className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            {isCurrentTrack && isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 text-white fill-white" />
            )}
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <Link href={`/podcasts/${podcast.id}`}>
            <h4 className="font-medium text-sm truncate hover:underline cursor-pointer" data-testid={`text-item-title-${podcast.id}`}>
              {podcast.title}
            </h4>
          </Link>
          <p className="text-xs text-muted-foreground truncate">
            {podcast.templateCategory || 'Custom'}
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {podcast.duration || '--:--'}
          </span>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                data-testid={`button-item-menu-${podcast.id}`}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/podcasts/${podcast.id}`}>
                  View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={onRemove}
                className="text-destructive"
                data-testid={`button-remove-item-${podcast.id}`}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Playlist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlaylistDetail() {
  const [, params] = useRoute("/playlist/:id");
  const [, setLocation] = useLocation();
  const playlistId = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const { state, play, pause } = useAudioPlayer();
  const { currentPodcast, isPlaying } = state;

  const { data: playlist, isLoading, error } = useQuery<PlaylistWithItems>({
    queryKey: ["/api/playlists", playlistId],
    enabled: !!playlistId,
  });

  const removeFromPlaylistMutation = useMutation({
    mutationFn: async (podcastId: string) => {
      return await apiRequest('DELETE', `/api/playlists/${playlistId}/items/${podcastId}`, {});
    },
    onSuccess: () => {
      toast({
        title: "Removed from playlist",
        description: "The podcast has been removed from this playlist",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists", playlistId] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove from playlist",
        variant: "destructive",
      });
    },
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('DELETE', `/api/playlists/${playlistId}`, {});
    },
    onSuccess: () => {
      toast({
        title: "Playlist deleted",
        description: "The playlist has been removed from your library",
      });
      setLocation('/library');
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete playlist",
        variant: "destructive",
      });
    },
  });

  const handlePlayAll = () => {
    if (!playlist || playlist.items.length === 0) return;
    play(playlist.items[0].podcast, true, true);
  };

  const handleShuffle = () => {
    if (!playlist || playlist.items.length === 0) return;
    const podcasts = [...playlist.items.map(item => item.podcast)];
    const randomIndex = Math.floor(Math.random() * podcasts.length);
    play(podcasts[randomIndex], true, true);
  };

  const handlePlayItem = (podcast: GeneratedPodcast) => {
    if (currentPodcast?.id === podcast.id) {
      if (isPlaying) {
        pause();
      } else {
        play(podcast, false, true);
      }
    } else {
      play(podcast, true, true);
    }
  };

  const handleShare = async () => {
    if (!playlist) return;
    
    const shareUrl = `${window.location.origin}/playlist/${playlist.id}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: playlist.name,
          text: playlist.description || `Check out this playlist: ${playlist.name}`,
          url: shareUrl,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          await navigator.clipboard.writeText(shareUrl);
          toast({ title: "Link copied to clipboard" });
        }
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied to clipboard" });
    }
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete "${playlist?.name}"?`)) {
      deletePlaylistMutation.mutate();
    }
  };

  const isOwner = playlist?.userId === user?.id;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background pb-20 md:pb-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pt-14 md:pt-16 max-w-4xl">
          <Skeleton className="w-24 h-8 mb-6" />
          <div className="flex flex-col md:flex-row gap-6 mb-8">
            <Skeleton className="w-48 h-48 rounded-lg" />
            <div className="flex-1 space-y-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/4" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-10" />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Skeleton className="w-6 h-4" />
                  <Skeleton className="w-12 h-12 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="w-12 h-4" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background flex items-center justify-center">
        <div className="text-center">
          <ListMusic className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Playlist not found</h2>
          <p className="text-muted-foreground mb-4">This playlist may have been deleted or you don't have access to it.</p>
          <Button onClick={() => setLocation('/library')}>
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background pb-20 md:pb-8 relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(29,185,84,0.15),transparent_50%)] pointer-events-none" />
      
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pt-14 md:pt-16 max-w-4xl">
        <Button
          variant="ghost"
          onClick={() => setLocation('/library')}
          className="mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Library
        </Button>

        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <div className="w-48 h-48 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0 mx-auto md:mx-0">
            {playlist.coverImageUrl ? (
              <img 
                src={playlist.coverImageUrl} 
                alt={playlist.name}
                className="w-full h-full object-cover rounded-lg"
              />
            ) : (
              <ListMusic className="w-16 h-16 text-primary" />
            )}
          </div>
          
          <div className="flex-1 text-center md:text-left">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">Playlist</p>
            <h1 className="text-3xl md:text-4xl font-bold mb-2" data-testid="text-playlist-title">
              {playlist.name}
            </h1>
            {playlist.description && (
              <p className="text-muted-foreground mb-3" data-testid="text-playlist-description">
                {playlist.description}
              </p>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground justify-center md:justify-start mb-4">
              <span>{playlist.itemCount} {playlist.itemCount === 1 ? 'podcast' : 'podcasts'}</span>
              <span>{playlist.totalDuration}</span>
              {playlist.isPublic && (
                <span className="px-2 py-0.5 bg-primary/20 text-primary rounded text-xs">Public</span>
              )}
            </div>
            
            <div className="flex items-center gap-2 justify-center md:justify-start flex-wrap">
              <Button
                onClick={handlePlayAll}
                disabled={playlist.items.length === 0}
                data-testid="button-play-all"
              >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Play All
              </Button>
              <Button
                variant="outline"
                onClick={handleShuffle}
                disabled={playlist.items.length === 0}
                data-testid="button-shuffle"
              >
                <Shuffle className="w-4 h-4 mr-2" />
                Shuffle
              </Button>
              
              {isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" data-testid="button-playlist-options">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleShare}>
                      <Share2 className="w-4 h-4 mr-2" />
                      Share Playlist
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation(`/library?edit=${playlist.id}`)}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Playlist
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleDelete}
                      className="text-destructive"
                      data-testid="button-delete-playlist"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Playlist
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        {playlist.items.length === 0 ? (
          <div className="text-center py-12" data-testid="empty-playlist-items">
            <Music2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">This playlist is empty</p>
            <p className="text-sm text-muted-foreground">Add podcasts from the Listen or Library pages</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="playlist-items">
            {playlist.items.map((item) => (
              <PlaylistItemCard
                key={item.podcast.id}
                item={{ podcast: item.podcast, position: item.position }}
                isPlaying={isPlaying}
                isCurrentTrack={currentPodcast?.id === item.podcast.id}
                onPlay={() => handlePlayItem(item.podcast)}
                onRemove={() => removeFromPlaylistMutation.mutate(item.podcast.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
