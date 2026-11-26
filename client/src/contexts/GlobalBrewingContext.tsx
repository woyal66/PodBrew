import { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { playCompletionChime } from '@/lib/chime';
import { queryClient } from '@/lib/queryClient';
import { clearPendingPodcast } from '@/lib/pendingPodcast';
import { toast } from '@/hooks/use-toast';
import type { GeneratedPodcast } from '@shared/schema';

export type BrewJobStatus = 'queued' | 'brewing' | 'complete' | 'failed' | 'cancelled';

export interface BrewJob {
  id: string;
  status: BrewJobStatus;
  progress: number;
  statusMessage: string;
  templateName: string;
  topic?: string;
  durationMinutes: number;
  numHosts?: number;
  startTime: number;
  estimatedGenerationTime: number;
  podcastId?: string;
  podcastTitle?: string;
  completedPodcast?: GeneratedPodcast;
  error?: string;
}

interface GlobalBrewingContextType {
  brewJobs: BrewJob[];
  activeBrewCount: number;
  startBrewing: (params: {
    templateName: string;
    topic?: string;
    durationMinutes: number;
    requestBody: any;
  }) => Promise<GeneratedPodcast | null>;
  startTrialBrew: (params: {
    topic: string;
    guestSessionToken: string;
  }) => Promise<GeneratedPodcast | null>;
  cancelBrew: (jobId: string) => void;
  clearCompletedBrews: () => void;
  removeJob: (jobId: string) => void;
}

const STORAGE_KEY = 'podbrew_brew_queue';
const MAX_CONCURRENT_BREWS = 3;
// Hard ceiling: any brewing job older than this is auto-failed on the client
// to prevent zombie jobs from polling forever after a server-side failure that
// the client never observed (e.g. proxy disconnect after 504 + no podcast saved).
const MAX_JOB_AGE_MS = 30 * 60 * 1000; // 30 minutes

function generateJobId(): string {
  return `brew_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function estimateGenerationTime(durationMinutes: number, numHosts: number): number {
  // 1-host: TTS runs in parallel batches of 6 → ~2× faster than 2-host sequential.
  // 2-host: TTS runs sequentially, 2100-char chunks, ~33s each.
  if (numHosts === 1) {
    // Calibrated from prod: 20-min single-host completed in 200s.
    if (durationMinutes <= 2) return 70;
    if (durationMinutes <= 5) return 90;
    if (durationMinutes <= 10) return 140;
    if (durationMinutes <= 15) return 175;
    if (durationMinutes <= 20) return 210;
    return 240;
  }
  // 2-host (multi-speaker sequential TTS).
  if (durationMinutes <= 2) return 100;
  if (durationMinutes <= 5) return 180;
  if (durationMinutes <= 10) return 270;
  if (durationMinutes <= 15) return 360;
  if (durationMinutes <= 20) return 420;
  return 480;
}

function calculateProgress(startTime: number, estimatedTime: number): number {
  const elapsed = (Date.now() - startTime) / 1000;
  const rawProgress = (elapsed / estimatedTime) * 95;
  return Math.min(rawProgress, 95);
}

export const GlobalBrewingContext = createContext<GlobalBrewingContextType | null>(null);

export function GlobalBrewingProvider({ children }: { children: React.ReactNode }) {
  const [brewJobs, setBrewJobs] = useState<BrewJob[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        return parsed.filter((job: BrewJob) => {
          // Drop jobs older than the max-age ceiling. This sweeps zombie jobs
          // left over from previous sessions where the server failed silently.
          if (now - job.startTime > MAX_JOB_AGE_MS) return false;
          return job.status === 'brewing' || job.status === 'queued';
        });
      }
      return [];
    } catch {
      return [];
    }
  });

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Ref-based launch counter — avoids stale closure when multiple brews are started in rapid succession
  const activeLaunchCountRef = useRef(0);

  const activeBrewCount = brewJobs.filter(j => j.status === 'brewing' || j.status === 'queued').length;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const activeJobs = brewJobs.filter(j => j.status === 'brewing' || j.status === 'queued');
      if (activeJobs.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activeJobs));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [brewJobs]);

  useEffect(() => {
    const hasActiveBrews = brewJobs.some(j => j.status === 'brewing');
    
    if (hasActiveBrews) {
      progressIntervalRef.current = setInterval(() => {
        setBrewJobs(prev => prev.map(job => {
          if (job.status !== 'brewing') return job;
          const newProgress = calculateProgress(job.startTime, job.estimatedGenerationTime);
          return { ...job, progress: newProgress };
        }));
      }, 500);
    } else if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [brewJobs.some(j => j.status === 'brewing')]);

  // Stale job detection: Check if 'brewing' jobs have their podcast already in the database
  // This handles race conditions where the podcast is saved but the response wasn't received properly
  const staleCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimeoutCheckRef = useRef<Map<string, number>>(new Map());
  
  useEffect(() => {
    const hasActiveBrews = brewJobs.some(j => j.status === 'brewing');
    
    if (hasActiveBrews && !staleCheckIntervalRef.current) {
      staleCheckIntervalRef.current = setInterval(() => {
        // Use setBrewJobs callback to access fresh state
        setBrewJobs(prev => {
          const brewingJobs = prev.filter(j => j.status === 'brewing');
          if (brewingJobs.length === 0) return prev;

          // Gather podcasts from every relevant cache source and merge them,
          // de-duplicating by id so a podcast that appears in multiple caches
          // is only checked once. This ensures detection works regardless of
          // which page the user is on (Library, Discover, or create-page).
          // The /mine cache may be either the flat shape `{podcasts: [...]}` or
          // an infinite-query shape `{pages: [{podcasts: [...]}]}`, depending on
          // which page populated it — handle both.
          const mineRaw = queryClient.getQueryData<any>(["/api/podcasts/mine"]);
          const mineFromInfinite: GeneratedPodcast[] = Array.isArray(mineRaw?.pages)
            ? mineRaw.pages.flatMap((p: any) => p?.podcasts ?? [])
            : [];
          const mineFromFlat: GeneratedPodcast[] = Array.isArray(mineRaw?.podcasts)
            ? mineRaw.podcasts
            : [];
          const minePreview = queryClient.getQueryData<{ podcasts: GeneratedPodcast[] }>(["/api/podcasts/mine", "preview"]);
          const publicData = queryClient.getQueryData<{ podcasts: GeneratedPodcast[] }>(["/api/podcasts/public"]);
          const flatList = queryClient.getQueryData<GeneratedPodcast[]>(["/api/podcasts"]) ?? [];

          const allPodcasts: GeneratedPodcast[] = [
            ...mineFromInfinite,
            ...mineFromFlat,
            ...(minePreview?.podcasts ?? []),
            ...flatList,
            ...(publicData?.podcasts ?? []),
          ];
          const seenIds = new Set<string | number>();
          const cachedPodcasts: GeneratedPodcast[] = allPodcasts.filter(p => {
            if (!p?.id || seenIds.has(p.id)) return false;
            seenIds.add(p.id);
            return true;
          });

          let hasChanges = false;
          const updated = prev.map(job => {
            if (job.status !== 'brewing') return job;

            // Hard age cutoff — auto-fail zombie jobs that have been polling
            // forever with no matching podcast. Without this, a server-side
            // failure that the client never observed would poll indefinitely.
            const ageMs = Date.now() - job.startTime;
            if (ageMs > MAX_JOB_AGE_MS) {
              console.warn(`[StaleJobDetection] Job ${job.id} exceeded MAX_JOB_AGE_MS (${Math.round(ageMs / 1000)}s), auto-failing`);
              hasChanges = true;
              abortControllersRef.current.delete(job.id);
              lastTimeoutCheckRef.current.delete(job.id);
              toast({
                title: 'Brew timed out',
                description: 'Your podcast generation took longer than expected. Check your Library — it may still be there. If not, try again.',
                variant: 'destructive',
                duration: 8000,
              });
              return {
                ...job,
                status: 'failed' as BrewJobStatus,
                statusMessage: 'Timed out',
                error: 'Generation took longer than 30 minutes',
              };
            }

            // Check if a podcast matching this job was created recently.
            // Primary match: clientJobId (deterministic — the job's own id was sent to the
            // server and stored on the podcast record). Fallback: topic text comparison for
            // any in-flight brew started before this change was deployed.
            const matchingPodcast = cachedPodcasts.find(podcast => {
              if (!podcast) return false;

              // Primary: exact clientJobId match — zero ambiguity
              if (podcast.clientJobId && podcast.clientJobId === job.id) {
                return true;
              }

              // Fallback: topic match (case-insensitive) + created-after-job-start guard
              if (!job.topic) return false;
              const topicMatch = podcast.topic?.toLowerCase().trim() === job.topic.toLowerCase().trim();
              const podcastTime = new Date(podcast.timestamp).getTime();
              const createdAfterJobStart = podcastTime >= job.startTime - 60000; // Allow 1 min buffer
              return topicMatch && createdAfterJobStart;
            });

            if (matchingPodcast) {
              console.log(`[StaleJobDetection] Found matching podcast for job ${job.id}, auto-completing`);
              playCompletionChime();
              clearPendingPodcast();
              hasChanges = true;
              
              // Just delete the abort controller reference without aborting
              // This prevents the in-flight request from being cancelled and overwriting the status
              abortControllersRef.current.delete(job.id);

              // Dispatch event so listeners (e.g. BottomPlayer) can trigger auto-play
              window.dispatchEvent(new CustomEvent('podbrew-brew-complete', { detail: { podcast: matchingPodcast } }));
              
              return {
                ...job,
                status: 'complete' as BrewJobStatus,
                progress: 100,
                statusMessage: 'Brew complete!',
                podcastId: String(matchingPodcast.id),
                podcastTitle: matchingPodcast.title || matchingPodcast.topic,
                completedPodcast: matchingPodcast,
              };
            }

            // Poll for completion once the job has been running past its estimated time.
            // Start at 1× (not 1.5×) so we catch on-time completions too.
            // After a gateway-timeout the job stays 'brewing' — re-invalidate every 15s.
            const elapsed = (Date.now() - job.startTime) / 1000;
            const pollAfter = job.estimatedGenerationTime; // 1× estimated
            const lastCheck = lastTimeoutCheckRef.current.get(job.id) || 0;
            const now = Date.now();
            
            // Trigger refetch every 15 seconds once past estimated time
            if (elapsed > pollAfter && now - lastCheck > 15000) {
              console.log(`[StaleJobDetection] Job ${job.id} at ${elapsed.toFixed(0)}s (est ${pollAfter}s), polling for completion`);
              lastTimeoutCheckRef.current.set(job.id, now);
              queryClient.refetchQueries({ queryKey: ["/api/podcasts/mine"], type: 'all' });
            }

            return job;
          });

          return hasChanges ? updated : prev;
        });
      }, 5000); // Check every 5 seconds
    } else if (!hasActiveBrews && staleCheckIntervalRef.current) {
      clearInterval(staleCheckIntervalRef.current);
      staleCheckIntervalRef.current = null;
      lastTimeoutCheckRef.current.clear();
    }

    return () => {
      if (staleCheckIntervalRef.current) {
        clearInterval(staleCheckIntervalRef.current);
        staleCheckIntervalRef.current = null;
      }
    };
  }, [brewJobs]);

  const executeBrew = useCallback(async (job: BrewJob, requestBody: any) => {
    const abortController = new AbortController();
    abortControllersRef.current.set(job.id, abortController);

    setBrewJobs(prev => prev.map(j => 
      j.id === job.id ? { ...j, status: 'brewing' as BrewJobStatus, statusMessage: 'Starting brew...' } : j
    ));

    // Retry logic for long podcast generation (network drops)
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Brew] Retry attempt ${attempt}/${MAX_RETRIES} for job ${job.id}`);
          setBrewJobs(prev => prev.map(j => 
            j.id === job.id ? { ...j, statusMessage: `Retrying... (attempt ${attempt + 1})` } : j
          ));
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }

        const response = await fetch('/api/podcasts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
          credentials: 'include',
        });

        // Parse response - handle both success and error cases
        let responseData: any;
        try {
          const text = await response.text();
          // Trim whitespace (keep-alive mechanism may add leading spaces)
          const trimmedText = text.trim();
          if (!trimmedText) {
            throw new Error('Empty response from server');
          }
          // Try to parse as JSON first. Real upstream/proxy timeouts return HTML error
          // pages (not JSON), so we only scan for gateway-error keywords if JSON parsing
          // fails. Scanning a valid JSON podcast payload for "502"/"504" substrings can
          // false-positive on long scripts/byte counts and incorrectly mark a successful
          // generation as a timeout.
          try {
            responseData = JSON.parse(trimmedText);
          } catch (jsonErr: any) {
            const lowerText = trimmedText.toLowerCase();
            if (
              lowerText.includes('upstream') ||
              lowerText.includes('bad gateway') ||
              lowerText.includes('gateway timeout') ||
              lowerText.includes('<html') ||
              lowerText.includes('504 gateway') ||
              lowerText.includes('502 bad')
            ) {
              throw new Error('Your podcast is still generating on the server. This can take several minutes for longer episodes — check your Library in a few minutes and it should be ready.');
            }
            throw jsonErr;
          }
        } catch (parseError: any) {
          // Only retry parse errors that are clearly network-related (empty/truncated response).
          // Do NOT retry if the server returned a valid error JSON — that would fire a second full generation.
          // Do NOT retry upstream/gateway errors — the server already has the request.
          const isNetworkParseError =
            parseError.message?.includes('Empty response') ||
            parseError.message?.includes('network') ||
            parseError.message?.includes('Failed to fetch');
          const isUpstreamError =
            parseError.message?.includes('still generating') ||
            parseError.message?.includes('upstream') ||
            parseError.message?.includes('gateway');
          if (isUpstreamError) {
            // Surface the friendly message directly — no retry
            throw parseError;
          }
          if (attempt < MAX_RETRIES && !abortController.signal.aborted && isNetworkParseError) {
            lastError = new Error(parseError.message || 'Failed to parse server response');
            continue;
          }
          throw new Error(parseError.message || 'Failed to parse server response');
        }

        // Check for error response (server may return 200 with error object due to keep-alive)
        if (!response.ok || responseData.error) {
          throw new Error(responseData.message || responseData.details || responseData.error || 'Generation failed');
        }

        const podcast: GeneratedPodcast = responseData;

        playCompletionChime();
        clearPendingPodcast();

        // Warn the user if real-time research failed during generation
        if (responseData.researchFailed && (responseData.templateCategory === 'news' || responseData.templateCategory === 'sports')) {
          toast({
            title: 'Real-time research unavailable',
            description: 'Live data could not be fetched. This episode was generated from general knowledge and may not reflect the latest news.',
            variant: 'default',
            duration: 8000,
          });
        }

        if (podcast?.id) {
          
          queryClient.setQueryData(["/api/podcasts"], (oldData: any[] | undefined) => {
            if (!oldData) return [podcast];
            return [podcast, ...oldData.filter(p => p.id !== podcast.id)];
          });
          
          if (podcast.isPublic) {
            queryClient.setQueryData(["/api/podcasts/public"], (oldData: any) => {
              if (!oldData) return { podcasts: [podcast], total: 1 };
              const existingPodcasts = oldData.podcasts || [];
              const alreadyExists = existingPodcasts.some((p: any) => p.id === podcast.id);
              return { ...oldData, podcasts: [podcast, ...existingPodcasts.filter((p: any) => p.id !== podcast.id)], total: alreadyExists ? (oldData.total || 0) : (oldData.total || 0) + 1 };
            });
          }
        }

        setBrewJobs(prev => prev.map(j => 
          j.id === job.id ? {
            ...j,
            status: 'complete' as BrewJobStatus,
            progress: 100,
            statusMessage: 'Brew complete!',
            podcastId: String(podcast.id),
            podcastTitle: podcast.title || podcast.topic,
            completedPodcast: podcast,
          } : j
        ));

        queryClient.invalidateQueries({ queryKey: ["/api/podcasts"], type: 'all' });
        queryClient.invalidateQueries({ queryKey: ['/api/podcasts/mine'], type: 'all' });
        queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"], type: 'all' });
        queryClient.invalidateQueries({ queryKey: ["/api/podcasts/favorites"], type: 'all' });

        abortControllersRef.current.delete(job.id);
        return podcast;
      } catch (error: any) {
        // For transient network errors, retry if attempts remain
        if (attempt < MAX_RETRIES && !abortController.signal.aborted && 
            (error.message?.includes('Empty response') || error.message?.includes('network') || error.message?.includes('Failed to fetch'))) {
          lastError = error;
          console.log(`[Brew] Transient error on attempt ${attempt + 1}, will retry: ${error.message}`);
          continue;
        }

        abortControllersRef.current.delete(job.id);
        
        if (error.name === 'AbortError') {
          // Don't overwrite if job was already completed by stale detection
          setBrewJobs(prev => prev.map(j => 
            j.id === job.id && j.status !== 'complete' 
              ? { ...j, status: 'cancelled' as BrewJobStatus, statusMessage: 'Cancelled' } 
              : j
          ));
          return null;
        }

        // Upstream/gateway timeout — the podcast is still generating on the server.
        // Keep the job as 'brewing' so the stale-detection interval can auto-complete
        // it when the server finishes. No error toast — progress bar holds at 95%.
        const isUpstreamTimeout =
          error.message?.includes('still generating') ||
          error.message?.includes('upstream') ||
          error.message?.includes('gateway') ||
          error.message?.includes('bad gateway') ||
          error.message?.includes('504') ||
          error.message?.includes('502');
        if (isUpstreamTimeout) {
          console.warn(`[Brew] Gateway timeout for job ${job.id} — keeping as brewing, stale-detection will auto-complete`);
          setBrewJobs(prev => prev.map(j =>
            j.id === job.id && j.status !== 'complete' ? {
              ...j,
              statusMessage: 'Still brewing on server...',
            } : j
          ));
          // Immediately refetch so the next stale-detection tick can find the podcast
          queryClient.refetchQueries({ queryKey: ["/api/podcasts/mine"], type: 'all' });
          return null;
        }

        // Don't overwrite if job was already completed by stale detection
        setBrewJobs(prev => prev.map(j => 
          j.id === job.id && j.status !== 'complete' ? { 
            ...j, 
            status: 'failed' as BrewJobStatus, 
            statusMessage: 'Failed',
            error: error.message 
          } : j
        ));
        throw error;
      }
    }

    // All retries exhausted - don't overwrite if already completed
    abortControllersRef.current.delete(job.id);
    const finalError = lastError || new Error('Generation failed after retries');
    setBrewJobs(prev => prev.map(j => 
      j.id === job.id && j.status !== 'complete' ? { 
        ...j, 
        status: 'failed' as BrewJobStatus, 
        statusMessage: 'Failed after retries',
        error: finalError.message 
      } : j
    ));
    throw finalError;
  }, []);

  const startBrewing = useCallback(async (params: {
    templateName: string;
    topic?: string;
    durationMinutes: number;
    requestBody: any;
  }): Promise<GeneratedPodcast | null> => {
    // Use ref-based counter to avoid stale closure — brewJobs state may not have updated yet
    // when multiple calls land in the same render cycle.
    if (activeLaunchCountRef.current >= MAX_CONCURRENT_BREWS) {
      return null;
    }
    activeLaunchCountRef.current++;

    const jobId = generateJobId();
    const numHosts: number = params.requestBody?.numPeople === 1 ? 1 : 2;
    const estimatedTime = estimateGenerationTime(params.durationMinutes, numHosts);
    const startTime = Date.now();

    const newJob: BrewJob = {
      id: jobId,
      status: 'queued',
      progress: 0,
      statusMessage: 'Queued...',
      templateName: params.templateName,
      topic: params.topic,
      durationMinutes: params.durationMinutes,
      numHosts,
      startTime,
      estimatedGenerationTime: estimatedTime,
    };

    setBrewJobs(prev => [...prev, newJob]);

    // Inject the idempotency key so the backend can de-duplicate on retries
    const requestBodyWithJobId = { ...params.requestBody, clientJobId: jobId };

    try {
      return await executeBrew(newJob, requestBodyWithJobId);
    } finally {
      activeLaunchCountRef.current--;
    }
  }, [executeBrew]);

  const cancelBrew = useCallback((jobId: string) => {
    const controller = abortControllersRef.current.get(jobId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(jobId);
    }

    setBrewJobs(prev => prev.map(j => 
      j.id === jobId ? { ...j, status: 'cancelled' as BrewJobStatus, statusMessage: 'Cancelled' } : j
    ));
  }, []);

  const clearCompletedBrews = useCallback(() => {
    setBrewJobs(prev => prev.filter(j => j.status === 'brewing' || j.status === 'queued'));
  }, []);

  const removeJob = useCallback((jobId: string) => {
    const controller = abortControllersRef.current.get(jobId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(jobId);
    }
    setBrewJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  const startTrialBrew = useCallback(async (params: {
    topic: string;
    guestSessionToken: string;
  }): Promise<GeneratedPodcast | null> => {
    const jobId = generateJobId();
    const TRIAL_DURATION_MINUTES = 2;
    const estimatedTime = 120; // Trial brews are fast - ~2 minutes
    const startTime = Date.now();

    const newJob: BrewJob = {
      id: jobId,
      status: 'brewing',
      progress: 0,
      statusMessage: 'Creating your quick podcast...',
      templateName: 'Quick 2-min Podcast',
      topic: params.topic,
      durationMinutes: TRIAL_DURATION_MINUTES,
      numHosts: 1,
      startTime,
      estimatedGenerationTime: estimatedTime,
    };

    setBrewJobs(prev => [...prev, newJob]);

    try {
      const response = await fetch('/api/trial/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: params.topic,
          guestSessionToken: params.guestSessionToken,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        // Create error with requiresSignup property for handling in caller
        const error = new Error(data.error || data.message || 'Failed to create trial podcast') as Error & { requiresSignup?: boolean };
        error.requiresSignup = data.requiresSignup;
        throw error;
      }

      const data = await response.json();
      const podcast: GeneratedPodcast = data.podcast;

      playCompletionChime();

      // Update query cache with new podcast
      if (podcast?.id) {
        queryClient.setQueryData(["/api/podcasts/public"], (oldData: any) => {
          if (!oldData) return { podcasts: [podcast], total: 1 };
          const existingPodcasts = oldData.podcasts || [];
          const alreadyExists = existingPodcasts.some((p: any) => p.id === podcast.id);
          return { ...oldData, podcasts: [podcast, ...existingPodcasts.filter((p: any) => p.id !== podcast.id)], total: alreadyExists ? (oldData.total || 0) : (oldData.total || 0) + 1 };
        });
      }

      setBrewJobs(prev => prev.map(j => 
        j.id === jobId ? {
          ...j,
          status: 'complete' as BrewJobStatus,
          progress: 100,
          statusMessage: 'Brew complete!',
          podcastId: String(podcast.id),
          podcastTitle: podcast.title || podcast.topic,
          completedPodcast: podcast,
        } : j
      ));

      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/public"], type: 'all' });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts/trending"], type: 'all' });

      return podcast;
    } catch (error: any) {
      setBrewJobs(prev => prev.map(j => 
        j.id === jobId ? { 
          ...j, 
          status: 'failed' as BrewJobStatus, 
          statusMessage: 'Failed',
          error: error.message 
        } : j
      ));
      throw error;
    }
  }, []);

  return (
    <GlobalBrewingContext.Provider value={{
      brewJobs,
      activeBrewCount,
      startBrewing,
      startTrialBrew,
      cancelBrew,
      clearCompletedBrews,
      removeJob,
    }}>
      {children}
    </GlobalBrewingContext.Provider>
  );
}
