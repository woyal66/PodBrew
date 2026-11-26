import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GeneratedPodcast } from "@shared/schema";

interface PodcastEditModalProps {
  podcast: GeneratedPodcast;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PodcastEditModal({ podcast, open, onOpenChange }: PodcastEditModalProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(podcast.title || "");
  const [description, setDescription] = useState("");

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

  useEffect(() => {
    if (open) {
      setTitle(podcast.title || "");
      setDescription(fullPodcast?.description ?? podcast.description ?? "");
    }
  }, [open, podcast, fullPodcast]);

  const savedDescription = fullPodcast?.description ?? podcast.description ?? "";

  const updateMutation = useMutation<GeneratedPodcast, Error, { title?: string; description?: string }>({
    mutationFn: async (data) => {
      const response = await apiRequest("PATCH", `/api/podcasts/${podcast.id}/metadata`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcast.id] });
      toast({
        title: "Podcast updated",
        description: "Your changes have been saved.",
      });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error.message || "Could not update podcast. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const updates: { title?: string; description?: string } = {};

    if (title !== (podcast.title || "")) {
      updates.title = title;
    }
    if (description !== savedDescription) {
      updates.description = description;
    }

    if (Object.keys(updates).length === 0) {
      onOpenChange(false);
      return;
    }

    updateMutation.mutate(updates);
  };

  const hasChanges = title !== (podcast.title || "") || description !== savedDescription;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Podcast</DialogTitle>
          <DialogDescription>
            Update the title and description for RSS distribution and sharing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="podcast-title">Title</Label>
            <Input
              id="podcast-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a catchy title"
              maxLength={200}
              data-testid="input-podcast-title"
            />
            <p className="text-xs text-muted-foreground">
              {title.length}/200 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="podcast-description">Description</Label>
            <Textarea
              id="podcast-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this episode is about..."
              rows={4}
              maxLength={4000}
              className="resize-none"
              data-testid="input-podcast-description"
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/4000 characters - Used in RSS feeds for Spotify and Apple Podcasts
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateMutation.isPending}
            data-testid="button-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || !hasChanges}
            data-testid="button-edit-save"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
