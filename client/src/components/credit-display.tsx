import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Coins, Loader2, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";

interface CreditDisplayProps {
  onUpgradeClick?: () => void;
}

export function CreditDisplay({ onUpgradeClick }: CreditDisplayProps) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  
  const { data, isLoading } = useQuery<{ credits: number; plan: string }>({
    queryKey: ['/api/user/credits'],
    enabled: !isAuthLoading && isAuthenticated,
    placeholderData: { credits: 0, plan: 'free' },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card" data-testid="credit-display-loading">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const credits = data?.credits ?? 0;
  const plan = data?.plan ?? 'free';
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const isFree = plan === 'free';
  const isLowCredits = credits < 10;

  // Color coding based on credit levels
  const getCreditColor = () => {
    if (credits === 0) return "destructive";
    if (credits < 10) return "secondary";
    return "default";
  };

  // Calculate minutes from credits (using standard quality 0.2 cr/min)
  const minutes = Math.floor(credits / 0.2);

  return (
    <div className="flex items-center gap-1.5 md:gap-2">
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <div 
              className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded-md bg-card border border-border hover-elevate cursor-help transition-all"
              data-testid="credit-display"
            >
              <Coins className="h-3.5 w-3.5 md:h-4 md:w-4 text-primary" />
              <div className="flex items-center gap-1 md:gap-2">
                <span className="text-xs md:text-sm font-semibold" data-testid="text-credits">
                  {credits.toFixed(1)}
                </span>
                <Badge 
                  variant={getCreditColor()} 
                  className="text-[10px] md:text-xs px-1.5 py-0" 
                  data-testid="badge-plan"
                >
                  {planLabel}
                </Badge>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-2">
              <p className="font-semibold">{credits.toFixed(1)} credits = ~{minutes} minutes</p>
              <p className="text-xs text-muted-foreground">
                Standard • Premium • Ultra • Cinematic quality tiers
              </p>
              {isFree && (
                <p className="text-xs text-primary pt-2 border-t flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span>Upgrade to Creator for 30 credits/mo</span>
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {isFree && isLowCredits && onUpgradeClick && (
        <Button
          variant="default"
          size="sm"
          onClick={onUpgradeClick}
          className="bg-[#1DB954] hover:bg-[#1DB954]/90 text-black gap-1 md:gap-1.5 h-7 md:h-8 px-2 md:px-3 text-[10px] md:text-xs premium-glow"
          data-testid="button-upgrade-credits"
        >
          <Sparkles className="h-3 w-3 md:h-3.5 md:w-3.5" />
          <span>Upgrade</span>
        </Button>
      )}
    </div>
  );
}
