import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Check } from "lucide-react";

interface CostSummaryProps {
  durationMinutes: number;
  creditsData?: { credits: number; plan: string };
  templateName?: string;
}

export function CostSummary({ durationMinutes, creditsData, templateName }: CostSummaryProps) {
  const CREDITS_PER_MINUTE = 0.1;
  const creditsCost = Math.ceil(durationMinutes * CREDITS_PER_MINUTE * 10) / 10;
  const hasEnoughCredits = !creditsData || creditsData.credits >= creditsCost;
  const remainingCredits = creditsData ? creditsData.credits - creditsCost : 0;
  const remainingMinutes = Math.floor(remainingCredits / CREDITS_PER_MINUTE);

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs font-medium">Duration</p>
              <p className="text-foreground font-semibold">{durationMinutes} min</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium">Cost</p>
              <p className="text-primary font-semibold">{creditsCost} credits</p>
            </div>
          </div>

          {creditsData && (
            <div className="pt-2 border-t border-primary/10">
              <div className="flex items-start gap-2">
                {hasEnoughCredits ? (
                  <>
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="text-foreground font-medium">
                        You have enough credits
                      </p>
                      <p className="text-muted-foreground">
                        {remainingCredits} credits remaining ({remainingMinutes} min)
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="text-foreground font-medium">
                        Insufficient credits
                      </p>
                      <p className="text-muted-foreground">
                        Need {creditsCost} credits, have {creditsData.credits}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
