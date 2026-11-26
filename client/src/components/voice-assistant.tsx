import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { Mic, MicOff, X, Volume2, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { savePendingPodcast } from "@/lib/pendingPodcast";
import { useGlobalBrewing } from "@/hooks/useGlobalBrewing";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { Capacitor } from "@capacitor/core";
import { VoiceLiveSession, type VoiceLiveEvent } from "@/lib/voiceLiveSession";
import {
  isNativeAndroid as isNativeAndroidPlatform,
  isNativeIOS as isNativeIOSPlatform,
  nativeHasMicPermission,
  openNativeAppSettings,
} from "@/lib/nativeBridge";
import { useMicPermissionWatcher } from "@/hooks/useMicPermissionWatcher";
import type { GeneratedPodcast } from "@shared/schema";

interface PodcastSearchResult {
  match: GeneratedPodcast | null;
  ambiguous: GeneratedPodcast[]; // candidates close in score; empty if not ambiguous
  recency: string | null;
  wantsLatest: boolean;
}

// Calls the server-side voice search endpoint, which scans the full library
// (no 200-row cap), parses recency/intent hints, and returns scored matches.
// We pick the top result when it's clearly the winner; if the runner-up is
// close, we surface the alternates so the assistant can ask for clarification.
async function findBestPodcastMatch(
  query: string,
  excludeIds: Set<string> = new Set()
): Promise<PodcastSearchResult> {
  const empty: PodcastSearchResult = {
    match: null,
    ambiguous: [],
    recency: null,
    wantsLatest: false,
  };

  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", "5");
  if (excludeIds.size > 0) {
    params.set("exclude", Array.from(excludeIds).join(","));
  }

  interface SearchMineResponse {
    parsed?: {
      cleanedQuery?: string | null;
      recency?: string | null;
      wantsLatest?: boolean;
      moods?: string[];
      speakerTokens?: string[];
      matchedVoiceCount?: number;
    };
    results?: Array<{ podcast: GeneratedPodcast; score: number }>;
  }

  let payload: SearchMineResponse;
  try {
    const res = await fetch(`/api/podcasts/search-mine?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return empty;
    payload = (await res.json()) as SearchMineResponse;
  } catch {
    return empty;
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length === 0) return empty;

  const top = results[0];
  const runnerUp = results[1];

  const wantsLatest = !!payload.parsed?.wantsLatest;
  const hasRecencyFilter = !!payload.parsed?.recency;
  const cleanedQuery = (payload.parsed?.cleanedQuery || "").trim();
  const moods = payload.parsed?.moods ?? [];
  const speakerTokens = payload.parsed?.speakerTokens ?? [];

  // Detect any intent that *could* benefit from clarification when several
  // candidates score similarly. "Latest" is a hard pick (newest wins) so it
  // never asks; everything else (keywords, moods, speakers, or a non-latest
  // recency window like "yesterday") can.
  const hasKeywordIntent = cleanedQuery.length > 0;
  const hasMoodIntent = moods.length > 0;
  const hasSpeakerIntent = speakerTokens.length > 0;
  const hasNonLatestRecencyIntent = hasRecencyFilter && !wantsLatest;
  const hasClarifiableIntent =
    hasKeywordIntent ||
    hasMoodIntent ||
    hasSpeakerIntent ||
    hasNonLatestRecencyIntent;

  // Ambiguity detection: when the user expressed any clarifiable intent, the
  // runner-up exists, and its score is within 25% of the top (with at most a
  // small number of close candidates so a clarifying question is actually
  // useful), surface the alternates so the assistant can ask which one.
  let ambiguous: GeneratedPodcast[] = [];
  if (hasClarifiableIntent && runnerUp && top.score >= 6) {
    const ratio = runnerUp.score / Math.max(top.score, 1);
    if (ratio >= 0.75) {
      const close = results
        .filter((r) => r.score >= top.score * 0.75)
        .slice(0, 3)
        .map((r) => r.podcast);
      // Only treat as ambiguous when there are 2-3 close candidates; with
      // many tied matches a clarifying question doesn't help, so we just
      // pick the top result (which is also the most recent given the
      // newest-wins tiebreaker on the server).
      if (close.length >= 2 && close.length <= 3) {
        ambiguous = close;
      }
    }
  }

  return {
    match: top.podcast,
    ambiguous,
    recency: payload?.parsed?.recency ?? null,
    wantsLatest: wantsLatest || hasRecencyFilter,
  };
}

function podcastLabel(p: GeneratedPodcast): string {
  return p.title || p.topic || "an episode";
}

function joinTitlesForSpeech(titles: string[]): string {
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `"${titles[0]}" or "${titles[1]}"`;
  const head = titles.slice(0, -1).map((t) => `"${t}"`).join(", ");
  return `${head}, or "${titles[titles.length - 1]}"`;
}

type AssistantState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "closed";

type MicPermission = "granted" | "denied" | "prompt" | "unsupported" | "service-unavailable";

async function checkMicPermission(): Promise<MicPermission> {
  if (typeof navigator === "undefined") return "unsupported";
  if (!navigator.permissions) return "unsupported";
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return result.state as MicPermission;
  } catch {
    return "unsupported";
  }
}

function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function isVoiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.AudioContext !== "undefined" &&
    typeof window.AudioWorkletNode !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebSocket !== "undefined"
  );
}

function PermissionDeniedPanel({
  onCheckAgain,
  onClose,
}: {
  onCheckAgain: () => void;
  onClose: () => void;
}) {
  const ios = isIOS();
  const nativeAndroid = isNativeAndroidPlatform();
  const nativeIOS = isNativeIOSPlatform();
  const nativeMobile = nativeAndroid || nativeIOS;
  const { toast } = useToast();

  const handleOpenAppSettings = () => {
    const launched = openNativeAppSettings();
    if (!launched) {
      // Both the native bridge and the platform fallback failed (e.g. on a
      // very old install without the bridge AND without scheme handling).
      // Tell the user where to go manually so the button isn't a dead-end.
      toast({
        title: "Couldn't open Settings",
        description: nativeIOS
          ? "Open your iPhone's Settings app, then scroll to PodBrew and turn on Microphone."
          : "Open your phone's Settings app, then go to Apps → PodBrew → Permissions and turn on Microphone.",
        variant: "destructive",
      });
    }
  };

  const steps = ios
    ? [
        "Open the Settings app on your iPhone",
        "Scroll down and tap Safari (or your browser)",
        "Tap Microphone and select Allow",
        "Come back and tap the mic again",
      ]
    : [
        "Tap the lock icon or site-settings icon in your browser's address bar",
        'Tap "Permissions" then "Microphone"',
        'Change the setting to "Allow"',
        "Reload the page and tap the mic again",
      ];

  return (
    <div className="p-6 flex flex-col items-center gap-5">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
        <Lock className="w-7 h-7 text-destructive" />
      </div>
      <div className="text-center space-y-1">
        <p className="font-semibold text-base">Microphone access blocked</p>
        <p className="text-sm text-muted-foreground">
          {nativeMobile
            ? "Microphone was denied. Open your phone settings to re-enable it for PodBrew."
            : "You previously blocked the mic. Here's how to re-enable it:"}
        </p>
      </div>

      {nativeMobile ? (
        <div className="w-full space-y-3">
          <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground text-center">
            {nativeIOS ? (
              <>
                Settings → PodBrew → Microphone →{" "}
                <span className="text-foreground font-medium">On</span>
              </>
            ) : (
              <>
                Settings → Apps → PodBrew → Permissions → Microphone →{" "}
                <span className="text-foreground font-medium">Allow while using app</span>
              </>
            )}
          </div>
          <Button
            className="w-full"
            onClick={handleOpenAppSettings}
            data-testid="button-open-app-settings"
          >
            Open App Settings
          </Button>
        </div>
      ) : (
        <ol className="w-full space-y-2 text-sm">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
              <span className="text-foreground pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="flex gap-3 w-full pt-1">
        <Button onClick={onCheckAgain} className="flex-1" data-testid="button-mic-check-again">
          Check again
        </Button>
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1"
          data-testid="button-mic-permission-close"
        >
          Close
        </Button>
      </div>
    </div>
  );
}

function VoiceUnavailablePanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="p-6 flex flex-col items-center gap-5">
      <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center">
        <AlertCircle className="w-7 h-7 text-muted-foreground" />
      </div>
      <div className="text-center space-y-1">
        <p className="font-semibold text-base">Voice not available</p>
        <p className="text-sm text-muted-foreground">
          Your browser doesn't support streaming audio, or the voice service is offline. Try Chrome
          or Edge on desktop or mobile.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onClose}
        className="w-full"
        data-testid="button-speech-unavailable-close"
      >
        Got it
      </Button>
    </div>
  );
}

export function VoiceAssistant() {
  const [state, setState] = useState<AssistantState>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [micPermission, setMicPermission] = useState<MicPermission>("prompt");
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantMessage, setAssistantMessage] = useState("");

  const sessionRef = useRef<VoiceLiveSession | null>(null);
  // Set synchronously the moment startSession is invoked, so two calls in
  // the same tick (e.g. user taps "Check again" exactly when the resume
  // watcher also fires) can't both pass the guard during the await window.
  const startingRef = useRef(false);
  const userBufferRef = useRef("");
  const assistantBufferRef = useRef("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { startBrewing } = useGlobalBrewing();
  const { state: audioState, play, queuePodcast, skipToNext, restart } = useAudioPlayer();

  // Mirror player state and methods in refs so the tool handler — which is
  // captured by the long-lived voice session — can read the latest values
  // without going stale.
  const audioStateRef = useRef(audioState);
  const queuePodcastRef = useRef(queuePodcast);
  const skipToNextRef = useRef(skipToNext);
  const restartRef = useRef(restart);
  const playRef = useRef(play);
  useEffect(() => {
    audioStateRef.current = audioState;
    queuePodcastRef.current = queuePodcast;
    skipToNextRef.current = skipToNext;
    restartRef.current = restart;
    playRef.current = play;
  });

  const supported = isVoiceSupported();

  const closeSession = useCallback(() => {
    try {
      sessionRef.current?.close();
    } catch {}
    sessionRef.current = null;
  }, []);

  const closeAssistant = useCallback(() => {
    closeSession();
    setIsOpen(false);
    setState("idle");
    setUserTranscript("");
    setAssistantMessage("");
    userBufferRef.current = "";
    assistantBufferRef.current = "";
  }, [closeSession]);

  useEffect(() => () => closeSession(), [closeSession]);

  const handleToolCall = useCallback(
    (name: string, args: any) => {
      if (name === "navigate") {
        const routes: Record<string, string> = {
          library: "/library",
          discover: "/listen",
          settings: "/settings",
          voices: "/voices",
          create: "/",
          home: "/",
        };
        const route = routes[args?.destination] || "/";
        setLocation(route);
        setTimeout(() => closeAssistant(), 600);
        return;
      }

      if (name === "play_podcast") {
        const q = (args?.query || "").toString().trim();
        (async () => {
          const result = await findBestPodcastMatch(q);
          const { match, ambiguous } = result;

          if (match && ambiguous.length > 1) {
            const choices = joinTitlesForSpeech(
              ambiguous.map(podcastLabel)
            );
            sessionRef.current?.sendText(
              `(System note: The user's request matches multiple episodes in their library — ${choices}. Don't play anything yet. Ask them in one short sentence which one they meant.)`
            );
            return;
          }

          if (match) {
            let started = false;
            try {
              playRef.current(match, false, true);
              started = true;
            } catch (err) {
              console.error("Voice assistant play failed:", err);
            }
            const label = podcastLabel(match);
            if (started) {
              sessionRef.current?.sendText(
                `(System note: I'm starting playback of "${label}" from the user's library now. Briefly acknowledge it in one short sentence — for example: "Playing ${label}." Then wait for the user's next request without closing.)`
              );
            } else {
              sessionRef.current?.sendText(
                `(System note: I found "${label}" in the user's library but couldn't start playback. Apologize in one short sentence and suggest they try again from the library.)`
              );
            }
          } else {
            const what = q ? `"${q}"` : "that";
            sessionRef.current?.sendText(
              `(System note: I couldn't find any podcast matching ${what} in the user's library. Tell them in one short sentence that there's no matching episode, and offer to brew one if they'd like.)`
            );
          }
        })();
        return;
      }

      if (name === "queue_podcast") {
        const q = (args?.query || "").toString().trim();
        (async () => {
          const exclude = new Set<string>();
          const current = audioStateRef.current.currentPodcast;
          if (current?.id) exclude.add(current.id);
          for (const p of audioStateRef.current.queue) exclude.add(p.id);

          const result = await findBestPodcastMatch(q, exclude);
          const { match, ambiguous } = result;

          if (match && ambiguous.length > 1) {
            const choices = joinTitlesForSpeech(
              ambiguous.map(podcastLabel)
            );
            sessionRef.current?.sendText(
              `(System note: The user's queue request matches multiple episodes — ${choices}. Don't queue anything yet. Ask them in one short sentence which one they meant.)`
            );
            return;
          }

          if (match) {
            const queued = queuePodcastRef.current(match);
            const label = podcastLabel(match);
            if (queued) {
              sessionRef.current?.sendText(
                `(System note: I queued "${label}" to play after the current one. Acknowledge it in one short sentence — for example: "Queued ${label}." Then wait for the next request.)`
              );
            } else {
              sessionRef.current?.sendText(
                `(System note: I found "${label}" but couldn't queue it because the audio file isn't available. Apologize briefly in one sentence.)`
              );
            }
          } else {
            const what = q ? `"${q}"` : "that";
            sessionRef.current?.sendText(
              `(System note: I couldn't find another podcast matching ${what} in the user's library to queue. Say so in one short sentence and offer to brew one if they'd like.)`
            );
          }
        })();
        return;
      }

      if (name === "skip_to_next") {
        const next = skipToNextRef.current();
        if (next) {
          const label = next.title || next.topic || "the next episode";
          sessionRef.current?.sendText(
            `(System note: Skipping ahead to "${label}" from the queue. Acknowledge it in one short sentence — for example: "Playing ${label} next." Then wait for the next request.)`
          );
        } else {
          sessionRef.current?.sendText(
            `(System note: There's nothing in the queue to skip to. Tell the user in one short sentence and offer to queue something.)`
          );
        }
        return;
      }

      if (name === "resume_podcast") {
        const current = audioStateRef.current.currentPodcast;
        if (!current) {
          sessionRef.current?.sendText(
            `(System note: There's no podcast playing right now to restart. Say so in one short sentence and offer to play something.)`
          );
          return;
        }
        const ok = restartRef.current();
        const label = current.title || current.topic || "the episode";
        if (ok) {
          sessionRef.current?.sendText(
            `(System note: Restarting "${label}" from the beginning. Acknowledge it in one short sentence and then wait.)`
          );
        } else {
          sessionRef.current?.sendText(
            `(System note: I couldn't restart "${label}". Apologize in one short sentence.)`
          );
        }
        return;
      }

      if (name === "create_podcast") {
        const topic = (args?.topic || "").toString();
        if (!topic) return;
        const requestBody = {
          topic,
          durationMinutes: Number(args?.durationMinutes) || 5,
          languageComplexity: 5,
          numPeople: Number(args?.numPeople) || 2,
          podcastStyle: args?.podcastStyle || "conversational",
          timeFrame: "pastMonth",
          coHostPersonality: args?.coHostPersonality || "casual",
          podcastMood: args?.podcastMood || "balanced",
          language: "en",
          selectedVoicePool: [],
          assignedVoices: [],
          selectedVoiceIds: [],
          templateCategory: args?.templateCategory || "custom",
        };

        savePendingPodcast(requestBody);

        // Let Gemini's spoken acknowledgement finish naturally; close after a
        // beat so we don't cut off its TTS.
        setTimeout(() => closeAssistant(), 1500);

        startBrewing({
          templateName: "Custom",
          topic: requestBody.topic,
          durationMinutes: requestBody.durationMinutes,
          requestBody,
        })
          .then((podcast) => {
            if (podcast) {
              toast({
                title: "Podcast Brewed!",
                description: `"${podcast.title || podcast.topic}" is ready to listen.`,
              });
            }
          })
          .catch(() => {
            toast({
              title: "Brewing failed",
              description: "Something went wrong. Please try again from the create page.",
              variant: "destructive",
            });
          });
      }
    },
    [closeAssistant, setLocation, startBrewing, toast]
  );

  const handleEvent = useCallback(
    (ev: VoiceLiveEvent) => {
      switch (ev.type) {
        case "ready":
          setState("listening");
          break;
        case "input_transcript":
          userBufferRef.current += ev.text;
          setUserTranscript(userBufferRef.current);
          break;
        case "output_transcript":
          assistantBufferRef.current += ev.text;
          setAssistantMessage(assistantBufferRef.current);
          break;
        case "audio_started":
          setState("speaking");
          // assistant is starting a new turn — clear stale user transcript
          if (userBufferRef.current) {
            userBufferRef.current = "";
            setUserTranscript("");
          }
          assistantBufferRef.current = "";
          setAssistantMessage("");
          break;
        case "audio_ended":
          setState("listening");
          break;
        case "interrupted":
          // user barged in — reset assistant buffer for the next reply
          assistantBufferRef.current = "";
          setAssistantMessage("");
          setState("listening");
          break;
        case "tool_call":
          handleToolCall(ev.tool.name, ev.tool.args);
          break;
        case "reconnecting":
          setState("reconnecting");
          break;
        case "reconnected":
          setState("listening");
          break;
        case "error": {
          // Fatal upstream-outage errors (Gemini Live rejecting the
          // session early, no API key, etc.) get a friendlier title since
          // there's nothing the user did wrong and we won't be retrying.
          const isUpstreamOutage =
            ev.code === "upstream_unavailable" || ev.code === "not_configured";
          toast({
            title: isUpstreamOutage
              ? "Voice service is unavailable"
              : "Voice assistant error",
            description: ev.message,
            variant: "destructive",
          });
          closeAssistant();
          break;
        }
        case "closed":
          // Retry budget exhausted — drop the dead session so the user can
          // tap the mic to start a fresh one without reopening the panel.
          try {
            sessionRef.current?.close();
          } catch {}
          sessionRef.current = null;
          if (state !== "idle") setState("closed");
          break;
      }
    },
    [closeAssistant, handleToolCall, state, toast]
  );

  const startSession = useCallback(async () => {
    if (sessionRef.current || startingRef.current) return;
    startingRef.current = true;
    setState("connecting");
    setUserTranscript("");
    setAssistantMessage("");
    userBufferRef.current = "";
    assistantBufferRef.current = "";

    const tryStart = async () => {
      const session = new VoiceLiveSession({ onEvent: handleEvent });
      await session.start();
      sessionRef.current = session;
    };

    try {
      await tryStart();
    } catch (err: any) {
      const name = err?.name || "";
      const msg = (err?.message || "").toString();
      const isNotAllowed =
        name === "NotAllowedError" || name === "PermissionDeniedError";

      // Stale-denial recovery (Android WebView): if the OS-level mic is
      // actually granted but getUserMedia rejected, the per-origin permission
      // cache inside the WebView is stale. Retry once after a short delay so
      // the WebChromeClient.onPermissionRequest path runs cleanly. If that
      // still fails, force a one-shot reload to clear the WebView state — the
      // user loses the open assistant modal but isn't permanently stuck.
      if (
        isNotAllowed &&
        isNativeAndroidPlatform() &&
        nativeHasMicPermission() === true
      ) {
        try {
          await new Promise((r) => setTimeout(r, 300));
          await tryStart();
        } catch (retryErr: any) {
          const retryName = retryErr?.name || "";
          const retryStillBlocked =
            retryName === "NotAllowedError" ||
            retryName === "PermissionDeniedError";
          if (retryStillBlocked) {
            try {
              window.location.reload();
            } catch {
              setMicPermission("denied");
              setState("idle");
            }
            return;
          }
          // Different failure on retry — fall through to generic handling.
          console.error("Voice session retry failed:", retryErr);
          toast({
            title: "Voice assistant",
            description:
              (retryErr?.message || "").toString() ||
              "Couldn't start the voice connection.",
            variant: "destructive",
          });
          setState("idle");
          closeAssistant();
          return;
        }
        // Retry succeeded — nothing else to do.
        return;
      }

      if (isNotAllowed) {
        setMicPermission("denied");
        setState("idle");
        return;
      }
      console.error("Voice session start failed:", err);
      toast({
        title: "Voice assistant",
        description: msg || "Couldn't start the voice connection.",
        variant: "destructive",
      });
      setState("idle");
      closeAssistant();
    } finally {
      startingRef.current = false;
    }
  }, [closeAssistant, handleEvent, toast]);

  const handleMicClick = useCallback(() => {
    if (state === "speaking") {
      sessionRef.current?.interrupt();
      setState("listening");
      return;
    }
    if (state === "idle" || state === "closed") {
      startSession();
    }
  }, [state, startSession]);

  const openAssistant = useCallback(async () => {
    setIsOpen(true);
    setUserTranscript("");
    setAssistantMessage("");
    setMicPermission("prompt");

    // Probe mic so the OS prompt fires inside the user-gesture handler.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        setMicPermission("granted");
      } catch (err: any) {
        const isNotAllowed =
          err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
        // On native Android, getUserMedia can reject from a stale per-origin
        // WebView decision even though the OS has granted RECORD_AUDIO. Trust
        // the OS over the WebView's cache.
        if (isNotAllowed && (isNativeAndroidPlatform() || isNativeIOSPlatform())) {
          if (nativeHasMicPermission() === true) {
            setMicPermission("granted");
            startSession();
            return;
          }
        }
        setMicPermission(isNotAllowed ? "denied" : "service-unavailable");
        return;
      }
    } else {
      const perm = await checkMicPermission();
      setMicPermission(perm);
      if (perm === "denied") return;
    }

    startSession();
  }, [startSession]);

  // Auto-recover: when the modal is open and mic was denied on native Android,
  // re-probe each time the app resumes (user came back from Settings) and
  // start the session as soon as the OS reports mic granted.
  useMicPermissionWatcher({
    enabled: isOpen && micPermission === "denied",
    onGranted: useCallback(() => {
      setMicPermission("granted");
      startSession();
    }, [startSession]),
  });

  useEffect(() => {
    const handler = () => {
      if (!isOpen) {
        if (!supported) {
          toast({
            title: "Voice not supported here",
            description:
              "Open PodBrew in a recent version of Chrome, Edge, or Safari to use voice commands.",
            variant: "destructive",
          });
          return;
        }
        openAssistant();
      }
    };
    window.addEventListener("open-voice-assistant", handler);
    return () => window.removeEventListener("open-voice-assistant", handler);
  }, [isOpen, supported, openAssistant, toast]);

  if (!isOpen) {
    return createPortal(
      <Button
        size="icon"
        onClick={() => {
          if (!supported) {
            toast({
              title: "Voice not supported here",
              description:
                "Open PodBrew in a recent version of Chrome, Edge, or Safari to use voice commands.",
              variant: "destructive",
            });
            return;
          }
          openAssistant();
        }}
        className="!fixed !right-4 !z-[70] w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-all md:flex hidden"
        style={{ position: "fixed", bottom: "130px", right: "16px", zIndex: 70 }}
        data-testid="button-voice-assistant"
        aria-label="Open voice assistant"
      >
        <Mic className="w-5 h-5" />
      </Button>,
      document.body
    );
  }

  if (!supported) return null;

  const statusLabel =
    micPermission === "denied"
      ? "Microphone blocked"
      : micPermission === "service-unavailable"
      ? "Voice unavailable"
      : state === "connecting"
      ? "Connecting..."
      : state === "reconnecting"
      ? "Reconnecting..."
      : state === "listening"
      ? "Listening..."
      : state === "speaking"
      ? "Speaking..."
      : state === "closed"
      ? "Disconnected"
      : "PodBrew Assistant";

  const dotClass =
    micPermission === "denied"
      ? "bg-destructive"
      : micPermission === "service-unavailable"
      ? "bg-muted-foreground"
      : state === "connecting" || state === "reconnecting"
      ? "bg-yellow-500 animate-pulse"
      : state === "listening"
      ? "bg-red-500 animate-pulse"
      : state === "speaking"
      ? "bg-primary animate-pulse"
      : "bg-muted-foreground";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      data-testid="voice-assistant-overlay"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeAssistant}
      />

      <div className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 rounded-2xl bg-card border border-border/50 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border/30 gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${dotClass}`} />
            <span className="text-sm font-medium">{statusLabel}</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={closeAssistant}
            data-testid="button-close-voice-assistant"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {micPermission === "denied" ? (
          <PermissionDeniedPanel
            onCheckAgain={async () => {
              // Native fast-path: trust the OS over the WebView's per-origin
              // permission cache. If RECORD_AUDIO is granted at the OS level,
              // start the session — the WebView's onPermissionRequest path
              // will grant the mic on the next getUserMedia call.
              if (isNativeAndroidPlatform() || isNativeIOSPlatform()) {
                const native = nativeHasMicPermission();
                if (native === true) {
                  setMicPermission("granted");
                  startSession();
                  return;
                }
                if (native === false) {
                  setMicPermission("denied");
                  return;
                }
                // native === null → bridge unavailable (older build / iOS
                // Swift bridge not yet wired in Xcode); fall through to the
                // web probe below.
              }
              if (navigator.mediaDevices?.getUserMedia) {
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                  stream.getTracks().forEach((t) => t.stop());
                  setMicPermission("granted");
                  startSession();
                } catch {
                  setMicPermission("denied");
                }
              } else {
                const perm = await checkMicPermission();
                setMicPermission(perm);
                if (perm !== "denied") startSession();
              }
            }}
            onClose={closeAssistant}
          />
        ) : micPermission === "service-unavailable" ? (
          <VoiceUnavailablePanel onClose={closeAssistant} />
        ) : (
          <div className="p-6 flex flex-col items-center gap-4 min-h-[200px]">
            <div className="relative flex items-center justify-center">
              <button
                onClick={handleMicClick}
                disabled={state === "connecting" || state === "reconnecting"}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer ${
                  state === "listening"
                    ? "bg-red-500/20 border-2 border-red-500"
                    : state === "connecting" || state === "reconnecting"
                    ? "bg-yellow-500/20 border-2 border-yellow-500/50"
                    : state === "speaking"
                    ? "bg-primary/20 border-2 border-primary"
                    : "bg-primary/10 border-2 border-primary/30"
                }`}
                data-testid="button-voice-mic-main"
                aria-label={
                  state === "speaking"
                    ? "Interrupt assistant"
                    : state === "listening"
                    ? "Stop listening"
                    : "Start listening"
                }
              >
                {state === "listening" && (
                  <div className="absolute inset-0 rounded-full animate-ping bg-red-500/20" />
                )}
                {state === "speaking" && (
                  <div className="absolute inset-0 rounded-full animate-pulse bg-primary/10" />
                )}
                {state === "listening" ? (
                  <MicOff className="w-8 h-8 text-red-500 relative z-10" />
                ) : state === "speaking" ? (
                  <Volume2 className="w-8 h-8 text-primary relative z-10" />
                ) : (
                  <Mic
                    className={`w-8 h-8 relative z-10 ${
                      state === "connecting" || state === "reconnecting"
                        ? "text-yellow-500"
                        : "text-primary"
                    }`}
                  />
                )}
              </button>

              {state === "listening" && (
                <div className="absolute -bottom-1 flex items-end gap-[3px] h-4">
                  {[...Array(5)].map((_, i) => (
                    <span
                      key={i}
                      className="w-[3px] bg-red-500 rounded-full"
                      style={{
                        animation: `voiceWave 0.6s ease-in-out infinite`,
                        animationDelay: `${i * 0.1}s`,
                        height: "30%",
                      }}
                    />
                  ))}
                </div>
              )}

              {state === "speaking" && (
                <div className="absolute -bottom-1 flex items-end gap-[3px] h-4">
                  {[...Array(5)].map((_, i) => (
                    <span
                      key={i}
                      className="w-[3px] bg-primary rounded-full"
                      style={{
                        animation: `voiceWave 0.5s ease-in-out infinite`,
                        animationDelay: `${i * 0.08}s`,
                        height: "30%",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {userTranscript && (
              <div className="w-full text-center" data-testid="text-voice-transcript">
                <p className="text-sm text-foreground">{userTranscript}</p>
              </div>
            )}

            {assistantMessage && (
              <div
                className="w-full rounded-lg bg-primary/5 border border-primary/20 p-3"
                data-testid="text-assistant-message"
              >
                <p className="text-sm text-foreground text-center">{assistantMessage}</p>
              </div>
            )}

            {state === "idle" && !assistantMessage && (
              <p
                className="text-xs text-muted-foreground text-center"
                data-testid="text-voice-hint"
              >
                Tap the mic and say something like:
                <br />
                <span className="text-foreground">"Make a 5-minute podcast about AI"</span>
              </p>
            )}

            {state === "speaking" && (
              <p className="text-xs text-muted-foreground text-center">
                Tap the mic or just talk to interrupt.
              </p>
            )}

            {state === "closed" && (
              <p className="text-xs text-muted-foreground text-center">
                Tap the mic to reconnect.
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes voiceWave {
          0%, 100% { height: 30%; }
          50% { height: 100%; }
        }
      `}</style>
    </div>,
    document.body
  );
}
