// Streaming voice session against the server's Gemini Live proxy.
// Handles 16 kHz PCM mic capture, 24 kHz PCM playback, barge-in, and
// surfaces server messages (transcripts, tool calls, errors) via callbacks.

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// The mic AudioWorklet is served as a real static file from
// /worklets/mic-capture-processor.js so it loads under `script-src 'self'`
// without needing `blob:` allowances in the production CSP.
const MIC_WORKLET_URL = "/worklets/mic-capture-processor.js";

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export type VoiceLiveEvent =
  | { type: "ready" }
  | { type: "input_transcript"; text: string }
  | { type: "output_transcript"; text: string }
  | { type: "audio_started" }
  | { type: "audio_ended" }
  | { type: "interrupted" }
  | { type: "tool_call"; tool: { name: string; args: any } }
  | { type: "reconnecting"; attempt: number }
  | { type: "reconnected" }
  | { type: "error"; message: string; code?: string }
  | { type: "closed" };

interface VoiceLiveOptions {
  onEvent: (event: VoiceLiveEvent) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 8000;

export class VoiceLiveSession {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private playbackTime = 0;
  private playingCount = 0;
  private isAudioPlaying = false;
  private destroyed = false;
  private opts: VoiceLiveOptions;
  private resumeHandle: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting = false;
  // When the server sends an error with `fatal: true` (upstream voice
  // service is unreachable / rejecting us), suppress reconnects entirely
  // so the user sees one toast instead of a cycle.
  private unrecoverable = false;
  // Number of useful messages we've received on the *current* socket. If a
  // reconnect attempt opens the socket but it closes before any message
  // arrives, that's a no-progress attempt — reconnecting again will just
  // repeat the failure, so we bail out instead of burning the full retry
  // budget pretending to "reconnect".
  private messagesThisSocket = 0;
  private lastReconnectMadeProgress = true;
  // True only between attemptReconnect opening a socket and that socket
  // emitting its first server message. Used to defer the "reconnected"
  // event (and the budget reset) until we've actually confirmed the
  // upstream is alive again.
  private awaitingReconnectConfirm = false;

  constructor(opts: VoiceLiveOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    try {
      // Mic
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      await this.openWebSocket();

      // Mic AudioContext + worklet
      this.inputCtx = new AudioContext();
      try {
        await this.inputCtx.audioWorklet.addModule(MIC_WORKLET_URL);
      } catch (err) {
        console.error("[VoiceLive] Failed to load mic worklet:", err);
        throw new Error(
          "Couldn't start the voice assistant. Please reload the page and try again.",
        );
      }
      this.workletNode = new AudioWorkletNode(this.inputCtx, "mic-capture-processor", {
        processorOptions: { targetRate: INPUT_SAMPLE_RATE },
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      this.workletNode.port.onmessage = (ev) => this.sendAudioChunk(ev.data as ArrayBuffer);
      this.sourceNode = this.inputCtx.createMediaStreamSource(this.stream);
      this.sourceNode.connect(this.workletNode);

      // Playback context (24 kHz output)
      this.outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    } catch (err: any) {
      // Surface the failure as a structured event so the UI gets a clean
      // toast instead of a swallowed exception, then make sure we don't
      // leak the mic stream / websocket / audio contexts that may have
      // been opened before the failure.
      const isPermission =
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
      if (!isPermission) {
        const message =
          (err && typeof err.message === "string" && err.message) ||
          "Couldn't start the voice assistant.";
        try {
          this.opts.onEvent({ type: "error", message });
        } catch {}
      }
      try {
        if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
      this.cleanupAudio();
      throw err;
    }
  }

  private async openWebSocket(): Promise<void> {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const params = this.resumeHandle
      ? `?resume=${encodeURIComponent(this.resumeHandle)}`
      : "";
    const wsUrl = `${proto}//${location.host}/ws/voice-assistant${params}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Voice connect timed out")), 10000);
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error("Voice WebSocket error"));
      };
    });

    this.messagesThisSocket = 0;
    ws.onmessage = (e) => {
      const wasFirst = this.messagesThisSocket === 0;
      this.messagesThisSocket += 1;
      // First server message on this socket confirms the upstream is alive.
      // If we got here via a reconnect, that's our cue to surface the
      // "reconnected" event and reset the per-incident retry budget.
      if (wasFirst) {
        this.lastReconnectMadeProgress = true;
        if (this.awaitingReconnectConfirm) {
          this.awaitingReconnectConfirm = false;
          this.reconnectAttempts = 0;
          this.opts.onEvent({ type: "reconnected" });
        } else if (this.reconnectAttempts > 0) {
          // Initial open after a previous incident also clears the budget.
          this.reconnectAttempts = 0;
        }
      }
      this.handleServerMessage(e.data);
    };
    ws.onclose = () => this.handleSocketClose();
    ws.onerror = () => {
      // Surfaced via onclose; avoid double-firing user-visible errors.
    };
  }

  private handleSocketClose(): void {
    if (this.destroyed) {
      this.cleanupAudio();
      return;
    }
    if (this.isReconnecting) return;
    // If the server already told us this is unrecoverable, don't try
    // again — the user has the toast, we just tear down.
    if (this.unrecoverable) {
      this.opts.onEvent({ type: "closed" });
      this.cleanupAudio();
      return;
    }
    // Track whether the just-closed socket actually heard back from the
    // server. If not, this attempt was no-progress; another reconnect will
    // almost certainly hit the same wall, so bail out after one try.
    this.lastReconnectMadeProgress = this.messagesThisSocket > 0;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.unrecoverable) {
      this.opts.onEvent({ type: "closed" });
      this.cleanupAudio();
      return;
    }
    // No-progress guard: if the previous reconnect attempt opened a socket
    // but it closed before any server message arrived, the upstream is
    // down for some reason curl-able by us — stop now and surface a clean
    // error rather than running through the full retry budget.
    if (this.reconnectAttempts >= 1 && !this.lastReconnectMadeProgress) {
      this.opts.onEvent({
        type: "error",
        message:
          "Voice service kept dropping the connection. Please try again in a moment.",
      });
      this.opts.onEvent({ type: "closed" });
      this.cleanupAudio();
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.opts.onEvent({ type: "closed" });
      this.cleanupAudio();
      return;
    }
    this.isReconnecting = true;
    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
    );
    this.opts.onEvent({ type: "reconnecting", attempt: this.reconnectAttempts });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.destroyed) return;
    try {
      // Mark this attempt as provisional. We won't emit "reconnected" or
      // reset the per-incident retry budget until the new socket actually
      // receives a message — otherwise a socket that opens then drops
      // immediately would falsely look like a recovery.
      this.awaitingReconnectConfirm = true;
      await this.openWebSocket();
      this.isReconnecting = false;
    } catch {
      // The WS failed to open at all (network unreachable, server down,
      // timeout). This is *not* a no-progress signal — it's a transient
      // network condition that exponential backoff can recover from —
      // so leave lastReconnectMadeProgress alone and let the normal
      // MAX_RECONNECT_ATTEMPTS budget run its course.
      this.isReconnecting = false;
      this.awaitingReconnectConfirm = false;
      this.scheduleReconnect();
    }
  }

  private sendAudioChunk(buf: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const data = bufferToBase64(buf);
    this.ws.send(JSON.stringify({ type: "audio", data }));
  }

  private handleServerMessage(raw: any) {
    let msg: any;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        this.opts.onEvent({ type: "ready" });
        break;
      case "audio":
        if (msg.data) this.enqueueAudio(msg.data);
        break;
      case "input_transcript":
        this.opts.onEvent({ type: "input_transcript", text: msg.text || "" });
        break;
      case "output_transcript":
        this.opts.onEvent({ type: "output_transcript", text: msg.text || "" });
        break;
      case "interrupted":
        this.flushPlayback();
        this.opts.onEvent({ type: "interrupted" });
        break;
      case "turn_complete":
        // playback may still be draining; let onended notify us
        break;
      case "tool_call":
        if (msg.tool) this.opts.onEvent({ type: "tool_call", tool: msg.tool });
        break;
      case "resumption":
        if (typeof msg.handle === "string" && msg.handle) {
          this.resumeHandle = msg.handle;
        }
        break;
      case "error":
        if (msg.fatal === true) {
          // Server says retrying won't help. Suppress the reconnect cycle
          // so the user sees a single toast and the session tears down
          // cleanly when the socket closes a moment later.
          this.unrecoverable = true;
        }
        this.opts.onEvent({
          type: "error",
          message: msg.text || "Voice error",
          code: typeof msg.code === "string" ? msg.code : undefined,
        });
        break;
      case "closed":
        this.opts.onEvent({ type: "closed" });
        break;
    }
  }

  private enqueueAudio(b64: string) {
    if (!this.outputCtx) return;
    const ctx = this.outputCtx;
    const i16 = base64ToInt16(b64);
    if (i16.length === 0) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    const audioBuffer = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(f32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    if (!this.isAudioPlaying) {
      this.isAudioPlaying = true;
      this.opts.onEvent({ type: "audio_started" });
    }
    this.playingCount++;
    source.onended = () => {
      this.playingCount--;
      if (this.playingCount <= 0 && this.isAudioPlaying) {
        this.isAudioPlaying = false;
        this.playbackTime = 0;
        this.opts.onEvent({ type: "audio_ended" });
      }
    };
    source.start(startAt);
    this.playbackTime = startAt + audioBuffer.duration;
  }

  private flushPlayback() {
    // Restarting the output context is the cleanest way to drop everything
    // already scheduled.
    if (!this.outputCtx) return;
    try {
      this.outputCtx.close();
    } catch {}
    this.outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.playbackTime = 0;
    this.playingCount = 0;
    if (this.isAudioPlaying) {
      this.isAudioPlaying = false;
      this.opts.onEvent({ type: "audio_ended" });
    }
  }

  interrupt(): void {
    this.flushPlayback();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }

  isSpeaking(): boolean {
    return this.isAudioPlaying;
  }

  private cleanupAudio() {
    try {
      this.workletNode?.disconnect();
    } catch {}
    try {
      this.sourceNode?.disconnect();
    } catch {}
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      this.inputCtx?.close();
    } catch {}
    try {
      this.outputCtx?.close();
    } catch {}
    this.workletNode = null;
    this.sourceNode = null;
    this.stream = null;
    this.inputCtx = null;
    this.outputCtx = null;
  }

  close(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "audio_end" }));
      }
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.cleanupAudio();
  }
}
