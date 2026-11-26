import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { X, Search, Download, FileText, Sparkles, Volume2, Check, Loader2, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import brewingVideoSrc from "@assets/0895a471-9140-45de-9a0f-9e63212af53c_1763370650558.mp4";

export interface ResearchStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  result?: string;
}

interface BrewingProgressProps {
  brewProgress: number;
  brewStatus: string;
  isVisible: boolean;
  durationMinutes?: number;
  numHosts?: number;
  onCancel?: () => void;
  researchStages?: ResearchStage[];
  showDetailedProgress?: boolean;
}

function getEstimatedTime(durationMinutes: number, numHosts: number): string {
  if (numHosts === 1) {
    if (durationMinutes <= 2) return "~1 min";
    if (durationMinutes <= 5) return "~2 min";
    if (durationMinutes <= 10) return "~2 min";
    if (durationMinutes <= 15) return "~3 min";
    if (durationMinutes <= 20) return "~4 min";
    return "~4 min";
  }
  if (durationMinutes <= 2) return "~2 min";
  if (durationMinutes <= 5) return "~3 min";
  if (durationMinutes <= 10) return "~5 min";
  if (durationMinutes <= 15) return "~6 min";
  if (durationMinutes <= 20) return "~7 min";
  return "~7 min";
}

const STAGE_ICONS: Record<string, typeof Search> = {
  'URL Detection': Search,
  'Content Ingestion': Download,
  'Deep Research': Search,
  'Context Compilation': FileText,
  'Script Generation': Sparkles,
  'Audio Synthesis': Volume2,
  'Researching': Search,
  'Ingesting': Download,
  'Compiling': FileText,
  'Generating': Sparkles,
  'Synthesizing': Volume2,
};

function getStageIcon(stageName: string) {
  for (const [key, Icon] of Object.entries(STAGE_ICONS)) {
    if (stageName.toLowerCase().includes(key.toLowerCase())) {
      return Icon;
    }
  }
  return FileText;
}

function StageIndicator({ stage }: { stage: ResearchStage }) {
  const Icon = getStageIcon(stage.name);
  
  const statusStyles = {
    pending: 'text-muted-foreground opacity-50',
    running: 'text-primary animate-pulse',
    completed: 'text-green-500',
    skipped: 'text-muted-foreground opacity-40',
    failed: 'text-destructive'
  };
  
  const StatusIcon = () => {
    switch (stage.status) {
      case 'running':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'completed':
        return <Check className="w-3 h-3" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3" />;
      default:
        return null;
    }
  };
  
  return (
    <div 
      className={`flex items-center gap-2 text-xs ${statusStyles[stage.status]}`}
      data-testid={`stage-${stage.name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="flex-1 truncate">{stage.name}</span>
      <StatusIcon />
      {stage.result && stage.status === 'completed' && (
        <span className="text-[10px] text-muted-foreground ml-1">
          {stage.result}
        </span>
      )}
    </div>
  );
}

export function BrewingProgress({ 
  brewProgress, 
  brewStatus, 
  isVisible, 
  durationMinutes = 10,
  numHosts = 2,
  onCancel,
  researchStages,
  showDetailedProgress = false
}: BrewingProgressProps) {
  const [smoothProgress, setSmoothProgress] = useState(0);
  
  useEffect(() => {
    if (!isVisible) {
      setSmoothProgress(0);
    }
  }, [isVisible]);
  
  // Smooth progress animation
  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      setSmoothProgress(prev => {
        if (brewProgress > prev) {
          // Smoothly move towards the target, faster when far away
          const diff = brewProgress - prev;
          return prev + Math.max(0.5, diff * 0.1);
        }
        return prev;
      });
    });
    
    return () => cancelAnimationFrame(animationFrame);
  }, [brewProgress]);
  
  if (!isVisible) return null;
  
  const estimatedTime = getEstimatedTime(durationMinutes, numHosts);

  const defaultStages: ResearchStage[] = [
    { name: 'Researching', status: brewProgress < 15 ? 'running' : 'completed' },
    { name: 'Ingesting', status: brewProgress < 15 ? 'pending' : brewProgress < 30 ? 'running' : 'completed' },
    { name: 'Compiling', status: brewProgress < 30 ? 'pending' : brewProgress < 45 ? 'running' : 'completed' },
    { name: 'Generating', status: brewProgress < 45 ? 'pending' : brewProgress < 70 ? 'running' : 'completed' },
    { name: 'Synthesizing', status: brewProgress < 70 ? 'pending' : brewProgress < 100 ? 'running' : 'completed' },
  ];

  const stages = researchStages || defaultStages;

  return (
    <Card className="bg-card border-primary/30 shadow-md overflow-hidden" data-testid="card-brewing-progress">
      <CardContent className="pt-6 pb-6 space-y-4">
        <div className="flex items-center justify-center">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-24 h-24 object-cover"
            data-testid="video-brewing-animation"
          >
            <source src={brewingVideoSrc} type="video/mp4" />
          </video>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-center text-sm">
            <span className="font-medium text-foreground" data-testid="text-brew-status">{brewStatus}</span>
            <span className="text-muted-foreground ml-2" data-testid="text-brew-progress">({Math.round(smoothProgress)}%)</span>
          </div>
          <Progress value={smoothProgress} className="h-2" data-testid="progress-brewing" />
        </div>

        {showDetailedProgress && stages.length > 0 && (
          <div className="space-y-1.5 py-2 border-y border-border/50" data-testid="section-research-stages">
            {stages.map((stage, index) => (
              <StageIndicator key={index} stage={stage} />
            ))}
          </div>
        )}
        
        <div className="flex items-center justify-center text-xs text-muted-foreground">
          <span data-testid="text-estimated-time">Estimated: {estimatedTime}</span>
        </div>
        
        <p className="text-xs text-muted-foreground text-center">
          Brewing your {durationMinutes}-min podcast. Don't close this page.
        </p>

        {onCancel && (
          <div className="pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="w-full"
              data-testid="button-cancel-brew"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel Brew
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
