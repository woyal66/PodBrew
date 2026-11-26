import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, X, Coffee, Star, Newspaper, Zap, Cloud, TrendingUp, Cpu, Tv, Building2, Heart, Settings2, ChevronDown, Lightbulb, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AutoGenerateSettingsModal } from "./AutoGenerateSettingsModal";
import type { FavoriteTopic, NewsPreset } from "@shared/schema";

const TOPIC_CATEGORIES = [
  { value: 'custom', label: 'Custom', icon: Star, description: 'General news and updates' },
  { value: 'sports', label: 'Sports', icon: Zap, description: 'Sports events, competitions, team news' },
  { value: 'weather', label: 'Weather', icon: Cloud, description: 'Weather forecasts and climate updates' },
  { value: 'finance', label: 'Finance', icon: TrendingUp, description: 'Market impact and financial implications' },
  { value: 'tech', label: 'Tech', icon: Cpu, description: 'Innovation, product launches, breakthroughs' },
  { value: 'entertainment', label: 'Entertainment', icon: Tv, description: 'Movies, shows, celebrity news' },
  { value: 'politics', label: 'Politics', icon: Building2, description: 'Political news and policy updates' },
  { value: 'health', label: 'Health', icon: Heart, description: 'Health trends and medical developments' },
] as const;

const getCategoryIcon = (category: string) => {
  const found = TOPIC_CATEGORIES.find(c => c.value === category);
  return found ? found.icon : Star;
};

const getCategoryDescription = (category: string) => {
  const found = TOPIC_CATEGORIES.find(c => c.value === category);
  return found ? found.description : 'General news and updates';
};

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    sports: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    weather: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    finance: 'bg-green-500/20 text-green-400 border-green-500/30',
    tech: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    entertainment: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    politics: 'bg-red-500/20 text-red-400 border-red-500/30',
    health: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    custom: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  return colors[category] || colors.custom;
};

interface FavoriteTopicsManagerProps {
  onBrewFavorites: (combinedTopic: string) => void;
  isGenerating?: boolean;
  usePresets: boolean;
  onTogglePresets: (enabled: boolean) => void;
  onEditPreset?: () => void;
  hasPreset?: boolean;
}

export function FavoriteTopicsManager({ onBrewFavorites, isGenerating, usePresets, onTogglePresets, onEditPreset, hasPreset }: FavoriteTopicsManagerProps) {
  const [newTopic, setNewTopic] = useState("");
  const [newCategory, setNewCategory] = useState<string>("custom");
  const [showInfoBanner, setShowInfoBanner] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showAutoGenerateModal, setShowAutoGenerateModal] = useState(false);
  const { toast } = useToast();

  const { data: topicsData, isLoading } = useQuery<{ topics: FavoriteTopic[] }>({
    queryKey: ['/api/favorite-topics'],
  });

  const { data: presetData } = useQuery<{ preset: NewsPreset | null }>({
    queryKey: ['/api/news-preset'],
  });

  const topics = topicsData?.topics || [];
  const preset = presetData?.preset || null;

  const addMutation = useMutation({
    mutationFn: async (data: { label: string; category: string }) => {
      const response = await apiRequest('POST', '/api/favorite-topics', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-topics'] });
      setNewTopic("");
      toast({
        title: "Topic saved",
        description: "Your favorite topic has been added to your daily news.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add topic",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/favorite-topics/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-topics'] });
      toast({
        title: "Topic removed",
        description: "The topic has been removed from your favorites.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove topic",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAddTopic = () => {
    if (!newTopic.trim()) return;
    addMutation.mutate({ label: newTopic.trim(), category: newCategory });
  };

  const handleBrewAll = () => {
    if (topics.length === 0) {
      toast({
        title: "No topics to brew",
        description: "Add some favorite topics first!",
        variant: "destructive",
      });
      return;
    }

    const combinedTopic = `Daily Personalized News Brief covering: ${topics.map(t => t.label).join('; ')}. Provide updates on each topic with the latest news and developments.`;
    onBrewFavorites(combinedTopic);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTopic.trim()) {
      handleAddTopic();
    }
  };

  return (
    <Card 
      id="daily-news-brief" 
      className="bg-gradient-to-br from-primary/5 to-transparent border-primary/20"
    >
      <CardHeader 
        className="pb-3 cursor-pointer hover-elevate"
        onClick={() => setIsCollapsed(!isCollapsed)}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="p-2 rounded-full bg-primary/20 flex-shrink-0">
              <Coffee className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Daily Brief</CardTitle>
                {topics.length > 0 && (
                  <Badge variant="secondary" className="bg-primary/20 text-primary text-xs flex-shrink-0">
                    {topics.length}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Save your favorite topics for quick daily briefings
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center">
                    <Switch
                      checked={usePresets}
                      onCheckedChange={onTogglePresets}
                      disabled={topics.length === 0}
                      data-testid="switch-use-presets"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {usePresets ? "Using saved preset" : "Toggle to use preset"}
                </TooltipContent>
              </Tooltip>
              {hasPreset && onEditPreset && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditPreset();
                      }}
                      data-testid="button-edit-preset"
                    >
                      <Settings2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit preset settings</TooltipContent>
                </Tooltip>
              )}
              {hasPreset && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-7 w-7 ${preset?.autoGenerateEnabled ? 'text-primary' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAutoGenerateModal(true);
                      }}
                      data-testid="button-auto-generate-settings"
                    >
                      <Clock className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {preset?.autoGenerateEnabled 
                      ? `Auto-generates at ${preset.autoGenerateTime || '06:00'}` 
                      : 'Schedule auto-generation'}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-primary transition-transform flex-shrink-0 ${isCollapsed ? '' : 'rotate-180'}`} />
          </div>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="space-y-4">
        {/* Pro Tip + Category Selector Row */}
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowInfoBanner(!showInfoBanner)}
            className="flex-1 p-3 bg-primary/10 border border-primary/20 rounded-lg hover-elevate text-left flex items-center justify-between group min-w-0"
            data-testid="button-toggle-info-banner"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Lightbulb className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-sm font-medium truncate">Pro Tip</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-primary transition-transform flex-shrink-0 ml-1 ${showInfoBanner ? 'rotate-180' : ''}`} />
          </button>

          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger className="w-auto min-w-[140px]" data-testid="select-topic-category">
              <SelectValue placeholder="Custom" />
            </SelectTrigger>
            <SelectContent>
              {TOPIC_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value} title={cat.description}>
                  <div className="flex items-center gap-2">
                    <cat.icon className="w-3 h-3" />
                    {cat.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {showInfoBanner && (
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm text-muted-foreground space-y-2">
            <p>
              Add the same topic under <strong>different categories</strong> to get <strong>multi-perspective coverage</strong>.
            </p>
            <div className="space-y-1 text-xs">
              <p><strong>Example:</strong> "Elon Musk"</p>
              <ul className="list-disc list-inside space-y-0.5 ml-1">
                <li><strong>Tech:</strong> Innovation & SpaceX developments</li>
                <li><strong>Finance:</strong> Tesla stock performance</li>
                <li><strong>Entertainment:</strong> Public appearances & news</li>
              </ul>
              <p className="mt-2">Each category researches the topic from a different angle for richer context.</p>
            </div>
          </div>
        )}

        {/* Topic Input Row - Full Width */}
        <div className="flex gap-2 w-full">
          <Input
            placeholder="e.g., NBA results, Brisbane weather, Tesla stock..."
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={addMutation.isPending || isGenerating}
            className="flex-1 min-w-0"
            data-testid="input-favorite-topic"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                onClick={handleAddTopic}
                disabled={!newTopic.trim() || addMutation.isPending || isGenerating}
                data-testid="button-add-favorite-topic"
                className="flex-shrink-0"
              >
                {addMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add to favorites</TooltipContent>
          </Tooltip>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : topics.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {topics.map((topic) => {
                const CategoryIcon = getCategoryIcon(topic.category || 'custom');
                return (
                  <div key={topic.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Badge
                            variant="outline"
                            className={`pr-1 pl-2 py-1.5 gap-1.5 cursor-help ${getCategoryColor(topic.category || 'custom')}`}
                            data-testid={`badge-favorite-topic-${topic.id}`}
                          >
                            <CategoryIcon className="w-3 h-3" />
                            <span className="max-w-[200px] truncate">{topic.label}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 ml-1 hover:bg-destructive/20 hover:text-destructive"
                              onClick={() => removeMutation.mutate(topic.id)}
                              disabled={removeMutation.isPending || isGenerating}
                              data-testid={`button-remove-topic-${topic.id}`}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{topic.label}</p>
                        <p className="text-xs text-muted-foreground">{getCategoryDescription(topic.category || 'custom')}</p>
                        <p className="text-xs mt-1 opacity-75">Add same topic in other categories for multi-perspective coverage</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>

            {usePresets ? (
              <Button
                onClick={handleBrewAll}
                className="w-full bg-primary hover:bg-primary/90"
                disabled={isGenerating || topics.length === 0}
                data-testid="button-brew-favorites"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Brewing...
                  </>
                ) : (
                  <>
                    <Newspaper className="w-4 h-4 mr-2" />
                    Brew Daily Brief ({topics.length} topic{topics.length !== 1 ? 's' : ''})
                  </>
                )}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">
                Toggle ON to use presets for brewing
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <Newspaper className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No favorite topics yet</p>
            <p className="text-xs mt-1">Add topics above to create your personalized daily brief</p>
          </div>
        )}
        </CardContent>
      )}

      <AutoGenerateSettingsModal
        open={showAutoGenerateModal}
        onOpenChange={setShowAutoGenerateModal}
        preset={preset}
      />
    </Card>
  );
}
