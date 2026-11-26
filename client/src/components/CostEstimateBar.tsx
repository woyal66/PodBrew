import { Zap, AlertCircle } from "lucide-react";

interface CostEstimateBarProps {
  durationMinutes: number;
  numPeople: number;
  creditsAvailable?: number;
  plan?: string;
}

export function CostEstimateBar({
  durationMinutes,
  numPeople,
  creditsAvailable = 0,
  plan = "free",
}: CostEstimateBarProps) {
  // Cost calculation: $0.025 per minute ($1.50 per 60 minutes)
  const estimatedCost = (durationMinutes * 0.025).toFixed(2);
  const costAsNumber = parseFloat(estimatedCost);
  
  // Convert credits to dollar equivalent for comparison
  // Credits are at 0.1 per minute, dollars at 0.025 per minute
  const creditsInDollars = creditsAvailable * 0.25; // 1 credit = $0.25
  const hasEnoughCredits = creditsInDollars >= costAsNumber;

  return (
    <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Estimated Cost</span>
      </div>
      <div className="flex items-center gap-2">
        {!hasEnoughCredits && creditsAvailable !== undefined && (
          <AlertCircle className="w-4 h-4 text-destructive" />
        )}
        <span className="text-lg font-semibold text-primary">${estimatedCost}</span>
      </div>
    </div>
  );
}
