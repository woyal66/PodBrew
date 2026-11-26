import { createContext, useContext, useReducer, useRef, useEffect, ReactNode } from "react";
import type { GeneratedPodcast } from "@shared/schema";

interface AudioPlayerState {
  currentPodcast: GeneratedPodcast | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  volume: number;
  isLoading: boolean;
  shouldAutoExpand: boolean;
  error: string | null;
  queue: GeneratedPodcast[];
}

type AudioPlayerAction =
  | { type: "PLAY_PODCAST"; podcast: GeneratedPodcast; autoExpand?: boolean; autoPlay?: boolean }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "SET_TIME"; time: number }
  | { type: "SET_DURATION"; duration: number }
  | { type: "SET_SPEED"; speed: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SKIP_FORWARD" }
  | { type: "SKIP_BACKWARD" }
  | { type: "CLEAR_AUTO_EXPAND" }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "CLEAR_ERROR" }
  | { type: "QUEUE_PODCAST"; podcast: GeneratedPodcast }
  | { type: "CLEAR_QUEUE" }
  | { type: "ADVANCE_QUEUE" };

interface AudioPlayerContextValue {
  state: AudioPlayerState;
  play: (podcast?: GeneratedPodcast, autoExpand?: boolean, autoPlay?: boolean) => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: number) => void;
  setVolume: (volume: number) => void;
  skipForward: () => void;
  skipBackward: () => void;
  isCurrentPodcast: (podcastId: string) => boolean;
  clearAutoExpand: () => void;
  clearError: () => void;
  queuePodcast: (podcast: GeneratedPodcast) => boolean;
  skipToNext: () => GeneratedPodcast | null;
  restart: () => boolean;
  clearQueue: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

// Validate a podcast object has the fields needed to actually play.
// Used both when rehydrating from localStorage and when sanity-checking a
// podcast handed to the player at runtime, so the audio element never tries
// to load ".../undefined" or an empty src.
function hasValidAudio(podcast: { id?: unknown; audioUrl?: unknown } | null): boolean {
  if (!podcast) return false;
  if (typeof podcast.id !== 'string' || !podcast.id) return false;
  const url = podcast.audioUrl;
  if (typeof url !== 'string' || !url) return false;
  if (url === 'undefined' || url.endsWith('/undefined')) return false;
  return true;
}

// Load last played podcast from localStorage
function getLastPlayedPodcast(): GeneratedPodcast | null {
  try {
    const lastPodcast = localStorage.getItem("lastPlayedPodcast");
    if (!lastPodcast) return null;
    const parsed = JSON.parse(lastPodcast) as GeneratedPodcast;
    if (!hasValidAudio(parsed)) {
      // Stale entry from a previous session — drop it so the player effect
      // never tries to set audio.src to undefined and stall the element.
      localStorage.removeItem("lastPlayedPodcast");
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const _lastPlayed = getLastPlayedPodcast();
const initialState: AudioPlayerState = {
  currentPodcast: _lastPlayed,
  isPlaying: false,
  currentTime: 0,
  duration: _lastPlayed ? formatTimeToSeconds(_lastPlayed.duration) : 0,
  playbackSpeed: parseFloat(localStorage.getItem("playbackSpeed") || "1"),
  volume: parseFloat(localStorage.getItem("audioVolume") || "75"),
  isLoading: false,
  shouldAutoExpand: false,
  error: null,
  queue: [],
};

// Helper function to convert MM:SS format to seconds
function formatTimeToSeconds(timeString: string): number {
  if (!timeString) return 0;
  const parts = timeString.split(':').map(p => parseInt(p, 10));
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function audioPlayerReducer(state: AudioPlayerState, action: AudioPlayerAction): AudioPlayerState {
  switch (action.type) {
    case "PLAY_PODCAST":
      // Use the podcast's duration (calculated from WAV buffer) instead of audio element's duration
      // The podcast.duration is in "MM:SS" format (e.g., "5:23")
      const podcastDurationSeconds = formatTimeToSeconds(action.podcast.duration);
      // Save last played podcast to localStorage
      localStorage.setItem("lastPlayedPodcast", JSON.stringify(action.podcast));
      return {
        ...state,
        currentPodcast: action.podcast,
        isPlaying: action.autoPlay !== false, // Default to true unless explicitly false
        currentTime: 0,
        duration: podcastDurationSeconds, // Set from podcast object, don't wait for audio metadata
        isLoading: true,
        shouldAutoExpand: action.autoExpand ?? false,
        error: null, // Clear any previous error when playing new podcast
      };
    case "CLEAR_AUTO_EXPAND":
      return { ...state, shouldAutoExpand: false };
    case "PLAY":
      return { ...state, isPlaying: true };
    case "PAUSE":
      return { ...state, isPlaying: false };
    case "STOP":
      return {
        ...state,
        isPlaying: false,
        currentTime: 0,
      };
    case "SET_TIME":
      return { ...state, currentTime: action.time };
    case "SET_DURATION":
      return { ...state, duration: action.duration };
    case "SET_SPEED":
      localStorage.setItem("playbackSpeed", action.speed.toString());
      return { ...state, playbackSpeed: action.speed };
    case "SET_VOLUME":
      localStorage.setItem("audioVolume", action.volume.toString());
      return { ...state, volume: action.volume };
    case "SET_LOADING":
      return { ...state, isLoading: action.loading };
    case "SKIP_FORWARD":
      return { ...state, currentTime: Math.min(state.currentTime + 15, state.duration) };
    case "SKIP_BACKWARD":
      return { ...state, currentTime: Math.max(state.currentTime - 15, 0) };
    case "SET_ERROR":
      return { ...state, error: action.error, isPlaying: false, isLoading: false };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "QUEUE_PODCAST":
      return { ...state, queue: [...state.queue, action.podcast] };
    case "CLEAR_QUEUE":
      return { ...state, queue: [] };
    case "ADVANCE_QUEUE": {
      const [next, ...rest] = state.queue;
      if (!next) return state;
      const podcastDurationSeconds = formatTimeToSeconds(next.duration);
      localStorage.setItem("lastPlayedPodcast", JSON.stringify(next));
      return {
        ...state,
        currentPodcast: next,
        queue: rest,
        isPlaying: true,
        currentTime: 0,
        duration: podcastDurationSeconds,
        isLoading: true,
        shouldAutoExpand: false,
        error: null,
      };
    }
    default:
      return state;
  }
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(audioPlayerReducer, initialState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number>();
  const isSeekingRef = useRef<boolean>(false);
  const playCountIncrementedRef = useRef<string | null>(null);
  // Mirror the queue so the audio "ended" event handler — which is registered
  // once and closes over the initial state — can still see the latest queue.
  const queueRef = useRef<GeneratedPodcast[]>([]);
  useEffect(() => {
    queueRef.current = state.queue;
  }, [state.queue]);
  // Resume-from-position support
  const lastSyncedAtRef = useRef<number>(0);
  const lastSyncedPodcastRef = useRef<string | null>(null);
  const resumeAttemptedRef = useRef<string | null>(null);

  // Throttled save of resume position to the server. Fire-and-forget;
  // 401 (unauthenticated) is silently ignored so guests still play normally.
  const savePlaybackProgress = (podcastId: string, position: number, duration: number) => {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
    fetch('/api/playback-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        podcastId,
        positionSeconds: Math.floor(position),
        durationSeconds: Math.floor(duration),
      }),
    }).catch(() => { /* silent: offline / unauth */ });
  };

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }

    const audio = audioRef.current;

    const handleLoadedMetadata = () => {
      console.log("[Audio Player] Metadata loaded:", {
        audioDuration: audio.duration,
        src: audio.src
      });
      // Don't use audio.duration - use the duration from the podcast object instead
      // The podcast object has the correct duration calculated from WAV buffer
      // Only update loading state
      dispatch({ type: "SET_LOADING", loading: false });
    };

    const handleEnded = () => {
      console.log("[Audio Player] Playback ended");
      // Mark this podcast as completed in playback_progress so it drops
      // out of Continue Listening on the next refresh.
      const podcast = state.currentPodcast;
      if (podcast && audio.duration > 0) {
        savePlaybackProgress(podcast.id, audio.duration, audio.duration);
      }
      // If there's a queued episode, jump to it; otherwise stop.
      if (queueRef.current.length > 0) {
        dispatch({ type: "ADVANCE_QUEUE" });
      } else {
        dispatch({ type: "STOP" });
      }
    };

    const handleError = (e: Event) => {
      console.error("[Audio Player] Error occurred:", {
        error: audio.error,
        errorCode: audio.error?.code,
        errorMessage: audio.error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: audio.src,
        currentTime: audio.currentTime,
        duration: audio.duration,
        event: e
      });
      
      // Map error codes to user-friendly messages
      let errorMessage = "Unable to play audio";
      if (audio.error) {
        switch (audio.error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = "Playback was aborted";
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = "Network error - please check your connection";
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = "Audio file is corrupted or unavailable";
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = "Audio file is unavailable or unsupported";
            break;
        }
      }
      
      dispatch({ type: "SET_ERROR", error: errorMessage });
    };

    const handleStalled = () => {
      console.warn("[Audio Player] Playback stalled - browser is trying to fetch data but nothing is arriving");
    };

    const handleSuspend = () => {
      console.warn("[Audio Player] Media data loading suspended");
    };

    const handleWaiting = () => {
      console.log("[Audio Player] Waiting for data to continue playback");
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("stalled", handleStalled);
    audio.addEventListener("suspend", handleSuspend);
    audio.addEventListener("waiting", handleWaiting);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("stalled", handleStalled);
      audio.removeEventListener("suspend", handleSuspend);
      audio.removeEventListener("waiting", handleWaiting);
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = state.playbackSpeed;
  }, [state.playbackSpeed]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = state.volume / 100;
  }, [state.volume]);

  useEffect(() => {
    if (!audioRef.current) return;

    const audio = audioRef.current;

    // Function to update time via RAF loop
    const updateTime = () => {
      if (!isSeekingRef.current && audioRef.current) {
        dispatch({ type: "SET_TIME", time: audioRef.current.currentTime });
      }
      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    // Start RAF loop - called by multiple events to ensure it starts
    const startRafLoop = () => {
      // Cancel any existing loop first
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Start fresh RAF loop
      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    // Fallback: Update time directly on timeupdate event (fires every ~250ms)
    // This ensures progress updates even if RAF loop hasn't started
    const handleTimeUpdate = () => {
      if (!isSeekingRef.current && audioRef.current) {
        dispatch({ type: "SET_TIME", time: audioRef.current.currentTime });

        // Throttled resume-position sync: every 10 seconds while playing.
        const podcast = state.currentPodcast;
        if (podcast) {
          const now = Date.now();
          if (now - lastSyncedAtRef.current > 10000) {
            lastSyncedAtRef.current = now;
            lastSyncedPodcastRef.current = podcast.id;
            savePlaybackProgress(
              podcast.id,
              audioRef.current.currentTime,
              state.duration || audioRef.current.duration || 0
            );
          }
        }
      }
      // Also ensure RAF loop is running
      if (!animationFrameRef.current) {
        startRafLoop();
      }
    };

    if (state.isPlaying) {
      // Add multiple event listeners to ensure RAF loop starts
      audio.addEventListener('playing', startRafLoop);
      audio.addEventListener('play', startRafLoop);
      audio.addEventListener('timeupdate', handleTimeUpdate);
      
      // Also start loop immediately if audio is already playing (e.g., resume from pause)
      if (!audio.paused && audio.readyState >= 2) {
        startRafLoop();
      }
      
      // Only try to play if not loading a new podcast
      // New podcast loading is handled by the canplay event in the other useEffect
      if (!state.isLoading && audio.src && audio.readyState >= 2) {
        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch(() => {
            dispatch({ type: "PAUSE" });
          });
        }
      }
    } else {
      audio.pause();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    }

    return () => {
      audio.removeEventListener('playing', startRafLoop);
      audio.removeEventListener('play', startRafLoop);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [state.isPlaying, state.isLoading, state.currentPodcast?.id]);

  useEffect(() => {
    if (!audioRef.current || !state.currentPodcast) return;

    const audio = audioRef.current;
    const podcast = state.currentPodcast;
    // Hardened guard for the rehydrate-on-mount path: if the persisted
    // podcast has a missing/invalid audioUrl we surface the same
    // "audio unavailable" error as play() and skip both the audio.src
    // assignment and the resume-position fetch — otherwise the browser
    // turns an undefined src into ".../undefined" and emits
    // DEMUXER_ERROR_COULD_NOT_OPEN plus a wasted /api/playback-progress
    // round-trip on every cold load.
    if (!hasValidAudio(podcast)) {
      console.error(
        '[Audio Player] Skipping load for podcast with invalid audioUrl:',
        podcast.id,
        podcast.audioUrl,
      );
      dispatch({ type: 'SET_ERROR', error: 'Audio file is unavailable for this podcast' });
      return;
    }
    const podcastId = podcast.id;
    audio.src = podcast.audioUrl;
    audio.load();

    // Reset sync throttle when switching podcasts so the new one syncs
    // its first position promptly.
    if (lastSyncedPodcastRef.current !== podcastId) {
      lastSyncedAtRef.current = 0;
    }

    // Resume-from-position: fetch saved position once per podcast switch
    // and seek there on canplay. Only attempts once per podcast.
    let cancelled = false;
    const resumePromise = (async () => {
      if (resumeAttemptedRef.current === podcastId) return null;
      resumeAttemptedRef.current = podcastId;
      try {
        const res = await fetch(`/api/playback-progress/${podcastId}`, { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || cancelled) return null;
        const pos = Number(data.positionSeconds) || 0;
        const dur = Number(data.durationSeconds) || 0;
        // Only resume if there's a meaningful saved position (>5s) and
        // we haven't already finished (>=95% is treated as completed).
        if (pos > 5 && dur > 0 && pos / dur < 0.95) {
          return pos;
        }
        return null;
      } catch {
        return null;
      }
    })();

    // Immediately start playing when audio can play if isPlaying is true
    const handleCanPlay = async () => {
      const resumeAt = await resumePromise;
      if (cancelled) return;
      if (resumeAt != null && audioRef.current) {
        try {
          audioRef.current.currentTime = resumeAt;
          dispatch({ type: "SET_TIME", time: resumeAt });
        } catch (err) {
          console.warn('[Audio Player] Failed to seek to resume position', err);
        }
      }
      if (state.isPlaying) {
        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch(() => {
            dispatch({ type: "PAUSE" });
          });
        }
      }
    };

    audio.addEventListener('canplay', handleCanPlay, { once: true });

    return () => {
      cancelled = true;
      audio.removeEventListener('canplay', handleCanPlay);
      // Save position when switching away from a podcast.
      if (audio.currentTime > 0 && audio.duration > 0) {
        savePlaybackProgress(podcastId, audio.currentTime, audio.duration);
      }
    };
  }, [state.currentPodcast?.id]);

  // Save position when the player pauses (so refresh-after-pause resumes correctly)
  // and on tab-close / unmount.
  useEffect(() => {
    if (!state.isPlaying && state.currentPodcast && audioRef.current) {
      const audio = audioRef.current;
      if (audio.currentTime > 0 && audio.duration > 0) {
        savePlaybackProgress(state.currentPodcast.id, audio.currentTime, audio.duration);
      }
    }
  }, [state.isPlaying, state.currentPodcast?.id]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const audio = audioRef.current;
      const podcast = state.currentPodcast;
      if (audio && podcast && audio.currentTime > 0 && audio.duration > 0) {
        // sendBeacon survives page unload where fetch would be cancelled.
        try {
          const blob = new Blob(
            [JSON.stringify({
              podcastId: podcast.id,
              positionSeconds: Math.floor(audio.currentTime),
              durationSeconds: Math.floor(audio.duration),
            })],
            { type: 'application/json' }
          );
          navigator.sendBeacon('/api/playback-progress', blob);
        } catch { /* noop */ }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.currentPodcast?.id]);

  // Removed: This useEffect was causing race conditions with seek/skip operations
  // The RAF loop already keeps state in sync with audio element during playback
  // Manual seeks go directly to audio.currentTime, no need to sync back

  const incrementPlayCount = async (podcastId: string) => {
    try {
      await fetch(`/api/podcasts/${podcastId}/increment-play`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to increment play count:', error);
    }
  };

  useEffect(() => {
    if (!state.currentPodcast) {
      playCountIncrementedRef.current = null;
      return;
    }

    const podcastId = state.currentPodcast.id;

    if (playCountIncrementedRef.current !== podcastId && state.isPlaying) {
      incrementPlayCount(podcastId);
      playCountIncrementedRef.current = podcastId;
    }
  }, [state.currentPodcast?.id, state.isPlaying]);


  const play = (podcast?: GeneratedPodcast, autoExpand?: boolean, autoPlay?: boolean) => {
    if (podcast) {
      // Single canonical guard (shared with rehydrate + queue paths) so the
      // audio element never receives ".../undefined" or an empty src.
      if (!hasValidAudio(podcast)) {
        console.error('[Audio Player] Refusing to play podcast with invalid audioUrl:', podcast.id, podcast.audioUrl);
        dispatch({ type: "SET_ERROR", error: "Audio file is unavailable for this podcast" });
        return;
      }
      dispatch({ type: "PLAY_PODCAST", podcast, autoExpand, autoPlay });
    } else {
      dispatch({ type: "PLAY" });
    }
  };

  const clearAutoExpand = () => {
    dispatch({ type: "CLEAR_AUTO_EXPAND" });
  };

  const pause = () => {
    dispatch({ type: "PAUSE" });
  };

  const stop = () => {
    dispatch({ type: "STOP" });
  };

  const seek = (time: number) => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    
    // For slider seeks, we don't block - just update the time directly
    // The seeking flag is mainly for skip buttons to prevent rapid clicking
    audio.currentTime = time;
    dispatch({ type: "SET_TIME", time });
  };

  const setSpeed = (speed: number) => {
    dispatch({ type: "SET_SPEED", speed });
  };

  const setVolume = (volume: number) => {
    dispatch({ type: "SET_VOLUME", volume });
  };

  const skipForward = () => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    
    // Prevent multiple simultaneous skip operations
    if (isSeekingRef.current) return;
    
    isSeekingRef.current = true;
    const currentTime = audio.currentTime;
    const duration = audio.duration || state.duration;
    // Cap at duration - 0.5 to prevent triggering 'ended' event which resets to 0
    // Also ensure we don't go negative if duration hasn't loaded yet
    const maxTime = Math.max(duration - 0.5, 0);
    const newTime = Math.min(currentTime + 15, maxTime);
    
    // Set the audio time
    audio.currentTime = newTime;
    
    // Wait for seek to complete, then update state
    const handleSeeked = () => {
      isSeekingRef.current = false;
      dispatch({ type: "SET_TIME", time: audio.currentTime });
      audio.removeEventListener('seeked', handleSeeked);
    };
    
    audio.addEventListener('seeked', handleSeeked, { once: true });
    
    // Fallback timeout
    setTimeout(() => {
      if (isSeekingRef.current) {
        isSeekingRef.current = false;
        dispatch({ type: "SET_TIME", time: audio.currentTime });
        audio.removeEventListener('seeked', handleSeeked);
      }
    }, 300);
  };

  const skipBackward = () => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    
    // Prevent multiple simultaneous skip operations
    if (isSeekingRef.current) return;
    
    isSeekingRef.current = true;
    const currentTime = audio.currentTime;
    const newTime = Math.max(currentTime - 15, 0);
    
    // Set the audio time
    audio.currentTime = newTime;
    
    // Wait for seek to complete, then update state
    const handleSeeked = () => {
      isSeekingRef.current = false;
      dispatch({ type: "SET_TIME", time: audio.currentTime });
      audio.removeEventListener('seeked', handleSeeked);
    };
    
    audio.addEventListener('seeked', handleSeeked, { once: true });
    
    // Fallback timeout
    setTimeout(() => {
      if (isSeekingRef.current) {
        isSeekingRef.current = false;
        dispatch({ type: "SET_TIME", time: audio.currentTime });
        audio.removeEventListener('seeked', handleSeeked);
      }
    }, 300);
  };

  const isCurrentPodcast = (podcastId: string) => {
    return state.currentPodcast?.id === podcastId;
  };

  const queuePodcast = (podcast: GeneratedPodcast): boolean => {
    if (!hasValidAudio(podcast)) {
      console.error("[Audio Player] Refusing to queue podcast with invalid audioUrl:", podcast.id, podcast.audioUrl);
      return false;
    }
    dispatch({ type: "QUEUE_PODCAST", podcast });
    return true;
  };

  const skipToNext = (): GeneratedPodcast | null => {
    const next = state.queue[0];
    if (!next) return null;
    dispatch({ type: "ADVANCE_QUEUE" });
    return next;
  };

  const restart = (): boolean => {
    if (!audioRef.current || !state.currentPodcast) return false;
    const audio = audioRef.current;
    try {
      audio.currentTime = 0;
    } catch {
      // ignore
    }
    dispatch({ type: "SET_TIME", time: 0 });
    if (!state.isPlaying) {
      dispatch({ type: "PLAY" });
    } else {
      const playPromise = audio.play();
      if (playPromise) playPromise.catch(() => { /* ignore */ });
    }
    return true;
  };

  const clearQueue = () => dispatch({ type: "CLEAR_QUEUE" });

  return (
    <AudioPlayerContext.Provider
      value={{
        state,
        play,
        pause,
        stop,
        seek,
        setSpeed,
        setVolume,
        skipForward,
        skipBackward,
        isCurrentPodcast,
        clearAutoExpand,
        clearError: () => dispatch({ type: "CLEAR_ERROR" }),
        queuePodcast,
        skipToNext,
        restart,
        clearQueue,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext);
  if (!context) {
    throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  }
  return context;
}
