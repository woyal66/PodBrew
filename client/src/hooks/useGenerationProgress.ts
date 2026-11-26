import { useState, useEffect, useCallback } from 'react';
import { playCompletionChime } from '@/lib/chime';

export interface GenerationProgress {
  isGenerating: boolean;
  progress: number;
  status: string;
  podcastId?: string;
  templateName?: string;
  startTime?: number;
  durationMinutes?: number;
  estimatedGenerationTime?: number;
}

const STORAGE_KEY = 'podbrew_generation_progress';

export function useGenerationProgress() {
  const [generationState, setGenerationState] = useState<GenerationProgress>(() => {
    if (typeof window === 'undefined') return { isGenerating: false, progress: 0, status: '' };
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : { isGenerating: false, progress: 0, status: '' };
    } catch {
      return { isGenerating: false, progress: 0, status: '' };
    }
  });

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(generationState));
    }
  }, [generationState]);

  const setProgress = useCallback((progress: number, status: string, templateName?: string) => {
    setGenerationState(prev => ({
      ...prev,
      progress,
      status,
      templateName: templateName || prev.templateName,
    }));
  }, []);

  const startGeneration = useCallback((templateName: string, durationMinutes?: number, estimatedTime?: number) => {
    setGenerationState({
      isGenerating: true,
      progress: 0,
      status: 'Initializing brew...',
      templateName,
      startTime: Date.now(),
      durationMinutes,
      estimatedGenerationTime: estimatedTime,
    });
  }, []);

  const completeGeneration = useCallback((podcastId: string) => {
    // Play completion chime if enabled
    playCompletionChime();
    
    setGenerationState(prev => ({
      ...prev,
      isGenerating: true,
      progress: 100,
      status: 'Brew complete!',
      podcastId,
    }));
    
    // Clear after 2 seconds
    setTimeout(() => {
      setGenerationState({ isGenerating: false, progress: 0, status: '' });
      localStorage.removeItem(STORAGE_KEY);
    }, 2000);
  }, []);

  const failGeneration = useCallback(() => {
    setGenerationState(prev => ({
      ...prev,
      isGenerating: false,
      progress: 0,
      status: '',
    }));
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    ...generationState,
    setProgress,
    startGeneration,
    completeGeneration,
    failGeneration,
  };
}
