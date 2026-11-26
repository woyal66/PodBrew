import { useEffect, useCallback } from 'react';

interface MediaSessionOptions {
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
  onStop?: () => void;
}

export function useMediaSession(options: MediaSessionOptions | null) {
  const {
    title = '',
    artist = 'PodBrew',
    album = 'AI Podcast',
    artwork = '',
    onPlay,
    onPause,
    onSeekBackward,
    onSeekForward,
    onPreviousTrack,
    onNextTrack,
    onStop,
  } = options || {};

  const updatePositionState = useCallback((
    duration: number,
    position: number,
    playbackRate: number = 1
  ) => {
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, duration),
          playbackRate: Math.max(0.25, Math.min(4, playbackRate)),
          position: Math.max(0, Math.min(position, duration)),
        });
      } catch (error) {
        console.warn('Failed to update media session position:', error);
      }
    }
  }, []);

  const setPlaybackState = useCallback((state: 'playing' | 'paused' | 'none') => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !options) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: artwork ? [
        { src: artwork, sizes: '96x96', type: 'image/png' },
        { src: artwork, sizes: '128x128', type: 'image/png' },
        { src: artwork, sizes: '192x192', type: 'image/png' },
        { src: artwork, sizes: '256x256', type: 'image/png' },
        { src: artwork, sizes: '384x384', type: 'image/png' },
        { src: artwork, sizes: '512x512', type: 'image/png' },
      ] : [],
    });

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', onPlay || null],
      ['pause', onPause || null],
      ['seekbackward', onSeekBackward || null],
      ['seekforward', onSeekForward || null],
      ['previoustrack', onPreviousTrack || null],
      ['nexttrack', onNextTrack || null],
      ['stop', onStop || null],
    ];

    handlers.forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        console.warn(`Media Session action '${action}' not supported:`, error);
      }
    });

    return () => {
      handlers.forEach(([action]) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (error) {
        }
      });
    };
  }, [title, artist, album, artwork, onPlay, onPause, onSeekBackward, onSeekForward, onPreviousTrack, onNextTrack, onStop, options]);

  return {
    updatePositionState,
    setPlaybackState,
    isSupported: 'mediaSession' in navigator,
  };
}
