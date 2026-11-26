import { useState, useEffect, useCallback } from "react";

const GUEST_SESSION_KEY = "podbrew_guest_session_token";

interface GuestSession {
  token: string;
  createdAt: number;
}

interface TrialStatus {
  hasUsedTrial: boolean;
  trialPodcastId: string | null;
  expiresAt: string | null;
  hoursRemaining: number | null;
}

export function useGuestSession() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(GUEST_SESSION_KEY);
    if (stored) {
      try {
        const session: GuestSession = JSON.parse(stored);
        setSessionToken(session.token);
      } catch {
        localStorage.removeItem(GUEST_SESSION_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const generateSessionToken = useCallback((): string => {
    const token = crypto.randomUUID();
    const session: GuestSession = {
      token,
      createdAt: Date.now(),
    };
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
    setSessionToken(token);
    return token;
  }, []);

  const getOrCreateSessionToken = useCallback((): string => {
    if (sessionToken) return sessionToken;
    return generateSessionToken();
  }, [sessionToken, generateSessionToken]);

  const clearSession = useCallback(() => {
    localStorage.removeItem(GUEST_SESSION_KEY);
    setSessionToken(null);
    setTrialStatus(null);
  }, []);

  const checkTrialStatus = useCallback(async (): Promise<TrialStatus | null> => {
    const token = sessionToken || localStorage.getItem(GUEST_SESSION_KEY);
    if (!token) {
      setTrialStatus({ hasUsedTrial: false, trialPodcastId: null, expiresAt: null, hoursRemaining: null });
      return null;
    }

    try {
      const parsedToken = typeof token === "string" && token.startsWith("{") 
        ? JSON.parse(token).token 
        : token;
      
      const response = await fetch(`/api/trial/status?guestSessionToken=${parsedToken}`);
      if (response.ok) {
        const data = await response.json();
        setTrialStatus(data);
        return data;
      }
    } catch (error) {
      console.error("Failed to check trial status:", error);
    }
    return null;
  }, [sessionToken]);

  const migrateTrialPodcast = useCallback(async (): Promise<{ migrated: boolean; podcastId?: string; message: string }> => {
    const token = sessionToken || localStorage.getItem(GUEST_SESSION_KEY);
    if (!token) {
      return { migrated: false, message: "No guest session found" };
    }

    try {
      const parsedToken = typeof token === "string" && token.startsWith("{") 
        ? JSON.parse(token).token 
        : token;

      const response = await fetch("/api/trial/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestSessionToken: parsedToken }),
        credentials: "include",
      });

      if (response.ok) {
        const result = await response.json();
        if (result.migrated) {
          clearSession();
        }
        return result;
      } else {
        const error = await response.json();
        return { migrated: false, message: error.error || "Migration failed" };
      }
    } catch (error) {
      console.error("Failed to migrate trial podcast:", error);
      return { migrated: false, message: "Failed to migrate trial podcast" };
    }
  }, [sessionToken, clearSession]);

  return {
    sessionToken,
    trialStatus,
    isLoading,
    getOrCreateSessionToken,
    checkTrialStatus,
    migrateTrialPodcast,
    clearSession,
    hasActiveSession: !!sessionToken,
  };
}
