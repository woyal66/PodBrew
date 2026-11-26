import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, Calendar, Zap, Clock, BookOpen, Globe, Eye, EyeOff } from "lucide-react";

export type DeliveryMode = "single" | "binge" | "daily";

export interface DailyScheduleSettings {
  autoGenerateEnabled: boolean;
  autoGenerateTime: string;
  autoGenerateTimezone: string;
  autoGeneratePublic: boolean;
}

const COMMON_TIMEZONES = [
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Chicago", label: "Central Time (US)" },
  { value: "America/Denver", label: "Mountain Time (US)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "America/Phoenix", label: "Arizona (US)" },
  { value: "America/Anchorage", label: "Alaska (US)" },
  { value: "Pacific/Honolulu", label: "Hawaii (US)" },
  { value: "Europe/London", label: "London (UK)" },
  { value: "Europe/Paris", label: "Paris (France)" },
  { value: "Europe/Berlin", label: "Berlin (Germany)" },
  { value: "Europe/Moscow", label: "Moscow (Russia)" },
  { value: "Asia/Tokyo", label: "Tokyo (Japan)" },
  { value: "Asia/Shanghai", label: "Shanghai (China)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Dubai", label: "Dubai (UAE)" },
  { value: "Asia/Kolkata", label: "Mumbai (India)" },
  { value: "Australia/Sydney", label: "Sydney (Australia)" },
  { value: "Australia/Brisbane", label: "Brisbane (Australia)" },
  { value: "Australia/Perth", label: "Perth (Australia)" },
  { value: "Pacific/Auckland", label: "Auckland (New Zealand)" },
];

const TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const time = `${hour.toString().padStart(2, '0')}:00`;
  const label = hour === 0 ? "12:00 AM (Midnight)" 
    : hour === 12 ? "12:00 PM (Noon)"
    : hour < 12 ? `${hour}:00 AM` 
    : `${hour - 12}:00 PM`;
  return { value: time, label };
});

interface CourseSettingsPanelProps {
  deliveryMode: DeliveryMode;
  setDeliveryMode: (mode: DeliveryMode) => void;
  episodeCount: number;
  setEpisodeCount: (count: number) => void;
  episodeDuration: number;
  setEpisodeDuration: (duration: number) => void;
  isGenerating?: boolean;
  dailySchedule?: DailyScheduleSettings;
  setDailySchedule?: (settings: DailyScheduleSettings) => void;
}

export function CourseSettingsPanel({
  deliveryMode,
  setDeliveryMode,
  episodeCount,
  setEpisodeCount,
  episodeDuration,
  setEpisodeDuration,
  isGenerating = false,
  dailySchedule = {
    autoGenerateEnabled: true,
    autoGenerateTime: "08:00",
    autoGenerateTimezone: "UTC",
    autoGeneratePublic: true,
  },
  setDailySchedule,
}: CourseSettingsPanelProps) {
  const totalMinutes = deliveryMode === "single" ? episodeDuration : episodeCount * episodeDuration;
  const estimatedCredits = (totalMinutes * 0.1).toFixed(1);

  const updateDailySchedule = (key: keyof DailyScheduleSettings, value: any) => {
    if (setDailySchedule) {
      setDailySchedule({ ...dailySchedule, [key]: value });
    }
  };

  return (
    <Card className="bg-card/50 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-primary" />
          Course Structure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label className="text-sm font-medium">Delivery Mode</Label>
          <RadioGroup
            value={deliveryMode}
            onValueChange={(value) => setDeliveryMode(value as DeliveryMode)}
            disabled={isGenerating}
            className="grid grid-cols-1 gap-2"
          >
            <label
              htmlFor="mode-single"
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                deliveryMode === "single"
                  ? "border-primary bg-primary/10"
                  : "border-muted hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="single" id="mode-single" className="sr-only" />
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Single Episode</div>
                <div className="text-xs text-muted-foreground">One podcast covering your topic</div>
              </div>
              {deliveryMode === "single" && (
                <Badge variant="secondary" className="text-xs">Selected</Badge>
              )}
            </label>

            <label
              htmlFor="mode-binge"
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                deliveryMode === "binge"
                  ? "border-primary bg-primary/10"
                  : "border-muted hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="binge" id="mode-binge" className="sr-only" />
              <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-orange-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Binge Course</div>
                <div className="text-xs text-muted-foreground">Generate all episodes now as a playlist</div>
              </div>
              {deliveryMode === "binge" && (
                <Badge variant="secondary" className="text-xs">Selected</Badge>
              )}
            </label>

            <label
              htmlFor="mode-daily"
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                deliveryMode === "daily"
                  ? "border-primary bg-primary/10"
                  : "border-muted hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="daily" id="mode-daily" className="sr-only" />
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Daily Micro-Learning</div>
                <div className="text-xs text-muted-foreground">One episode per day, scheduled</div>
              </div>
              {deliveryMode === "daily" && (
                <Badge variant="secondary" className="text-xs">Selected</Badge>
              )}
            </label>
          </RadioGroup>
        </div>

        {/* Daily Schedule Settings */}
        {deliveryMode === "daily" && setDailySchedule && (
          <div className="space-y-4 pt-3 border-t">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Schedule Generation</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically create one episode each day
                </p>
              </div>
              <Switch
                checked={dailySchedule.autoGenerateEnabled}
                onCheckedChange={(checked) => updateDailySchedule('autoGenerateEnabled', checked)}
                disabled={isGenerating}
                data-testid="switch-daily-auto-generate"
              />
            </div>

            {dailySchedule.autoGenerateEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Time of Day</Label>
                  <Select 
                    value={dailySchedule.autoGenerateTime} 
                    onValueChange={(value) => updateDailySchedule('autoGenerateTime', value)}
                    disabled={isGenerating}
                  >
                    <SelectTrigger data-testid="select-daily-time">
                      <Clock className="w-4 h-4 mr-2 text-muted-foreground" />
                      <SelectValue placeholder="Select time" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {TIME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Timezone</Label>
                  <Select 
                    value={dailySchedule.autoGenerateTimezone} 
                    onValueChange={(value) => updateDailySchedule('autoGenerateTimezone', value)}
                    disabled={isGenerating}
                  >
                    <SelectTrigger data-testid="select-daily-timezone">
                      <Globe className="w-4 h-4 mr-2 text-muted-foreground" />
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {COMMON_TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {dailySchedule.autoGeneratePublic ? (
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <Label className="text-sm font-medium">Visibility</Label>
                      <p className="text-xs text-muted-foreground">
                        {dailySchedule.autoGeneratePublic ? "Visible in Explore" : "Private"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={dailySchedule.autoGeneratePublic}
                    onCheckedChange={(checked) => updateDailySchedule('autoGeneratePublic', checked)}
                    disabled={isGenerating}
                    data-testid="switch-daily-visibility"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {deliveryMode !== "single" && (
          <div className="space-y-3 pt-2 border-t">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-medium">Number of Episodes</Label>
                <span className="text-sm font-mono text-primary">{episodeCount}</span>
              </div>
              <Slider
                value={[episodeCount]}
                onValueChange={([value]) => setEpisodeCount(value)}
                min={2}
                max={30}
                step={1}
                disabled={isGenerating}
                className="py-2"
                data-testid="slider-episode-count"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>2 episodes</span>
                <span>30 episodes (max)</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-medium">Episode Duration</Label>
                <span className="text-sm font-mono text-primary">{episodeDuration} min</span>
              </div>
              <Slider
                value={[episodeDuration]}
                onValueChange={([value]) => setEpisodeDuration(value)}
                min={5}
                max={30}
                step={5}
                disabled={isGenerating}
                className="py-2"
                data-testid="slider-episode-duration"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>5 min</span>
                <span>30 min</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span>Total Duration:</span>
          </div>
          <div className="text-right">
            <div className="font-semibold text-sm">
              {deliveryMode === "single" ? (
                <span>{episodeDuration} minutes</span>
              ) : (
                <span>{episodeCount} × {episodeDuration} min = {totalMinutes} min</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              ~{estimatedCredits} credits
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
