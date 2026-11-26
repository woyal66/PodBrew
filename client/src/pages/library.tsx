import { useState } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { PodcastCard } from "@/components/podcast-card";
import { PodcastCardSkeleton } from "@/components/PodcastCardSkeleton";
import { Music2, History, Plus, Trash2, ListMusic, Play, MoreHorizontal, Pencil, Loader2, LibraryIcon, Sparkles, ArrowRight, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { GeneratedPodcast, Playlist } from "@shared/schema";
import { useAuth } from "@/contexts/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { VoiceLibrary } from "@/components/voice-library";

function LibraryEmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  const { data: featuredPodcasts, isLoading: isFeaturedLoading } = useQuery<GeneratedPodcast[]>({
    queryKey: ["/api/podcasts", "featured"],
    queryFn: async () => {
      const res = await fetch("/api/podcasts?limit=4&sort=trending");
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div className="space-y-8" data-testid="library-empty-state">
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-6">
          <Sparkles className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Your podcast library is empty</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          Create your first AI-generated podcast in seconds. It's completely free to try!
        </p>
        <Button 
          size="lg" 
          onClick={onCreateClick}
          className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
          data-testid="button-create-first-podcast"
        >
          <Plus className="w-5 h-5" />
          Create Your First Podcast - It's Free!
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Get Inspired</h3>
          <Button variant="ghost" size="sm" className="gap-1" asChild>
            <a href="/listen">
              Explore More <ArrowRight className="w-4 h-4" />
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Check out what others have created with PodBrew
        </p>
        
        {isFeaturedLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <PodcastCardSkeleton key={index} />
            ))}
          </div>
        ) : featuredPodcasts && featuredPodcasts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
            {featuredPodcasts.slice(0, 4).map((podcast) => (
              <PodcastCard key={podcast.id} podcast={podcast} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No podcasts to show yet. Be the first to create one!</p>
          </div>
        )}
      </div>
    </div>
  );
}

type TabType = 'playlists' | 'all' | 'voices' | 'history';

interface PlaylistCardProps {
  playlist: Playlist;
  itemCount?: number;
  onPlay?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function PlaylistCard({ playlist, itemCount = 0, onPlay, onEdit, onDelete }: PlaylistCardProps) {
  const [, setLocation] = useLocation();
  
  return (
    <Card 
      className="group relative overflow-hidden hover-elevate cursor-pointer"
      onClick={() => setLocation(`/playlist/${playlist.id}`)}
      data-testid={`card-playlist-${playlist.id}`}
    >
      <CardContent className="p-4 flex gap-4">
        <div className="w-20 h-20 md:w-24 md:h-24 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0 relative">
          {playlist.coverImageUrl ? (
            <img 
              src={playlist.coverImageUrl} 
              alt={playlist.name}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <ListMusic className="w-8 h-8 text-primary" />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay?.();
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"
            data-testid={`button-play-playlist-${playlist.id}`}
          >
            <Play className="w-8 h-8 text-white fill-white" />
          </button>
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg truncate" data-testid={`text-playlist-name-${playlist.id}`}>
            {playlist.name}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {playlist.description || "No description"}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span>{itemCount} {itemCount === 1 ? 'podcast' : 'podcasts'}</span>
            {playlist.isPublic && (
              <span className="px-1.5 py-0.5 bg-primary/20 text-primary rounded text-xs">Public</span>
            )}
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button 
              variant="ghost" 
              size="icon" 
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid={`button-playlist-menu-${playlist.id}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit?.()} data-testid={`button-edit-playlist-${playlist.id}`}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit Playlist
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => onDelete?.()} 
              className="text-destructive"
              data-testid={`button-delete-playlist-${playlist.id}`}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Playlist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

interface CreatePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editPlaylist?: Playlist | null;
}

function CreatePlaylistDialog({ open, onOpenChange, editPlaylist }: CreatePlaylistDialogProps) {
  const [name, setName] = useState(editPlaylist?.name || "");
  const [description, setDescription] = useState(editPlaylist?.description || "");
  const [isPublic, setIsPublic] = useState(editPlaylist?.isPublic || false);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const isEditing = !!editPlaylist;
  
  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; isPublic: boolean }) => {
      if (isEditing) {
        return await apiRequest('PATCH', `/api/playlists/${editPlaylist.id}`, data);
      }
      return await apiRequest('POST', '/api/playlists', data);
    },
    onSuccess: () => {
      toast({
        title: isEditing ? "Playlist updated" : "Playlist created",
        description: isEditing ? `"${name}" has been updated` : `"${name}" has been added to your library`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditing ? 'update' : 'create'} playlist`,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setIsPublic(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      isPublic,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {isEditing ? 'Edit Playlist' : 'Create New Playlist'}
          </DialogTitle>
          <DialogDescription>
            {isEditing 
              ? 'Update your playlist details below.'
              : 'Give your playlist a name and optional description.'
            }
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="playlist-name">Name</Label>
            <Input
              id="playlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Playlist"
              maxLength={100}
              data-testid="input-playlist-name"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="playlist-description">Description (optional)</Label>
            <Textarea
              id="playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this playlist about?"
              rows={3}
              data-testid="input-playlist-description"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="playlist-public">Make it public</Label>
              <p className="text-xs text-muted-foreground">
                Others can discover and play this playlist
              </p>
            </div>
            <Switch
              id="playlist-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
              data-testid="switch-playlist-public"
            />
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-playlist"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!name.trim() || createMutation.isPending}
              data-testid="button-save-playlist"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEditing ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                isEditing ? 'Save Changes' : 'Create Playlist'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 20;

export default function Library() {
  const [activeTab, setActiveTab] = useState<TabType>('playlists');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: playlists = [], isLoading: isLoadingPlaylists } = useQuery<Playlist[]>({
    queryKey: ["/api/playlists"],
    placeholderData: [],
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const {
    data: mineData,
    isLoading: isLoadingMine,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<{ podcasts: GeneratedPodcast[], total: number }>({
    queryKey: ["/api/podcasts/mine"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      const res = await fetch(`/api/podcasts/mine?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + p.podcasts.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    retry: 2,
  });

  const myPodcasts = mineData?.pages.flatMap(p => p.podcasts) ?? [];
  const myPodcastsTotal = mineData?.pages[0]?.total ?? 0;

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/podcasts/cleanup/old', {});
    },
    onSuccess: (data: any) => {
      toast({
        title: "Cleanup complete",
        description: `Deleted ${data.deletedCount} podcast(s) older than 7 days`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup old podcasts",
        variant: "destructive",
      });
    },
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      return await apiRequest('DELETE', `/api/playlists/${playlistId}`, {});
    },
    onSuccess: () => {
      toast({
        title: "Playlist deleted",
        description: "The playlist has been removed from your library",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete playlist",
        variant: "destructive",
      });
    },
  });

  const { data: favorites = [], isLoading: isLoadingFavorites } = useQuery<GeneratedPodcast[]>({
    queryKey: ["/api/podcasts/favorites"],
    placeholderData: [],
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: continueListening = [], isLoading: isLoadingHistory } = useQuery<GeneratedPodcast[]>({
    queryKey: ["/api/podcasts/continue-listening"],
    placeholderData: [],
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const tabs = [
    { id: 'playlists' as TabType, label: 'Playlists', icon: Music2 },
    { id: 'all' as TabType, label: 'All', icon: LibraryIcon },
    { id: 'voices' as TabType, label: 'Voices', icon: Mic2 },
    { id: 'history' as TabType, label: 'History', icon: History },
  ];

  const isLoading = activeTab === 'playlists' ? isLoadingPlaylists : 
                    activeTab === 'all' ? isLoadingMine :
                    isLoadingHistory;

  const podcasts = activeTab === 'all' ? myPodcasts : continueListening;

  const emptyStateMessages = {
    playlists: {
      title: "No playlists yet",
      description: "Create your first playlist to organize your favorite podcasts",
    },
    all: {
      title: "No podcasts yet",
      description: "Generated podcasts will appear here",
    },
    history: {
      title: "No listening history",
      description: "Podcasts you've listened to will appear here",
    },
  };

  const handleEditPlaylist = (playlist: Playlist) => {
    setEditingPlaylist(playlist);
    setShowCreateDialog(true);
  };

  const handleDeletePlaylist = (playlist: Playlist) => {
    if (window.confirm(`Are you sure you want to delete "${playlist.name}"?`)) {
      deletePlaylistMutation.mutate(playlist.id);
    }
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    setLocation(`/playlist/${playlist.id}`);
  };

  const handleCloseDialog = () => {
    setShowCreateDialog(false);
    setEditingPlaylist(null);
  };

  return (
    <>
      <Helmet>
        <title>Your Podcast Library | PodBrew</title>
        <meta name="description" content="Access your personal podcast library. Manage playlists, view your generated podcasts, liked episodes, and listening history all in one place." />
        <meta property="og:title" content="Your Podcast Library | PodBrew" />
        <meta property="og:description" content="Access your personal podcast library. Manage playlists, view your generated podcasts, and listening history." />
        <meta property="og:url" content="https://podbrew.pro/library" />
        <meta name="twitter:title" content="Your Podcast Library | PodBrew" />
        <meta name="twitter:description" content="Access your personal podcast library. Manage playlists, view your generated podcasts, and listening history." />
        <link rel="canonical" href="https://podbrew.pro/library" />
      </Helmet>
      <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background pb-20 md:pb-8 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(29,185,84,0.15),transparent_50%)] pointer-events-none" />
        <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pt-14 md:pt-16 max-w-5xl">
          <div className="mb-6">
            <h1 className="text-3xl md:text-4xl font-bold mb-2" data-testid="text-library-title">
              Your Library
            </h1>
          <p className="text-muted-foreground" data-testid="text-library-subtitle">
            Manage your playlists, podcasts, and listening history
          </p>
        </div>

        <div className="flex gap-2 mb-6 bg-card/50 p-1.5 rounded-lg border w-full sm:w-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex-1 sm:flex-none px-2 sm:px-3 h-8 flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 text-xs sm:text-sm"
                    data-testid={`button-tab-${tab.id}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline whitespace-nowrap">{tab.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">
                  {tab.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {activeTab === 'playlists' && (
          <div className="mb-6 flex gap-2">
            <Button
              onClick={() => setShowCreateDialog(true)}
              data-testid="button-create-playlist"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Playlist
            </Button>
            <Button
              variant="outline"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
              data-testid="button-cleanup-old-podcasts"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {cleanupMutation.isPending ? "Cleaning..." : "Delete Old"}
            </Button>
          </div>
        )}

        {activeTab === 'playlists' ? (
          <>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="loading-playlists">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Card key={index} className="animate-pulse">
                    <CardContent className="p-4 flex gap-4">
                      <div className="w-20 h-20 md:w-24 md:h-24 rounded-lg bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-5 bg-muted rounded w-3/4" />
                        <div className="h-4 bg-muted rounded w-1/2" />
                        <div className="h-3 bg-muted rounded w-1/4" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : playlists.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[300px] text-center px-4" data-testid="empty-playlists">
                <ListMusic className="w-16 h-16 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">{emptyStateMessages.playlists.title}</p>
                <p className="text-muted-foreground mb-4">{emptyStateMessages.playlists.description}</p>
                <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-playlist">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Playlist
                </Button>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold" data-testid="text-playlists-section">Your Playlists</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="playlists-gallery">
                    {playlists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        onPlay={() => handlePlayPlaylist(playlist)}
                        onEdit={() => handleEditPlaylist(playlist)}
                        onDelete={() => handleDeletePlaylist(playlist)}
                      />
                    ))}
                  </div>
                </div>
                
                {myPodcasts.length > 0 && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-semibold" data-testid="text-created-section">
                      Your Created Podcasts
                      {myPodcastsTotal > 0 && (
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                          ({myPodcasts.length} of {myPodcastsTotal})
                        </span>
                      )}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="created-gallery">
                      {myPodcasts.map((podcast) => (
                        <PodcastCard key={podcast.id} podcast={podcast} />
                      ))}
                    </div>
                    {hasNextPage && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="outline"
                          onClick={() => fetchNextPage()}
                          disabled={isFetchingNextPage}
                          data-testid="button-load-more-podcasts"
                        >
                          {isFetchingNextPage ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                          ) : (
                            `Load more (${myPodcastsTotal - myPodcasts.length} remaining)`
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : activeTab === 'voices' ? (
          <div data-testid="voices-tab-content">
            <VoiceLibrary />
          </div>
        ) : (
          <>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="loading-library">
                {Array.from({ length: 6 }).map((_, index) => (
                  <PodcastCardSkeleton key={index} />
                ))}
              </div>
            ) : podcasts.length === 0 ? (
              activeTab === 'all' ? (
                <LibraryEmptyState onCreateClick={() => setLocation('/')} />
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-4" data-testid={`empty-${activeTab}`}>
                  <p className="text-lg text-muted-foreground">
                    {emptyStateMessages[activeTab].title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {emptyStateMessages[activeTab].description}
                  </p>
                </div>
              )
            ) : (
              <>
                {activeTab === 'all' && myPodcastsTotal > 0 && (
                  <p className="text-sm text-muted-foreground mb-2">
                    Showing {myPodcasts.length} of {myPodcastsTotal} podcasts
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid={`${activeTab}-gallery`}>
                  {podcasts.map((podcast) => (
                    <PodcastCard key={podcast.id} podcast={podcast} />
                  ))}
                </div>
                {activeTab === 'all' && hasNextPage && (
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="outline"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      data-testid="button-load-more-all"
                    >
                      {isFetchingNextPage ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                      ) : (
                        `Load more (${myPodcastsTotal - myPodcasts.length} remaining)`
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <CreatePlaylistDialog
        open={showCreateDialog}
        onOpenChange={handleCloseDialog}
        editPlaylist={editingPlaylist}
      />
    </div>
    </>
  );
}
