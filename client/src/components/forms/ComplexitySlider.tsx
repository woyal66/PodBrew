import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface ComplexitySliderProps {
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  isGenerating: boolean;
  label?: string;
}

const COMPLEXITY_LEVELS = [
  { value: 2, label: "Basic" },
  { value: 4, label: "Simple" },
  { value: 6, label: "Normal" },
  { value: 8, label: "Deep" },
  { value: 10, label: "Expert" },
];

function getComplexityLabel(value: number): string {
  const level = COMPLEXITY_LEVELS.find(l => l.value === value);
  if (level) return level.label;
  if (value <= 2) return "Basic";
  if (value <= 4) return "Simple";
  if (value <= 6) return "Normal";
  if (value <= 8) return "Deep";
  return "Expert";
}

function getComplexityIndex(value: number): number {
  const index = COMPLEXITY_LEVELS.findIndex(l => l.value === value);
  return index >= 0 ? index : 2;
}

export function ComplexitySlider({
  languageComplexity,
  setLanguageComplexity,
  isGenerating,
  label = "Language Complexity",
}: ComplexitySliderProps) {
  const handleSliderChange = (value: number[]) => {
    const index = value[0];
    const complexity = COMPLEXITY_LEVELS[index]?.value ?? 6;
    setLanguageComplexity(complexity);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="text-sm text-muted-foreground">{getComplexityLabel(languageComplexity)}</span>
      </div>
      
      <Slider
        value={[getComplexityIndex(languageComplexity)]}
        onValueChange={handleSliderChange}
        max={COMPLEXITY_LEVELS.length - 1}
        step={1}
        disabled={isGenerating}
        className="cursor-pointer"
        showSteps
        data-testid="slider-complexity"
      />
    </div>
  );
}
