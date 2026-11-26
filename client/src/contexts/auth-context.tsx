import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { TierRestrictions } from "@shared/schema";
import { Capacitor } from "@capacitor/core";

const PERSIST_TOKEN_KEY = "podbrew_auth_token";

interface User {
  id: string;
  email: string | null;
  credits: number;
  subscriptionPlan: string;
  onboardingCompleted: boolean;
  tierRestrictions: TierRestrictions;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refetchAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchSessionToken(): Promise<void> {
  try {
    const res = await fetch("/api/auth/session-token", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        localStorage.setItem(PERSIST_TOKEN_KEY, data.token);
      }
    }
  } catch {
  }
}

function extractAuthCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_code");
    if (code) {
      params.delete("auth_code");
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      return code;
    }
  } catch {}
  return null;
}

async function exchangeCodeForToken(code: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/exchange-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        localStorage.setItem(PERSIST_TOKEN_KEY, data.token);
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function tryRestoreSession(): Promise<boolean> {
  const authCode = extractAuthCodeFromUrl();
  if (authCode) {
    const exchanged = await exchangeCodeForToken(authCode);
    if (exchanged) return true;
  }

  const token = localStorage.getItem(PERSIST_TOKEN_KEY);
  if (!token) return false;
  try {
    const res = await fetch("/api/auth/restore-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      return true;
    }
    localStorage.removeItem(PERSIST_TOKEN_KEY);
    return false;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionRestored, setSessionRestored] = useState(false);
  const restorationAttempted = useRef(false);

  const { data: user, isLoading: isQueryLoading, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    enabled: sessionRestored,
  });

  useEffect(() => {
    if (restorationAttempted.current) return;
    restorationAttempted.current = true;

    (async () => {
      const checkRes = await fetch("/api/auth/user", { credentials: "include" });
      if (checkRes.ok) {
        const userData = await checkRes.json();
        if (userData) {
          // Pre-populate the TanStack Query cache so the gated useQuery
          // below sees fresh data on mount and does not fire a second
          // identical /api/auth/user request. fetchSessionToken is left
          // to the user-changed effect below so it only runs once.
          queryClient.setQueryData(["/api/auth/user"], userData);
          setSessionRestored(true);
          return;
        }
      }
      const restored = await tryRestoreSession();
      if (restored) {
        // Restoration succeeded — invalidate so the gated useQuery fetches
        // the freshly-authenticated user once.
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else {
        // No session and nothing to restore. Prime the cache with null so
        // the gated useQuery sees fresh data on mount and doesn't make a
        // second identical /api/auth/user request just to learn the same
        // null answer the manual check already produced.
        queryClient.setQueryData(["/api/auth/user"], null);
      }
      setSessionRestored(true);
    })();
  }, []);

  useEffect(() => {
    if (user && sessionRestored) {
      fetchSessionToken();
    }
  }, [user, sessionRestored]);

  const isAuthenticated = !!user;
  const isLoading = !sessionRestored || isQueryLoading;

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isAuthenticated,
        isLoading,
        refetchAuth: refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
