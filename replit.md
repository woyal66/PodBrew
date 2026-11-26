# PodBrew - AI Podcast Generator

## Overview
PodBrew is a mobile-first, Spotify-inspired single-page application for generating customizable AI podcasts from text topics. It allows users to create professional-quality podcasts (2-60 minutes) using advanced text-to-speech, manage them in a library, and store them in the cloud. The platform aims to be a leading AI podcast app with a clean, modern, and mobile-optimized design, focusing on product-led growth, and offers advanced features like multi-speaker synthesis, AI-generated content sourcing, and robust podcast distribution.

## User Preferences
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.

## System Architecture
PodBrew is a Single-Page Application (SPA) built with React and TypeScript, styled with Tailwind CSS and Shadcn UI. Data fetching is managed by TanStack Query, and routing by Wouter. The backend is an Express.js server, configured for Android deployment via Capacitor.

**UI/UX Decisions:**
- **Design System:** Spotify-inspired dark theme with a vibrant green accent, consistent gradient background, and radial green accent overlay, utilizing Glassmorphism.
- **Mobile-First:** Optimized layouts, large touch targets, responsive grid, iOS safe-area support, and a persistent bottom navigation bar.
- **Branding:** Clean animated waveform logo and "PodBrew" wordmark.
- **User Experience:** Minimized hero sections for authenticated users; value proposition and walkthrough for unauthenticated/free users. Dedicated settings page with a Netflix/Spotify-inspired conversion-focused layout.
- **Unified Listen/Discover Page:** YouTube-inspired mobile-first experience at `/listen` combining Home and Explore functionality into a single page with search, category filters, sort dropdown, and vertical content rails (Fresh Releases, You Might Like, Trending Now, All Podcasts). Progressive skeleton loading and 44px touch targets. AI-powered "You Might Like" recommendations based on category and topic keyword matching with 10-minute caching. Hot Comments preview on podcast cards.
- **Navigation:** Desktop sidebar and mobile bottom nav with 4 items: Discover, Create, Library, Settings.
- **Components:** Podcast cards, a persistent global audio player with Media Session API integration, icon-only buttons with tooltips, and a mobile-optimized 3-step form wizard for podcast creation. Template picker uses horizontal scrollable chips. MorningBriefWidget is a compact collapsible action bar. Rotating tagline uses animated neon green cursive text for paid users. Voice selection is a full-screen modal with simplified gender filters and AI-generated avatars.

**Technical Implementations & Feature Specifications:**
- **AI Podcast Generation:** Multi-voice natural dialogue, 24kHz audio quality, branded audio watermarks, AI-generated cover art (Gemini 2.5 Flash Image), and dynamic script generation via GPT-4o.
- **Voice Intelligence Platform:** Advanced selection of 30 premium Gemini voices with personalized alias names, on-demand voice preview generation with caching, multi-host selection, user favoriting, and multi-speaker synthesis for 2-host podcasts. Includes emotion-driven speech delivery and a Voice Accent System.
- **TTS Optimization:** Four-layer strategy for API call reduction and improved performance: intelligent segment batching, LRU in-memory synthesis cache, throttled request queueing with rate limit protection, and pre-generation of watermarks. Includes per-voice-tone duration calibration, proportional request timeouts, TTS quota monitoring, and 3-key API rotation fallback. **Voice consistency across chunks:** every Gemini TTS call sends an explicit per-template `temperature` (0.5 for news/medical/teachme/documents, 0.7 for stories/conversational, 0.6 default; override via `GEMINI_TTS_TEMPERATURE`) plus a fixed seed reused across all chunks of one podcast. For resumable single-host generation the seed is derived deterministically from the job ID via `deriveSeedFromId` so post-resume batches share the same prosody trajectory. Implemented in `server/podcast/ttsAdapter.ts`.
- **Hybrid LLM Cost Optimization:** LLM Router (`server/llmRouter.ts`) routes tasks to optimal models (e.g., GPT-4o-mini for titles, GPT-4o for topic enhancement, DeepSeek R1 for bulk tasks) for significant cost savings.
- **Content Sourcing & Research:** Real-time content sourcing using Perplexity API for web search, aggregation, and citations. Intelligent Research Orchestration includes expert personas, multi-dimensional research, chain-of-thought analysis, and multi-perspective analysis. Unified Content Ingestion System for YouTube, Spotify, podcasts, and arbitrary websites/articles, with support for large document uploads and Grok-powered deep analysis. The Documents template also accepts topic-only briefs.
- **Voice Assistant:** Tap-to-talk AI assistant (`client/src/components/voice-assistant.tsx`) with floating mic button, integrated in AppShell, utilizing Gemini Live for phone-call-quality latency. Architecture: browser streams 16 kHz PCM over WebSocket → server proxy (`server/voiceAssistantLive.ts`) forwards to Gemini Live for VAD, ASR, intent reasoning, and TTS. Server emits incoming model audio back to client for gapless playback; barge-in is implemented. Intent parsing uses Live function declarations for actions like `create_podcast`, `navigate`, `play_podcast`. Voice search via `play_podcast` and `queue_podcast` tool calls resolves through `GET /api/podcasts/search-mine`, which scans the user's library and parses recency hints.
- **Morpheus Wizard:** Universal conversational AI tool integrated across all brew templates for topic refinement.
- **Podcast Customization:** Various input methods (text, voice, AI enhancement, trending topics, document upload) and customization options for duration, language complexity, hosts, styles, co-host personalities, moods, and 80+ languages. Includes location-based personalization and local event discovery.
- **Daily Briefs:** Features Daily Brew independent settings, "Add Topic" modal, 8 topic categories, improved UX with settings summary and Pro Tip, and Intelligent Weekly Fallback for sparse news. Trending Topics system allows multi-category headline selection, with a 6-hour TTL cache and smart deduplication.
- **Podcast Management & Engagement:** Audio playback controls, engagement tracking, brewing progress, public/private toggle, shareable embeds, and a social engagement platform with simple like/dislike reactions (`LikeDislikeButtons`), threaded comments, and a Reddit Hot formula-based trending algorithm. Full playlist management and in-app metadata editing.
- **RSS Feed Distribution:** Complete podcast distribution system with show management, episode curation, iTunes-compatible RSS 2.0 feed generation, and copy-to-clipboard RSS URLs.
- **Voice Library:** Dedicated tab for exploring and managing premium voices, with avatars, gender badges, tone tags, and cached preview playback.
- **Binge Course Generation:** Multi-episode educational course generation via TeachMe template, with AI syllabus generation, sequential episode synthesis, automatic playlist creation, and episode numbering.
- **Authentication & Monetization:** Google OAuth + email/password auth with Passport.js, persistent login via signed tokens, one-time authorization code exchange, Capacitor deep link handler for native app OAuth return flow, dual-path native Google Sign-In via `@capgo/capacitor-social-login` plugin with `POST /api/auth/google/native-signin` endpoint for Google ID token verification, credit-based pricing, free and tiered paid plans, and Stripe integration.
- **Security & SEO:** Content Security Policy (CSP), three-tier rate limiting, anti-scraping middleware, AI bot blocking, security headers, copyright protection, and comprehensive SEO (meta tags, Schema.org, `robots.txt`, dynamic `sitemap.xml`).
- **Android/Play Store Ready:** Capacitor-based Android deployment with: StatusBar/SplashScreen/Haptics plugin initialization, Media Session API for native audio controls, service worker for offline support, network security config, release build configuration, required permissions, deep linking support, Privacy Policy and Terms of Service pages. WebView Mic Bridge in `MainActivity` explicitly handles `RESOURCE_AUDIO_CAPTURE` for microphone permissions. **Mic Permission Recovery Bridge** (`MainActivity.NativeBridge` → `window.PodBrewNative`) exposes origin-gated `openAppSettings()` and `hasMicPermission()` to the WebView so denied-mic flows can reliably open Settings → PodBrew → Permissions, and `useMicPermissionWatcher` (`client/src/hooks/useMicPermissionWatcher.ts`) auto-recovers the Voice Assistant + Create-page topic mic when the user returns from Settings with mic granted. Origin-gated fail-closed. Cross-platform JS API lives in `client/src/lib/nativeBridge.ts` (`isNativeMobile`, `nativeHasMicPermission`, `openNativeAppSettings`); the legacy `androidNative.ts` is now a thin re-export shim. iOS support is JS-complete and ready for the Swift bridge in `ios-prep/MicPermissionBridge.swift` to be wired into Xcode after `npx cap add ios` is run on a Mac (see `ios-prep/README.md`); until then iOS native paths gracefully fall back to the `app-settings:` URL scheme.
- **Bandwidth Optimization:** Gzip compression, batch engagement API endpoint, 1-year cache TTL for media files, and TanStack Query cache priming.
- **Data Model:** `GeneratedPodcast` stores comprehensive podcast metadata. Critical business rules include private document/medical templates and exclusive use of premium voices.

## External Dependencies
- **OpenAI:** GPT-4o
- **xAI (Grok):** grok-2-1212
- **Google Gemini:** Gemini 2.5 Flash Image, Gemini 2.5 Flash TTS
- **Perplexity AI:** sonar-pro model
- **Replit Object Storage:** For hosting generated audio files.
- **PostgreSQL:** Database for persistent storage (managed via Drizzle ORM).
- **Web Speech API:** For voice input (speech-to-text).
- **TanStack Query:** For efficient data fetching.
- **date-fns:** For date formatting.
- **Lucide React:** For icons.
- **Google Fonts:** For Inter, Space Grotesk, and JetBrains Mono fonts.