import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, Flame, Sparkles, Loader2, Filter, Zap, Globe, AlertCircle, MapPin, Clock } from "lucide-react";
import { SiX } from "react-icons/si";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox as CheckboxUI } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";

type TrendingCategory = 'all' | 'tech' | 'sports' | 'politics' | 'entertainment' | 'science' | 'business' | 'health' | 'world' | 'culture' | 'crime';
type TrendingSource = 'web' | 'x';

interface TrendingTopic {
  title: string;
  description: string;
  category: string;
  relevanceScore?: number;
  engagementLevel?: 'viral' | 'trending' | 'rising';
  source?: 'x';
  publishedAt?: string;
}

interface WebTrendingResponse {
  topics: TrendingTopic[];
  isGlobalFallback?: boolean;
  lastUpdated?: string;
  error?: string;
}

/**
 * Returns a user-friendly message for known provider failure modes
 * (insufficient quota, rate limited, spending limit) so we don't show
 * raw API error strings to end users.
 */
function friendlyProviderError(raw: string, source: 'web' | 'x'): string {
  const m = raw.toLowerCase();
  const provider = source === 'web' ? 'web news' : 'X (Twitter)';
  if (
    m.includes('insufficient_quota') ||
    m.includes('insufficient quota') ||
    m.includes('quota') ||
    m.includes('spending limit') ||
    m.includes('billing') ||
    m.includes('payment') ||
    m.includes('credit')
  ) {
    return `Trends temporarily unavailable — our ${provider} provider has run out of quota. We're working on it.`;
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many requests')) {
    return `Trends temporarily unavailable — our ${provider} provider is rate-limited. Please try again in a moment.`;
  }
  return `Trends temporarily unavailable for ${provider}. Please try again.`;
}

interface XTrendingResponse {
  topics: TrendingTopic[];
  lastUpdated: string;
  available: boolean;
  error?: string;
}

/**
 * Format a story's publish time as a short, friendly label that
 * distinguishes "today" / "yesterday" / older dates without being noisy.
 */
function formatPublishedAt(iso: string): string | null {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return null;
    const now = Date.now();
    const ageMs = now - date.getTime();
    // Less than 24h: relative ("2h ago", "20m ago").
    if (ageMs < 24 * 60 * 60 * 1000 && ageMs >= 0) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    if (isToday(date)) return `Today ${format(date, 'p')}`;
    if (isYesterday(date)) return `Yesterday ${format(date, 'p')}`;
    return format(date, 'MMM d');
  } catch {
    return null;
  }
}

interface TrendingTopicsProps {
  onTopicSelect: (topic: string) => void;
  onMultipleTopicsSelect?: (topics: TrendingTopic[]) => void;
  locationEnabled?: boolean;
  locationCity?: string | null;
  onToggleLocation?: () => void;
}

export function TrendingTopics({ onTopicSelect, onMultipleTopicsSelect, locationEnabled, locationCity, onToggleLocation }: TrendingTopicsProps) {
  const [selectedCategory, setSelectedCategory] = useState<TrendingCategory>('all');
  const [trendingSource, setTrendingSource] = useState<TrendingSource>('x'); // X/Twitter is ~33% cheaper than Perplexity
  
  // Track selected topics per category: { category: [topic1, topic2] }
  const [selectedTopicsPerCategory, setSelectedTopicsPerCategory] = useState<Record<string, TrendingTopic[]>>({});

  const { data: xStatusData } = useQuery<{ available: boolean }>({
    queryKey: ['/api/trending-topics/x/status'],
  });

  const { data: webData, isLoading: webLoading, error: webQueryError, refetch: refetchWeb } = useQuery<WebTrendingResponse>({
    queryKey: ['/api/trending-topics', selectedCategory, locationEnabled, locationCity],
    queryFn: async () => {
      const locationParam = locationEnabled && locationCity ? `&location=${encodeURIComponent(locationCity)}` : '';
      const response = await fetch(`/api/trending-topics?category=${selectedCategory}${locationParam}`);
      if (!response.ok) {
        throw new Error('Failed to fetch trending topics');
      }
      const data = await response.json();

      // If local search returned no/few topics and location was enabled, fallback to global.
      // Skip the fallback if the local request itself surfaced a provider error —
      // the global request will hit the same provider and produce the same error.
      if (locationEnabled && locationCity && data.topics.length === 0 && !data.error) {
        console.log('[TrendingTopics] Local topics empty, falling back to global');
        const globalResponse = await fetch(`/api/trending-topics?category=${selectedCategory}`);
        if (globalResponse.ok) {
          const globalData = await globalResponse.json();
          return { topics: globalData.topics, isGlobalFallback: true, lastUpdated: globalData.lastUpdated, error: globalData.error };
        }
      }

      return { topics: data.topics, isGlobalFallback: false, lastUpdated: data.lastUpdated, error: data.error };
    },
    enabled: trendingSource === 'web',
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const { data: xData, isLoading: xLoading, error: xError, refetch: refetchX } = useQuery<XTrendingResponse>({
    queryKey: ['/api/trending-topics/x', selectedCategory],
    queryFn: async () => {
      const categoryParam = selectedCategory !== 'all' ? `&category=${selectedCategory}` : '';
      const response = await fetch(`/api/trending-topics/x?count=10${categoryParam}`);
      if (!response.ok) {
        throw new Error('Failed to fetch X trending topics');
      }
      return response.json();
    },
    enabled: trendingSource === 'x' && xStatusData?.available !== false,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = trendingSource === 'web' ? webLoading : xLoading;
  const topics = trendingSource === 'web' ? (webData?.topics || []) : (xData?.topics || []);
  const isGlobalFallback = trendingSource === 'web' && webData?.isGlobalFallback === true;
  const xAvailable = xStatusData?.available !== false;
  const xHasError = xData?.error || xError;
  const webHasError = webData?.error;
  const activeErrorRaw =
    trendingSource === 'web'
      ? (typeof webHasError === 'string' ? webHasError : (webQueryError ? 'Network error' : null))
      : (typeof xHasError === 'string' ? xHasError : (xError ? 'Network error' : null));
  const activeErrorMessage = activeErrorRaw ? friendlyProviderError(activeErrorRaw, trendingSource) : null;
  const handleRetry = () => {
    if (trendingSource === 'web') refetchWeb();
    else refetchX();
  };
  // Cache-write timestamp: use the API's lastUpdated for both tabs so the
  // indicator reflects when the *server* refreshed the cache, not when the
  // browser most recently refetched it.
  const lastUpdated = trendingSource === 'x' ? xData?.lastUpdated : webData?.lastUpdated;

  const getLastUpdatedText = () => {
    if (!lastUpdated) return null;
    try {
      const date = new Date(lastUpdated);
      if (isNaN(date.getTime())) return null;
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return null;
    }
  };

  const categories: { value: TrendingCategory; label: string; }[] = [
    { value: 'all', label: 'All' },
    { value: 'business', label: 'Business' },
    { value: 'tech', label: 'Tech' },
    { value: 'health', label: 'Health' },
    { value: 'world', label: 'World' },
    { value: 'politics', label: 'Politics' },
    { value: 'sports', label: 'Sports' },
    { value: 'entertainment', label: 'Entertainment' },
    { value: 'culture', label: 'Culture' },
    { value: 'crime', label: 'Crime' },
    { value: 'science', label: 'Science' },
  ];

  const getEngagementBadge = (topic: TrendingTopic) => {
    if (topic.engagementLevel === 'viral') {
      return (
        <Badge variant="destructive" className="shrink-0">
          <Zap className="h-3 w-3 mr-1" />
          Viral
        </Badge>
      );
    }
    if (topic.engagementLevel === 'trending') {
      return (
        <Badge variant="default" className="shrink-0">
          <Flame className="h-3 w-3 mr-1" />
          Trending
        </Badge>
      );
    }
    if (topic.engagementLevel === 'rising') {
      return (
        <Badge variant="secondary" className="shrink-0">
          <TrendingUp className="h-3 w-3 mr-1" />
          Rising
        </Badge>
      );
    }
    if (topic.relevanceScore && topic.relevanceScore > 0.8) {
      return (
        <Badge variant="destructive" className="shrink-0">
          <Flame className="h-3 w-3 mr-1" />
          Hot
        </Badge>
      );
    }
    return null;
  };

  const handleToggleTopicSelection = (topic: TrendingTopic) => {
    const categoryKey = topic.category;
    const currentSelection = selectedTopicsPerCategory[categoryKey] || [];
    
    // Check if topic is already selected by matching title
    const isSelected = currentSelection.some(t => t.title === topic.title);
    
    if (isSelected) {
      // Remove topic
      const updated = currentSelection.filter(t => t.title !== topic.title);
      if (updated.length === 0) {
        // Remove category key if no topics left
        const newSelection = { ...selectedTopicsPerCategory };
        delete newSelection[categoryKey];
        setSelectedTopicsPerCategory(newSelection);
      } else {
        setSelectedTopicsPerCategory({ ...selectedTopicsPerCategory, [categoryKey]: updated });
      }
    } else {
      // Add topic
      const updated = [...currentSelection, topic];
      setSelectedTopicsPerCategory({ ...selectedTopicsPerCategory, [categoryKey]: updated });
    }
  };

  const handleCreatePodcastFromSelected = () => {
    // Flatten all selected topics from all categories
    const selectedTopics = Object.values(selectedTopicsPerCategory).flat();
    if (selectedTopics.length > 0 && onMultipleTopicsSelect) {
      onMultipleTopicsSelect(selectedTopics);
      setSelectedTopicsPerCategory({});
    }
  };

  const getTotalSelectedCount = () => {
    return Object.values(selectedTopicsPerCategory).reduce((sum, topics) => sum + topics.length, 0);
  };

  const isTopicSelected = (topic: TrendingTopic) => {
    const categoryKey = topic.category;
    const categoryTopics = selectedTopicsPerCategory[categoryKey] || [];
    return categoryTopics.some(t => t.title === topic.title);
  };

  const getSelectedCountsByCategory = () => {
    const counts: Record<string, number> = {};
    Object.entries(selectedTopicsPerCategory).forEach(([category, topicsList]) => {
      counts[category] = topicsList.length;
    });
    return counts;
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-col gap-3">
        {/* Mobile-first layout: Stack on mobile, row on larger screens */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Source tabs - full width on mobile */}
          <Tabs value={trendingSource} onValueChange={(v) => setTrendingSource(v as TrendingSource)} className="w-full sm:w-auto">
            <TabsList className="grid w-full grid-cols-2 sm:w-[200px]">
              <TabsTrigger value="web" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-source-web">
                <Globe className="h-3.5 w-3.5" />
                <span>Web News</span>
              </TabsTrigger>
              <TabsTrigger 
                value="x" 
                className="gap-1.5 text-xs sm:text-sm" 
                data-testid="tab-source-x"
                disabled={!xAvailable}
              >
                <SiX className="h-3 w-3" />
                <span>Twitter</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          
          {/* Filters row - timestamp, location, category */}
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            {/* Last updated timestamp */}
            {getLastUpdatedText() && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">Updated {getLastUpdatedText()}</span>
              </div>
            )}
            
            <div className="flex items-center gap-1 flex-shrink-0">
              {onToggleLocation && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={onToggleLocation}
                      className={`h-8 w-8 ${locationEnabled ? "text-primary" : "text-muted-foreground"}`}
                      data-testid="button-toggle-location"
                    >
                      <MapPin className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {locationEnabled && locationCity 
                      ? `Local: ${locationCity}` 
                      : "Enable location-based topics"}
                  </TooltipContent>
                </Tooltip>
              )}
              
              <Select value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as TrendingCategory)}>
                <SelectTrigger className="w-[90px] h-8 text-xs" data-testid="select-category">
                  <Filter className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem 
                      key={category.value} 
                      value={category.value}
                      data-testid={`select-item-${category.value}`}
                    >
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {isGlobalFallback && trendingSource === 'web' && (
          <Alert>
            <Globe className="h-4 w-4" />
            <AlertDescription>
              Limited local news available for {locationCity}. Showing global trending topics.
            </AlertDescription>
          </Alert>
        )}

        {!xAvailable && trendingSource === 'x' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              X trending topics are not available. Please check back later.
            </AlertDescription>
          </Alert>
        )}

      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 className="h-5 w-5 text-primary animate-spin" data-testid="icon-loading-spinner" />
          <span className="text-sm text-muted-foreground">
            {trendingSource === 'x'
              ? 'Fetching what\'s trending on X...'
              : 'Loading trending topics...'}
          </span>
        </div>
      ) : topics.length === 0 && activeErrorMessage ? (
        <Card data-testid={`card-trending-error-${trendingSource}`}>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm">
              {activeErrorMessage}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              data-testid="button-retry-trending"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : topics.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            {trendingSource === 'x' ? (
              <SiX className="h-12 w-12 text-muted-foreground mb-4" />
            ) : (
              <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
            )}
            <p className="text-muted-foreground text-center">
              No trending topics available right now.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Try selecting a different category or check back later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div>
          <div className="space-y-2 pb-20">
            {topics.map((topic, index) => (
              <label 
                key={`${topic.category}-${topic.title}-${index}`}
                className={`flex gap-2 items-start p-3 rounded-lg border transition-all cursor-pointer hover-elevate ${
                  isTopicSelected(topic) 
                    ? 'ring-2 ring-primary bg-primary/5 border-primary/30' 
                    : 'bg-card/50 border-border/50 hover:border-border'
                }`}
                data-testid={`card-trending-topic-${index}`}
              >
                {/* Left column: number and checkbox stacked vertically */}
                <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-1">
                  <div className="text-muted-foreground font-medium text-xs leading-none">
                    {index + 1}
                  </div>
                  {onMultipleTopicsSelect ? (
                    <CheckboxUI
                      checked={isTopicSelected(topic)}
                      onCheckedChange={() => handleToggleTopicSelection(topic)}
                      data-testid={`checkbox-topic-${index}`}
                    />
                  ) : (
                    <input 
                      type="radio" 
                      name="trending-topic" 
                      className="sr-only" 
                      onChange={() => onTopicSelect(topic.title)}
                    />
                  )}
                </div>
                
                {/* Right column: content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="font-medium text-sm leading-snug">
                      {topic.title}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {getEngagementBadge(topic)}
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {topic.category}
                      </Badge>
                      {topic.source === 'x' && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 gap-0.5">
                          <SiX className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                    </div>
                  </div>
                  {topic.publishedAt && formatPublishedAt(topic.publishedAt) && (
                    <div
                      className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1"
                      data-testid={`text-topic-published-${index}`}
                    >
                      <Clock className="h-2.5 w-2.5 flex-shrink-0" />
                      <span>{formatPublishedAt(topic.publishedAt)}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {topic.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Floating selected topics bar - matches width of topic tiles (same as Listen page container) */}
      {/* Position above audio player footer */}
      {getTotalSelectedCount() > 0 && onMultipleTopicsSelect && (
        <div className="fixed bottom-32 left-0 right-0 z-[50] pointer-events-none md:bottom-24">
          <div className="w-full px-4 sm:px-6 lg:px-8 mx-auto max-w-5xl">
            <div className="flex flex-col gap-2 bg-primary/10 rounded-lg border border-primary/20 backdrop-blur-sm pointer-events-auto p-3">
              {/* Selected count */}
              <span className="text-sm font-medium" data-testid="text-selected-count">
                {getTotalSelectedCount()} topic{getTotalSelectedCount() !== 1 ? 's' : ''} selected
              </span>
              
              {/* Per-category breakdown */}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:gap-2">
                {Object.entries(getSelectedCountsByCategory()).map(([category, count]) => (
                  <div key={category} className="px-2 py-1 bg-primary/20 rounded text-xs whitespace-nowrap">
                    {count} from <span className="capitalize font-medium">{category}</span>
                  </div>
                ))}
              </div>
              
              {/* Button */}
              <Button
                onClick={handleCreatePodcastFromSelected}
                size="sm"
                className="w-full"
                data-testid="button-brew-selected-topics"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Create Podcast from All
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
