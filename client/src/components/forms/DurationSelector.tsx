import { useMemo } from "react";
import { Zap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

interface DurationSelectorProps {
  durationMinutes: number;
  setDurationMinutes: (minutes: number) => void;
  isGenerating?: boolean;
}

const DURATION_OPTIONS = [2, 5, 10, 15, 20];

const DURATION_LABELS: Record<number, { label: string }> = {
  2: { label: "Quick" },
  5: { label: "Short" },
  10: { label: "Standard" },
  15: { label: "Medium" },
  20: { label: "Extended" },
};

function getDurationLabel(minutes: number): string {
  if (DURATION_LABELS[minutes]) return DURATION_LABELS[minutes].label;
  if (minutes <= 5) return "Quick";
  if (minutes <= 10) return "Short";
  if (minutes <= 15) return "Medium";
  return "Extended";
}

export function DurationSelector({
  durationMinutes,
  setDurationMinutes,
  isGenerating = false,
}: DurationSelectorProps) {
  const durationIndex = useMemo(() => {
    return DURATION_OPTIONS.indexOf(durationMinutes);
  }, [durationMinutes]);

  const handleSliderChange = (value: number[]) => {
    const index = value[0];
    const minutes = DURATION_OPTIONS[index];
    setDurationMinutes(minutes);
  };

  const costEstimate = (durationMinutes * 0.025).toFixed(2);

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-sm font-medium">Duration</Label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">{durationMinutes} min</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
              {getDurationLabel(durationMinutes)}
            </Badge>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 rounded-md">
            <Zap className="w-3 h-3 text-primary" />
            <span className="text-xs font-medium text-primary">${costEstimate}</span>
          </div>
        </div>
      </div>
      
      <Slider
        value={[durationIndex >= 0 ? durationIndex : 0]}
        onValueChange={handleSliderChange}
        max={DURATION_OPTIONS.length - 1}
        step={1}
        disabled={isGenerating}
        className="cursor-pointer"
        showSteps
        data-testid="slider-duration"
      />
      
      <div className="relative h-6 mt-2 px-0.5">
        <span className="absolute text-[10px] text-muted-foreground left-0 -translate-x-1/2">2m</span>
        <span className="absolute text-[10px] text-muted-foreground left-1/2 -translate-x-1/2">10m</span>
        <span className="absolute text-[10px] text-muted-foreground right-0 translate-x-1/2">20m</span>
      </div>
    </div>
  );
}
