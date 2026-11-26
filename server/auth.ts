import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import crypto from "crypto";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";

const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

const authCodes = new Map<string, { userId: string; expiresAt: number }>();
const AUTH_CODE_TTL = 60_000; // 60 seconds

function generateAuthCode(userId: string): string {
  const code = crypto.randomBytes(32).toString("hex");
  authCodes.set(code, { userId, expiresAt: Date.now() + AUTH_CODE_TTL });
  return code;
}

function consumeAuthCode(code: string): string | null {
  const entry = authCodes.get(code);
  if (!entry) return null;
  authCodes.delete(code);
  if (Date.now() > entry.expiresAt) return null;
  return entry.userId;
}

setInterval(() => {
  const now = Date.now();
  authCodes.forEach((entry, code) => {
    if (now > entry.expiresAt) authCodes.delete(code);
  });
}, 60_000);

function signPersistentToken(userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const payload = JSON.stringify({ sub: userId, exp: expiresAt });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const secret = process.env.SESSION_SECRET || "podbrew-session-secret";
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifyPersistentToken(token: string): string | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const secret = process.env.SESSION_SECRET || "podbrew-session-secret";
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payloadB64)
      .digest("base64url");
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString()
    );
    if (!payload.sub || !payload.exp) return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Serialize user to session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user || false);
    } catch (error) {
      done(error, false);
    }
  });

  // Google OAuth Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    // Construct absolute callback URL
    const baseUrl = process.env.REPLIT_DEPLOYMENT 
      ? 'https://podbrew.pro'
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : 'http://localhost:5000';
    
    const callbackURL = `${baseUrl}/api/auth/google/callback`;
    
    console.log('[Auth] Google OAuth callback URL:', callbackURL);
    
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: callbackURL,
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            // Check if user exists with this Google ID
            const [existingUser] = await db
              .select()
              .from(users)
              .where(eq(users.googleId, profile.id))
              .limit(1);

            if (existingUser) {
              // Update existing user's info
              const [updatedUser] = await db
                .update(users)
                .set({
                  email: profile.emails?.[0]?.value,
                  firstName: profile.name?.givenName,
                  lastName: profile.name?.familyName,
                  profileImageUrl: profile.photos?.[0]?.value,
                  updatedAt: new Date(),
                })
                .where(eq(users.id, existingUser.id))
                .returning();
              
              return done(null, updatedUser || false);
            }

            // Check if user exists with this email
            if (profile.emails?.[0]?.value) {
              const [emailUser] = await db
                .select()
                .from(users)
                .where(eq(users.email, profile.emails[0].value))
                .limit(1);

              if (emailUser) {
                // Link Google account to existing email account
                const [linkedUser] = await db
                  .update(users)
                  .set({
                    googleId: profile.id,
                    authProvider: 'google',
                    firstName: profile.name?.givenName || emailUser.firstName,
                    lastName: profile.name?.familyName || emailUser.lastName,
                    profileImageUrl: profile.photos?.[0]?.value || emailUser.profileImageUrl,
                    updatedAt: new Date(),
                  })
                  .where(eq(users.id, emailUser.id))
                  .returning();
                
                return done(null, linkedUser || false);
              }
            }

            // Create new user
            const [newUser] = await db
              .insert(users)
              .values({
                googleId: profile.id,
                email: profile.emails?.[0]?.value,
                firstName: profile.name?.givenName,
                lastName: profile.name?.familyName,
                profileImageUrl: profile.photos?.[0]?.value,
                authProvider: 'google',
                credits: 3,
                subscriptionPlan: 'free',
                subscriptionStatus: 'active',
                onboardingCompleted: false,
              })
              .returning();

            done(null, newUser || false);
          } catch (error) {
            console.error('[Auth] Google OAuth error:', error);
            done(error as Error, undefined);
          }
        }
      )
    );
  }

  // Local Strategy (Email/Password)
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          if (!user) {
            return done(null, false, { message: 'Incorrect email or password' });
          }

          if (!user.password) {
            return done(null, false, { message: 'Please sign in with Google' });
          }

          const isValidPassword = await bcrypt.compare(password, user.password);
          
          if (!isValidPassword) {
            return done(null, false, { message: 'Incorrect email or password' });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // Google OAuth routes (only register if credentials are configured)
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.get(
      '/api/auth/google',
      (req, res, next) => {
        const source = req.query.source as string;
        if (source) {
          (req.session as any).authSource = source;
        }
        req.session.save(() => next());
      },
      passport.authenticate('google', {
        scope: ['profile', 'email'],
      })
    );

    app.get(
      '/api/auth/google/callback',
      passport.authenticate('google', {
        failureRedirect: '/?error=auth_failed',
      }),
      (req, res) => {
        req.session.save((err) => {
          if (err) {
            console.error('[Auth] Session save error:', err);
            return res.redirect('/?error=session_failed');
          }
          
          const user = req.user as any;
          const authSource = (req.session as any).authSource;
          delete (req.session as any).authSource;
          
          if (user?.id) {
            const code = generateAuthCode(user.id);
            console.log('[Auth] Google OAuth successful, session saved, auth code generated');
            
            if (authSource === 'capacitor') {
              return res.redirect(`podbrew://auth/callback?code=${encodeURIComponent(code)}`);
            }
            
            return res.redirect(`/?auth_code=${encodeURIComponent(code)}`);
          }
          
          console.log('[Auth] Google OAuth successful, session saved');
          res.redirect('/');
        });
      }
    );
  } else {
    // Return friendly error if Google OAuth is not configured
    app.get('/api/auth/google', (req, res) => {
      res.status(503).json({ 
        error: 'Google sign-in is not configured',
        message: 'Please use email/password authentication'
      });
    });
    
    app.get('/api/auth/google/callback', (req, res) => {
      res.redirect('/?error=google_not_configured');
    });
  }

  // Local auth routes
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Check if user already exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          password: hashedPassword,
          firstName: firstName || null,
          lastName: lastName || null,
          authProvider: 'email',
          credits: 3,
          subscriptionPlan: 'free',
          subscriptionStatus: 'active',
          onboardingCompleted: false,
        })
        .returning();

      // Log user in
      req.login(newUser as Express.User, (err) => {
        if (err) {
          console.error('[Auth] Login after signup failed:', err);
          return res.status(500).json({ error: 'Failed to log in after signup' });
        }
        res.json({ user: newUser });
      });
    } catch (error) {
      console.error('[Auth] Signup error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        console.error('[Auth] Login error:', err);
        return res.status(500).json({ error: 'Login failed' });
      }

      if (!user) {
        return res.status(401).json({ error: info?.message || 'Invalid credentials' });
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error('[Auth] Login session error:', loginErr);
          return res.status(500).json({ error: 'Failed to create session' });
        }
        res.json({ user });
      });
    })(req, res, next);
  });

  app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('[Auth] Logout error:', err);
        return res.status(500).json({ error: 'Logout failed' });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/session-token", (req: any, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ error: "No user ID" });
    }
    const token = signPersistentToken(userId);
    return res.json({ token });
  });

  app.post("/api/auth/exchange-code", async (req: any, res) => {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Code required" });
    }
    const userId = consumeAuthCode(code);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.login(user, (err: any) => {
      if (err) {
        console.error("[Auth] Code exchange failed:", err);
        return res.status(500).json({ error: "Code exchange failed" });
      }
      const token = signPersistentToken(userId);
      console.log("[Auth] Auth code exchanged for token, user:", userId);
      return res.json({ success: true, token });
    });
  });

  app.post("/api/auth/google/native-signin", async (req: any, res) => {
    try {
      const { idToken } = req.body;
      if (!idToken) {
        return res.status(400).json({ error: "ID token required" });
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        return res.status(503).json({ error: "Google sign-in not configured" });
      }

      const client = new OAuth2Client(clientId);
      let ticket;
      try {
        ticket = await client.verifyIdToken({
          idToken,
          audience: clientId,
        });
      } catch (verifyError) {
        console.error("[Auth] Google ID token verification failed:", verifyError);
        return res.status(401).json({ error: "Invalid Google ID token" });
      }

      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        return res.status(401).json({ error: "Invalid token payload" });
      }

      const googleId = payload.sub;
      const email = payload.email;
      const firstName = payload.given_name;
      const lastName = payload.family_name;
      const profileImageUrl = payload.picture;

      let user;

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.googleId, googleId))
        .limit(1);

      if (existingUser) {
        const [updatedUser] = await db
          .update(users)
          .set({
            email: email || existingUser.email,
            firstName: firstName || existingUser.firstName,
            lastName: lastName || existingUser.lastName,
            profileImageUrl: profileImageUrl || existingUser.profileImageUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id))
          .returning();
        user = updatedUser;
      } else if (email) {
        const [emailUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (emailUser) {
          const [linkedUser] = await db
            .update(users)
            .set({
              googleId,
              authProvider: "google",
              firstName: firstName || emailUser.firstName,
              lastName: lastName || emailUser.lastName,
              profileImageUrl: profileImageUrl || emailUser.profileImageUrl,
              updatedAt: new Date(),
            })
            .where(eq(users.id, emailUser.id))
            .returning();
          user = linkedUser;
        }
      }

      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({
            googleId,
            email: email || null,
            firstName: firstName || null,
            lastName: lastName || null,
            profileImageUrl: profileImageUrl || null,
            authProvider: "google",
            credits: 3,
            subscriptionPlan: "free",
            subscriptionStatus: "active",
            onboardingCompleted: false,
          })
          .returning();
        user = newUser;
      }

      if (!user) {
        return res.status(500).json({ error: "Failed to create/find user" });
      }

      req.login(user, (err: any) => {
        if (err) {
          console.error("[Auth] Native Google sign-in session error:", err);
          return res.status(500).json({ error: "Session creation failed" });
        }
        const token = signPersistentToken(user!.id);
        console.log("[Auth] Native Google sign-in successful for user:", user!.id);
        return res.json({ success: true, token, user });
      });
    } catch (error) {
      console.error("[Auth] Native Google sign-in error:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  });

  app.post("/api/auth/restore-session", async (req: any, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }
    const userId = verifyPersistentToken(token);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.login(user, (err: any) => {
      if (err) {
        console.error("[Auth] Session restore failed:", err);
        return res.status(500).json({ error: "Session restore failed" });
      }
      console.log("[Auth] Session restored for user:", userId);
      return res.json({ success: true, userId });
    });
  });

  // Developer login endpoint (for testing only)
  app.post('/api/auth/dev-login', async (req, res) => {
    try {
      const devEmail = 'leyton.sita80@gmail.com';
      
      // Check if dev user exists
      let [devUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, devEmail))
        .limit(1);

      // Create dev user if doesn't exist
      if (!devUser) {
        const [newUser] = await db
          .insert(users)
          .values({
            email: devEmail,
            firstName: 'Leyton',
            lastName: 'Developer',
            authProvider: 'email',
            credits: 10000,
            subscriptionPlan: 'enterprise',
            subscriptionStatus: 'active',
            onboardingCompleted: true,
          })
          .returning();
        devUser = newUser;
      }

      // Log user in
      req.login(devUser as Express.User, (err) => {
        if (err) {
          console.error('[Auth] Dev login failed:', err);
          return res.status(500).json({ error: 'Failed to log in' });
        }
        console.log('[Auth] Developer logged in:', devEmail);
        res.json({ user: devUser, message: 'Developer logged in successfully' });
      });
    } catch (error) {
      console.error('[Auth] Dev login error:', error);
      res.status(500).json({ error: 'Failed to log in as developer' });
    }
  });

  // Developer redirect endpoint - logs in and redirects to app
  app.get('/dev-login', async (req, res) => {
    try {
      const devEmail = 'leyton.sita80@gmail.com';
      
      // Check if dev user exists
      let [devUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, devEmail))
        .limit(1);

      // Create dev user if doesn't exist
      if (!devUser) {
        const [newUser] = await db
          .insert(users)
          .values({
            email: devEmail,
            firstName: 'Leyton',
            lastName: 'Developer',
            authProvider: 'email',
            credits: 10000,
            subscriptionPlan: 'enterprise',
            subscriptionStatus: 'active',
            onboardingCompleted: true,
          })
          .returning();
        devUser = newUser;
      }

      // Log user in and redirect
      req.login(devUser as Express.User, (err) => {
        if (err) {
          console.error('[Auth] Dev login redirect failed:', err);
          return res.redirect('/?error=dev_login_failed');
        }
        console.log('[Auth] Developer logged in via redirect:', devEmail);
        res.redirect('/');
      });
    } catch (error) {
      console.error('[Auth] Dev login redirect error:', error);
      res.redirect('/?error=dev_login_error');
    }
  });
}

// Allows both authenticated users AND guests (with x-guest-id header)
// Sets req.userId for authenticated users or req.guestId for guests
export const requireIdentity: RequestHandler = async (req, res, next) => {
  // If already authenticated, prefer that
  if (req.isAuthenticated() && req.user?.id) {
    req.userId = req.user.id;
    return next();
  }

  // Accept guest identity via header
  const guestId = req.headers['x-guest-id'] as string | undefined;
  if (guestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guestId)) {
    req.guestId = guestId;
    return next();
  }

  // Dev auto-login fallback (same as isAuthenticated)
  if (process.env.NODE_ENV !== 'production') {
    try {
      const devEmail = 'leyton.sita80@gmail.com';
      const [devUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, devEmail))
        .limit(1);

      if (devUser) {
        return req.login(devUser as Express.User, (err) => {
          if (!err) {
            req.userId = devUser.id;
            return next();
          }
          return res.status(401).json({ error: "Authentication required", requiresAuth: true, message: "Please sign in or provide a guest identity" });
        });
      }
    } catch (error) {
      console.error('[Auth] requireIdentity dev auto-login error:', error);
    }
  }

  return res.status(401).json({ error: "Authentication required", requiresAuth: true, message: "Please sign in or provide a guest identity" });
};

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // In development mode, auto-login if not authenticated
  if (process.env.NODE_ENV !== 'production' && !req.isAuthenticated()) {
    try {
      const devEmail = 'leyton.sita80@gmail.com';
      const [devUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, devEmail))
        .limit(1);

      if (devUser) {
        // Auto-login in development
        return req.login(devUser as Express.User, (err) => {
          if (!err) {
            req.userId = devUser.id;
            console.log('[Auth] Dev auto-login triggered for:', devEmail);
            return next();
          }
          // If auto-login fails, continue to auth error
          return res.status(401).json({ 
            error: "Authentication required", 
            requiresAuth: true, 
            message: "Please sign in to create podcasts" 
          });
        });
      }
    } catch (error) {
      console.error('[Auth] Dev auto-login error:', error);
    }
  }

  if (!req.isAuthenticated()) {
    return res.status(401).json({ 
      error: "Authentication required", 
      requiresAuth: true, 
      message: "Please sign in to create podcasts" 
    });
  }

  if (!req.user?.id) {
    return res.status(401).json({ 
      error: "Authentication required", 
      requiresAuth: true, 
      message: "Please sign in to create podcasts" 
    });
  }

  // Set userId for downstream middlewares
  req.userId = req.user.id;
  next();
};
