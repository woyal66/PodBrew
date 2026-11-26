import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, Sparkles, Play } from "lucide-react";

interface TrendingHeroCardProps {
  topic: {
    title: string;
    description: string;
    category: string;
    relevanceScore: number;
  };
  index: number;
  onTopicSelect: (topic: string) => void;
}

export function TrendingHeroCard({ topic, index, onTopicSelect }: TrendingHeroCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imageUrl = `/api/trending-topics/image?topic=${encodeURIComponent(topic.title)}&index=${index}`;

  const gradients = [
    'from-purple-600/20 to-pink-600/20',
    'from-blue-600/20 to-cyan-600/20',
    'from-orange-600/20 to-red-600/20',
  ];

  return (
    <div 
      className="relative group overflow-hidden rounded-lg aspect-video w-full hover-elevate"
      data-testid={`trending-hero-${index}`}
    >
      {!imageError ? (
        <>
          <img
            src={imageUrl}
            alt={topic.title}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
          {!imageLoaded && (
            <div className={`absolute inset-0 bg-gradient-to-br ${gradients[index % 3]} animate-pulse`} />
          )}
        </>
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${gradients[index % 3]}`} />
      )}
      
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
      
      <div className="relative h-full p-4 sm:p-6 flex flex-col justify-end">
        <div className="space-y-2 sm:space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="bg-white/20 backdrop-blur-sm text-white border-white/30">
              {topic.category}
            </Badge>
            {topic.relevanceScore > 0.8 && (
              <Badge className="bg-red-500/90 hover:bg-red-500 text-white border-0">
                <Flame className="h-3 w-3 mr-1" />
                Trending
              </Badge>
            )}
            {index === 0 && (
              <Badge className="bg-primary/90 hover:bg-primary text-white border-0">
                <Sparkles className="h-3 w-3 mr-1" />
                #1
              </Badge>
            )}
          </div>

          <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-white line-clamp-2">
            {topic.title}
          </h3>

          <p className="text-sm sm:text-base text-white/90 line-clamp-2">
            {topic.description}
          </p>

          <Button
            onClick={() => onTopicSelect(topic.title)}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white"
            size="sm"
            data-testid={`button-create-from-trending-${index}`}
          >
            <Play className="h-4 w-4 mr-2" />
            Brew Podcast
          </Button>
        </div>
      </div>
    </div>
  );
}
