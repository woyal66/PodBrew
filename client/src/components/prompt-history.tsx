import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface PromptHistoryProps {
  onSelectPrompt: (prompt: string) => void;
}

export function PromptHistory({ onSelectPrompt }: PromptHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: prompts = [], isLoading } = useQuery<string[]>({
    queryKey: ['/api/prompts/history'],
  });

  if (isLoading || prompts.length === 0) {
    return null;
  }

  const displayedPrompts = isExpanded ? prompts : prompts.slice(0, 5);

  return (
    <div className="space-y-3" data-testid="container-prompt-history">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">Recent Prompts</h3>
      </div>
      
      <div className="space-y-2">
        {displayedPrompts.map((prompt, index) => (
          <Button
            key={`${prompt}-${index}`}
            variant="outline"
            className="w-full justify-start text-left h-auto py-2 px-3"
            onClick={() => onSelectPrompt(prompt)}
            data-testid={`button-history-prompt-${index}`}
          >
            <span className="line-clamp-1 text-sm">{prompt}</span>
          </Button>
        ))}
      </div>

      {prompts.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setIsExpanded(!isExpanded)}
          data-testid="button-toggle-history"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4 mr-2" />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4 mr-2" />
              Show More ({prompts.length - 5} more)
            </>
          )}
        </Button>
      )}
    </div>
  );
}
