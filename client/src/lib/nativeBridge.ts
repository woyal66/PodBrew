import { Capacitor } from "@capacitor/core";

/**
 * Cross-platform native bridge for mic-permission recovery on Capacitor mobile
 * (Android + iOS).
 *
 * Both platforms expose the same JS surface — `window.PodBrewNative` with
 * `hasMicPermission()` (sync) and `openAppSettings()` (fire-and-forget) — so
 * web callers don't need platform branches. Implementations differ:
 *
 *   - Android: `MainActivity.NativeBridge` registered via
 *     `addJavascriptInterface(..., "PodBrewNative")`. Both methods are truly
 *     synchronous (binder-thread RPC).
 *
 *   - iOS:     A Swift bridge (see `ios-prep/MicPermissionBridge.swift`)
 *     registered as a `WKScriptMessageHandler` plus a documentStart
 *     `WKUserScript` that pre-defines `window.PodBrewNative.hasMicPermission`
 *     to return a cached boolean. The cache is refreshed by Swift via
 *     `evaluateJavaScript` on app launch and on every `viewWillAppear` —
 *     critically including when the user returns from Settings — so
 *     `hasMicPermission()` is fresh by the time the resume watcher reads it.
 *     `openAppSettings()` posts to a WKScriptMessageHandler that opens
 *     `UIApplication.openSettingsURLString`.
 *
 * On web (no Capacitor) the bridge is undefined and every helper is a
 * documented no-op so callers stay branch-free.
 */

declare global {
  interface Window {
    PodBrewNative?: {
      hasMicPermission?: () => boolean;
      openAppSettings?: () => void;
    };
  }
}

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function isNativeIOS(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

/** Android OR iOS native shell (not the mobile web). */
export function isNativeMobile(): boolean {
  return isNativeAndroid() || isNativeIOS();
}

function getBridge() {
  if (typeof window === "undefined") return undefined;
  return window.PodBrewNative;
}

export function hasNativeBridge(): boolean {
  const b = getBridge();
  return !!(b && typeof b.openAppSettings === "function" && typeof b.hasMicPermission === "function");
}

/**
 * Synchronous read of the OS-level mic permission via the native bridge.
 *
 * Returns:
 *   - `true`  — bridge confirms RECORD_AUDIO (Android) / AVAudioSession record
 *               permission (iOS) is granted.
 *   - `false` — bridge confirms it is NOT granted.
 *   - `null`  — bridge is unavailable (web, very old install). Callers should
 *               treat null as "unknown" and fall back to `getUserMedia`-based
 *               probing.
 *
 * On iOS the boolean comes from a Swift-maintained cache that's refreshed on
 * every `viewWillAppear`, so it is fresh whenever the resume-watcher reads it
 * after the user returns from Settings.
 */
export function nativeHasMicPermission(): boolean | null {
  const b = getBridge();
  if (!b || typeof b.hasMicPermission !== "function") return null;
  try {
    return b.hasMicPermission();
  } catch {
    return null;
  }
}

/**
 * Tries to open Settings → PodBrew → (Microphone) on whichever native
 * platform we're running on. Returns true only when a launch path was
 * successfully invoked.
 *
 *   - Android: native bridge first (its `Intent` launch throws synchronously
 *     if the activity can't start, so the boolean is trustworthy), then a
 *     Capacitor-routed `intent:` URL for older builds without the bridge.
 *   - iOS:     `app-settings:` (the documented
 *     `UIApplication.openSettingsURLString` scheme) via `window.open` is the
 *     primary path because `WKScriptMessageHandler` postMessage calls always
 *     succeed synchronously even when Swift rejects them (e.g. origin
 *     mismatch), so we can't distinguish a real launch from a silent reject.
 *     The bridge's `openAppSettings()` is still invoked as a belt-and-
 *     suspenders best-effort, but the boolean reflects the scheme launch.
 *   - Web:     returns false (no app-settings concept on the open web).
 *
 * Returns false when no launch path was available — callers MUST surface
 * that to the user (e.g. via toast) so they aren't left tapping a button
 * that does nothing.
 */
export function openNativeAppSettings(): boolean {
  // iOS: scheme is the source of truth; bridge is best-effort.
  if (isNativeIOS()) {
    const b = getBridge();
    if (b && typeof b.openAppSettings === "function") {
      try {
        b.openAppSettings();
      } catch {
        /* bridge may silently reject; fall through to scheme */
      }
    }
    try {
      const opened = window.open("app-settings:", "_system");
      return opened !== null;
    } catch {
      return false;
    }
  }

  // Android: bridge is reliable (throws on launch failure).
  const b = getBridge();
  if (b && typeof b.openAppSettings === "function") {
    try {
      b.openAppSettings();
      return true;
    } catch {}
  }

  if (!isNativeAndroid()) return false;

  try {
    const opened = window.open(
      "intent:com.podbrew.app/#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end",
      "_system",
    );
    return opened !== null;
  } catch {
    return false;
  }
}

/** @deprecated Use `openNativeAppSettings`. Kept as a transitional alias. */
export const openAndroidAppSettings = openNativeAppSettings;
