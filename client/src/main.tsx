import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPrefetch } from "./lib/prefetch";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

initPrefetch();

async function initializeCapacitor() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#000000" });
    await SplashScreen.hide();

    try {
      const { App: CapApp } = await import("@capacitor/app");
      CapApp.addListener("appUrlOpen", (event: { url: string }) => {
        try {
          const url = new URL(event.url);
          if (url.pathname === "/auth/callback" || url.host === "auth") {
            const code = url.searchParams.get("code");
            if (code) {
              window.location.href = `/?auth_code=${encodeURIComponent(code)}`;
            }
          }
        } catch (e) {
          console.warn("[Capacitor] Deep link parse error:", e);
        }
      });
    } catch {
      console.warn("[Capacitor] App plugin not available for deep links");
    }
    
    console.log("[Capacitor] Native plugins initialized");
  } catch (error) {
    console.warn("[Capacitor] Plugin initialization error:", error);
  }
}

// Register service worker for offline support (production only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[SW] Registered successfully:', registration.scope);
      })
      .catch((err) => {
        console.log('[SW] Registration failed:', err);
      });
  });
}

// Initialize native plugins when DOM is ready
document.addEventListener('DOMContentLoaded', initializeCapacitor);

createRoot(document.getElementById("root")!).render(<App />);
