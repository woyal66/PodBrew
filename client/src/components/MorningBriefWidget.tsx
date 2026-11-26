import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription 
} from "@/components/ui/sheet";
import { 
  Coffee, 
  Loader2, 
  Settings2, 
  Zap,
  Plus,
  Trash2,
  Clock,
  Mic2,
  Timer,
  Lightbulb,
  ChevronDown,
  Star,
  Cloud,
  TrendingUp,
  Cpu,
  Tv,
  Building2,
  Heart,
  Sparkles
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AutoGenerateSettingsModal } from "./AutoGenerateSettingsModal";
import { PresetSetupModal } from "./PresetSetupModal";
import { BrewingProgress } from "./BrewingProgress";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import type { FavoriteTopic, GeneratedPodcast, NewsPreset } from "@shared/schema";
import { useIsMobile } from "@/hooks/use-mobile";

interface MorningBriefWidgetProps {
  onNavigateToNews?: () => void;
  hideEdgeTab?: boolean;
}

const getCategoryIcon = (category: string) => {
  const icons: Record<string, any> = {
    sports: Zap,
    weather: Cloud,
    finance: TrendingUp,
    tech: Cpu,
    entertainment: Tv,
    politics: Building2,
    health: Heart,
    custom: Star,
  };
  return icons[category] || Star;
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

const TOPIC_CATEGORIES = [
  { value: 'sports', label: 'Sports' },
  { value: 'weather', label: 'Weather' },
  { value: 'finance', label: 'Finance' },
  { value: 'tech', label: 'Technology' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'politics', label: 'Politics' },
  { value: 'health', label: 'Health' },
  { value: 'custom', label: 'Custom' },
];

export function MorningBriefWidget({ onNavigateToNews, hideEdgeTab = false }: MorningBriefWidgetProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { startBrewing } = useGlobalBrewing();
  const [isOpen, setIsOpen] = useState(false);
  const [showAutoGenerateModal, setShowAutoGenerateModal] = useState(false);
  const [showDailyBrewSettingsModal, setShowDailyBrewSettingsModal] = useState(false);
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const [newTopicLabel, setNewTopicLabel] = useState("");
  const [newTopicCategory, setNewTopicCategory] = useState("custom");
  const [isStartingBrew, setIsStartingBrew] = useState(false);
  const isMobile = useIsMobile();
  const sheetSide = isMobile ? "bottom" : "right";

  const { data: topicsData, isLoading } = useQuery<{ topics: FavoriteTopic[] }>({
    queryKey: ['/api/favorite-topics'],
  });

  const { data: voicesData, isLoading: voicesLoading } = useQuery<any[]>({
    queryKey: ['/api/voices'],
    staleTime: 600_000,
  });

  const { data: presetData } = useQuery<{ preset: NewsPreset | null }>({
    queryKey: ['/api/news-preset'],
  });

  const topics = topicsData?.topics || [];
  const voicesReady = !voicesLoading && voicesData && voicesData.length > 0;
  const preset = presetData?.preset;

  // Toggle Daily Brew custom settings
  const toggleDailyBrewMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await apiRequest('POST', '/api/news-preset', {
        quickBrewEnabled: enabled,
      });
      return response.json();
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ['/api/news-preset'] });
      toast({
        title: enabled ? "Using Daily Brew Settings" : "Using News Preset",
        description: enabled 
          ? "Daily Brew will use its own custom settings" 
          : "Daily Brew will now use your News template settings",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (topicId: string | number) => {
      await apiRequest('DELETE', `/api/favorite-topics/${topicId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-topics'] });
      toast({ title: "Topic removed" });
    },
  });

  const createTopicMutation = useMutation({
    mutationFn: async () => {
      if (!newTopicLabel.trim()) {
        throw new Error("Topic name is required");
      }
      const response = await apiRequest('POST', '/api/favorite-topics', {
        label: newTopicLabel.trim(),
        category: newTopicCategory,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-topics'] });
      toast({
        title: "Topic added",
        description: `"${newTopicLabel}" added to your daily brief`,
      });
      setNewTopicLabel("");
      setNewTopicCategory("custom");
      setShowAddTopicModal(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add topic",
        variant: "destructive",
      });
    },
  });


  const handleDailyBrew = async () => {
    if (topics.length === 0) {
      toast({
        title: "No favorite topics",
        description: "Add some topics in the News template first!",
      });
      return;
    }

    if (!voicesData || voicesData.length === 0) {
      toast({
        title: "Voices not loaded",
        description: "Please wait for voices to load and try again.",
        variant: "destructive",
      });
      return;
    }

    const topicLabels = topics.map(t => t.label);
    const topicList = topicLabels.join('; ');
    const currentDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    let avoidanceInstructions = '';
    if (preset?.lastGeneratedScriptSummary && preset?.lastGeneratedDate) {
      const lastGenDate = new Date(preset.lastGeneratedDate);
      const today = new Date();
      const isYesterday = (today.getTime() - lastGenDate.getTime()) < 24 * 60 * 60 * 1000;
      
      if (isYesterday) {
        avoidanceInstructions = `\n\nIMPORTANT - AVOID REPETITIVE CONTENT:
You generated a news podcast yesterday covering these stories/angles. DO NOT re-cover the same stories, topics, or angles. Find fresh angles and new developments:
${preset.lastGeneratedScriptSummary}\n`;
      }
    }
    
    const combinedTopic = `DAILY NEWS BROADCAST - MULTI-TOPIC COVERAGE REQUIRED

HEADLINE TOPICS (MUST COVER ALL ${topicLabels.length} TOPICS):
${topicLabels.map((label, i) => `${i + 1}. ${label}`).join('\n')}

BROADCAST FORMAT REQUIREMENTS:
- OPENING (MANDATORY): Begin with "Today, ${currentDate}, we bring you the following headlines: ${topicList}."
- BODY: Research and cover EACH of the ${topicLabels.length} topics listed above with latest news and developments. Allocate time proportionally across all topics.
- CLOSING (MANDATORY): End with "Thanks for listening and be sure to tune in tomorrow for latest breaking news."

This is a traditional news broadcast. Cover ALL ${topicLabels.length} topics within the allocated time. Do NOT skip any topic.${avoidanceInstructions}`;
    
    const useDailyBrewSettings = preset?.quickBrewEnabled && preset?.quickBrewVoiceIds && preset.quickBrewVoiceIds.length > 0;
    
    let durationMinutes: number;
    let numPeople: number;
    let podcastStyle: string;
    let podcastMood: string;
    let selectedVoiceIds: string[];

    if (useDailyBrewSettings) {
      durationMinutes = preset.quickBrewDurationMinutes ?? 5;
      numPeople = preset.quickBrewNumPeople ?? 1;
      podcastStyle = preset.quickBrewPodcastStyle ?? 'news';
      podcastMood = preset.quickBrewPodcastMood ?? 'balanced';
      selectedVoiceIds = preset.quickBrewVoiceIds ?? [];
    } else {
      durationMinutes = preset?.durationMinutes ?? 5;
      numPeople = preset?.numPeople ?? 1;
      podcastStyle = preset?.podcastStyle ?? 'news';
      podcastMood = preset?.podcastMood ?? 'balanced';
      if (preset?.selectedVoiceIds && preset.selectedVoiceIds.length > 0) {
        selectedVoiceIds = preset.selectedVoiceIds;
      } else {
        const defaultVoice = voicesData[0];
        selectedVoiceIds = [defaultVoice.id];
      }
    }

    const voicesForGeneration = selectedVoiceIds.slice(0, numPeople);

    setIsStartingBrew(true);
    setIsOpen(false);

    try {
      const podcast = await startBrewing({
        templateName: 'Daily Brief',
        durationMinutes,
        requestBody: {
          topic: combinedTopic,
          durationMinutes,
          languageComplexity: preset?.languageComplexity ?? 5,
          numPeople,
          podcastStyle,
          timeFrame: preset?.timeFrame ?? 'past24h',
          coHostPersonality: preset?.coHostPersonality ?? 'executive',
          podcastMood,
          language: preset?.language ?? 'en',
          selectedVoiceIds: voicesForGeneration,
          templateCategory: 'news',
        },
      });

      if (podcast) {
        toast({
          title: "Daily Brief Ready!",
          description: "Your personalized news podcast is ready to play.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Generation failed",
        description: error.message || "Failed to generate podcast. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsStartingBrew(false);
    }
  };

  const handleManageTopics = () => {
    setIsOpen(false);
    setLocation('/?template=news');
    onNavigateToNews?.();
  };

  const handleSaveDailyBrewSettings = (savedPreset: NewsPreset) => {
    queryClient.invalidateQueries({ queryKey: ['/api/news-preset'] });
  };

  if (isLoading) {
    return null;
  }

  // Get voice names for display - use Quick Brew settings if enabled
  const getVoiceNames = () => {
    const useQuickBrew = preset?.quickBrewEnabled && preset?.quickBrewVoiceIds && preset.quickBrewVoiceIds.length > 0;
    const voiceIds = useQuickBrew ? preset.quickBrewVoiceIds : preset?.selectedVoiceIds;
    
    if (!voiceIds || voiceIds.length === 0 || !voicesData) {
      return 'Default';
    }
    const names = voiceIds
      .map(id => voicesData.find(v => v.id === id)?.aliasName || voicesData.find(v => v.id === id)?.name)
      .filter(Boolean)
      .slice(0, 2);
    if (names.length === 0) return 'Default';
    return names.join(', ') + (voiceIds.length > 2 ? ` +${voiceIds.length - 2}` : '');
  };

  // Get current settings for display
  const getCurrentSettings = () => {
    const useQuickBrew = preset?.quickBrewEnabled;
    return {
      duration: useQuickBrew ? (preset?.quickBrewDurationMinutes ?? 5) : (preset?.durationMinutes ?? 5),
      mood: useQuickBrew ? (preset?.quickBrewPodcastMood ?? 'balanced') : (preset?.podcastMood ?? 'balanced'),
      numPeople: useQuickBrew ? (preset?.quickBrewNumPeople ?? 1) : (preset?.numPeople ?? 1),
    };
  };

  const currentSettings = getCurrentSettings();

  const mobileEdgeTab = (
    <button
      onClick={() => setIsOpen(true)}
      className="fixed left-0 top-1/2 -translate-y-1/2 z-40 md:hidden flex flex-col items-center gap-1 px-1.5 py-3 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground rounded-r-lg shadow-lg hover:from-primary/90 hover:to-primary/70 transition-all"
      data-testid="button-daily-brief-edge"
      aria-label="Open Daily Brief"
    >
      <Zap className="h-4 w-4" />
      <span className="text-[10px] font-medium tracking-tight" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
        Brief
      </span>
      {topics.length > 0 && (
        <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[9px] bg-white text-primary">
          {topics.length}
        </Badge>
      )}
    </button>
  );

  const desktopTrigger = topics.length === 0 ? (
    // Empty / setup state — always visible on desktop when no topics configured
    <Card
      className="hidden md:flex bg-gradient-to-br from-primary/5 to-transparent border-primary/20"
      data-testid="card-daily-brief-desktop-empty"
    >
      <CardContent className="p-3 flex items-center justify-between gap-2 w-full">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="p-1.5 rounded-md bg-primary/20 shrink-0">
            <Zap className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-tight">Daily Brief</p>
            <p className="text-xs text-muted-foreground leading-tight">Add topics to get started</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-3 text-xs shrink-0"
          onClick={() => setShowAddTopicModal(true)}
          data-testid="button-daily-brew-setup"
        >
          <Plus className="w-3 h-3 mr-1" />
          Add Topic
        </Button>
      </CardContent>
    </Card>
  ) : (
    // Normal trigger card with topic count and Brew button
    <Tooltip>
      <TooltipTrigger asChild>
        <Card 
          className="hidden md:flex cursor-pointer hover-elevate hover:shadow-lg transition-all bg-gradient-to-br from-primary/5 to-transparent border-primary/20"
          onClick={() => setIsOpen(true)}
          data-testid="card-daily-brief-desktop"
        >
      <CardContent className="p-3 flex items-center justify-between gap-2 w-full">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1.5 rounded-md bg-primary/20 shrink-0">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-sm font-medium truncate">Daily Brief</span>
              <Badge variant="secondary" className="bg-primary/20 text-primary text-[10px] px-1.5 py-0 shrink-0">
                {topics.length}
              </Badge>
            </div>
          </div>
          <Button 
            variant="default" 
            size="sm" 
            className="h-7 px-3 text-xs shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              handleDailyBrew();
            }}
            disabled={isStartingBrew || !voicesReady}
            data-testid="button-daily-brew-desktop"
          >
            {isStartingBrew ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Coffee className="w-3 h-3 mr-1" />
                Daily Brew
              </>
            )}
          </Button>
      </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent side="right">View and manage your saved news topics</TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {!isOpen && !hideEdgeTab && mobileEdgeTab}
      {desktopTrigger}
      
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent 
          side={sheetSide} 
          className={`p-0 flex flex-col ${
            isMobile 
              ? "h-[92vh] rounded-t-xl" 
              : "w-full sm:w-[400px]"
          }`}
        >
          <SheetHeader className="px-4 pt-4 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/20">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              Daily Brief
              <Badge variant="secondary" className="bg-primary/20 text-primary text-xs">
                {topics.length}
              </Badge>
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Your saved topics for quick daily news podcasts
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 px-4 py-3">
            {/* Add Topic — always at top so it's immediately visible */}
            <Button
              variant="default"
              className="w-full mb-4 bg-primary/90 hover:bg-primary"
              onClick={() => setShowAddTopicModal(true)}
              data-testid="button-add-more-topics"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Topic
            </Button>

            {/* Topics List */}
            <div className="space-y-2 mb-4">
              {topics.map((topic) => {
                const CategoryIcon = getCategoryIcon(topic.category || 'custom');
                return (
                  <Card key={topic.id} className="overflow-hidden">
                    <CardContent className="p-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className={`p-1.5 rounded-md ${getCategoryColor(topic.category || 'custom')}`}>
                          <CategoryIcon className="w-3 h-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{topic.label}</p>
                          <p className="text-xs text-muted-foreground capitalize">{topic.category || 'custom'}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(topic.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-topic-${topic.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Settings section — below topics */}
            <Card className="mb-3 bg-gradient-to-r from-primary/10 to-transparent border-primary/20">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <Label htmlFor="daily-brew-toggle" className="text-sm font-medium cursor-pointer">
                      Custom Daily Brew Settings
                    </Label>
                  </div>
                  <Switch
                    id="daily-brew-toggle"
                    checked={preset?.quickBrewEnabled ?? false}
                    onCheckedChange={(checked) => toggleDailyBrewMutation.mutate(checked)}
                    disabled={toggleDailyBrewMutation.isPending}
                    data-testid="switch-daily-brew-enabled"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {preset?.quickBrewEnabled 
                    ? "Using custom Daily Brew settings" 
                    : "Using News template settings"}
                </p>
              </CardContent>
            </Card>

            <Card className="mb-3 bg-muted/30 border-muted">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground">
                    {preset?.quickBrewEnabled ? 'Daily Brew Settings' : 'News Preset Settings'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border border-primary text-xs"
                    onClick={() => {
                      if (preset?.quickBrewEnabled) {
                        setShowDailyBrewSettingsModal(true);
                      } else {
                        handleManageTopics();
                      }
                    }}
                    data-testid="button-customize-preset"
                  >
                    <Settings2 className="w-3 h-3 mr-1.5" />
                    Customize
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Timer className="w-3 h-3 text-muted-foreground" />
                    <span>{currentSettings.duration} min</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Mic2 className="w-3 h-3 text-muted-foreground" />
                    <span className="truncate">{getVoiceNames()}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-muted-foreground" />
                    <span className="capitalize">{currentSettings.mood}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </ScrollArea>

          {/* Footer with Quick Brew - Always visible on both mobile and desktop */}
          {(
          <div className="p-4 border-t bg-card/50 space-y-3">
            {/* Auto-generate info and button row */}
            <div className="flex items-center justify-between gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAutoGenerateModal(true)}
                    className="flex-shrink-0 gap-2"
                    data-testid="button-auto-daily"
                  >
                    <Clock className={`h-4 w-4 ${preset?.autoGenerateEnabled ? 'text-primary' : ''}`} />
                    <span>Auto-Generate</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {preset?.autoGenerateEnabled 
                    ? `Auto-generates at ${preset.autoGenerateTime || '06:00'}` 
                    : 'Schedule auto-generation'}
                </TooltipContent>
              </Tooltip>
              {preset?.autoGenerateEnabled && (
                <p className="text-[10px] text-muted-foreground flex-1 text-right">
                  Auto-generates at {preset.autoGenerateTime || '06:00'} {preset.autoGenerateTimezone || 'UTC'}
                </p>
              )}
            </div>

            {/* Action buttons row */}
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleDailyBrew}
                    disabled={isStartingBrew || !voicesReady || topics.length === 0}
                    className="flex-1 bg-primary hover:bg-primary/90 transition-all duration-200 hover:shadow-lg hover:scale-[1.02]"
                    data-testid="button-daily-brew-panel"
                  >
                {isStartingBrew ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : voicesLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Coffee className="w-4 h-4 mr-2" />
                    Daily Brew
                  </>
                )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Instantly generate a news podcast from your saved topics</TooltipContent>
              </Tooltip>
            </div>
          </div>
          )}
        </SheetContent>
      </Sheet>

      <AutoGenerateSettingsModal
        open={showAutoGenerateModal}
        onOpenChange={setShowAutoGenerateModal}
        preset={preset || null}
      />

      {/* Daily Brew Settings Modal - reuses PresetSetupModal with Daily Brew values */}
      <PresetSetupModal
        open={showDailyBrewSettingsModal}
        onOpenChange={setShowDailyBrewSettingsModal}
        initialValues={{
          durationMinutes: preset?.quickBrewDurationMinutes ?? preset?.durationMinutes ?? 5,
          languageComplexity: preset?.languageComplexity ?? 6,
          numPeople: preset?.quickBrewNumPeople ?? preset?.numPeople ?? 1,
          podcastStyle: preset?.quickBrewPodcastStyle ?? preset?.podcastStyle ?? 'news',
          timeFrame: preset?.timeFrame ?? 'past24h',
          coHostPersonality: preset?.coHostPersonality ?? 'executive',
          podcastMood: preset?.quickBrewPodcastMood ?? preset?.podcastMood ?? 'balanced',
          language: preset?.language ?? 'en',
          selectedVoiceIds: preset?.quickBrewVoiceIds ?? preset?.selectedVoiceIds ?? [],
        }}
        onSave={handleSaveDailyBrewSettings}
        isQuickBrewMode={true}
      />

      {/* Add Topic Modal */}
      <Dialog open={showAddTopicModal} onOpenChange={setShowAddTopicModal}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Add New Topic
            </DialogTitle>
            <DialogDescription>
              Create a new topic for your daily brief
            </DialogDescription>
          </DialogHeader>

          {/* Pro Tip Section */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-foreground">Pro Tip: Multi-Perspective Coverage</span>
            </div>
            <p>
              Add the same topic under <strong className="text-foreground">different categories</strong> for <strong className="text-foreground">richer coverage</strong>.
            </p>
            <div className="space-y-1">
              <p className="text-foreground font-medium">Example: "Elon Musk"</p>
              <ul className="list-disc list-inside space-y-0.5 ml-1">
                <li><Badge variant="outline" className={`${getCategoryColor('tech')} text-[10px] px-1 py-0 mr-1`}>Tech</Badge> SpaceX &amp; innovation news</li>
                <li><Badge variant="outline" className={`${getCategoryColor('finance')} text-[10px] px-1 py-0 mr-1`}>Finance</Badge> Tesla stock updates</li>
                <li><Badge variant="outline" className={`${getCategoryColor('entertainment')} text-[10px] px-1 py-0 mr-1`}>Entertainment</Badge> Public appearances</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="topic-name">Topic Name</Label>
              <Input
                id="topic-name"
                placeholder="e.g., 'Tesla news', 'Climate change'"
                value={newTopicLabel}
                onChange={(e) => setNewTopicLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTopicLabel.trim()) {
                    createTopicMutation.mutate();
                  }
                }}
                disabled={createTopicMutation.isPending}
                data-testid="input-topic-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic-category">Category</Label>
              <Select value={newTopicCategory} onValueChange={setNewTopicCategory} disabled={createTopicMutation.isPending}>
                <SelectTrigger id="topic-category" data-testid="select-topic-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPIC_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setShowAddTopicModal(false)}
              disabled={createTopicMutation.isPending}
              data-testid="button-cancel-topic"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createTopicMutation.mutate()}
              disabled={!newTopicLabel.trim() || createTopicMutation.isPending}
              data-testid="button-save-topic"
            >
              {createTopicMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Topic
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
