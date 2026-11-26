import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Coffee, X, ChevronDown, Check, Loader2, Clock, AlertCircle } from 'lucide-react';
import { useGlobalBrewing } from '@/hooks/useGlobalBrewing';
import type { BrewJob } from '@/contexts/GlobalBrewingContext';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
}

function getEstimatedTimeDisplay(durationMinutes: number, numHosts: number): string {
  if (numHosts === 1) {
    if (durationMinutes <= 2) return "~1 min";
    if (durationMinutes <= 5) return "1-2 min";
    if (durationMinutes <= 10) return "2-3 min";
    if (durationMinutes <= 15) return "3-4 min";
    if (durationMinutes <= 20) return "3-4 min";
    return "4-5 min";
  }
  if (durationMinutes <= 2) return "1-2 min";
  if (durationMinutes <= 5) return "2-3 min";
  if (durationMinutes <= 10) return "4-5 min";
  if (durationMinutes <= 15) return "5-6 min";
  if (durationMinutes <= 20) return "6-7 min";
  return "7-8 min";
}

function BrewJobItem({ job, onCancel, onView, onRemove }: {
  job: BrewJob;
  onCancel: () => void;
  onView: () => void;
  onRemove: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (job.status !== 'brewing' && job.status !== 'queued') {
      return;
    }

    const updateElapsed = () => {
      const elapsed = Math.floor((Date.now() - job.startTime) / 1000);
      setElapsedSeconds(elapsed);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [job.status, job.startTime]);

  const isComplete = job.status === 'complete';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const isBrewing = job.status === 'brewing';
  const isQueued = job.status === 'queued';

  const remainingSeconds = Math.max(0, job.estimatedGenerationTime - elapsedSeconds);

  return (
    <div className="p-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isComplete ? (
            <div className="p-2 rounded-full bg-primary/20 shrink-0">
              <Check className="h-4 w-4 text-primary" />
            </div>
          ) : isFailed ? (
            <div className="p-2 rounded-full bg-destructive/20 shrink-0">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
          ) : isCancelled ? (
            <div className="p-2 rounded-full bg-muted shrink-0">
              <X className="h-4 w-4 text-muted-foreground" />
            </div>
          ) : isQueued ? (
            <div className="p-2 rounded-full bg-muted shrink-0">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          ) : (
            <div className="p-2 rounded-full bg-primary/20 shrink-0">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium line-clamp-2">
              {job.topic || job.templateName}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {job.templateName} • {job.durationMinutes}min
            </p>
          </div>
        </div>
        
        {(isBrewing || isQueued) && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onCancel}
            data-testid={`button-cancel-brew-${job.id}`}
          >
            Cancel
          </Button>
        )}
        {(isComplete || isFailed || isCancelled) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onRemove}
            data-testid={`button-remove-brew-${job.id}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isBrewing && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{job.statusMessage}</span>
            <span className="font-medium">{Math.round(job.progress)}%</span>
          </div>
          <Progress value={job.progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(elapsedSeconds)} elapsed
            </span>
            <span>{getEstimatedTimeDisplay(job.durationMinutes, job.numHosts ?? 2)} remaining</span>
          </div>
        </div>
      )}

      {isQueued && (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">Waiting in queue...</p>
        </div>
      )}

      {isComplete && job.podcastId && (
        <div className="mt-3">
          <Button
            size="sm"
            className="w-full"
            onClick={onView}
            data-testid={`button-view-podcast-${job.id}`}
          >
            <Coffee className="h-4 w-4 mr-2" />
            Listen Now
          </Button>
        </div>
      )}

      {isFailed && (
        <div className="mt-3">
          <p className="text-sm text-destructive">{job.error || 'Generation failed'}</p>
        </div>
      )}
    </div>
  );
}

export function HeaderBrewingIndicator() {
  const [, setLocation] = useLocation();
  const { brewJobs, activeBrewCount, cancelBrew, clearCompletedBrews, removeJob } = useGlobalBrewing();
  const [isOpen, setIsOpen] = useState(false);

  const activeJobs = brewJobs.filter(j => j.status === 'brewing' || j.status === 'queued');
  const completedJobs = brewJobs.filter(j => j.status === 'complete' || j.status === 'failed' || j.status === 'cancelled');
  const brewingJobs = brewJobs.filter(j => j.status === 'brewing');
  
  const hasJobs = brewJobs.length > 0;
  
  if (!hasJobs) {
    return null;
  }

  const totalProgress = brewingJobs.length > 0
    ? brewingJobs.reduce((sum, j) => sum + j.progress, 0) / brewingJobs.length
    : completedJobs.length > 0 ? 100 : 0;

  const allComplete = activeJobs.length === 0 && completedJobs.length > 0;

  const handleViewPodcast = (podcastId: string) => {
    setLocation(`/podcasts/${podcastId}`);
    setIsOpen(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`relative flex-1 justify-between gap-2 px-3 h-8 text-xs font-medium rounded-full bg-primary/20 hover:bg-primary/30 border border-primary/40 ${allComplete ? 'bg-green-600/20 hover:bg-green-600/30 border-green-600/40' : ''}`}
          data-testid="button-brewing-indicator"
        >
          <div className="flex items-center gap-1.5">
            {allComplete ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Coffee className="h-3.5 w-3.5 text-primary animate-pulse" />
            )}
            {activeBrewCount > 1 && (
              <span className="text-primary text-[10px] font-bold">
                {activeBrewCount}x
              </span>
            )}
          </div>
          
          {brewingJobs.length > 0 && (
            <div className="absolute left-10 right-16 top-1/2 -translate-y-1/2 h-1.5 bg-primary/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
                style={{ width: `${totalProgress}%` }}
              />
            </div>
          )}
          
          <div className="flex items-center gap-1">
            <span className={`font-medium ${allComplete ? 'text-green-500' : 'text-primary'}`}>
              {allComplete ? 'Ready!' : brewingJobs.length > 0 ? `${Math.round(totalProgress)}%` : 'Queued'}
            </span>
            <ChevronDown className="h-3 w-3 text-primary/70" />
          </div>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl" data-testid="sheet-brewing-details">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <SheetTitle>Brew Queue</SheetTitle>
            {completedJobs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCompletedBrews}
                data-testid="button-clear-completed"
              >
                Clear Done
              </Button>
            )}
          </div>
        </SheetHeader>
        
        <ScrollArea className="max-h-[60vh] mt-2">
          {brewJobs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No brews in queue
            </div>
          ) : (
            brewJobs.map(job => (
              <BrewJobItem
                key={job.id}
                job={job}
                onCancel={() => cancelBrew(job.id)}
                onView={() => job.podcastId && handleViewPodcast(job.podcastId)}
                onRemove={() => removeJob(job.id)}
              />
            ))
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
