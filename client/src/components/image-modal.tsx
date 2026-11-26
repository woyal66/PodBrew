import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { GeneratedImage } from "@shared/schema";
import { Download, X, Loader2, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImageModalProps {
  image: GeneratedImage | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageModal({ image, isOpen, onClose }: ImageModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  
  // Get latest images from cache via hook (not direct queryClient call)
  const { data: images } = useQuery<GeneratedImage[]>({ 
    queryKey: ['/api/images'] 
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (newFavoriteState: boolean) => {
      if (!image) return null;
      const response = await apiRequest('PATCH', `/api/images/${image.id}/favorite`, {
        isFavorite: newFavoriteState,
      });
      return await response.json();
    },
    onMutate: async (newFavoriteState) => {
      // Cancel ongoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/images'] });
      
      // Snapshot previous value
      const previousImages = queryClient.getQueryData(['/api/images']);
      
      // Optimistically update the cache
      queryClient.setQueryData(['/api/images'], (old: GeneratedImage[] | undefined) => {
        if (!old || !image) return old;
        return old.map(img => 
          img.id === image.id 
            ? { ...img, isFavorite: newFavoriteState }
            : img
        );
      });
      
      return { previousImages };
    },
    onError: (error: Error, _newState, context) => {
      // Rollback on error
      if (context?.previousImages) {
        queryClient.setQueryData(['/api/images'], context.previousImages);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update favorite status",
        variant: "destructive",
      });
    },
    onSuccess: (_data, newFavoriteState) => {
      toast({
        title: newFavoriteState ? "Added to favorites" : "Removed from favorites",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/images'] });
    },
  });

  if (!image) return null;

  // Get the latest image state from cache (not stale prop)
  const currentImage = images?.find(img => img.id === image.id) || image;
  const isFavorite = currentImage.isFavorite === true || currentImage.isFavorite === 'true';

  const handleToggleFavorite = () => {
    toggleFavoriteMutation.mutate(!isFavorite);
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    
    try {
      const response = await fetch(image.imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-generated-${image.id}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>Generated Image</DialogTitle>
          <DialogDescription>{image.prompt}</DialogDescription>
        </VisuallyHidden>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex-1 pr-12">
            <p className="font-medium line-clamp-1">{image.prompt}</p>
            <p className="text-sm text-muted-foreground">
              Generated {formatDistanceToNow(new Date(image.timestamp), { addSuffix: true })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleToggleFavorite}
              disabled={toggleFavoriteMutation.isPending}
              data-testid="button-modal-favorite"
            >
              {toggleFavoriteMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Heart className={`h-5 w-5 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleDownload}
              disabled={isDownloading}
              data-testid="button-modal-download"
            >
              {isDownloading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Download className="h-5 w-5" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              data-testid="button-modal-close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Image */}
        <div className="relative bg-muted max-h-[70vh] overflow-auto">
          <img
            src={image.imageUrl}
            alt={image.prompt}
            className="w-full h-auto"
            data-testid="img-modal-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
