import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, type Session } from "@google/genai";

const VOICE_LIVE_PATH = "/ws/voice-assistant";

// Gemini Live model. `-latest` is a rolling alias to the current stable
// native-audio variant, so we survive Google's next deprecation without a
// code change. To verify what's available for this key:
//   GET https://generativelanguage.googleapis.com/v1beta/models?key=...
const VOICE_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest";

const FUNCTION_DECLARATIONS = [
  {
    name: "create_podcast",
    description:
      "Queue a new podcast for brewing once the user has confirmed the topic and any options they care about.",
    parameters: {
      type: "OBJECT",
      properties: {
        topic: { type: "STRING", description: "What the podcast is about. Required." },
        durationMinutes: {
          type: "NUMBER",
          description: "Target duration in minutes. Default 5 if user did not say.",
        },
        numPeople: {
          type: "NUMBER",
          description: "Number of hosts (1=solo, 2=co-hosts, 3=panel). Default 2.",
        },
        podcastStyle: {
          type: "STRING",
          enum: [
            "conversational",
            "narrative",
            "debate",
            "interview",
            "news",
            "executive-briefing",
            "tutor",
            "lecturer",
            "coach",
          ],
        },
        podcastMood: {
          type: "STRING",
          enum: ["uplifting", "serious", "humorous", "mysterious", "balanced", "energetic"],
        },
        templateCategory: {
          type: "STRING",
          enum: [
            "custom",
            "news",
            "sports",
            "teachme",
            "stories",
            "documents",
            "medical",
            "events",
          ],
        },
        coHostPersonality: {
          type: "STRING",
          enum: ["casual", "academic", "executive", "storyteller", "investigative"],
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "navigate",
    description: "Navigate the user to a section of the app.",
    parameters: {
      type: "OBJECT",
      properties: {
        destination: {
          type: "STRING",
          enum: ["library", "discover", "settings", "voices", "home", "create"],
        },
      },
      required: ["destination"],
    },
  },
  {
    name: "play_podcast",
    description:
      "Search the user's library and play a podcast matching the query. The search engine understands recency hints (e.g. 'latest', 'newest', 'most recent', 'today', 'yesterday', 'this week', 'last month'), mood words ('uplifting', 'calm', 'serious', 'energetic', 'humorous'), speaker hints ('with Drake', 'hosted by Maya', 'featuring Sarah'), partial titles, and topic keywords. Pass the user's natural-language phrasing through verbatim — DO NOT translate or summarize it. For example, if the user says 'play the latest uplifting one about climate', send query='latest uplifting one about climate'. If the user says 'play the one with Drake', send query='the one with Drake'.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description:
            "The user's natural-language description of what to play. Include any recency words ('latest', 'yesterday'), mood words ('uplifting', 'calm'), speaker hints ('with Drake', 'hosted by Maya'), topic keywords, and partial titles they used. Pass an empty string only if the user truly didn't say anything specific.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "queue_podcast",
    description:
      "Queue an episode from the user's library to play after the current one. Use when the user says things like 'queue another about cooking', 'play one about space next', or 'add yesterday's news to the queue'. Recency hints and partial topic phrasing are supported just like play_podcast.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description:
            "The user's natural-language description of what to queue. Pass their phrasing verbatim including recency words, mood words, and speaker hints.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "skip_to_next",
    description:
      "Skip the currently playing podcast and start the next one in the queue. Use when the user says 'play the next one', 'skip', or 'next episode'.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "resume_podcast",
    description:
      "Restart the currently playing podcast from the beginning. Use when the user says 'start over', 'restart', or 'play it from the beginning'.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

const SYSTEM_INSTRUCTION = `You are PodBrew's voice assistant. The user is talking to you on a phone-call-like voice interface — your replies are spoken aloud, so keep them short, natural, and conversational. Use contractions ("I'll", "you're"). Do not read JSON, markdown, or option lists.

Your job is to help the user do one of these things and then call the matching tool:
- create_podcast: brew a new podcast.
- navigate: jump to library, discover, voices, settings, home, or create.
- play_podcast: play an existing episode by description (supports "latest", "yesterday", "from this week", mood words like "uplifting" or "calm", speaker hints like "with Drake" or "hosted by Maya", topic keywords, partial titles, etc.).
- queue_podcast: line up another episode to play after the current one (same recency + mood + speaker + keyword hints work here).
- skip_to_next: jump to the next queued episode.
- resume_podcast: restart the current episode from the beginning.

Conversation guidelines:
- Greet briefly the first time you speak: "Hi, how can I help?"
- Get the topic if they want a podcast. If duration/host count/style are not mentioned, that's fine — use sensible defaults (5 minutes, 2 hosts, conversational, balanced) without asking.
- Once you have at minimum a topic, give a one-sentence confirmation in your own voice and ask "Anything else to add?". If they say no / brew it / go / done / sounds good — call create_podcast immediately. If they add details, merge them and re-confirm briefly.
- Never ask the user to "say yes" or "tap" anything. Never describe the buttons.
- If they ask to navigate or play something, just call the tool — you don't need to confirm.
- If you don't understand, ask a short clarifying question.

Style mapping hints:
- "funny"/"comedy" → podcastMood: humorous
- "serious"/"professional" → podcastStyle: executive-briefing, podcastMood: serious
- "story"/"narrative" → podcastStyle: narrative, templateCategory: stories
- "news" → podcastStyle: news, templateCategory: news
- "teach"/"learn"/"explain" → podcastStyle: tutor, templateCategory: teachme
- "debate" → podcastStyle: debate
- "solo"/"monologue" → numPeople: 1
- "panel" → numPeople: 3
- Duration: "half hour" → 30, "an hour" → 60.

When you call create_podcast, do it as soon as the user has confirmed — don't keep talking afterwards. The app will say "Brewing your podcast now" itself.`;

// Lazily initialize the Gemini client so missing keys don't crash boot in
// environments where the voice assistant isn't used.
let gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (gemini) return gemini;
  const apiKey =
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY;
  if (!apiKey) return null;
  // Use a direct connection (no Replit proxy) — Live API speaks raw WSS to
  // generativelanguage.googleapis.com and the proxy doesn't carry websockets.
  gemini = new GoogleGenAI({ apiKey });
  return gemini;
}

interface ClientToServer {
  type: "audio" | "audio_end" | "text" | "interrupt";
  data?: string; // base64 PCM16 16kHz mono
  text?: string;
}

interface ServerToClient {
  type:
    | "ready"
    | "audio"
    | "input_transcript"
    | "output_transcript"
    | "interrupted"
    | "turn_complete"
    | "tool_call"
    | "resumption"
    | "error"
    | "closed";
  data?: string; // base64 audio
  text?: string;
  tool?: { name: string; args: any };
  handle?: string;
  // When true, the client must NOT auto-reconnect — the upstream voice
  // service is rejecting us and a retry will just loop. Surface a single
  // toast and tear the session down instead.
  fatal?: boolean;
  code?: string;
}

function send(ws: WebSocket, msg: ServerToClient) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore send errors on closing socket
    }
  }
}

export function attachVoiceAssistantWebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Hook the upgrade event so we don't conflict with Vite's HMR socket
  // (which uses its own path on the same server).
  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname !== VOICE_LIVE_PATH) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const resumeHandle = url.searchParams.get("resume") || undefined;
        wss.emit("connection", ws, req, resumeHandle);
      });
    } catch {
      // ignore — let other upgrade listeners handle it
    }
  });

  wss.on("connection", async (ws, _req, resumeHandle?: string) => {
    const ai = getGemini();
    const connId = Math.random().toString(36).slice(2, 8);
    if (!ai) {
      console.warn(`[voice-live] [${connId}] no API key configured — refusing`);
      send(ws, {
        type: "error",
        text: "Voice service isn't configured on this server.",
        code: "not_configured",
        fatal: true,
      });
      ws.close();
      return;
    }

    let session: Session | null = null;
    let closed = false;

    // Telemetry for diagnosing upstream drops. If Gemini closes the session
    // shortly after open without ever producing useful output, we treat it
    // as unrecoverable so the client doesn't loop on reconnects.
    const sessionStartedAt = Date.now();
    let openedAt = 0;
    let firstAudioForwardedAt = 0;
    let outputCount = 0;
    let upstreamClosedFirst = false;
    let upstreamErrorMessage: string | null = null;
    let upstreamErrorAt = 0;
    let upstreamCloseCode: number | undefined;
    let upstreamCloseReason: string | undefined;

    // Window after "ready" within which an upstream close with zero output
    // is treated as a fatal upstream failure (and not a transient drop).
    const FATAL_CLOSE_WINDOW_MS = 8000;

    const safeClose = (reason?: string) => {
      if (closed) return;
      closed = true;
      try {
        session?.close();
      } catch {}
      try {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
          if (reason) send(ws, { type: "closed", text: reason });
          ws.close();
        }
      } catch {}
    };

    // Decide whether the upstream close was unrecoverable (model rejected
    // us, quota, bad mime, etc) and tell the client not to bother
    // reconnecting in that case. Reasons it's "fatal":
    //   - Session never opened (openedAt = 0): connect succeeded but onopen
    //     never fired and onclose did → upstream rejected immediately.
    //   - Closed within the early window with zero useful output: the
    //     model accepted the WS but dropped before responding to us, and
    //     reconnecting just repeats the failure.
    //
    // An onerror by itself is NOT fatal — Gemini occasionally surfaces
    // transient errors mid-session and the user should still be able to
    // reconnect. We only let the error message contribute to fatal-ness if
    // it occurred during the early-close window with no useful output.
    const handleUpstreamClose = (closeEvent?: { code?: number; reason?: string }) => {
      if (closed) return;
      upstreamClosedFirst = true;
      if (closeEvent?.code !== undefined) upstreamCloseCode = closeEvent.code;
      if (closeEvent?.reason) upstreamCloseReason = closeEvent.reason;
      const totalMs = Date.now() - sessionStartedAt;
      const sinceReadyMs = openedAt ? Date.now() - openedAt : -1;

      const neverOpened = openedAt === 0;
      const earlyClose =
        openedAt > 0 && sinceReadyMs >= 0 && sinceReadyMs < FATAL_CLOSE_WINDOW_MS;
      const noProgress = outputCount === 0;
      // Only count a recent error as "early" if it landed inside the
      // early-close window — late errors followed by a normal close are
      // treated as transient, not fatal.
      const errorWasEarly =
        !!upstreamErrorMessage &&
        upstreamErrorAt > 0 &&
        openedAt > 0 &&
        upstreamErrorAt - openedAt < FATAL_CLOSE_WINDOW_MS;
      const isFatal =
        neverOpened ||
        (earlyClose && noProgress) ||
        (errorWasEarly && noProgress);

      console.warn(
        `[voice-live] [${connId}] upstream closed ` +
          `totalMs=${totalMs} sinceReadyMs=${sinceReadyMs} ` +
          `outputCount=${outputCount} firstAudioForwardedAt=${
            firstAudioForwardedAt ? firstAudioForwardedAt - sessionStartedAt : "never"
          } ` +
          `closeCode=${upstreamCloseCode ?? "n/a"} ` +
          `closeReason="${upstreamCloseReason ?? ""}" ` +
          `fatal=${isFatal}` +
          (upstreamErrorMessage ? ` errorMsg="${upstreamErrorMessage}"` : "")
      );

      if (isFatal) {
        const message = neverOpened
          ? "Voice service didn't accept the connection. Please try again in a moment."
          : "Voice service hung up before we could talk. Please try again in a moment.";
        send(ws, {
          type: "error",
          text: message,
          code: "upstream_unavailable",
          fatal: true,
        });
      }
      safeClose();
    };

    try {
      session = await ai.live.connect({
        model: VOICE_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as any }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          },
        } as any,
        callbacks: {
          onopen: () => {
            openedAt = Date.now();
            console.log(
              `[voice-live] [${connId}] upstream open (connect took ${
                openedAt - sessionStartedAt
              }ms)`
            );
            send(ws, { type: "ready" });
          },
          onmessage: (msg: any) => {
            try {
              const sc = msg.serverContent;
              if (sc) {
                if (sc.interrupted) {
                  outputCount++;
                  send(ws, { type: "interrupted" });
                }
                if (sc.inputTranscription?.text) {
                  outputCount++;
                  send(ws, { type: "input_transcript", text: sc.inputTranscription.text });
                }
                if (sc.outputTranscription?.text) {
                  outputCount++;
                  send(ws, { type: "output_transcript", text: sc.outputTranscription.text });
                }
                const parts = sc.modelTurn?.parts || [];
                for (const part of parts) {
                  const inline = part.inlineData;
                  if (inline?.data && (inline.mimeType || "").startsWith("audio/")) {
                    outputCount++;
                    send(ws, { type: "audio", data: inline.data });
                  }
                }
                if (sc.turnComplete) send(ws, { type: "turn_complete" });
              }

              const resumption = msg.sessionResumptionUpdate;
              if (resumption?.newHandle && resumption.resumable !== false) {
                send(ws, { type: "resumption", handle: resumption.newHandle });
              }

              const toolCall = msg.toolCall;
              if (toolCall?.functionCalls?.length) {
                const responses: any[] = [];
                for (const fc of toolCall.functionCalls) {
                  outputCount++;
                  send(ws, {
                    type: "tool_call",
                    tool: { name: fc.name, args: fc.args || {} },
                  });
                  // Acknowledge to keep the model from blocking on a response
                  responses.push({
                    id: fc.id,
                    name: fc.name,
                    response: { ok: true },
                  });
                }
                try {
                  session?.sendToolResponse({ functionResponses: responses });
                } catch {}
              }
            } catch (err) {
              console.error(`[voice-live] [${connId}] onmessage error:`, err);
            }
          },
          onerror: (e: any) => {
            const msg = e?.message || (typeof e === "string" ? e : "unknown");
            upstreamErrorMessage = msg;
            upstreamErrorAt = Date.now();
            console.error(
              `[voice-live] [${connId}] gemini error (sinceReadyMs=${
                openedAt ? upstreamErrorAt - openedAt : -1
              }):`,
              msg
            );
            // Don't send the generic "error" event here — handleUpstreamClose
            // will fire next and decide whether to surface it as fatal.
          },
          onclose: (e: any) =>
            handleUpstreamClose({
              code: typeof e?.code === "number" ? e.code : undefined,
              reason: typeof e?.reason === "string" ? e.reason : undefined,
            }),
        },
      });
    } catch (err: any) {
      console.error(
        `[voice-live] [${connId}] failed to open Gemini Live session:`,
        err?.message || err
      );
      send(ws, {
        type: "error",
        text: "Couldn't reach the voice service. Please try again in a moment.",
        code: "upstream_unavailable",
        fatal: true,
      });
      safeClose();
      return;
    }

    ws.on("message", (raw) => {
      if (!session || closed) return;
      let msg: ClientToServer;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        if (msg.type === "audio" && msg.data) {
          if (!firstAudioForwardedAt) {
            firstAudioForwardedAt = Date.now();
            console.log(
              `[voice-live] [${connId}] first audio chunk forwarded ` +
                `(${firstAudioForwardedAt - sessionStartedAt}ms after connect)`
            );
          }
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (msg.type === "audio_end") {
          session.sendRealtimeInput({ audioStreamEnd: true });
        } else if (msg.type === "text" && msg.text) {
          session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        } else if (msg.type === "interrupt") {
          // Best-effort: end activity so the model stops mid-sentence.
          try {
            session.sendRealtimeInput({ activityEnd: {} });
          } catch {}
        }
      } catch (err) {
        console.error(`[voice-live] [${connId}] forward error:`, err);
      }
    });

    ws.on("close", () => {
      // Only log the reason when the client closed first; if upstream had
      // already closed, handleUpstreamClose has already logged details.
      if (!upstreamClosedFirst) {
        const totalMs = Date.now() - sessionStartedAt;
        console.log(
          `[voice-live] [${connId}] client closed totalMs=${totalMs} outputCount=${outputCount}`
        );
      }
      safeClose();
    });
    ws.on("error", () => safeClose());
  });

  console.log(
    `[voice-live] WebSocket attached at ${VOICE_LIVE_PATH} (model=${VOICE_LIVE_MODEL})`
  );
}
