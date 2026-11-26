import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Download, Heart, SkipBack, SkipForward, Share2, Trash2, Globe, Lock, Link as LinkIcon, Code, Copy, Check, MessageSquare } from "lucide-react";
import { sharePodcast } from "@/lib/share";
import { Slider } from "@/components/ui/slider";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import type { GeneratedPodcast, User, CommentWithUser } from "@shared/schema";
import { Comments } from "@/components/comments";

interface PodcastModalProps {
  podcast: GeneratedPodcast;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMBED_SIZES = {
  small: { width: 320, height: 480, label: "Small" },
  medium: { width: 500, height: 600, label: "Medium" },
  large: { width: 720, height: 840, label: "Large" },
} as const;

type EmbedSize = keyof typeof EMBED_SIZES;

export function PodcastModal({ podcast, open, onOpenChange }: PodcastModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEmbedDialog, setShowEmbedDialog] = useState(false);
  const [embedSize, setEmbedSize] = useState<EmbedSize>("medium");
  const [embedCopied, setEmbedCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const { toast} = useToast();
  const { user } = useAuth();

  const { data: session, isLoading: sessionLoading } = useQuery<{ userId: string | null }>({
    queryKey: ["/api/session"],
  });

  const { data: currentUser } = useQuery<User>({
    queryKey: ["/api/user"],
    enabled: !!session?.userId,
  });

  const { data: fullPodcast } = useQuery<GeneratedPodcast>({
    queryKey: ["/api/podcasts", podcast.id],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${podcast.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  const citations = fullPodcast?.citations ?? podcast.citations ?? [];

  const { data: commentsData } = useQuery<{ comments: CommentWithUser[] }>({
    queryKey: ["/api/podcasts", podcast.id, "comments", "best"],
    queryFn: async () => {
      const response = await fetch(`/api/podcasts/${podcast.id}/comments?sort=best`, {
        credentials: "include",
      });
      if (!response.ok) return { comments: [] };
      return response.json();
    },
    enabled: podcast.isPublic && open,
  });

  const commentCount = commentsData?.comments?.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0) || 0;

  const isOwner = !sessionLoading && session && podcast.userId === session.userId;

  const toggleFavoriteMutation = useMutation<GeneratedPodcast, Error, boolean>({
    mutationFn: async (isFavorite) => {
      const response = await apiRequest("PATCH", `/api/podcasts/${podcast.id}/favorite`, { isFavorite });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/favorites"] });
    },
  });

  const toggleVisibilityMutation = useMutation<GeneratedPodcast>({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/podcasts/${podcast.id}/toggle-visibility`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
      toast({
        title: data.isPublic ? "Made Public" : "Made Private",
        description: data.isPublic ? "Your podcast is now visible to everyone" : "Your podcast is now private",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/podcasts/${podcast.id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/favorites"] });
      toast({
        title: "Podcast Deleted",
        description: "Your podcast has been permanently deleted",
      });
    },
  });

  useEffect(() => {
    const audio = audioRef.current;
    
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      
      const autoPlayPodcastId = localStorage.getItem('podbrew_autoplay_podcast');
      if (autoPlayPodcastId === podcast.id) {
        localStorage.removeItem('podbrew_autoplay_podcast');
        audio.play().then(() => {
          setIsPlaying(true);
        }).catch(() => {
          toast({
            title: "Ready to play",
            description: "Press play to start listening to your podcast",
          });
        });
      }
    };
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    if (open) {
      audio.src = podcast.audioUrl;
    }

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      setIsPlaying(false);
    };
  }, [podcast.audioUrl, podcast.id, open]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    audio.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  const handleSkip = (seconds: number) => {
    const audio = audioRef.current;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + seconds));
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = podcast.audioUrl;
    const podcastTitle = podcast.title || podcast.topic;
    link.download = `podcast-${podcastTitle.substring(0, 30).replace(/\s+/g, "-")}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    await sharePodcast({ podcast, toast });
  };

  const generateEmbedCode = () => {
    const size = EMBED_SIZES[embedSize];
    const embedUrl = `${window.location.origin}/embed/${podcast.id}`;
    const podcastTitle = podcast.title || podcast.topic;
    return `<iframe src="${embedUrl}" width="${size.width}" height="${size.height}" frameborder="0" allow="autoplay" title="${podcastTitle.replace(/"/g, '&quot;')}" style="max-width: 100%;"></iframe>`;
  };

  const handleCopyEmbedCode = async () => {
    const code = generateEmbedCode();
    
    try {
      await navigator.clipboard.writeText(code);
      setEmbedCopied(true);
      toast({
        title: "Embed Code Copied",
        description: "Paste the code into your website to embed this podcast",
      });
      setTimeout(() => setEmbedCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy embed code",
        variant: "destructive",
      });
    }
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    setShowDeleteDialog(false);
    onOpenChange(false);
    deleteMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid={`modal-podcast-${podcast.id}`}>
        <DialogHeader>
          <DialogTitle className="text-2xl pr-8" data-testid={`modal-title-${podcast.id}`}>{podcast.title || podcast.topic}</DialogTitle>
          <DialogDescription className="sr-only">
            Listen to this AI-generated podcast about {podcast.topic} with playback controls, sharing options, and engagement actions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="relative aspect-video bg-gradient-to-br from-primary/20 via-primary/10 to-background rounded-lg flex items-center justify-center overflow-hidden">
            {podcast.coverImageUrl ? (
              <img 
                src={podcast.coverImageUrl} 
                alt={`Cover art for ${podcast.title || podcast.topic}`}
                className="absolute inset-0 w-full h-full object-cover"
                data-testid={`modal-img-cover-${podcast.id}`}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center opacity-20">
                <svg className="w-64 h-64" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <rect
                      key={i}
                      x={i * 5}
                      y={50 - Math.random() * 40}
                      width="3"
                      height={Math.random() * 80}
                      fill="currentColor"
                      className="text-primary"
                      opacity={0.6}
                    />
                  ))}
                </svg>
              </div>
            )}

            <Button
              size="icon"
              variant="default"
              className="relative z-10 h-20 w-20 rounded-full shadow-xl"
              onClick={handlePlayPause}
              data-testid={`modal-button-play-${podcast.id}`}
            >
              {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 ml-1" />}
            </Button>
          </div>

          <div className="space-y-2">
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="cursor-pointer"
              data-testid={`modal-slider-${podcast.id}`}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span data-testid={`modal-current-time-${podcast.id}`}>{formatTime(currentTime)}</span>
              <span data-testid={`modal-duration-${podcast.id}`}>{duration ? formatTime(duration) : podcast.duration}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4">
            <Button
              size="icon"
              variant="outline"
              onClick={() => handleSkip(-10)}
              data-testid={`modal-button-skip-back-${podcast.id}`}
            >
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button
              size="icon"
              variant="outline"
              onClick={handlePlayPause}
              className="h-12 w-12"
              data-testid={`modal-button-play-large-${podcast.id}`}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </Button>

            <Button
              size="icon"
              variant="outline"
              onClick={() => handleSkip(10)}
              data-testid={`modal-button-skip-forward-${podcast.id}`}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {citations.length > 0 && (
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="sources">
                <AccordionTrigger className="text-sm font-medium" data-testid={`modal-sources-trigger-${podcast.id}`}>
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" />
                    <span>Sources Used</span>
                    <Badge variant="secondary" className="ml-2" data-testid={`modal-sources-count-${podcast.id}`}>
                      {citations.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pt-2">
                    {citations.map((citation, index) => (
                      <a
                        key={index}
                        href={citation}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 p-3 rounded-md bg-muted/50 hover-elevate active-elevate-2 text-sm group"
                        data-testid={`modal-source-link-${index}`}
                      >
                        <Badge variant="outline" className="shrink-0 mt-0.5">
                          {index + 1}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground group-hover:text-primary transition-colors break-all">
                            {citation}
                          </p>
                        </div>
                        <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      </a>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {citations.length === 0 && (
            <div className="py-4 text-center">
              <p className="text-sm text-muted-foreground" data-testid={`modal-no-sources-${podcast.id}`}>
                No sources available for this podcast
              </p>
            </div>
          )}

          {podcast.isPublic && (
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="comments">
                <AccordionTrigger className="text-sm font-medium" data-testid={`modal-comments-trigger-${podcast.id}`}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    <span>Comments</span>
                    <Badge variant="secondary" className="ml-2" data-testid={`modal-comments-count-${podcast.id}`}>
                      {commentCount}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pt-2 max-h-[400px] overflow-y-auto">
                    <Comments 
                      podcastId={podcast.id} 
                      podcastOwnerId={podcast.userId || undefined}
                      currentUser={currentUser || null}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground" data-testid={`modal-timestamp-${podcast.id}`}>
              Created {formatDistanceToNow(new Date(podcast.timestamp), { addSuffix: true })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleFavoriteMutation.mutate(!podcast.isFavorite)}
                data-testid={`modal-button-favorite-${podcast.id}`}
              >
                <Heart className={`h-4 w-4 mr-2 ${podcast.isFavorite ? "fill-primary text-primary" : ""}`} />
                {podcast.isFavorite ? "Favorited" : "Favorite"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                data-testid={`modal-button-download-${podcast.id}`}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              {user?.subscriptionPlan !== 'free' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  data-testid={`modal-button-share-${podcast.id}`}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
              )}
              {podcast.isPublic && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEmbedDialog(true)}
                  data-testid={`modal-button-embed-${podcast.id}`}
                >
                  <Code className="h-4 w-4 mr-2" />
                  Embed
                </Button>
              )}
              {!sessionLoading && isOwner && (
                <>
                  {(
                    (podcast.templateCategory !== 'medical' && podcast.templateCategory !== 'documents') ||
                    (podcast.isPublic && (podcast.templateCategory === 'medical' || podcast.templateCategory === 'documents'))
                  ) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleVisibilityMutation.mutate()}
                      disabled={toggleVisibilityMutation.isPending}
                      data-testid={`modal-button-toggle-visibility-${podcast.id}`}
                    >
                      {podcast.isPublic ? (
                        <><Globe className="h-4 w-4 mr-2" /> 
                        {(podcast.templateCategory === 'medical' || podcast.templateCategory === 'documents')
                          ? "Make Private"
                          : "Public"}
                        </>
                      ) : (
                        <><Lock className="h-4 w-4 mr-2" /> Private</>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    data-testid={`modal-button-delete-${podcast.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Podcast?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{podcast.title || podcast.topic}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="dialog-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="dialog-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showEmbedDialog} onOpenChange={setShowEmbedDialog}>
        <DialogContent className="sm:max-w-2xl" data-testid="dialog-embed" aria-describedby="embed-dialog-description">
          <DialogHeader>
            <DialogTitle>Embed Podcast</DialogTitle>
          </DialogHeader>
          <p id="embed-dialog-description" className="sr-only">
            Generate embed code to share this podcast on your website. Choose a size preset and copy the iframe code.
          </p>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Preview</label>
              <div className="border rounded-lg p-4 bg-muted/20" style={{ height: EMBED_SIZES[embedSize].height / 2 }}>
                <iframe
                  src={`${window.location.origin}/embed/${podcast.id}`}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  allow="autoplay"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  sandbox="allow-scripts allow-same-origin"
                  title={`Preview of ${podcast.title || podcast.topic}`}
                  className="rounded"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="embed-size">Size</label>
              <Select value={embedSize} onValueChange={(value) => setEmbedSize(value as EmbedSize)}>
                <SelectTrigger id="embed-size" data-testid="select-embed-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">
                    Small ({EMBED_SIZES.small.width}×{EMBED_SIZES.small.height})
                  </SelectItem>
                  <SelectItem value="medium">
                    Medium ({EMBED_SIZES.medium.width}×{EMBED_SIZES.medium.height})
                  </SelectItem>
                  <SelectItem value="large">
                    Large ({EMBED_SIZES.large.width}×{EMBED_SIZES.large.height})
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Tip: Use style="max-width: 100%;" for responsive embedding
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Embed Code</label>
              <div className="relative">
                <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto border" data-testid="code-embed">
                  <code>{generateEmbedCode()}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={handleCopyEmbedCode}
                  data-testid="button-copy-embed"
                >
                  {embedCopied ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This podcast is public and can be embedded on any website
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
