import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { type Voice } from "@shared/schema";

interface VoiceControlsProps {
  selectedVoiceIds: string[];
  selectedVoices: Voice[];
  onOpenModal: () => void;
  creditsData?: { credits: number; plan: string };
  durationMinutes: number;
  isGenerating: boolean;
}

export function VoiceControls({
  selectedVoiceIds,
  selectedVoices,
  onOpenModal,
  isGenerating,
}: VoiceControlsProps) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Select Host (Voice)</Label>
      <Button
        type="button"
        variant="outline"
        onClick={onOpenModal}
        disabled={isGenerating}
        className="w-full justify-between h-9"
        data-testid="button-choose-voices"
      >
        <span className="flex items-center gap-2">
          <Mic className="w-4 h-4" />
          {selectedVoiceIds.length === 0 
            ? "Select voice(s)" 
            : selectedVoices.map(v => v.aliasName || v.displayName).join(", ")
          }
        </span>
        {selectedVoiceIds.length > 0 && (
          <Badge variant="secondary" className="ml-2 text-[10px]" data-testid="text-selected-count">
            {selectedVoiceIds.length}
          </Badge>
        )}
      </Button>
    </div>
  );
}
