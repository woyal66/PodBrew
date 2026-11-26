import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock, Globe, AlertCircle, CheckCircle2, XCircle, CreditCard, Eye, EyeOff, Trash2 } from "lucide-react";
import { type NewsPreset } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

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

interface AutoGenerateSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: NewsPreset | null;
}

export function AutoGenerateSettingsModal({ open, onOpenChange, preset }: AutoGenerateSettingsModalProps) {
  const { toast } = useToast();
  
  const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(false);
  const [autoGenerateTime, setAutoGenerateTime] = useState("06:00");
  const [autoGenerateTimezone, setAutoGenerateTimezone] = useState("UTC");
  const [autoGeneratePublic, setAutoGeneratePublic] = useState(true);

  useEffect(() => {
    if (preset) {
      setAutoGenerateEnabled(preset.autoGenerateEnabled ?? false);
      setAutoGenerateTime(preset.autoGenerateTime ?? "06:00");
      setAutoGenerateTimezone(preset.autoGenerateTimezone ?? "UTC");
      setAutoGeneratePublic(preset.autoGeneratePublic ?? true);
    }
  }, [preset]);

  const { data: userData } = useQuery<{ credits: number; subscriptionPlan: string }>({
    queryKey: ['/api/user/credits'],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/news-preset", {
        autoGenerateEnabled,
        autoGenerateTime,
        autoGenerateTimezone,
        autoGeneratePublic,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/news-preset'] });
      toast({
        title: autoGenerateEnabled ? "Auto-Generate Enabled" : "Auto-Generate Disabled",
        description: autoGenerateEnabled 
          ? `Your Daily Brief will auto-generate at ${formatTime(autoGenerateTime)} ${autoGenerateTimezone}`
          : "Auto-generation has been turned off",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save settings",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const formatTime = (time: string) => {
    const [hour] = time.split(':').map(Number);
    if (hour === 0) return "12:00 AM";
    if (hour === 12) return "12:00 PM";
    return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
  };

  const getStatusIcon = (status: string | null | undefined) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'insufficient_credits':
        return <CreditCard className="w-4 h-4 text-yellow-500" />;
      case 'failed':
      case 'skipped':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string | null | undefined) => {
    switch (status) {
      case 'success':
        return "Completed successfully";
      case 'insufficient_credits':
        return "Skipped - insufficient credits";
      case 'failed':
        return "Generation failed";
      case 'skipped':
        return "Skipped - no topics";
      default:
        return "Never run";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Auto-Generate Settings
          </DialogTitle>
          <DialogDescription>
            Schedule automatic Daily Brief generation at your preferred time
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-generate-toggle" className="text-base font-medium">
                Enable Auto-Generate
              </Label>
              <p className="text-sm text-muted-foreground">
                Automatically create your Daily Brief
              </p>
            </div>
            <Switch
              id="auto-generate-toggle"
              checked={autoGenerateEnabled}
              onCheckedChange={setAutoGenerateEnabled}
              data-testid="switch-auto-generate-enabled"
            />
          </div>

          {autoGenerateEnabled && (
            <>
              <div className="space-y-3">
                <Label className="text-sm font-medium">Time of Day</Label>
                <Select value={autoGenerateTime} onValueChange={setAutoGenerateTime}>
                  <SelectTrigger data-testid="select-auto-generate-time">
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

              <div className="space-y-3">
                <Label className="text-sm font-medium">Timezone</Label>
                <Select value={autoGenerateTimezone} onValueChange={setAutoGenerateTimezone}>
                  <SelectTrigger data-testid="select-auto-generate-timezone">
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
                <div className="space-y-0.5">
                  <Label htmlFor="auto-generate-public" className="text-sm font-medium flex items-center gap-2">
                    {autoGeneratePublic ? (
                      <Eye className="w-4 h-4 text-primary" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-muted-foreground" />
                    )}
                    Visibility
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {autoGeneratePublic ? "Visible in Explore feed" : "Only visible to you"}
                  </p>
                </div>
                <Switch
                  id="auto-generate-public"
                  checked={autoGeneratePublic}
                  onCheckedChange={setAutoGeneratePublic}
                  data-testid="switch-auto-generate-public"
                />
              </div>
            </>
          )}

          <Alert className="bg-yellow-500/10 border-yellow-500/30">
            <CreditCard className="w-4 h-4 text-yellow-500" />
            <AlertDescription className="text-sm">
              <strong>Credit Usage:</strong> Each auto-generated podcast consumes credits based on duration and voice quality. 
              Generation will be skipped if you have insufficient credits.
              {userData && (
                <span className="block mt-1 text-xs text-muted-foreground">
                  Current balance: {userData.credits?.toFixed(1) ?? 0} credits
                </span>
              )}
            </AlertDescription>
          </Alert>

          <Alert className="bg-primary/5 border-primary/20">
            <Trash2 className="w-4 h-4 text-primary" />
            <AlertDescription className="text-sm text-muted-foreground">
              <strong className="text-foreground">Storage Policy:</strong>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                <li>News podcasts are deleted after <strong>3 days</strong></li>
                <li>Podcasts with less than 2 plays are deleted after <strong>7 days</strong></li>
              </ul>
            </AlertDescription>
          </Alert>

          {preset?.lastAutoGeneratedAt && (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                {getStatusIcon(preset.lastGenerateStatus)}
                <div>
                  <p className="text-sm font-medium">Last Auto-Generate</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(preset.lastAutoGeneratedAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {getStatusText(preset.lastGenerateStatus)}
              </Badge>
            </div>
          )}

          {preset?.lastGenerateError && preset.lastGenerateStatus === 'failed' && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-sm">
                {preset.lastGenerateError}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={() => saveMutation.mutate()} 
            disabled={saveMutation.isPending}
            data-testid="button-save-auto-generate"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
