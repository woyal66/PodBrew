const PERSIST_TOKEN_KEY = "podbrew_auth_token";

interface NativeSignInResult {
  success: boolean;
  error?: string;
}

function isNativePlatform(): boolean {
  try {
    const w = window as any;
    return w?.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function getSocialLoginPlugin(): any {
  try {
    const w = window as any;
    const plugin = w?.Capacitor?.Plugins?.SocialLogin;
    if (plugin) return plugin;
    if (w?.CapacitorCustomPlatform?.plugins?.SocialLogin) {
      return w.CapacitorCustomPlatform.plugins.SocialLogin;
    }
    return null;
  } catch {
    return null;
  }
}

export async function nativeGoogleSignIn(): Promise<NativeSignInResult> {
  if (!isNativePlatform()) {
    return { success: false, error: "Not a native platform" };
  }

  try {
    const SocialLogin = getSocialLoginPlugin();

    if (!SocialLogin) {
      return { success: false, error: "Google Sign-In plugin not available. Please rebuild the native app with @capgo/capacitor-social-login." };
    }

    await SocialLogin.initialize({
      google: {
        webClientId: (window as any).__CAPACITOR_GOOGLE_WEB_CLIENT_ID || undefined,
        iosClientId: (window as any).__CAPACITOR_GOOGLE_IOS_CLIENT_ID || undefined,
      },
    }).catch(() => {});

    const result = await SocialLogin.login({
      provider: "google",
      options: {
        scopes: ["profile", "email"],
      },
    });

    const idToken =
      (result as any)?.result?.idToken ||
      (result as any)?.idToken ||
      (result as any)?.result?.serverAuthCode;

    if (!idToken) {
      console.error("[NativeAuth] No ID token in result:", JSON.stringify(result));
      return { success: false, error: "No authentication token received from Google" };
    }

    const response = await fetch("/api/auth/google/native-signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data.error || "Server authentication failed" };
    }

    const data = await response.json();
    if (data.token) {
      localStorage.setItem(PERSIST_TOKEN_KEY, data.token);
    }

    return { success: true };
  } catch (error: any) {
    console.error("[NativeAuth] Google sign-in error:", error);
    
    if (error?.message?.includes("canceled") || error?.message?.includes("cancelled")) {
      return { success: false, error: "Sign-in was cancelled" };
    }
    
    if (error?.message?.includes("Cannot find module") || error?.message?.includes("not available")) {
      return { success: false, error: "Google Sign-In plugin not installed. Please rebuild the native app with @capgo/capacitor-social-login." };
    }

    return { success: false, error: error.message || "Google sign-in failed" };
  }
}
