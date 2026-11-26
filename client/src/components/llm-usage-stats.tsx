import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Brain, TrendingDown, Zap, DollarSign } from "lucide-react";

interface LlmStats {
  totalRequests: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDuration: number;
  byModel: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }>;
  byTaskType: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }>;
  last24h: {
    requests: number;
    cost: number;
    savings: number;
  };
  openRouterAvailable: boolean;
}

export function LlmUsageStats() {
  const { data: stats, isLoading } = useQuery<LlmStats>({
    queryKey: ["/api/llm/stats"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card className="divide-y divide-border/50" data-testid="card-llm-stats">
        <div className="p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/10 shrink-0 animate-pulse">
            <Brain className="h-4 w-4 text-purple-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold">AI Model Usage</h3>
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!stats) {
    return null;
  }

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(3)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const savingsPercent = stats.last24h.cost > 0 
    ? ((stats.last24h.savings / (stats.last24h.cost + stats.last24h.savings)) * 100).toFixed(0)
    : 0;

  return (
    <Card className="divide-y divide-border/50" data-testid="card-llm-stats">
      <div className="p-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/10 shrink-0">
          <Brain className="h-4 w-4 text-purple-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold">AI Model Usage</h3>
          <p className="text-xs text-muted-foreground">Hybrid LLM cost optimization</p>
        </div>
        {stats.openRouterAvailable && (
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400">
            OpenRouter Active
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              Total Requests
            </div>
            <p className="text-lg font-semibold" data-testid="text-llm-total-requests">
              {stats.totalRequests}
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              Total Cost
            </div>
            <p className="text-lg font-semibold" data-testid="text-llm-total-cost">
              {formatCost(stats.totalCost)}
            </p>
          </div>
        </div>
      </div>

      {stats.last24h.savings > 0 && (
        <div className="p-4 bg-green-50/50 dark:bg-green-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium">24h Savings</span>
            </div>
            <div className="text-right">
              <span className="text-lg font-bold text-green-600 dark:text-green-400">
                {formatCost(stats.last24h.savings)}
              </span>
              <span className="text-xs text-muted-foreground ml-1">
                ({savingsPercent}% saved)
              </span>
            </div>
          </div>
        </div>
      )}

      {Object.keys(stats.byModel).length > 0 && (
        <div className="p-4">
          <h4 className="text-sm font-medium mb-3">By Model</h4>
          <div className="space-y-2">
            {Object.entries(stats.byModel).map(([model, data]) => (
              <div key={model} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground truncate max-w-[60%]">
                  {model.replace('openai/', '').replace('deepseek/', '')}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{data.requests} req</span>
                  <span className="font-medium">{formatCost(data.cost)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(stats.byTaskType).length > 0 && (
        <div className="p-4">
          <h4 className="text-sm font-medium mb-3">By Task</h4>
          <div className="space-y-2">
            {Object.entries(stats.byTaskType).map(([task, data]) => (
              <div key={task} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground capitalize">
                  {task.replace(/_/g, ' ')}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatTokens(data.inputTokens + data.outputTokens)} tokens
                  </span>
                  <span className="font-medium">{formatCost(data.cost)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 bg-muted/30">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Strategy:</span> GPT-4o-mini for titles (94% savings), GPT-4o for quality-critical tasks
        </p>
      </div>
    </Card>
  );
}
