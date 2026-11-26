import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, BrainCircuit, Link, Sparkles, Upload, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GeneratedPodcast } from "@shared/schema";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";

interface DocumentMeta {
  documentId: string;
  fileName: string;
  wordCount: number;
  snippet: string;
}

export function DeepDiveForm() {
  const [topic, setTopic] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [docMeta, setDocMeta] = useState<DocumentMeta | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { play: playPodcast } = useAudioPlayer();

  const { data: creditsData } = useQuery<{ credits: number; plan: string }>({
    queryKey: ['/api/user/credits'],
  });

  const deepDiveMutation = useMutation({
    mutationFn: async (payload: { topic: string; sourceUrl?: string; documentId?: string }) => {
      const res = await apiRequest("POST", "/api/generate/deep-dive", payload);
      return res.json() as Promise<GeneratedPodcast>;
    },
    onSuccess: (podcast) => {
      queryClient.invalidateQueries({ queryKey: ['/api/podcasts/mine'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/credits'] });
      setTopic("");
      setSourceUrl("");
      setDocMeta(null);
      toast({
        title: "Deep Dive Ready!",
        description: `"${podcast.title || podcast.topic}" is ready to listen.`,
      });
      setTimeout(() => {
        playPodcast(podcast, true, false);
      }, 500);
    },
    onError: (err: Error) => {
      toast({
        title: "Generation failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const allowedExts = ['.pdf', '.docx', '.txt'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      toast({ title: "Unsupported file", description: "Please upload a PDF, Word (.docx), or text file (.txt).", variant: "destructive" });
      return;
    }

    setIsUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append('document', file);
      const res = await fetch('/api/documents/extract-text', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }
      const data: DocumentMeta = await res.json();
      setDocMeta(data);
      // Pre-fill topic from filename if topic is empty
      if (!topic.trim()) {
        const basename = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        setTopic(basename.slice(0, 200));
      }
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not process file.", variant: "destructive" });
    } finally {
      setIsUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      toast({ title: "Enter a topic", description: "Please describe what you want to explore.", variant: "destructive" });
      return;
    }
    deepDiveMutation.mutate({
      topic: topic.trim(),
      sourceUrl: sourceUrl.trim() || undefined,
      documentId: docMeta?.documentId,
    });
  };

  const isGenerating = deepDiveMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Header badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818CF8', border: '1px solid rgba(99,102,241,0.3)' }}
          data-testid="badge-notebooklm-powered"
        >
          <BrainCircuit className="h-3 w-3" />
          Powered by Google NotebookLM
        </Badge>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        Two AI hosts hold a rich, natural conversation exploring your topic in depth — no script, just authentic dialogue powered by Google&apos;s NotebookLM. Duration is determined automatically based on the material.
      </p>

      {/* Topic */}
      <div className="space-y-1.5">
        <Label htmlFor="deepdive-topic" className="text-sm font-medium">
          Topic <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="deepdive-topic"
          data-testid="textarea-deepdive-topic"
          placeholder="e.g. The history of the internet, the science of sleep, quantum computing basics…"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          className="min-h-[90px] resize-none"
          disabled={isGenerating}
          maxLength={1000}
        />
        <p className="text-xs text-muted-foreground text-right">{topic.length}/1000</p>
      </div>

      {/* Source: URL */}
      <div className="space-y-1.5">
        <Label htmlFor="deepdive-url" className="text-sm font-medium flex items-center gap-1.5">
          <Link className="h-3.5 w-3.5 text-muted-foreground" />
          Source URL <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="deepdive-url"
          data-testid="input-deepdive-url"
          type="url"
          placeholder="https://example.com/article or YouTube link"
          value={sourceUrl}
          onChange={e => setSourceUrl(e.target.value)}
          disabled={isGenerating || !!docMeta}
        />
        {!!docMeta && (
          <p className="text-xs text-muted-foreground">Clear the uploaded document to use a URL instead.</p>
        )}
      </div>

      {/* Source: Document upload */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          Upload document <span className="text-muted-foreground font-normal">(optional — PDF, DOCX, TXT)</span>
        </Label>

        {docMeta ? (
          <div
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5"
            data-testid="card-uploaded-document"
          >
            <div className="flex items-start gap-2 min-w-0">
              <FileText className="h-4 w-4 mt-0.5 shrink-0 text-indigo-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{docMeta.fileName}</p>
                <p className="text-xs text-muted-foreground">{docMeta.wordCount.toLocaleString()} words</p>
                {docMeta.snippet && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">&ldquo;{docMeta.snippet}&rdquo;</p>
                )}
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => setDocMeta(null)}
              data-testid="button-remove-document"
              disabled={isGenerating}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-document-file"
              disabled={isGenerating || isUploadingDoc}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating || isUploadingDoc || !!sourceUrl.trim()}
              data-testid="button-upload-document"
            >
              {isUploadingDoc ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing document…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Choose file
                </>
              )}
            </Button>
            {!!sourceUrl.trim() && (
              <p className="text-xs text-muted-foreground">Clear the URL to upload a document instead.</p>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Ground the conversation with a specific article, paper, or video link to improve focus and accuracy.
        </p>
      </div>

      {/* Credit info */}
      {creditsData && (
        <p className="text-xs text-muted-foreground">
          Available credits: <span className="font-medium text-foreground">{creditsData.credits.toFixed(1)}</span>
          {' '}— Deep Dive costs 2 credits (billed after generation).
        </p>
      )}

      {/* Submit */}
      <Button
        type="submit"
        data-testid="button-generate-deepdive"
        disabled={isGenerating || isUploadingDoc || !topic.trim()}
        className="w-full"
        size="default"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating Deep Dive…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Deep Dive
          </>
        )}
      </Button>
    </form>
  );
}
