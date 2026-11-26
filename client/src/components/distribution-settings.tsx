import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  Rss, 
  Plus, 
  Copy, 
  Check, 
  Loader2, 
  ExternalLink, 
  Trash2,
  ChevronDown,
  ChevronRight,
  Music2,
  Mic2,
  Clock
} from "lucide-react";
import { SiSpotify, SiApplepodcasts } from "react-icons/si";
import type { PodcastShow, GeneratedPodcast, ShowEpisode } from "@shared/schema";

const RSS_CATEGORIES = [
  { name: 'Arts', subcategories: ['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts'] },
  { name: 'Business', subcategories: ['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit'] },
  { name: 'Comedy', subcategories: ['Comedy Interviews', 'Improv', 'Stand-Up'] },
  { name: 'Education', subcategories: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'] },
  { name: 'Health & Fitness', subcategories: ['Alternative Health', 'Fitness', 'Medicine', 'Mental Health', 'Nutrition'] },
  { name: 'History', subcategories: [] },
  { name: 'News', subcategories: ['Business News', 'Daily News', 'Entertainment News', 'News Commentary', 'Politics', 'Sports News', 'Tech News'] },
  { name: 'Science', subcategories: ['Astronomy', 'Chemistry', 'Earth Sciences', 'Life Sciences', 'Mathematics', 'Physics'] },
  { name: 'Society & Culture', subcategories: ['Documentary', 'Personal Journals', 'Philosophy', 'Places & Travel', 'Relationships'] },
  { name: 'Sports', subcategories: ['Baseball', 'Basketball', 'Football', 'Golf', 'Hockey', 'Soccer', 'Tennis'] },
  { name: 'Technology', subcategories: ['AI & Data Science', 'Gadgets', 'Tech News', 'Programming', 'Software How-To'] },
  { name: 'True Crime', subcategories: [] },
];

interface ShowWithEpisodes extends PodcastShow {
  episodes?: Array<ShowEpisode & { podcast: GeneratedPodcast }>;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function ShowCard({ 
  show, 
  onDelete, 
  onCopyFeed, 
  isCopied 
}: { 
  show: ShowWithEpisodes; 
  onDelete: () => void;
  onCopyFeed: () => void;
  isCopied: boolean;
}) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [showAddEpisodeModal, setShowAddEpisodeModal] = useState(false);

  const { data: showDetails } = useQuery<ShowWithEpisodes>({
    queryKey: ["/api/shows", show.id],
    enabled: isOpen,
  });

  const { data: mineResponse } = useQuery<{ podcasts: GeneratedPodcast[], total: number }>({
    queryKey: ["/api/podcasts/mine", "preview"],
    queryFn: async () => {
      const res = await fetch('/api/podcasts/mine?limit=50&offset=0', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: showAddEpisodeModal,
    // Bumped staleTime to 5min (Task #102 parity). Mutations invalidate
    // this key explicitly so users still see fresh data after edits.
    staleTime: 5 * 60 * 1000,
  });
  const userPodcasts = mineResponse?.podcasts ?? [];

  const addEpisodeMutation = useMutation({
    mutationFn: async ({ podcastId, episodeNumber }: { podcastId: string; episodeNumber?: number }) => {
      const response = await apiRequest("POST", `/api/shows/${show.id}/episodes`, { 
        podcastId,
        episodeNumber 
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shows", show.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/shows"] });
      setShowAddEpisodeModal(false);
      toast({
        title: "Episode added",
        description: "Your podcast has been added to the show.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add episode",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeEpisodeMutation = useMutation({
    mutationFn: async (podcastId: string) => {
      await apiRequest("DELETE", `/api/shows/${show.id}/episodes/${podcastId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shows", show.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/shows"] });
      toast({
        title: "Episode removed",
        description: "The episode has been removed from this show.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove episode",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const episodes = showDetails?.episodes || [];
  const episodeIds = new Set(episodes.map(e => e.podcastId));
  const availablePodcasts = userPodcasts?.filter(p => 
    !episodeIds.has(p.id) && p.audioUrl
  ) || [];

  return (
    <>
      <Card className="overflow-hidden" data-testid={`card-show-${show.id}`}>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="p-4">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
                <Rss className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h5 className="font-semibold truncate">{show.name}</h5>
                  {show.category && (
                    <Badge variant="secondary" className="text-xs">{show.category}</Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {episodes.length} episode{episodes.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {show.description || "No description yet"}
                </p>
                
                <div className="flex items-center gap-2 mt-3">
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                    {window.location.origin}/rss/{show.id}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyFeed();
                    }}
                    data-testid={`button-copy-feed-${show.id}`}
                  >
                    {isCopied ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center gap-1 shrink-0">
                <CollapsibleTrigger asChild>
                  <Button size="icon" variant="ghost" data-testid={`button-expand-show-${show.id}`}>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onDelete}
                  className="text-muted-foreground hover:text-destructive"
                  data-testid={`button-delete-show-${show.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          
          <CollapsibleContent>
            <div className="border-t bg-muted/30 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h6 className="text-sm font-medium">Episodes</h6>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setShowAddEpisodeModal(true)}
                  data-testid={`button-add-episode-${show.id}`}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Episode
                </Button>
              </div>
              
              {episodes.length > 0 ? (
                <div className="space-y-2">
                  {episodes.map((episode) => (
                    <div 
                      key={episode.id} 
                      className="flex items-center gap-3 p-3 bg-background rounded-lg border"
                      data-testid={`episode-${episode.id}`}
                    >
                      {episode.podcast.coverImageUrl ? (
                        <img 
                          src={episode.podcast.coverImageUrl} 
                          alt={episode.podcast.topic}
                          className="w-10 h-10 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                          <Mic2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {episode.episodeNumber ? `Ep ${episode.episodeNumber}: ` : ''}
                          {episode.podcast.topic}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatDuration(Number(episode.podcast.duration) || 0)}</span>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeEpisodeMutation.mutate(episode.podcastId)}
                        disabled={removeEpisodeMutation.isPending}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-episode-${episode.id}`}
                      >
                        {removeEpisodeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Mic2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No episodes yet. Add podcasts from your library!</p>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Dialog open={showAddEpisodeModal} onOpenChange={setShowAddEpisodeModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Episode to {show.name}</DialogTitle>
            <DialogDescription>
              Select a podcast from your library to add to this show.
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[400px]">
            {availablePodcasts.length > 0 ? (
              <div className="space-y-2 pr-4">
                {availablePodcasts.map((podcast) => (
                  <div 
                    key={podcast.id} 
                    className="flex items-center gap-3 p-3 rounded-lg border hover-elevate cursor-pointer"
                    onClick={() => addEpisodeMutation.mutate({ 
                      podcastId: podcast.id,
                      episodeNumber: episodes.length + 1
                    })}
                    data-testid={`podcast-option-${podcast.id}`}
                  >
                    {podcast.coverImageUrl ? (
                      <img 
                        src={podcast.coverImageUrl} 
                        alt={podcast.topic}
                        className="w-12 h-12 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                        <Mic2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{podcast.topic}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{formatDuration(Number(podcast.duration) || 0)}</span>
                        <span className="text-muted-foreground/50">|</span>
                        <span>{podcast.templateCategory || 'Custom'}</span>
                      </div>
                    </div>
                    {addEpisodeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Mic2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No podcasts available to add.</p>
                <p className="text-xs mt-1">Create more podcasts or check if they're already in this show.</p>
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEpisodeModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DistributionSettings() {
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<string | null>(null);
  const [copiedFeedId, setCopiedFeedId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    author: "",
    category: "",
    subcategory: "",
    explicit: false,
  });

  const { data: shows, isLoading } = useQuery<PodcastShow[]>({
    queryKey: ["/api/shows"],
  });

  const createShowMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/shows", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shows"] });
      setShowCreateModal(false);
      setFormData({ name: "", description: "", author: "", category: "", subcategory: "", explicit: false });
      toast({
        title: "Show created",
        description: "Your podcast show is ready for episodes!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create show",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteShowMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/shows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shows"] });
      setShowDeleteDialog(null);
      toast({
        title: "Show deleted",
        description: "Your podcast show has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete show",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyFeedUrl = (showId: string) => {
    const baseUrl = window.location.origin;
    const feedUrl = `${baseUrl}/rss/${showId}`;
    navigator.clipboard.writeText(feedUrl);
    setCopiedFeedId(showId);
    setTimeout(() => setCopiedFeedId(null), 2000);
    toast({
      title: "RSS Feed URL copied!",
      description: "Paste this URL in Spotify or Apple Podcasts.",
    });
  };

  const selectedCategory = RSS_CATEGORIES.find(c => c.name === formData.category);

  return (
    <div className="space-y-6">
      <Card className="p-6" data-testid="card-distribution-intro">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Rss className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Publish to Spotify & Apple Podcasts</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create a podcast show, add your episodes, and get an RSS feed URL to submit to Spotify, Apple Podcasts, and other platforms.
            </p>
            
            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SiSpotify className="h-5 w-5 text-[#1DB954]" />
                <span>Spotify</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SiApplepodcasts className="h-5 w-5 text-[#9933FF]" />
                <span>Apple Podcasts</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Music2 className="h-5 w-5 text-blue-500" />
                <span>& More</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold">Your Podcast Shows</h4>
          <Button 
            size="sm" 
            onClick={() => setShowCreateModal(true)}
            data-testid="button-create-show"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Show
          </Button>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </Card>
        ) : shows && shows.length > 0 ? (
          <div className="space-y-3">
            {shows.map((show) => (
              <ShowCard
                key={show.id}
                show={show}
                onDelete={() => setShowDeleteDialog(show.id)}
                onCopyFeed={() => copyFeedUrl(show.id)}
                isCopied={copiedFeedId === show.id}
              />
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Rss className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              No podcast shows yet. Create one to start distributing your podcasts!
            </p>
          </Card>
        )}
      </div>

      <Card className="p-6 bg-muted/50">
        <h4 className="font-semibold mb-3">How to Submit Your Podcast</h4>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">1</span>
            <span>Create a show above and copy the RSS feed URL</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">2</span>
            <span>Expand the show and add episodes from your library</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">3</span>
            <span>
              Submit your RSS URL to{" "}
              <a href="https://podcasters.spotify.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                Spotify for Podcasters <ExternalLink className="h-3 w-3" />
              </a>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">4</span>
            <span>
              Submit to{" "}
              <a href="https://podcastsconnect.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                Apple Podcasts Connect <ExternalLink className="h-3 w-3" />
              </a>
            </span>
          </li>
        </ol>
      </Card>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create Podcast Show</DialogTitle>
            <DialogDescription>
              Set up your podcast show for distribution to Spotify, Apple Podcasts, and more.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="show-name">Show Name *</Label>
              <Input
                id="show-name"
                value={formData.name}
                onChange={(e) => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="My Awesome Podcast"
                data-testid="input-show-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="show-description">Description</Label>
              <Textarea
                id="show-description"
                value={formData.description}
                onChange={(e) => setFormData(f => ({ ...f, description: e.target.value }))}
                placeholder="What's your podcast about?"
                rows={3}
                className="resize-none"
                data-testid="input-show-description"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="show-author">Author Name</Label>
              <Input
                id="show-author"
                value={formData.author}
                onChange={(e) => setFormData(f => ({ ...f, author: e.target.value }))}
                placeholder="Your name or brand"
                data-testid="input-show-author"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData(f => ({ ...f, category: value, subcategory: "" }))}
                >
                  <SelectTrigger data-testid="select-show-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {RSS_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.name} value={cat.name}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Subcategory</Label>
                <Select
                  value={formData.subcategory}
                  onValueChange={(value) => setFormData(f => ({ ...f, subcategory: value }))}
                  disabled={!selectedCategory || selectedCategory.subcategories.length === 0}
                >
                  <SelectTrigger data-testid="select-show-subcategory">
                    <SelectValue placeholder="Select subcategory" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedCategory?.subcategories.map((sub) => (
                      <SelectItem key={sub} value={sub}>
                        {sub}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="explicit">Explicit Content</Label>
                <p className="text-xs text-muted-foreground">Mark if your show contains explicit language</p>
              </div>
              <Switch
                id="explicit"
                checked={formData.explicit}
                onCheckedChange={(checked) => setFormData(f => ({ ...f, explicit: checked }))}
                data-testid="switch-show-explicit"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createShowMutation.mutate(formData)}
              disabled={!formData.name || createShowMutation.isPending}
              data-testid="button-create-show-submit"
            >
              {createShowMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Show"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Podcast Show?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the show and its RSS feed. Your podcast episodes will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => showDeleteDialog && deleteShowMutation.mutate(showDeleteDialog)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Show
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
