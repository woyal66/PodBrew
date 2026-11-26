import { useState, useRef } from "react";
import { FileText, Upload, X, Wand2, Youtube, Podcast, Sparkles, Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { type VoiceId, type Voice } from "@shared/schema";
import { TemplateFormLayout } from "./TemplateFormLayout";
import { documentsTemplateConfig } from "./templateFormConfigs";
import { useQuery } from "@tanstack/react-query";

interface DocumentFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
  summaryType: string;
  setSummaryType: (style: string) => void;
  podcastStyle: string;
  setPodcastStyle: (style: string) => void;
  timeFrame: string;
  setTimeFrame: (frame: string) => void;
  coHostPersonality: string;
  setCoHostPersonality: (personality: string) => void;
  podcastMood: string;
  setPodcastMood: (mood: string) => void;
  language: string;
  setLanguage: (lang: string) => void;
  selectedVoicePool: string[];
  setSelectedVoicePool: (voices: string[]) => void;
  assignedVoices: string[];
  selectedVoiceIds: string[];
  selectedVoices: Voice[];
  creditsData: { credits: number; plan: string } | undefined;
  setShowVoiceModal: (show: boolean) => void;
  isListening: boolean;
  onVoiceInput: () => void;
  onEnhanceTopic: () => void;
  onMorpheus?: () => void;
  showMorpheus?: boolean;
  isMorpheusOpen?: boolean;
  isEnhancing: boolean;
  onSubmit: (e: React.FormEvent, documentId?: string, contentId?: string) => void;
  isGenerating: boolean;
  topicRef?: React.RefObject<HTMLTextAreaElement>;
  locationEnabled?: boolean;
  locationCity?: string | null;
  brewProgress?: number;
  brewStatus?: string;
  onCancelBrew?: () => void;
  onToggleLocation?: () => void;
}

const SUMMARY_STYLES = [
  { value: "executive", label: "Executive Summary", description: "Brief, high-level overview" },
  { value: "detailed", label: "Detailed Analysis", description: "Comprehensive breakdown" },
  { value: "educational", label: "Chapter by Chapter", description: "Sequential walkthrough" },
  { value: "conversational", label: "Conversational Discussion", description: "Hosts discussing summary like a real podcast" },
];

type ContentSourceType = 'document' | 'youtube' | 'podcast' | 'website';

interface ContentMetadata {
  contentId: string;
  title: string;
  wordCount: number;
  tokenEstimate?: number;
  snippet: string;
  sourceType: ContentSourceType;
  metadata?: {
    duration?: string;
    author?: string;
    channel?: string;
    publishDate?: string;
    description?: string;
  };
}

interface DocumentMetadata {
  documentId?: string;
  fileName: string;
  fileSize: number;
  wordCount: number;
  snippet: string;
}

export function DocumentForm({
  topic,
  setTopic,
  summaryType,
  setSummaryType,
  isGenerating,
  onSubmit,
  ...commonProps
}: DocumentFormProps) {
  const [documentMetadata, setDocumentMetadata] = useState<DocumentMetadata | null>(null);
  const [contentMetadata, setContentMetadata] = useState<ContentMetadata | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [contentSource, setContentSource] = useState<ContentSourceType>('document');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [podcastUrl, setPodcastUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [useDeepAnalysis, setUseDeepAnalysis] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Check if Grok is available for deep analysis
  const { data: capabilities } = useQuery<{
    grokAvailable: boolean;
    maxTokens: number;
    supportedSources: string[];
    analysisTypes: string[];
  }>({
    queryKey: ['/api/content/capabilities'],
    staleTime: 60000,
  });

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await fetch('/api/documents/extract-text', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload document');
      }

      const data = await response.json();
      setDocumentMetadata(data);
      setTopic(data.snippet || `Summary of ${data.fileName}`);
      
      toast({
        title: "Document uploaded successfully",
        description: `${data.fileName} (${data.wordCount.toLocaleString()} words)`,
      });
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to process document",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleRemoveFile = () => {
    setDocumentMetadata(null);
    setContentMetadata(null);
    setTopic("");
    setYoutubeUrl('');
    setPodcastUrl('');
    setWebsiteUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Import YouTube video transcript
  const handleYoutubeImport = async () => {
    if (!youtubeUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please enter a YouTube video URL",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch('/api/content/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import YouTube video');
      }

      const data = await response.json();
      setContentMetadata({
        contentId: data.contentId,
        title: data.title,
        wordCount: data.wordCount,
        tokenEstimate: data.tokenEstimate,
        snippet: data.snippet,
        sourceType: 'youtube',
        metadata: data.metadata,
      });
      setDocumentMetadata({
        fileName: data.title,
        fileSize: 0,
        wordCount: data.wordCount,
        snippet: data.snippet,
      });
      setTopic(data.snippet || `Summary of: ${data.title}`);

      toast({
        title: "YouTube video imported",
        description: `${data.title} (${data.wordCount.toLocaleString()} words)`,
      });
    } catch (error) {
      console.error('YouTube import error:', error);
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Failed to import YouTube video",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Import podcast episode
  const handlePodcastImport = async () => {
    if (!podcastUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please enter a podcast episode URL",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch('/api/content/podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: podcastUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import podcast');
      }

      const data = await response.json();
      setContentMetadata({
        contentId: data.contentId,
        title: data.title,
        wordCount: data.wordCount,
        tokenEstimate: data.tokenEstimate,
        snippet: data.snippet,
        sourceType: 'podcast',
        metadata: data.metadata,
      });
      setDocumentMetadata({
        fileName: data.title,
        fileSize: 0,
        wordCount: data.wordCount,
        snippet: data.snippet,
      });
      setTopic(data.snippet || `Summary of: ${data.title}`);

      toast({
        title: "Podcast episode imported",
        description: `${data.title} (${data.wordCount.toLocaleString()} words)`,
      });
    } catch (error) {
      console.error('Podcast import error:', error);
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Failed to import podcast",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Import website / article content
  const handleWebsiteImport = async () => {
    const trimmed = websiteUrl.trim();
    if (!trimmed) {
      toast({
        title: "URL required",
        description: "Please enter a website or article URL",
        variant: "destructive",
      });
      return;
    }
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('bad-protocol');
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Enter a full URL starting with http:// or https://",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch('/api/content/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import website');
      }

      const data = await response.json();
      setContentMetadata({
        contentId: data.contentId,
        title: data.title,
        wordCount: data.wordCount,
        tokenEstimate: data.tokenEstimate,
        snippet: data.snippet,
        sourceType: 'website',
        metadata: data.metadata,
      });
      setDocumentMetadata({
        fileName: data.title,
        fileSize: 0,
        wordCount: data.wordCount,
        snippet: data.snippet,
      });
      setTopic(data.snippet || `Summary of: ${data.title}`);

      toast({
        title: "Website imported",
        description: `${data.title} (${data.wordCount.toLocaleString()} words)`,
      });
    } catch (error) {
      console.error('Website import error:', error);
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Failed to import website",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Always pass documentId if available (file uploads set it directly)
    // For YouTube/podcast/website imports, also pass contentId
    const documentId = documentMetadata?.documentId;
    const contentId = (
      contentMetadata?.sourceType === 'youtube' ||
      contentMetadata?.sourceType === 'podcast' ||
      contentMetadata?.sourceType === 'website'
    )
      ? contentMetadata?.contentId
      : undefined;
    onSubmit(e, documentId, contentId);
  };

  // Content source selection with tabs
  const contentSourceSection = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          Import Content
        </Label>
        {capabilities?.grokAvailable && (
          <Badge variant="outline" className="text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            Deep Analysis Available
          </Badge>
        )}
      </div>

      {/* Show imported content if any */}
      {documentMetadata ? (
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {contentMetadata?.sourceType === 'youtube' ? (
                <Youtube className="w-5 h-5 text-red-500" />
              ) : contentMetadata?.sourceType === 'podcast' ? (
                <Podcast className="w-5 h-5 text-purple-500" />
              ) : contentMetadata?.sourceType === 'website' ? (
                <Globe className="w-5 h-5 text-sky-500" />
              ) : (
                <FileText className="w-5 h-5 text-primary" />
              )}
              <div>
                <p className="text-sm font-medium line-clamp-1">{documentMetadata.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {documentMetadata.wordCount.toLocaleString()} words
                  {contentMetadata?.tokenEstimate && (
                    <span> • ~{Math.round(contentMetadata.tokenEstimate / 1000)}k tokens</span>
                  )}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleRemoveFile}
              disabled={isGenerating}
              data-testid="button-remove-content"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          {documentMetadata.snippet && (
            <div className="bg-muted/50 rounded-md p-3 border">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Content Preview:</p>
              <p className="text-xs text-muted-foreground line-clamp-3">{documentMetadata.snippet}</p>
            </div>
          )}

          {/* Deep Analysis Option */}
          {capabilities?.grokAvailable && contentMetadata?.tokenEstimate && contentMetadata.tokenEstimate > 50000 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="deep-analysis"
                  checked={useDeepAnalysis}
                  onCheckedChange={(checked) => setUseDeepAnalysis(checked === true)}
                  disabled={isGenerating}
                  data-testid="checkbox-deep-analysis"
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor="deep-analysis"
                    className="text-sm font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Use Deep Analysis
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Process entire content with 2M token context for comprehensive analysis
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Tabs value={contentSource} onValueChange={(v) => setContentSource(v as ContentSourceType)} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-3">
            <TabsTrigger value="document" data-testid="tab-document">
              <FileText className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Document</span>
            </TabsTrigger>
            <TabsTrigger value="website" data-testid="tab-website">
              <Globe className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Website</span>
            </TabsTrigger>
            <TabsTrigger value="youtube" data-testid="tab-youtube">
              <Youtube className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">YouTube</span>
            </TabsTrigger>
            <TabsTrigger value="podcast" data-testid="tab-podcast">
              <Podcast className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Podcast</span>
            </TabsTrigger>
          </TabsList>

          {/* Document Upload Tab */}
          <TabsContent value="document" className="mt-0">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer",
                isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/30",
                isProcessing && "opacity-50 pointer-events-none"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file-upload"
                disabled={isGenerating || isProcessing}
              />
              
              <div className="text-center space-y-3">
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Processing document...</p>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Drop your document here or click to browse</p>
                      <p className="text-xs text-muted-foreground">
                        Supports PDF, DOCX, and TXT files up to 50MB
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Website Import Tab */}
          <TabsContent value="website" className="mt-0">
            <div className="space-y-3 p-4 border rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="website-url" className="text-sm">Article or Website URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="website-url"
                    type="url"
                    placeholder="https://example.com/article"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!isProcessing && !isGenerating && websiteUrl.trim()) {
                          handleWebsiteImport();
                        }
                      }
                    }}
                    disabled={isProcessing || isGenerating}
                    data-testid="input-website-url"
                  />
                  <Button
                    type="button"
                    onClick={handleWebsiteImport}
                    disabled={isProcessing || isGenerating || !websiteUrl.trim()}
                    data-testid="button-import-website"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Import"
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Pulls the readable text from a news story, blog post, or article so you can brew a podcast about it.
              </p>
            </div>
          </TabsContent>

          {/* YouTube Import Tab */}
          <TabsContent value="youtube" className="mt-0">
            <div className="space-y-3 p-4 border rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="youtube-url" className="text-sm">YouTube Video URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="youtube-url"
                    type="url"
                    placeholder="https://youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    disabled={isProcessing || isGenerating}
                    data-testid="input-youtube-url"
                  />
                  <Button
                    type="button"
                    onClick={handleYoutubeImport}
                    disabled={isProcessing || isGenerating || !youtubeUrl.trim()}
                    data-testid="button-import-youtube"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Import"
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Extracts transcript from YouTube videos for podcast conversion
              </p>
            </div>
          </TabsContent>

          {/* Podcast Import Tab */}
          <TabsContent value="podcast" className="mt-0">
            <div className="space-y-3 p-4 border rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="podcast-url" className="text-sm">Podcast Episode URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="podcast-url"
                    type="url"
                    placeholder="https://podcast.com/episode/..."
                    value={podcastUrl}
                    onChange={(e) => setPodcastUrl(e.target.value)}
                    disabled={isProcessing || isGenerating}
                    data-testid="input-podcast-url"
                  />
                  <Button
                    type="button"
                    onClick={handlePodcastImport}
                    disabled={isProcessing || isGenerating || !podcastUrl.trim()}
                    data-testid="button-import-podcast"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Import"
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Import podcast episodes via direct URL or RSS feed
              </p>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );

  // Legacy file upload section for backward compatibility (kept but hidden)
  const fileUploadSection = contentSourceSection;

  // Summary type selector goes in children (after complexity)
  const summaryTypeSection = (
    <div className="space-y-2">
      <Label htmlFor="summary-type" className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-primary" />
        Summary Type
      </Label>
      <Select value={summaryType} onValueChange={setSummaryType} disabled={isGenerating}>
        <SelectTrigger id="summary-type" data-testid="select-summary-type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUMMARY_STYLES.map(({ value, label, description }) => (
            <SelectItem key={value} value={value}>
              <div className="flex flex-col items-start">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <TemplateFormLayout
      config={documentsTemplateConfig}
      topic={topic}
      setTopic={setTopic}
      {...commonProps}
      isGenerating={isGenerating}
      onSubmit={handleFormSubmit}
      beforeCommonControls={fileUploadSection}
      isFormValid={documentMetadata !== null || topic.trim().length >= 10}
    >
      {summaryTypeSection}
    </TemplateFormLayout>
  );
}
