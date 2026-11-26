import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, Youtube, Music, Podcast, ExternalLink, Loader2 } from 'lucide-react';
import { detectUrlsInText, type DetectedSource, getYouTubeThumbnail } from '@/lib/urlDetection';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SourceEntry extends DetectedSource {
  id: string;
  thumbnail?: string;
  status: 'pending' | 'validating' | 'valid' | 'invalid';
  error?: string;
}

interface MultiSourceInputProps {
  sources: SourceEntry[];
  onSourcesChange: (sources: SourceEntry[]) => void;
  maxSources?: number;
  className?: string;
  disabled?: boolean;
}

export function MultiSourceInput({ 
  sources, 
  onSourcesChange, 
  maxSources = 5, 
  className = '',
  disabled = false
}: MultiSourceInputProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  
  const handleAddSource = useCallback(() => {
    if (!inputUrl.trim() || sources.length >= maxSources) return;
    
    setIsAdding(true);
    
    const detected = detectUrlsInText(inputUrl.trim());
    
    if (detected.length === 0) {
      setIsAdding(false);
      return;
    }
    
    const newSources: SourceEntry[] = detected.map(source => ({
      ...source,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      thumbnail: source.type === 'youtube' && source.videoId 
        ? getYouTubeThumbnail(source.videoId)
        : undefined,
      status: 'valid' as const
    }));
    
    const existingUrls = new Set(sources.map(s => s.url));
    const uniqueNewSources = newSources.filter(s => !existingUrls.has(s.url));
    
    if (uniqueNewSources.length > 0) {
      onSourcesChange([...sources, ...uniqueNewSources].slice(0, maxSources));
    }
    
    setInputUrl('');
    setIsAdding(false);
  }, [inputUrl, sources, maxSources, onSourcesChange]);
  
  const handleRemoveSource = useCallback((id: string) => {
    onSourcesChange(sources.filter(s => s.id !== id));
  }, [sources, onSourcesChange]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSource();
    }
  }, [handleAddSource]);
  
  const getIcon = (type: DetectedSource['type']) => {
    switch (type) {
      case 'youtube': return <Youtube className="w-4 h-4 text-red-500" />;
      case 'spotify': return <Music className="w-4 h-4 text-green-500" />;
      case 'podcast': return <Podcast className="w-4 h-4 text-purple-500" />;
      default: return <ExternalLink className="w-4 h-4 text-muted-foreground" />;
    }
  };
  
  const getLabel = (type: DetectedSource['type']) => {
    switch (type) {
      case 'youtube': return 'YouTube';
      case 'spotify': return 'Spotify';
      case 'podcast': return 'Podcast';
      default: return 'URL';
    }
  };
  
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            placeholder="Paste YouTube, Spotify, or podcast URL..."
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || sources.length >= maxSources}
            data-testid="input-source-url"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              onClick={handleAddSource}
              disabled={disabled || !inputUrl.trim() || sources.length >= maxSources || isAdding}
              data-testid="button-add-source"
            >
              {isAdding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {sources.length >= maxSources 
              ? `Maximum ${maxSources} sources allowed`
              : 'Add source URL'
            }
          </TooltipContent>
        </Tooltip>
      </div>
      
      {sources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Sources to include ({sources.length}/{maxSources})</span>
          </div>
          
          <div className="grid gap-2">
            {sources.map((source) => (
              <Card 
                key={source.id} 
                className="bg-card/50 border-border/50"
                data-testid={`card-source-${source.id}`}
              >
                <CardContent className="p-2 flex items-center gap-3">
                  {source.thumbnail ? (
                    <div className="relative w-12 h-8 rounded overflow-hidden flex-shrink-0">
                      <img 
                        src={source.thumbnail} 
                        alt="Source thumbnail"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded bg-muted/50 flex items-center justify-center flex-shrink-0">
                      {getIcon(source.type)}
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant="secondary" 
                        className="text-xs flex items-center gap-1"
                      >
                        {getIcon(source.type)}
                        {getLabel(source.type)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {source.url}
                    </p>
                  </div>
                  
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => handleRemoveSource(source.id)}
                    disabled={disabled}
                    data-testid={`button-remove-source-${source.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
      
      {sources.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Add YouTube videos, Spotify episodes, or podcast URLs to include in your podcast research
        </p>
      )}
    </div>
  );
}

export type { SourceEntry };
