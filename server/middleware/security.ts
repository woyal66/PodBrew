import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

/**
 * Security headers middleware using Helmet.js
 * Protects against XSS, clickjacking, and other common vulnerabilities
 */
const isDevelopment = process.env.NODE_ENV === 'development';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        ...(isDevelopment ? ["'unsafe-inline'"] : []), // Only allow in development for Vite HMR
        "https://cdnjs.cloudflare.com",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for UI libraries (Radix UI, Framer Motion, etc.)
        "https://fonts.googleapis.com",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "blob:",
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:",
      ],
      connectSrc: [
        "'self'",
        "https://api.openai.com",
        "https://generativelanguage.googleapis.com",
        "https://storage.googleapis.com",
        "ws://localhost:*", // WebSocket for Vite HMR
        "wss://localhost:*",
      ],
      mediaSrc: [
        "'self'",
        "https:",
        "blob:",
      ],
      frameSrc: [
        "'self'",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  // Prevent MIME type sniffing
  noSniff: true,
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // Prevent clickjacking
  frameguard: {
    action: 'deny',
  },
  // Control referrer information
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  // HTTP Strict Transport Security
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
});

/**
 * Global API rate limiter
 * Prevents abuse and DoS attacks
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per window (SPA makes ~15 calls/load + background polls)
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: Math.ceil(((req as any).rateLimit?.resetTime?.getTime() || Date.now()) / 1000),
    });
  },
});

/**
 * Strict rate limiter for authentication endpoints
 * Prevents brute-force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 attempts per 15 minutes
  skipSuccessfulRequests: true, // Don't count successful logins
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Account temporarily locked. Please try again in 15 minutes.',
      retryAfter: Math.ceil(((req as any).rateLimit?.resetTime?.getTime() || Date.now()) / 1000),
    });
  },
});

/**
 * Rate limiter for podcast generation
 * Prevents abuse of expensive AI operations
 * Enterprise users and the dev account bypass the hourly cap entirely
 */
export const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Max 10 podcast generations per hour per IP
  message: 'Generation rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    const user = (req as any).user;
    if (!user) return false;
    // Bypass for enterprise plan or dev account — unlimited generation
    return user.subscriptionPlan === 'enterprise' || user.id === 'dev-user-001';
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Generation rate limit exceeded',
      message: 'You have reached the maximum number of podcast generations per hour. Please try again later.',
      retryAfter: Math.ceil(((req as any).rateLimit?.resetTime?.getTime() || Date.now()) / 1000),
    });
  },
});

/**
 * Rate limiter for file uploads
 * Prevents storage abuse
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Max 20 uploads per hour
  message: 'Upload rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Anti-scraping middleware
 * Detects and blocks automated scraping attempts
 */
export const antiScrapingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip anti-scraping for API endpoints (consumed by frontend JavaScript)
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Skip anti-scraping for public object files (audio, images, etc.)
  if (req.path.startsWith('/public-objects/')) {
    return next();
  }
  
  if (req.path === '/sitemap.xml' || req.path === '/robots.txt' || 
      req.path === '/favicon.svg' || req.path === '/favicon.png' || req.path === '/favicon.ico' ||
      req.path === '/og-image.png' || req.path === '/twitter-image.png' || req.path === '/logo.png' ||
      (req.path.startsWith('/google') && req.path.endsWith('.html'))) {
    return next();
  }
  
  const userAgent = req.headers['user-agent']?.toLowerCase() || '';
  
  // Block known scrapers and bots (except search engine crawlers)
  const suspiciousAgents = [
    'scrapy',
    'python-requests',
    'curl',
    'wget',
    'postman',
    'insomnia',
    'httpie',
    'bot',
    'spider',
    'crawler',
  ];
  
  const allowedBots = [
    'googlebot',
    'bingbot',
    'slurp',
    'duckduckbot',
    'baiduspider',
    'yandexbot',
    'facebookexternalhit',
    'facebot',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot',
    'slackbot',
    'discordbot',
    'pinterestbot',
    'applebot',
  ];
  
  const isAllowedBot = allowedBots.some(bot => userAgent.includes(bot));
  const isSuspicious = suspiciousAgents.some(agent => userAgent.includes(agent));
  
  if (isSuspicious && !isAllowedBot) {
    console.warn(`[Anti-Scraping] Blocked suspicious user agent: ${userAgent} from IP: ${req.ip}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Automated access is not permitted',
    });
  }
  
  next();
};

/**
 * Block AI training bots from scraping content
 */
export const blockAIBots = (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers['user-agent']?.toLowerCase() || '';
  
  const aiBots = [
    'gptbot',
    'chatgpt-user',
    'ccbot',
    'anthropic-ai',
    'claude-web',
    'cohere-ai',
    'omgilibot',
    'omgili',
    'facebookbot',
    'meta-externalagent',
  ];
  
  const isAIBot = aiBots.some(bot => userAgent.includes(bot));
  
  if (isAIBot) {
    console.warn(`[AI Bot Block] Blocked AI training bot: ${userAgent} from IP: ${req.ip}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'AI training bots are not permitted to access this content',
    });
  }
  
  next();
};
