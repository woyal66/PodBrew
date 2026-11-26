import { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { AudioPlayer } from "@/components/audio-player";
import type { GeneratedPodcast } from "@shared/schema";

export function BottomPlayer() {
  const { state, play } = useAudioPlayer();
  const isPlayingRef = useRef(state.isPlaying);

  useEffect(() => {
    isPlayingRef.current = state.isPlaying;
  }, [state.isPlaying]);

  useEffect(() => {
    const handleBrewComplete = (e: Event) => {
      const podcast: GeneratedPodcast = (e as CustomEvent).detail?.podcast;
      if (!podcast) return;

      const autoPlayEnabled = localStorage.getItem('podbrew_autoplay') === 'true';
      if (!autoPlayEnabled) return;

      if (isPlayingRef.current) return;

      console.log('[BottomPlayer] Stale-detection brew complete — auto-playing:', podcast.title || podcast.topic);
      setTimeout(() => {
        if (isPlayingRef.current) return;
        play(podcast, true, autoPlayEnabled);
      }, 500);
    };

    window.addEventListener('podbrew-brew-complete', handleBrewComplete);
    return () => window.removeEventListener('podbrew-brew-complete', handleBrewComplete);
  }, [play]);

  if (!state.currentPodcast) {
    return null;
  }

  return (
    <div data-testid="bottom-player">
      <AudioPlayer
        title="PodBrew"
        topic={state.currentPodcast.topic}
        coverImage={state.currentPodcast.coverImageUrl || undefined}
        podcastId={state.currentPodcast.id}
      />
    </div>
  );
}
