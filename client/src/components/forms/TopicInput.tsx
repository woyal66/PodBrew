import { Mic, Sparkles, MapPin, Zap, Loader2 } from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MorpheusFloatingAvatar } from "@/components/MorpheusFloatingAvatar";
import { Progress } from "@/components/ui/progress";

interface TopicInputProps {
  label: string;
  description: string;
  placeholder: string;
  icon: LucideIcon;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  onVoiceInput: () => void;
  onEnhanceTopic: () => void;
  onToggleLocation?: () => void;
  onMorpheus?: () => void;
  onQuickBrew?: () => void;
  isListening: boolean;
  isEnhancing: boolean;
  isGenerating: boolean;
  isQuickBrewLoading?: boolean;
  brewProgress?: number;
  brewStatus?: string;
  topicRef?: React.RefObject<HTMLTextAreaElement>;
  maxLength?: number;
  locationEnabled?: boolean;
  locationCity?: string | null;
  showLocationToggle?: boolean;
  showMorpheus?: boolean;
  isMorpheusOpen?: boolean;
  showQuickBrew?: boolean;
  compact?: boolean;
}

export function TopicInput({
  label,
  description,
  placeholder,
  icon: Icon,
  testId,
  value,
  onChange,
  onVoiceInput,
  onEnhanceTopic,
  onToggleLocation,
  onMorpheus,
  onQuickBrew,
  isListening,
  isEnhancing,
  isGenerating,
  isQuickBrewLoading = false,
  brewProgress = 0,
  brewStatus = "",
  topicRef,
  maxLength = 5000,
  locationEnabled = false,
  locationCity = null,
  showLocationToggle = true,
  showMorpheus = true,
  isMorpheusOpen = false,
  showQuickBrew = false,
  compact = false,
}: TopicInputProps) {
  return (
    <div className="space-y-2">
      {!compact && (
        <Label htmlFor={testId} className="text-base font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {label}
        </Label>
      )}
      {!compact && (
        <p className="text-sm text-muted-foreground">
          {description}
        </p>
      )}
      <div className="relative">
        {/* Morpheus Floating Avatar - only visible when text is entered */}
        {showMorpheus && onMorpheus && value.trim() && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <MorpheusFloatingAvatar
                  onClick={onMorpheus}
                  disabled={isGenerating}
                  isActive={isMorpheusOpen}
                  className="left-2 bottom-[100px]"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8} className="max-w-[150px] text-xs">
              <p className="font-medium">Morpheus Wizard</p>
              <p className="text-muted-foreground">Refine your topic</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Textarea
          ref={topicRef}
          id={testId}
          data-testid={testId}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isGenerating}
          rows={compact ? 3 : 4}
          className="resize-none text-base border-2 border-primary shadow-[0_0_20px_hsl(var(--primary)/0.4)] focus-visible:shadow-[0_0_30px_hsl(var(--primary)/0.6)] focus-visible:border-primary transition-all duration-300"
          maxLength={maxLength}
        />
        
        <div className="flex gap-2 mt-2 justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onVoiceInput}
                disabled={isListening || isGenerating}
                data-testid="button-voice-input"
                aria-label={isListening ? "Stop listening" : "Voice input"}
                className={cn(isListening && "bg-destructive/10 border-destructive")}
              >
                <Mic className={cn("w-4 h-4", isListening && "text-destructive animate-pulse")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Speak your topic</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onEnhanceTopic}
                disabled={!value.trim() || isEnhancing || isGenerating}
                data-testid="button-enhance-topic"
                aria-label={isEnhancing ? "Enhancing..." : "AI enhance topic"}
              >
                {isEnhancing ? (
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isEnhancing ? "Enhancing..." : "AI enhance topic"}
            </TooltipContent>
          </Tooltip>
          {showLocationToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onToggleLocation}
                  disabled={isGenerating}
                  data-testid="button-location-toggle"
                  aria-label={locationEnabled && locationCity ? `Toggle location: ${locationCity}` : "Toggle location"}
                  className={cn(
                    locationEnabled && locationCity 
                      ? "border-primary bg-primary/10 text-primary hover-elevate" 
                      : "hover-elevate"
                  )}
                >
                  <MapPin className={cn("w-4 h-4", !locationEnabled && "opacity-50")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {locationEnabled && locationCity 
                  ? `Location enabled: ${locationCity}. Click to disable.` 
                  : "Click to enable location for local content"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {value && (
          <p className="text-xs text-muted-foreground mt-1">
            {value.length} / {maxLength} characters
          </p>
        )}
        
        {/* Quick 2-min Podcast Button - for new users */}
        {showQuickBrew && value.trim() && onQuickBrew && (
          <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Button
              type="button"
              onClick={onQuickBrew}
              disabled={isGenerating || isQuickBrewLoading}
              className="w-full bg-gradient-to-r from-primary to-emerald-500 hover:from-primary/90 hover:to-emerald-500/90 text-white font-semibold py-5 h-auto text-base rounded-xl shadow-lg shadow-primary/25 transition-all"
              data-testid="button-quick-brew"
            >
              {isQuickBrewLoading ? (
                <div className="flex flex-col items-center w-full gap-2">
                  <div className="flex items-center justify-center">
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    <span>Creating your podcast...</span>
                  </div>
                  {isQuickBrewLoading && brewProgress > 0 && (
                    <div className="w-full max-w-xs px-4">
                      <Progress value={brewProgress} className="h-1.5" />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Quick 2-min Podcast
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Instant preview with AI-selected voice and settings
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
