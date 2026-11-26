import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { SiX } from "react-icons/si";
import { 
  TrendingUp, 
  Flame, 
  Zap, 
  Sparkles,
  ChevronRight,
  Check,
  Globe,
  AlertCircle
} from "lucide-react";

/**
 * Returns a user-friendly message for known provider failure modes
 * (insufficient quota, rate limited, spending limit) so we don't show
 * raw API error strings to end users.
 */
function friendlyProviderError(raw: string, source: 'web' | 'x'): string {
  const m = raw.toLowerCase();
  const provider = source === 'web' ? 'web news' : 'X (Twitter)';
  if (
    m.includes('insufficient_quota') || m.includes('insufficient quota') || m.includes('quota') ||
    m.includes('spending limit') || m.includes('billing') || m.includes('payment') || m.includes('credit')
  ) {
    return `Trends temporarily unavailable — our ${provider} provider has run out of quota. We're working on it.`;
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many requests')) {
    return `Trends temporarily unavailable — our ${provider} provider is rate-limited. Please try again in a moment.`;
  }
  return `Trends temporarily unavailable for ${provider}. Please try again.`;
}

type TrendingCategory = 'all' | 'tech' | 'sports' | 'politics' | 'entertainment' | 'science' | 'business' | 'health' | 'world' | 'culture' | 'crime';
type TrendingSource = 'web' | 'x';

interface TrendingTopic {
  title: string;
  description: string;
  category: string;
  relevanceScore?: number;
  engagementLevel?: 'viral' | 'trending' | 'rising';
}

interface TrendingTopicsPanelProps {
  trigger?: React.ReactNode;
}

export function TrendingTopicsPanel({ trigger }: TrendingTopicsPanelProps) {
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TrendingCategory>('all');
  const [selectedTopics, setSelectedTopics] = useState<Map<string, TrendingTopic>>(new Map());
  const [trendingSource, setTrendingSource] = useState<TrendingSource>('x');
  const isMobile = useIsMobile();
  const sheetSide = isMobile ? "bottom" : "right";

  const { data: xStatusData } = useQuery<{ available: boolean }>({
    queryKey: ['/api/trending-topics/x/status'],
    enabled: isOpen,
  });

  const xAvailable = xStatusData?.available !== false;

  const { data: webData, isLoading: webLoading, error: webQueryError, refetch: refetchWeb } = useQuery<{ topics: TrendingTopic[]; error?: string }>({
    queryKey: ['/api/trending-topics', selectedCategory],
    queryFn: async () => {
      const response = await fetch(`/api/trending-topics?category=${selectedCategory}`);
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    enabled: isOpen && trendingSource === 'web',
    staleTime: 5 * 60 * 1000,
  });

  const { data: xData, isLoading: xLoading, error: xQueryError, refetch: refetchX } = useQuery<{ topics: TrendingTopic[]; error?: string }>({
    queryKey: ['/api/trending-topics/x', selectedCategory],
    queryFn: async () => {
      const categoryParam = selectedCategory !== 'all' ? `&category=${selectedCategory}` : '';
      const response = await fetch(`/api/trending-topics/x?count=10${categoryParam}`);
      if (!response.ok) throw new Error('Failed to fetch X trending topics');
      return response.json();
    },
    enabled: isOpen && trendingSource === 'x' && xAvailable,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = trendingSource === 'web' ? webLoading : xLoading;
  const topics = trendingSource === 'web' ? (webData?.topics || []) : (xData?.topics || []);
  const activeErrorRaw =
    trendingSource === 'web'
      ? (webData?.error || (webQueryError ? 'Network error' : null))
      : (xData?.error || (xQueryError ? 'Network error' : null));
  const activeErrorMessage = activeErrorRaw ? friendlyProviderError(activeErrorRaw, trendingSource) : null;
  const handleRetry = () => {
    if (trendingSource === 'web') refetchWeb();
    else refetchX();
  };

  const categories: { value: TrendingCategory; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'business', label: 'Business' },
    { value: 'tech', label: 'Tech' },
    { value: 'sports', label: 'Sports' },
    { value: 'entertainment', label: 'Entertainment' },
    { value: 'science', label: 'Science' },
    { value: 'health', label: 'Health' },
    { value: 'politics', label: 'Politics' },
  ];

  const toggleTopic = (topic: TrendingTopic) => {
    const key = topic.title;
    const newSelected = new Map(selectedTopics);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.set(key, topic);
    }
    setSelectedTopics(newSelected);
  };

  const isSelected = (topic: TrendingTopic) => selectedTopics.has(topic.title);

  const handleBrew = () => {
    if (selectedTopics.size === 0) return;
    
    const topicTitles = Array.from(selectedTopics.values()).map(t => t.title);
    const combinedTopic = topicTitles.join('; ');
    
    const params = new URLSearchParams({
      template: 'news',
      topic: combinedTopic,
    });
    
    const targetUrl = `/?${params.toString()}`;
    
    setIsOpen(false);
    setLocation(targetUrl);
    
    setTimeout(() => {
      setSelectedTopics(new Map());
    }, 100);
  };

  const clearSelection = () => {
    setSelectedTopics(new Map());
  };

  const getEngagementBadge = (topic: TrendingTopic) => {
    if (topic.engagementLevel === 'viral') {
      return (
        <Badge variant="destructive" className="shrink-0 text-xs">
          <Zap className="h-2.5 w-2.5 mr-0.5" />
          Viral
        </Badge>
      );
    }
    if (topic.engagementLevel === 'trending') {
      return (
        <Badge variant="default" className="shrink-0 text-xs">
          <Flame className="h-2.5 w-2.5 mr-0.5" />
          Trending
        </Badge>
      );
    }
    if (topic.engagementLevel === 'rising') {
      return (
        <Badge variant="secondary" className="shrink-0 text-xs">
          <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
          Rising
        </Badge>
      );
    }
    return null;
  };

  const getCategoryBadge = (category: string) => {
    return (
      <Badge variant="outline" className="shrink-0 text-xs capitalize">
        {category}
      </Badge>
    );
  };

  const getSelectedCountByCategory = () => {
    const counts: Record<string, number> = {};
    selectedTopics.forEach((topic) => {
      const cat = topic.category || 'general';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  };

  const selectedCounts = getSelectedCountByCategory();

  const defaultTrigger = (
    <Button 
      variant="outline" 
      size="sm" 
      className="hidden md:flex gap-2"
      data-testid="button-trending-topics"
    >
      <Flame className="h-4 w-4 text-orange-500" />
      <span>Trending Topics</span>
    </Button>
  );

  // Mobile edge tab trigger - fixed to right side of screen
  const mobileEdgeTab = (
    <button
      onClick={() => setIsOpen(true)}
      className="fixed right-0 top-1/2 -translate-y-1/2 z-40 md:hidden flex flex-col items-center gap-1 px-1.5 py-3 bg-gradient-to-l from-orange-500 to-orange-600 text-white rounded-l-lg shadow-lg hover:from-orange-600 hover:to-orange-700 transition-all"
      data-testid="button-trending-topics-edge"
      aria-label="Open Trending Topics"
    >
      <Flame className="h-4 w-4" />
      <span className="text-[10px] font-medium tracking-tight" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
        Topics
      </span>
    </button>
  );

  return (
    <>
      {/* Mobile edge tab - always visible on mobile when panel is closed */}
      {!isOpen && mobileEdgeTab}
      
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          {trigger || defaultTrigger}
        </SheetTrigger>
      <SheetContent 
        side={sheetSide} 
        className={`p-0 flex flex-col ${
          isMobile 
            ? "h-[85vh] rounded-t-xl" 
            : "w-full sm:w-[440px]"
        }`}
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b space-y-3">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              Trending Topics
            </SheetTitle>
            {selectedTopics.size > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearSelection}
                className="text-muted-foreground"
              >
                Clear ({selectedTopics.size})
              </Button>
            )}
          </div>
          <SheetDescription className="text-sm text-muted-foreground">
            Select topics from different categories to create a custom news podcast
          </SheetDescription>
          
          <Tabs value={trendingSource} onValueChange={(v) => setTrendingSource(v as TrendingSource)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="web" className="gap-1.5 text-xs" data-testid="tab-panel-source-web">
                <Globe className="h-3.5 w-3.5" />
                <span>Web News</span>
              </TabsTrigger>
              <TabsTrigger 
                value="x" 
                className="gap-1.5 text-xs" 
                data-testid="tab-panel-source-x"
                disabled={!xAvailable}
              >
                <SiX className="h-3 w-3" />
                <span>Twitter (X)</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </SheetHeader>

        <div className="px-4 py-3 border-b">
          <ScrollArea className="w-full">
            <Tabs value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as TrendingCategory)}>
              <TabsList className="inline-flex w-max gap-1 bg-transparent p-0">
                {categories.map((cat) => {
                  const count = selectedCounts[cat.value] || 0;
                  return (
                    <TabsTrigger
                      key={cat.value}
                      value={cat.value}
                      className="relative data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-3 py-1.5 text-sm rounded-full"
                      data-testid={`tab-category-${cat.value}`}
                    >
                      {cat.label}
                      {count > 0 && (
                        <Badge 
                          variant="secondary" 
                          className="ml-1.5 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-primary text-primary-foreground"
                        >
                          {count}
                        </Badge>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </ScrollArea>
        </div>

        <ScrollArea className="flex-1 px-4 py-2">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <CardContent className="p-3 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-5 w-12" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : topics.length === 0 && activeErrorMessage ? (
            <div
              className="flex flex-col items-center justify-center text-center py-12 gap-3 text-muted-foreground"
              data-testid={`panel-trending-error-${trendingSource}`}
            >
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm max-w-xs">{activeErrorMessage}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                data-testid="button-retry-trending-panel"
              >
                Retry
              </Button>
            </div>
          ) : topics.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p>No trending topics found</p>
              <p className="text-sm">Try selecting a different category</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topics.map((topic, index) => {
                const selected = isSelected(topic);
                return (
                  <Tooltip key={`${topic.title}-${index}`}>
                    <TooltipTrigger asChild>
                      <Card 
                        role="button"
                        tabIndex={0}
                        className={`cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] hover:bg-accent/50 ${
                          selected ? 'ring-2 ring-primary bg-primary/5' : ''
                        }`}
                        onClick={() => toggleTopic(topic)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleTopic(topic);
                          }
                        }}
                        data-testid={`topic-card-${index}`}
                        data-selected={selected}
                      >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="pt-0.5 shrink-0">
                          <Checkbox 
                            checked={selected}
                            className="pointer-events-none"
                            tabIndex={-1}
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-medium text-sm leading-tight line-clamp-2">
                              {topic.title}
                            </h4>
                            {selected && (
                              <Check className="h-4 w-4 text-primary shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {topic.description}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {getEngagementBadge(topic)}
                            {getCategoryBadge(topic.category)}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                      </Card>
                    </TooltipTrigger>
                    <TooltipContent>Click to select this topic for your podcast</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {selectedTopics.size > 0 && (
          <div 
            className="border-t p-4 bg-background/95 backdrop-blur"
            data-testid="action-bar-topics"
            data-selected-count={selectedTopics.size}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" data-testid="text-selected-count">
                  {selectedTopics.size} topic{selectedTopics.size !== 1 ? 's' : ''} selected
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {Object.entries(selectedCounts).map(([cat, count]) => 
                    `${count} ${cat}`
                  ).join(', ')}
                </p>
              </div>
              <Button 
                onClick={handleBrew}
                className="gap-2 bg-primary hover:bg-primary/90"
                data-testid="button-brew-topics"
              >
                <Sparkles className="h-4 w-4" />
                Brew Podcast
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}
