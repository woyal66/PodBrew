let audioContext: AudioContext | null = null;
let lastChimeTime = 0;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
}

function scheduleNotes(ctx: AudioContext): void {
  const currentTime = ctx.currentTime;

  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  masterGain.gain.setValueAtTime(0.8, currentTime);

  const frequencies = [523.25, 659.25, 783.99];
  const durations = [0.15, 0.15, 0.25];
  let offset = 0;
  let maxDuration = 0;

  frequencies.forEach((freq, i) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, currentTime + offset);

    gainNode.gain.setValueAtTime(0, currentTime + offset);
    gainNode.gain.linearRampToValueAtTime(0.7, currentTime + offset + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + offset + durations[i]);

    oscillator.connect(gainNode);
    gainNode.connect(masterGain);

    oscillator.start(currentTime + offset);
    oscillator.stop(currentTime + offset + durations[i]);

    offset += durations[i] * 0.7;
    maxDuration = Math.max(maxDuration, offset + durations[i]);
  });

  // Ramp master gain down to 0 after all notes finish
  const stopTime = currentTime + maxDuration + 0.15;
  masterGain.gain.exponentialRampToValueAtTime(0.001, stopTime - 0.05);
  masterGain.gain.setValueAtTime(0, stopTime);

  // Disconnect master gain after all audio has stopped
  setTimeout(() => {
    masterGain.disconnect();
  }, (maxDuration + 0.2) * 1000);
}

export function playCompletionChime(): void {
  // Check if chime is enabled (allow disabling via localStorage)
  const enabled = localStorage.getItem('podbrew_completion_chime') !== 'false';
  if (!enabled) return;

  // Prevent multiple chimes within 2 seconds (debounce)
  const now = Date.now();
  if (now - lastChimeTime < 2000) {
    console.log('[Chime] Debouncing chime - already played recently');
    return;
  }
  lastChimeTime = now;

  try {
    const ctx = getAudioContext();

    if (ctx.state === 'suspended') {
      // Many browsers (especially mobile) start AudioContext in suspended state
      // and require an explicit resume() before audio will play.
      ctx.resume().then(() => {
        scheduleNotes(ctx);
      }).catch(err => {
        console.warn('[Chime] AudioContext resume failed:', err);
      });
    } else {
      scheduleNotes(ctx);
    }
  } catch (error) {
    console.warn('Failed to play completion chime:', error);
  }
}
