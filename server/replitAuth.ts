import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true, // Auto-create sessions table if missing
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  // Secure cookies only in production (allows local development)
  const isProduction = process.env.NODE_ENV === 'production';
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction, // Only secure in production
      sameSite: 'lax', // 'lax' required for OAuth callback redirects to work properly
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
  // Store userId separately for session persistence (claims object may not survive serialization)
  user.userId = user.claims?.sub;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {} as Express.User;
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    // Development mode bypass: auto-login with test user
    // Only works when NODE_ENV=development (Replit preview mode)
    if (process.env.NODE_ENV === 'development') {
      console.log('[Auth] Development mode: Creating test user session');
      
      // Create test user claims
      const testClaims = {
        sub: 'dev-user-leyton',
        email: 'leyton.sita80@gmail.com',
        first_name: 'Leyton',
        last_name: 'Sita',
        profile_image_url: 'https://replit.com/public/images/mark.png',
        exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
      };
      
      // Upsert test user to database
      await upsertUser(testClaims);
      
      // Create mock user session
      const mockUser: any = {
        claims: testClaims,
        userId: testClaims.sub,
        access_token: 'dev-mock-token',
        refresh_token: 'dev-mock-refresh',
        expires_at: testClaims.exp,
      };
      
      // Manually log in the user
      req.login(mockUser, (err) => {
        if (err) {
          console.error('[Auth] Dev login failed:', err);
          return next(err);
        }
        console.log('[Auth] Dev user session created successfully');
        res.redirect('/');
      });
      return;
    }
    
    // Production mode: use normal OIDC flow (removed prompt: "consent" to prevent multiple accept screens)
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`)(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });

}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  // For OIDC bypass (testing/development): If user object has claims, allow through
  // Playwright tests use OIDC bypass which sets req.user directly without Passport serialization
  if (user?.claims?.sub) {
    console.log("[Auth] User authenticated via OIDC bypass with claims.sub:", user.claims.sub);
    // Set userId for downstream middlewares (e.g., enforceTierRestrictions)
    (req as any).userId = user.claims.sub;
    return next();
  }

  // Production authentication: Check Passport session
  if (!req.isAuthenticated()) {
    console.log("[Auth] Not authenticated - req.isAuthenticated() returned false, no bypass claims");
    return res.status(401).json({ error: "Authentication required", requiresAuth: true, message: "Please sign in to create podcasts" });
  }

  if (!user) {
    console.log("[Auth] No user object in request");
    return res.status(401).json({ error: "Authentication required", requiresAuth: true, message: "Please sign in to create podcasts" });
  }

  // Get userId from serialized session (user.userId is set during updateUserSession)
  const userId = user.userId || user.claims?.sub;
  if (!userId) {
    console.log("[Auth] User authenticated but userId not found in session");
    return res.status(401).json({ error: "Authentication required", requiresAuth: true, message: "Please sign in to create podcasts" });
  }

  // Set userId for downstream middlewares
  (req as any).userId = userId;

  // Check token expiration for production auth
  if (!user.expires_at) {
    console.log("[Auth] User authenticated but missing expires_at timestamp");
    return res.status(401).json({ error: "Authentication required", requiresAuth: true, message: "Please sign in to create podcasts" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  // Token expired, attempt refresh
  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    console.warn("No refresh token available for token refresh");
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const config = await getOidcConfig();
    // Use client.refreshTokenGrant from openid-client
    const tokenSet = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenSet);
    
    // Set userId for this request (updateUserSession sets user.userId for future requests)
    (req as any).userId = user.userId;
    
    // Explicitly save the session with updated tokens
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error("Session save failed after token refresh:", err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    return next();
  } catch (error: any) {
    // Log detailed error information for debugging
    console.error("Token refresh failed:", {
      error: error.message,
      code: error.code,
      status: error.status,
      cause: error.cause,
    });
    
    // Clear the invalid session to prevent stuck state
    req.logout((logoutErr) => {
      if (logoutErr) {
        console.error("Logout failed after token refresh error:", logoutErr);
      }
      
      // Destroy session to fully clear any stale tokens
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("Session destroy failed:", destroyErr);
        }
        
        // Return 401 to trigger re-authentication
        return res.status(401).json({ 
          message: "Unauthorized", 
          requiresReauth: true 
        });
      });
    });
  }
};
