import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CoHostPersonalityProps {
  value: string;
  onChange: (personality: string) => void;
  numPeople: number;
  isGenerating?: boolean;
  personalityOptions?: Array<{ value: string; label: string }>;
  showWhen?: number;
}

const DEFAULT_PERSONALITY_OPTIONS = [
  { value: "casual", label: "Casual" },
  { value: "academic", label: "Academic" },
  { value: "executive", label: "Executive" },
  { value: "storyteller", label: "Storyteller" },
  { value: "investigative", label: "Investigative" },
];

export function CoHostPersonality({
  value,
  onChange,
  numPeople,
  isGenerating = false,
  personalityOptions = DEFAULT_PERSONALITY_OPTIONS,
  showWhen = 2,
}: CoHostPersonalityProps) {
  if (numPeople < showWhen) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Co-Host Personality</Label>
      <Select value={value} onValueChange={onChange} disabled={isGenerating}>
        <SelectTrigger data-testid="select-cohost-personality" className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {personalityOptions.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
