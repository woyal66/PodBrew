import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Plus, Library, ListMusic, Mic2, Trash2, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PodcastCard } from "@/components/podcast-card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { GeneratedPodcast, Playlist, EnrichedPodcast, PodcastEngagement, PodcastLike, PodcastTopComment } from "@shared/schema";

function getTabFromPath(path: string): string {
  if (path.includes('/playlists')) return 'playlists';
  return 'podcasts';
}

function PodcastCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-square bg-muted animate-pulse" />
      <CardContent className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const [, setLocation] = useLocation();
  
  return (
    <Card 
      className="group cursor-pointer hover-elevate transition-all overflow-hidden"
      onClick={() => setLocation(`/playlist/${playlist.id}`)}
      data-testid={`playlist-card-${playlist.id}`}
    >
      <div className="aspect-square bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center relative">
        {playlist.coverImageUrl ? (
          <img src={playlist.coverImageUrl} alt={playlist.name} className="w-full h-full object-cover" />
        ) : (
          <ListMusic className="h-12 w-12 text-primary/50" />
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Button size="icon" className="rounded-full bg-primary text-primary-foreground h-12 w-12">
            <Play className="h-5 w-5 ml-0.5" />
          </Button>
        </div>
      </div>
      <CardContent className="p-3">
        <h3 className="font-medium truncate">{playlist.name}</h3>
        <p className="text-sm text-muted-foreground">
          {playlist.description || 'Playlist'}
        </p>
      </CardContent>
    </Card>
  );
}

const PAGE_SIZE = 20;

export default function LibraryPage() {
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath(location));
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistDescription, setPlaylistDescription] = useState("");
  const { toast } = useToast();
  
  useEffect(() => {
    setActiveTab(getTabFromPath(location));
  }, [location]);
  
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    if (newTab === 'podcasts') {
      setLocation('/listen/library');
    } else if (newTab === 'playlists') {
      setLocation('/listen/playlists');
    }
  };
  
  const {
    data: mineData,
    isLoading: isLoadingPodcasts,
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
    // Bumped from 30s → 5min (Task #102). The slim payload is mostly
    // immutable (topic/title/cover/audio/duration), and any user-driven
    // mutation (delete, toggle visibility, edit, new podcast) explicitly
    // invalidates this key — so the longer staleTime cuts redundant
    // refetches without making the library look stale.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    retry: 2,
  });

  const myPodcasts = mineData?.pages.flatMap(p => p.podcasts) ?? [];
  const myPodcastsTotal = mineData?.pages[0]?.total ?? 0;

  // Phase-2: batch-enrich all visible library podcasts so cards don't fire
  // their own /like, /engagement, /top-comment queries.
  const [enrichmentMap, setEnrichmentMap] = useState<Map<string, { engagement: PodcastEngagement | null; topComment: PodcastTopComment; userLike: PodcastLike | null }>>(new Map());
  // Tracks IDs that have already been requested (in-flight or completed) so
  // load-more pages only fetch the *new* IDs and we never re-batch the
  // original page. Doubles as the "in-flight reservation" set during a
  // pending request — entries are released only on error so a failed batch
  // can be retried on the next render.
  const requestedIdsRef = useRef<Set<string>>(new Set());

  const guestId = useMemo(() => {
    try { return localStorage.getItem('podbrew_guest_session_token') || undefined; } catch { return undefined; }
  }, []);

  // Pending = any visible podcast lacks an enrichment entry. Derived (not state)
  // so the very first render with new podcasts is already "pending", keeping
  // PodcastCards in the skeleton/disabled-query state until the batch returns.
  // This prevents the race where per-card /like, /engagement, /top-comment
  // queries fire before the useEffect below schedules the batch.
  const enrichmentPending = useMemo(
    () => myPodcasts.some(p => !enrichmentMap.has(p.id)),
    [myPodcasts, enrichmentMap]
  );

  useEffect(() => {
    // Only request IDs we haven't already batched for. Load-more therefore
    // sends a small follow-up request for just the new page, not the full set.
    const seen = new Set<string>();
    const unenrichedIds: string[] = [];
    for (const p of myPodcasts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (requestedIdsRef.current.has(p.id)) continue;
      unenrichedIds.push(p.id);
    }
    if (unenrichedIds.length === 0) return;

    // Reserve these IDs immediately so a re-render before state settles
    // doesn't kick off a duplicate request.
    unenrichedIds.forEach(id => requestedIdsRef.current.add(id));

    // Batch in chunks of 100 to respect server's max-per-request limit.
    const chunks: string[][] = [];
    for (let i = 0; i < unenrichedIds.length; i += 100) {
      chunks.push(unenrichedIds.slice(i, i + 100));
    }

    type BatchEnrichmentResponse = { enrichments: Record<string, { engagement: PodcastEngagement | null; topComment: PodcastTopComment; userLike: PodcastLike | null }> };
    type ChunkOutcome = { ok: true; data: BatchEnrichmentResponse } | { ok: false; ids: string[] };

    // Guard against state updates after unmount.
    let cancelled = false;

    Promise.all(
      chunks.map(chunk =>
        fetch('/api/podcasts/batch-enrichment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ podcastIds: chunk, guestId }),
        })
          .then(async (r): Promise<ChunkOutcome> =>
            r.ok ? { ok: true, data: await r.json() as BatchEnrichmentResponse } : { ok: false, ids: chunk })
          .catch((): ChunkOutcome => ({ ok: false, ids: chunk }))
      )
    ).then(outcomes => {
      if (cancelled) return;

      // Release reservations for chunks that failed so a future render can
      // retry them (e.g. when load-more triggers a fresh effect run, or the
      // user navigates back and the page re-mounts). Successful chunks stay
      // reserved so we don't re-request them.
      for (const outcome of outcomes) {
        if (!outcome.ok) {
          outcome.ids.forEach(id => requestedIdsRef.current.delete(id));
        }
      }

      // Update local map. Successful entries get real data; failed-chunk IDs
      // are *not* added to the map (and were released above) so
      // `enrichmentPending` stays true for those podcasts and the next
      // render's effect will retry them.
      setEnrichmentMap(prev => {
        const next = new Map(prev);
        for (const outcome of outcomes) {
          if (!outcome.ok) continue;
          for (const [id, data] of Object.entries(outcome.data.enrichments)) {
            next.set(id, {
              engagement: data.engagement ?? null,
              topComment: data.topComment,
              userLike: data.userLike,
            });
          }
        }
        return next;
      });

      // Prime the React Query cache directly so any per-card useQuery in
      // PodcastCard / LikeDislikeButtons sees cached data and never makes
      // its own network call. We only seed when nothing is cached so we
      // don't clobber fresher mutation results (e.g. the user just liked).
      for (const outcome of outcomes) {
        if (!outcome.ok) continue;
        for (const [id, data] of Object.entries(outcome.data.enrichments)) {
          if (queryClient.getQueryData(["/api/podcasts", id, "engagement"]) === undefined) {
            queryClient.setQueryData(["/api/podcasts", id, "engagement"], { engagement: data.engagement });
          }
          if (queryClient.getQueryData(["/api/podcasts", id, "like"]) === undefined) {
            queryClient.setQueryData(["/api/podcasts", id, "like"], { like: data.userLike });
          }
          if (queryClient.getQueryData(["/api/podcasts", id, "top-comment"]) === undefined) {
            queryClient.setQueryData(["/api/podcasts", id, "top-comment"], { comment: data.topComment });
          }
        }
      }
    }).catch(() => {
      // Promise.all itself shouldn't reject (each chunk has .catch above),
      // but defend against unexpected errors by releasing all reservations
      // so the next render can retry.
      if (cancelled) return;
      unenrichedIds.forEach(id => requestedIdsRef.current.delete(id));
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineData, guestId]);

  const enrichedMyPodcasts: EnrichedPodcast[] = useMemo(() => {
    return myPodcasts.map(podcast => {
      const e = enrichmentMap.get(podcast.id);
      if (!e) return podcast as EnrichedPodcast;
      return {
        ...podcast,
        _engagement: e.engagement,
        _topComment: e.topComment,
        _userLike: e.userLike,
      };
    });
  }, [myPodcasts, enrichmentMap]);

  const { data: playlists = [], isLoading: isLoadingPlaylists } = useQuery<Playlist[]>({
    queryKey: ["/api/playlists"],
    staleTime: 0,
    refetchOnMount: 'always',
  });
  
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/podcasts/cleanup/old', {});
    },
    onSuccess: async (response) => {
      const data = await response.json();
      toast({
        title: "Cleanup complete",
        description: `Deleted ${data.deletedCount} podcast(s) older than 7 days`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup old podcasts",
        variant: "destructive",
      });
    },
  });

  const createPlaylistMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return await apiRequest('POST', '/api/playlists', data);
    },
    onSuccess: async () => {
      toast({
        title: "Playlist created",
        description: `"${playlistName}" has been created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      setIsCreateDialogOpen(false);
      setPlaylistName("");
      setPlaylistDescription("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create playlist",
        variant: "destructive",
      });
    },
  });

  const handleCreatePlaylist = () => {
    if (!playlistName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for your playlist",
        variant: "destructive",
      });
      return;
    }
    createPlaylistMutation.mutate({
      name: playlistName.trim(),
      description: playlistDescription.trim() || undefined,
    });
  };

  return (
    <div className="container max-w-7xl mx-auto px-4 py-6 space-y-6 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="library-title">
          Your Library
        </h1>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            data-testid="library-cleanup-button"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {cleanupMutation.isPending ? "Cleaning..." : "Delete Old"}
          </Button>
        </div>
      </div>
      
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="podcasts" data-testid="library-tab-podcasts">
            <Mic2 className="h-4 w-4 mr-2" />
            Podcasts
          </TabsTrigger>
          <TabsTrigger value="playlists" data-testid="library-tab-playlists">
            <ListMusic className="h-4 w-4 mr-2" />
            Playlists
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="podcasts" className="space-y-4">
          {isLoadingPodcasts && myPodcasts.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <PodcastCardSkeleton key={i} />
              ))}
            </div>
          ) : myPodcasts.length > 0 ? (
            <>
              {myPodcastsTotal > 0 && (
                <p className="text-sm text-muted-foreground mb-2">
                  Showing {myPodcasts.length} of {myPodcastsTotal} podcasts
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="library-podcasts-grid">
                {enrichedMyPodcasts.map((podcast, index) => (
                  <PodcastCard
                    key={podcast.id}
                    podcast={podcast}
                    enrichmentPending={enrichmentPending}
                    priority={index === 0}
                  />
                ))}
              </div>
              {hasNextPage && (
                <div className="flex justify-center pt-4">
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
            </>
          ) : (
            <div className="py-16 text-center">
              <Mic2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">No podcasts yet</p>
              <Button asChild>
                <Link href="/" data-testid="library-create-first">Create Your First Podcast</Link>
              </Button>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="playlists" className="space-y-4">
          {isLoadingPlaylists ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
              {Array.from({ length: 2 }).map((_, i) => (
                <PodcastCardSkeleton key={i} />
              ))}
            </div>
          ) : playlists.length > 0 ? (
            <>
              <div className="flex justify-end mb-4">
                <Button 
                  size="sm"
                  onClick={() => setIsCreateDialogOpen(true)}
                  data-testid="library-create-playlist-header"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Playlist
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6" data-testid="library-playlists-grid">
                {playlists.map((playlist) => (
                  <PlaylistCard key={playlist.id} playlist={playlist} />
                ))}
              </div>
            </>
          ) : (
            <div className="py-16 text-center">
              <ListMusic className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">No playlists yet</p>
              <Button 
                onClick={() => setIsCreateDialogOpen(true)}
                data-testid="library-create-playlist"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Playlist
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="bg-background/60 backdrop-blur-md border-border/50">
          <DialogHeader>
            <DialogTitle>Create Playlist</DialogTitle>
            <DialogDescription>
              Create a new playlist to organize your favorite podcasts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="playlist-name">Name *</Label>
              <Input
                id="playlist-name"
                placeholder="My Awesome Playlist"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                data-testid="input-playlist-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="playlist-description">Description (optional)</Label>
              <Textarea
                id="playlist-description"
                placeholder="Add an optional description..."
                value={playlistDescription}
                onChange={(e) => setPlaylistDescription(e.target.value)}
                rows={3}
                data-testid="textarea-playlist-description"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              data-testid="button-cancel-playlist"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePlaylist}
              disabled={createPlaylistMutation.isPending || !playlistName.trim()}
              data-testid="button-submit-playlist"
            >
              {createPlaylistMutation.isPending ? "Creating..." : "Create Playlist"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
