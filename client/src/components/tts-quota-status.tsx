import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Zap, AlertCircle, CheckCircle2 } from "lucide-react";

interface QuotaStats {
  tier: string;
  today: string;
  requests: number;
  cacheHits: number;
  limit: number;
  remaining: number;
  usagePercent: number;
  status: 'ok' | 'warning' | 'exhausted';
}

export function TtsQuotaStatus() {
  const { data: quotaStats, isLoading } = useQuery<QuotaStats>({
    queryKey: ["/api/tts/quota"],
  });

  if (isLoading) {
    return (
      <Card className="divide-y divide-border/50" data-testid="card-tts-quota">
        <div className="p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0 animate-pulse">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold">Google Tier 1 Quota</h3>
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!quotaStats) {
    return null;
  }

  const statusConfig = {
    ok: { icon: CheckCircle2, color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-950" },
    warning: { icon: AlertCircle, color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-950" },
    exhausted: { icon: AlertCircle, color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-950" },
  };

  const config = statusConfig[quotaStats.status];
  const StatusIcon = config.icon;

  return (
    <Card className="divide-y divide-border/50" data-testid="card-tts-quota">
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold">Google Tier 1 Quota</h3>
          <p className="text-xs text-muted-foreground">Text-to-speech generation limits</p>
        </div>
      </div>

      {/* Status Badge */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className={`h-4 w-4 ${config.color}`} />
          <span className="text-sm font-medium">Status</span>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${config.bg}`}>
          {quotaStats.status === 'ok' && 'Healthy'}
          {quotaStats.status === 'warning' && 'Warning'}
          {quotaStats.status === 'exhausted' && 'Exhausted'}
        </div>
      </div>

      {/* Usage Stats */}
      <div className="p-4">
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Daily Requests</span>
            <span className="font-medium">{quotaStats.requests} / {quotaStats.limit}</span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                quotaStats.status === 'ok'
                  ? 'bg-green-600'
                  : quotaStats.status === 'warning'
                  ? 'bg-yellow-600'
                  : 'bg-red-600'
              }`}
              style={{ width: `${Math.min(quotaStats.usagePercent, 100)}%` }}
            />
          </div>
          
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{quotaStats.usagePercent.toFixed(1)}% used</span>
            <span>{quotaStats.remaining} remaining</span>
          </div>
        </div>
      </div>

      {/* Cache Stats */}
      <div className="p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cache Hits</span>
            <span className="font-medium">{quotaStats.cacheHits}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Reused audio from cache, saving quota usage
          </div>
        </div>
      </div>

      {/* Reset Info */}
      <div className="p-4 bg-muted/30">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Reset:</span> Today at midnight PT ({quotaStats.today})
        </p>
      </div>
    </Card>
  );
}
