import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { registerShareOgRoutes } from "./middleware/shareOgTags";
import { securityHeaders, globalLimiter, antiScrapingMiddleware, blockAIBots } from "./middleware/security";
import { validateStartupConfiguration } from "./startupValidation";
import { voicePreviewService } from "./services/VoicePreviewService";
import { syncVoicesOnStartup } from "./utils/syncVoices";
import { warmCache } from "./services/PersistentCache";
import { initializeWatermarkCache } from "./podcast/watermarkCache";
import { fixPodcastVisibilityOnStartup } from "./utils/fixPodcastVisibility";

// Initialize Google Cloud credentials if available (enables higher quotas for Gemini API)
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    const credentialsPath = path.join(process.cwd(), '.google-credentials.json');
    fs.writeFileSync(credentialsPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    console.log('[Init] ✅ Google Cloud credentials initialized - Gemini API using Google Cloud quotas');
  } catch (error) {
    console.warn('[Init] ⚠️  Failed to initialize Google Cloud credentials:', error instanceof Error ? error.message : error);
  }
}

// Validate configuration before starting server
validateStartupConfiguration();

// Sync voices data with curated voices catalog
syncVoicesOnStartup().catch(err => {
  console.warn('⚠️  Non-critical: Voice sync warning:', err instanceof Error ? err.message : err);
});

// Pre-generate all voice previews asynchronously (non-blocking)
// This ensures all voices have cached previews for instant playback in production
voicePreviewService.preGenerateAllVoicePreviews().catch(err => {
  console.warn('⚠️  Non-critical: Voice preview pre-generation warning:', err instanceof Error ? err.message : err);
});

// Warm the persistent cache from PostgreSQL (non-blocking)
warmCache().catch(err => {
  console.warn('⚠️  Non-critical: PersistentCache warm failed:', err instanceof Error ? err.message : err);
});

// Initialize watermark audio cache (lazy per-voice caching)
// Watermarks are cached on first use per voice to eliminate 2 TTS calls per subsequent podcast
initializeWatermarkCache().then(() => {
  console.log('[WatermarkCache] Lazy initialization ready - caches on first use per voice');
}).catch(err => {
  console.warn('⚠️  Non-critical: Watermark cache initialization failed:', err instanceof Error ? err.message : err);
});

const app = express();

// Trust proxy for rate limiting behind Replit's reverse proxy
app.set('trust proxy', 1);

declare module 'express-serve-static-core' {
  interface Request {
    sessionId: string;
    userId?: string;
  }
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// Gzip compression for all responses (reduces bandwidth by 70-80%)
// Uses default filter which already skips binary content types like audio, video, images
app.use(compression({
  level: 6, // Balanced compression level (1-9, higher = more compression but slower)
}));

// Security headers (CSP, X-Content-Type-Options, etc.)
app.use(securityHeaders);

// Anti-scraping and AI bot blocking
app.use(antiScrapingMiddleware);
app.use(blockAIBots);

// Global rate limiting
app.use('/api', globalLimiter);

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  let sessionId = req.cookies.sessionId;
  
  if (!sessionId) {
    sessionId = randomBytes(32).toString('hex');
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }
  
  req.sessionId = sessionId;
  req.userId = req.cookies.userId;
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const pathname = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (pathname.startsWith("/api")) {
      let logLine = `${req.method} ${pathname} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Server-side Open Graph tag injection for shared podcast routes.
  // Must run before vite/static so it sees the request before the SPA
  // fallback, but after registerRoutes so it doesn't shadow /api routes.
  registerShareOgRoutes(app);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  const PORT = parseInt(process.env.PORT || "5000", 10);
  server.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
    
    // Run startup fixes (non-blocking)
    fixPodcastVisibilityOnStartup().catch((err: Error) => {
      console.error('Startup fix failed (non-critical):', err);
    });

    // Pre-warm trending topics so the first user request is a cache hit
    // (initial run ~30s after start, then every 6h).
    import('./services/trendingWarmer').then(({ startTrendingWarmer }) => {
      startTrendingWarmer();
    }).catch((err: Error) => {
      console.error('TrendingWarmer init failed (non-critical):', err);
    });
  });
})();
