import { useQuery } from "@tanstack/react-query";
import type { GeneratedImage } from "@shared/schema";
import { ImageCard } from "@/components/image-card";
import { ImageModal } from "@/components/image-modal";
import { useState } from "react";
import { Loader2, ImageIcon } from "lucide-react";

export function ImageGallery() {
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  const { data: images, isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["/api/images"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading your gallery...</p>
        </div>
      </div>
    );
  }

  if (!images || images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
        <div className="rounded-full bg-muted p-8">
          <ImageIcon className="h-16 w-16 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h3 className="font-display text-2xl font-semibold">
            Your gallery is empty
          </h3>
          <p className="text-muted-foreground max-w-md">
            Generate your first image to see it here. Describe your vision above and let AI bring it to life!
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
        {images.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            onClick={() => setSelectedImage(image)}
          />
        ))}
      </div>

      <ImageModal
        image={selectedImage}
        isOpen={!!selectedImage}
        onClose={() => setSelectedImage(null)}
      />
    </>
  );
}
