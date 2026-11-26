import { useEffect, useRef } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { isNativeMobile, nativeHasMicPermission } from "@/lib/nativeBridge";

interface Options {
  enabled: boolean;
  onGranted: () => void;
}

/**
 * While `enabled`, listens for the app to come back to the foreground (e.g.
 * the user stepped out to phone Settings) and invokes `onGranted` once if the
 * native bridge reports RECORD_AUDIO (Android) / AVAudioSession record
 * permission (iOS) is granted.
 *
 * Active on Capacitor Android + iOS; no-ops on web. The iOS Swift bridge
 * refreshes its mic-permission cache on every `viewWillAppear` (which fires
 * before the Capacitor `appStateChange { isActive: true }` event), so by the
 * time this watcher reads `nativeHasMicPermission()` the value is fresh.
 *
 * `onGranted` is fired AT MOST ONCE per enable cycle: both the
 * `appStateChange` and `visibilitychange` resume signals are routed through
 * the same `firedRef` guard so duplicate-fire from two near-simultaneous
 * resume events can't cause the caller to start two concurrent sessions or
 * toggle a mic on-then-off.
 */
export function useMicPermissionWatcher({ enabled, onGranted }: Options) {
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;

  useEffect(() => {
    if (!enabled) return;
    if (!isNativeMobile()) return;

    let cancelled = false;
    let fired = false;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const check = () => {
      if (cancelled || fired) return;
      const granted = nativeHasMicPermission();
      if (granted === true) {
        fired = true;
        onGrantedRef.current();
      }
    };

    const scheduleCheck = () => {
      if (cancelled || fired) return;
      if (pendingTimeout !== null) return;
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        check();
      }, 200);
    };

    const handlePromise = CapacitorApp.addListener(
      "appStateChange",
      ({ isActive }) => {
        if (!isActive) return;
        scheduleCheck();
      }
    );

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      scheduleCheck();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (pendingTimeout !== null) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
      }
      handlePromise
        .then((h) => h.remove())
        .catch(() => {});
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled]);
}
