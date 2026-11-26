import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Youtube, Music, Podcast, Loader2, ExternalLink } from 'lucide-react';
import { detectUrlsInText, type DetectedSource, getYouTubeThumbnail } from '@/lib/urlDetection';

interface ContentPreviewProps {
  topic: string;
  onRemoveSource?: (url: string) => void;
  className?: string;
}

interface SourcePreview extends DetectedSource {
  title?: string;
  thumbnail?: string;
  duration?: string;
  loading?: boolean;
  error?: boolean;
}

export function ContentPreview({ topic, onRemoveSource, className = '' }: ContentPreviewProps) {
  const [sources, setSources] = useState<SourcePreview[]>([]);
  
  useEffect(() => {
    const detected = detectUrlsInText(topic);
    
    const previews: SourcePreview[] = detected.map(source => ({
      ...source,
      loading: source.type === 'youtube',
      thumbnail: source.type === 'youtube' && source.videoId 
        ? getYouTubeThumbnail(source.videoId)
        : undefined
    }));
    
    setSources(previews);
    
    previews.forEach((source, index) => {
      if (source.type === 'youtube' && source.videoId) {
        setSources(prev => prev.map((s, i) => 
          i === index ? { ...s, loading: false } : s
        ));
      }
    });
  }, [topic]);
  
  if (sources.length === 0) return null;
  
  const getIcon = (type: DetectedSource['type']) => {
    switch (type) {
      case 'youtube': return <Youtube className="w-4 h-4 text-red-500" />;
      case 'spotify': return <Music className="w-4 h-4 text-green-500" />;
      case 'podcast': return <Podcast className="w-4 h-4 text-purple-500" />;
      default: return <ExternalLink className="w-4 h-4" />;
    }
  };
  
  const getLabel = (type: DetectedSource['type']) => {
    switch (type) {
      case 'youtube': return 'YouTube';
      case 'spotify': return 'Spotify';
      case 'podcast': return 'Podcast';
      default: return 'Link';
    }
  };
  
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Detected sources to ingest:</span>
        <Badge variant="secondary" className="text-xs">
          {sources.length} source{sources.length !== 1 ? 's' : ''}
        </Badge>
      </div>
      
      <div className="grid gap-2">
        {sources.map((source, index) => (
          <Card 
            key={index} 
            className="bg-card/50 border-primary/20 overflow-hidden"
            data-testid={`card-source-preview-${index}`}
          >
            <CardContent className="p-2 flex items-center gap-3">
              {source.thumbnail ? (
                <div className="relative w-16 h-10 rounded overflow-hidden flex-shrink-0">
                  <img 
                    src={source.thumbnail} 
                    alt="Thumbnail"
                    className="w-full h-full object-cover"
                  />
                  {source.loading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  {getIcon(source.type)}
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {getIcon(source.type)}
                  <span className="text-xs font-medium">{getLabel(source.type)}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {source.url.substring(0, 50)}...
                </p>
              </div>
              
              {onRemoveSource && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => onRemoveSource(source.url)}
                  data-testid={`button-remove-source-${index}`}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      
      <p className="text-xs text-muted-foreground">
        These sources will be fully transcribed and used to create your podcast.
      </p>
    </div>
  );
}
