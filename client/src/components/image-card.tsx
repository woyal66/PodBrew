import { useState } from "react";
import type { GeneratedImage } from "@shared/schema";
import { Download, Loader2, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImageCardProps {
  image: GeneratedImage;
  onClick: () => void;
}

export function ImageCard({ image, onClick }: ImageCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  
  // Get latest images from cache via hook (not direct queryClient call)
  const { data: images } = useQuery<GeneratedImage[]>({ 
    queryKey: ['/api/images'] 
  });
  
  // Get the latest image state from cache (not stale prop)
  const currentImage = images?.find(img => img.id === image.id) || image;
  const isFavorite = currentImage.isFavorite === true || currentImage.isFavorite === 'true';

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (newFavoriteState: boolean) => {
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
      queryClient.setQueryData(['/api/images'], (old: any[] | undefined) => {
        if (!old) return old;
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
        description: newFavoriteState 
          ? "Image added to your favorites" 
          : "Image removed from your favorites",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/images'] });
    },
  });

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavoriteMutation.mutate(!isFavorite);
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
    <div
      className="group relative break-inside-avoid cursor-pointer rounded-lg overflow-hidden bg-card border border-card-border transition-all duration-300 hover:scale-[1.02] hover-elevate"
      onClick={onClick}
      data-testid={`card-image-${image.id}`}
    >
      {/* Image */}
      <div className="relative">
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        <img
          src={image.imageUrl}
          alt={image.prompt}
          className={`w-full h-auto transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setIsLoaded(true)}
          data-testid={`img-generated-${image.id}`}
        />

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {/* Action buttons */}
          <div className="absolute top-3 right-3 flex gap-2">
            <Button
              size="icon"
              variant="secondary"
              className="h-10 w-10 rounded-full backdrop-blur-md bg-background/80"
              onClick={handleToggleFavorite}
              disabled={toggleFavoriteMutation.isPending}
              data-testid={`button-favorite-${image.id}`}
            >
              {toggleFavoriteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Heart className={`h-4 w-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
              )}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="h-10 w-10 rounded-full backdrop-blur-md bg-background/80"
              onClick={handleDownload}
              disabled={isDownloading}
              data-testid={`button-download-${image.id}`}
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Prompt and timestamp */}
          <div className="absolute bottom-0 left-0 right-0 p-4 backdrop-blur-md bg-black/40">
            <p className="text-white text-sm font-medium line-clamp-2 mb-1" data-testid={`text-prompt-${image.id}`}>
              {image.prompt}
            </p>
            <p className="text-white/70 text-xs" data-testid={`text-timestamp-${image.id}`}>
              {formatDistanceToNow(new Date(image.timestamp), { addSuffix: true })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
