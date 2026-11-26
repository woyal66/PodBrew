import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GeneratedImage } from "@shared/schema";
import { PromptHistory } from "./prompt-history";

export function ImageGenerator() {
  const [prompt, setPrompt] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const response = await apiRequest("POST", "/api/images/generate", { prompt });
      return response.json() as Promise<GeneratedImage>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/images"] });
      setPrompt("");
      toast({
        title: "Image generated successfully!",
        description: "Your creation has been added to the gallery.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation failed",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      generateMutation.mutate(prompt.trim());
    }
  };

  const charCount = prompt.length;
  const maxChars = 500;

  const handleSelectPrompt = (selectedPrompt: string) => {
    setPrompt(selectedPrompt);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="prompt-input" className="text-sm font-medium uppercase tracking-wide">
            Image Description
          </label>
          <Textarea
            id="prompt-input"
            data-testid="input-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A serene mountain landscape at sunset with vibrant orange and pink skies..."
            className="min-h-32 resize-none text-base focus-visible:ring-2 focus-visible:ring-ring transition-all"
            maxLength={maxChars}
            disabled={generateMutation.isPending}
          />
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Be as detailed as possible for best results
            </p>
            <p className="text-xs text-muted-foreground">
              {charCount}/{maxChars}
            </p>
          </div>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto sm:px-8"
          disabled={!prompt.trim() || generateMutation.isPending}
          data-testid="button-generate"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Image
            </>
          )}
        </Button>
      </form>

      <PromptHistory onSelectPrompt={handleSelectPrompt} />
    </div>
  );
}
