import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Mic, Send, Loader2, Sparkles, CheckCircle2, ArrowRight, Volume2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateCategory } from "@shared/schema";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MorpheusWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTopic: string;
  templateCategory: TemplateCategory;
  onRefinedTopic: (refinedTopic: string, context: string) => void;
  isVoiceMode?: boolean;
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line) return <div key={i} className="h-1" />;
        const isBullet = line.startsWith("- ") || line.startsWith("• ");
        if (isBullet) {
          return (
            <div key={i} className="flex gap-1.5 items-start">
              <span className="text-primary mt-0.5 shrink-0">•</span>
              <span>{line.replace(/^[-•]\s/, "")}</span>
            </div>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function MorpheusWizard({
  open,
  onOpenChange,
  initialTopic,
  templateCategory,
  onRefinedTopic,
  isVoiceMode = false,
}: MorpheusWizardProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [refinedContext, setRefinedContext] = useState("");
  const [contextExpanded, setContextExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasGreeted = useRef(false);
  const wasNearBottomRef = useRef(true);

  const speakMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/morpheus/speak", { text });
      return response.json();
    },
    onSuccess: (data) => {
      if (!open) return;
      if (data.audio) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        const audioSrc = `data:${data.mimeType};base64,${data.audio}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        audio.onplay = () => setIsSpeaking(true);
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => setIsSpeaking(false);
        audio.play().catch(() => setIsSpeaking(false));
      }
    },
    onError: () => setIsSpeaking(false),
  });

  const speakMessage = useCallback(
    (text: string) => {
      if (isVoiceMode && text) {
        const truncated = text.length > 500 ? text.substring(0, 500) + "..." : text;
        speakMutation.mutate(truncated);
      }
    },
    [isVoiceMode, speakMutation]
  );

  const greetMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/morpheus/greet", {
        topic: initialTopic,
        templateCategory,
      });
      return response.json();
    },
    onSuccess: (data) => {
      const greeting: Message = { role: "assistant", content: data.greeting };
      setMessages([greeting]);
      if (Array.isArray(data.suggestions) && data.suggestions.length) {
        setSuggestions(data.suggestions);
      }
      if (isVoiceMode) speakMessage(data.greeting);
    },
    onError: () => {
      const fallback: Message = {
        role: "assistant",
        content: `You want to explore: "${initialTopic}"\n\nWhat specific angle or perspective are you most interested in?`,
      };
      setMessages([fallback]);
    },
  });

  useEffect(() => {
    if (open && initialTopic && !hasGreeted.current) {
      hasGreeted.current = true;
      greetMutation.mutate();
    }
    if (!open) {
      hasGreeted.current = false;
    }
  }, [open, initialTopic]);

  // Update wasNearBottom on every scroll so we know where the user was
  // *before* a new message renders (post-render DOM metrics are too late)
  const handleChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Smart autoscroll: reads the pre-render near-bottom flag (not post-render metrics)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const interviewMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const response = await apiRequest("POST", "/api/morpheus/interview", {
        topic: initialTopic,
        templateCategory,
        messages: [...messages, { role: "user", content: userMessage }],
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      if (data.refinedContext) setRefinedContext(data.refinedContext);
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      if (isVoiceMode && data.response) speakMessage(data.response);
    },
    onError: (error: any) => {
      toast({
        title: "Interview failed",
        description: error.message || "Could not process your response",
        variant: "destructive",
      });
    },
  });

  const handleSendMessage = (override?: string) => {
    const text = (override ?? inputValue).trim();
    if (!text || interviewMutation.isPending || greetMutation.isPending) return;

    const userMessage: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setSuggestions([]);
    setInputValue("");
    interviewMutation.mutate(text);
  };

  const handleVoiceInput = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      toast({
        title: "Not supported",
        description: "Speech recognition is not supported in your browser.",
        variant: "destructive",
      });
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputValue(transcript);
      if (inputRef.current) inputRef.current.focus();
    };
    recognition.onerror = () => {
      setIsListening(false);
      toast({ title: "Voice input failed", description: "Could not capture voice input. Please try again.", variant: "destructive" });
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleApplyRefinement = () => {
    const allUserMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    const pendingInput = inputValue.trim();
    if (pendingInput) allUserMessages.push(pendingInput);
    const contextSummary = refinedContext || allUserMessages.join(" | ");
    const enhancedTopic = contextSummary
      ? `${initialTopic}\n\nContext from refinement:\n${contextSummary}`
      : initialTopic;
    onRefinedTopic(enhancedTopic, contextSummary);
    onOpenChange(false);
    toast({ title: "Topic refined", description: "Your refined topic is ready for generation" });
  };

  const handleStartNow = () => {
    onRefinedTopic(initialTopic, "");
    onOpenChange(false);
  };

  const handleClose = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setMessages([]);
    setInputValue("");
    setRefinedContext("");
    setContextExpanded(false);
    setSuggestions([]);
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const isLoading = greetMutation.isPending || interviewMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[563px] max-h-[85vh] flex flex-col -mt-[50px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-red-500" />
            </div>
            <span>Morpheus</span>
            <Badge variant="secondary" className="text-xs">Topic Wizard</Badge>
            {refinedContext ? (
              <Badge className="text-xs ml-auto shrink-0 bg-green-500/15 text-green-600 border-green-500/30">
                Ready
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs ml-auto shrink-0 text-muted-foreground">
                Refining...
              </Badge>
            )}
            {(isSpeaking || speakMutation.isPending) && (
              <Badge variant="outline" className="text-xs flex items-center gap-1 text-primary shrink-0">
                <Volume2 className="w-3 h-3 animate-pulse" />
                Speaking...
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            I'll help you refine your topic for the best possible podcast
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          onScroll={handleChatScroll}
          className="flex-1 overflow-y-auto pr-2 min-h-0 max-h-[360px]"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="space-y-4 py-4">
            {greetMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {message.role === "assistant" ? (
                    <FormattedMessage content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}
            {interviewMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t pt-4 space-y-3">
          {suggestions.length > 0 && !isLoading && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInputValue(s);
                    setSuggestions([]);
                    setTimeout(() => handleSendMessage(s), 0);
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted hover-elevate cursor-pointer"
                  data-testid={`button-morpheus-suggestion-${i}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <Textarea
              ref={inputRef}
              placeholder="Type your response..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={2}
              className="resize-none pr-20 text-sm"
              data-testid="input-morpheus-response"
            />
            <div className="absolute bottom-2 right-2 flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleVoiceInput}
                disabled={isLoading}
                className={cn("h-7 w-7", isListening && "bg-red-500/10 text-red-500")}
                data-testid="button-morpheus-voice"
              >
                <Mic className={cn("w-3.5 h-3.5", isListening && "animate-pulse")} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || isLoading}
                className="h-7 w-7"
                data-testid="button-morpheus-send"
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {refinedContext && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Refinement Ready
                </div>
                <button
                  onClick={() => setContextExpanded((e) => !e)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  data-testid="button-morpheus-expand-context"
                >
                  {contextExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <p
                className={cn(
                  "text-xs text-muted-foreground mt-1 transition-all",
                  !contextExpanded && "line-clamp-2"
                )}
              >
                {refinedContext}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleStartNow} className="flex-1">
            Skip & Start Now
          </Button>
          <Button
            onClick={handleApplyRefinement}
            disabled={userMessageCount === 0 && !inputValue.trim()}
            className="flex-1"
            data-testid="button-morpheus-apply"
          >
            Apply Refinement
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
