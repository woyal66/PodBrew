import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  ChevronDown, 
  ChevronUp, 
  Search, 
  ExternalLink, 
  Youtube, 
  Music, 
  Podcast,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  BookOpen
} from 'lucide-react';
import { useState } from 'react';

interface ResearchSource {
  type: 'youtube' | 'spotify' | 'podcast' | 'perplexity' | 'document';
  title: string;
  url?: string;
  wordCount: number;
  excerpt?: string;
  citations?: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface ResearchPreviewProps {
  templateCategory: string;
  topic: string;
  sources: ResearchSource[];
  totalWordCount: number;
  isLoading?: boolean;
  className?: string;
}

export function ResearchPreview({
  templateCategory,
  topic,
  sources,
  totalWordCount,
  isLoading = false,
  className = ''
}: ResearchPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getIcon = (type: ResearchSource['type']) => {
    switch (type) {
      case 'youtube': return <Youtube className="w-4 h-4 text-red-500" />;
      case 'spotify': return <Music className="w-4 h-4 text-green-500" />;
      case 'podcast': return <Podcast className="w-4 h-4 text-purple-500" />;
      case 'perplexity': return <Search className="w-4 h-4 text-blue-500" />;
      case 'document': return <FileText className="w-4 h-4 text-amber-500" />;
      default: return <BookOpen className="w-4 h-4" />;
    }
  };
  
  const getStatusIcon = (status: ResearchSource['status']) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-3 h-3 text-primary" />;
      case 'processing': return <Loader2 className="w-3 h-3 animate-spin text-primary" />;
      case 'failed': return <AlertCircle className="w-3 h-3 text-destructive" />;
      default: return null;
    }
  };
  
  const getTemplateLabel = (category: string) => {
    const labels: Record<string, string> = {
      news: 'Breaking News',
      sports: 'Sports Update',
      events: 'Events Coverage',
      teachme: 'Educational',
      medical: 'Health Information',
      stories: 'Story Research',
      documents: 'Document Analysis',
      custom: 'Topic Research'
    };
    return labels[category] || 'Research';
  };
  
  const completedSources = sources.filter(s => s.status === 'completed').length;
  const totalCitations = sources.reduce((acc, s) => acc + (s.citations?.length || 0), 0);
  
  if (sources.length === 0 && !isLoading) return null;
  
  return (
    <Card className={`bg-card/80 border-primary/20 ${className}`}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover-elevate py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-md bg-primary/10">
                  <Search className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">
                    {getTemplateLabel(templateCategory)} Research
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isLoading ? 'Gathering information...' : `${completedSources} source${completedSources !== 1 ? 's' : ''} compiled`}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {isLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs">
                    {totalWordCount.toLocaleString()} words
                  </Badge>
                  {totalCitations > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {totalCitations} citations
                    </Badge>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4">
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {sources.map((source, index) => (
                  <div 
                    key={index}
                    className="flex items-start gap-3 p-2 rounded-md bg-muted/30"
                    data-testid={`div-research-source-${index}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getIcon(source.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {source.title}
                        </span>
                        {getStatusIcon(source.status)}
                      </div>
                      
                      {source.excerpt && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {source.excerpt}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {source.wordCount.toLocaleString()} words
                        </span>
                        {source.citations && source.citations.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            • {source.citations.length} citation{source.citations.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {source.url && (
                          <a 
                            href={source.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                {sources.length === 0 && isLoading && (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-sm">Starting research...</span>
                  </div>
                )}
              </div>
            </ScrollArea>
            
            {totalCitations > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-xs text-muted-foreground mb-2">Citations:</p>
                <div className="flex flex-wrap gap-1">
                  {sources
                    .flatMap(s => s.citations || [])
                    .slice(0, 5)
                    .map((citation, i) => (
                      <Badge 
                        key={i} 
                        variant="outline" 
                        className="text-xs truncate max-w-[200px]"
                      >
                        {citation}
                      </Badge>
                    ))}
                  {totalCitations > 5 && (
                    <Badge variant="outline" className="text-xs">
                      +{totalCitations - 5} more
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export type { ResearchSource };
