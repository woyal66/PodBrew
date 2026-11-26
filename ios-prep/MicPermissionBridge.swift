// MicPermissionBridge.swift
//
// Drop this file into the iOS Capacitor project (ios/App/App/) AFTER you run
// `npx cap add ios` locally and open the project in Xcode. This bridge is the
// iOS equivalent of the Android `NativeBridge` in
// `android/app/src/main/java/.../MainActivity.java` and exposes the same
// surface to the WebView:
//
//   window.PodBrewNative = {
//     hasMicPermission(): boolean    // synchronous, reads cached AVAudioSession state
//     openAppSettings(): void        // navigates the user to Settings → PodBrew
//   }
//
// The `useMicPermissionWatcher` hook + `mic-permission-recovery-dialog` rely
// on `hasMicPermission()` returning fresh data the moment the WebView is
// re-presented after the user toggles the mic permission in Settings. We
// achieve that by:
//   1. Pre-injecting the `window.PodBrewNative` shim at documentStart so it's
//      available before any React code runs.
//   2. Refreshing the cached `__micPermission` value via `evaluateJavaScript`
//      every time the view appears (`viewWillAppear`). On iOS, this fires
//      BEFORE `applicationDidBecomeActive`, which is what Capacitor's
//      `App.addListener('appStateChange', ...)` reacts to. So by the time the
//      JS hook re-reads `nativeHasMicPermission()`, the cache is already
//      correct.
//
// SETUP (one-time, done in Xcode after `npx cap add ios`):
//
//   1. Add this file to the App target.
//   2. In `Info.plist`, add `NSMicrophoneUsageDescription` with a user-facing
//      reason string (e.g. "PodBrew uses your microphone for the voice
//      assistant and voice input.").
//   3. In `AppDelegate.swift` or wherever the root `CAPBridgeViewController`
//      is created, replace the default class reference with
//      `MicPermissionBridgeViewController` (or instantiate
//      `MicPermissionBridge(webView:)` once after the bridge initializes).
//   4. Build & run on a real device (mic prompts don't reliably appear in the
//      simulator).
//
// COCOAPODS / `pod install` MUST be run on a Mac after copying this in.

import AVFoundation
import Capacitor
import Foundation
import UIKit
import WebKit

/// Subclass of CAPBridgeViewController that wires up the mic-permission
/// bridge. Use this as your root view controller in Main.storyboard (or
/// instantiate it programmatically) so the bridge is installed for every
/// WebView the app creates.
public class MicPermissionBridgeViewController: CAPBridgeViewController {

    private var bridge: MicPermissionBridge?

    public override func capacitorDidLoad() {
        super.capacitorDidLoad()
        if let webView = self.webView {
            bridge = MicPermissionBridge(webView: webView)
        }
    }

    public override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        bridge?.refreshPermissionCache()
    }
}

/// Manages the JS ↔ Swift bridge for `window.PodBrewNative`.
public final class MicPermissionBridge: NSObject, WKScriptMessageHandler {

    public static let openSettingsHandlerName = "podBrewNativeOpenSettings"

    private weak var webView: WKWebView?

    public init(webView: WKWebView) {
        self.webView = webView
        super.init()
        installUserScript()
        webView.configuration.userContentController.add(self, name: Self.openSettingsHandlerName)
        refreshPermissionCache()
    }

    /// Called from `viewWillAppear` (and once at init) to push the current
    /// AVAudioSession permission state into the WebView's cached
    /// `window.PodBrewNative.__micPermission` flag. Safe to call repeatedly.
    public func refreshPermissionCache() {
        guard let webView = self.webView else { return }
        let granted = AVAudioSession.sharedInstance().recordPermission == .granted
        let js = "if (window.PodBrewNative) { window.PodBrewNative.__micPermission = \(granted ? "true" : "false"); }"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - WKScriptMessageHandler

    /// Allowlisted hosts that may invoke the bridge. Must match the origins
    /// served by Capacitor at runtime: `capacitor.config.ts` sets
    /// `server.url: "https://podbrew.pro"` so the WebView main frame loads
    /// `podbrew.pro`. `localhost` is included for local dev / when
    /// `server.url` is removed for offline builds. Update this set if the
    /// production domain ever changes.
    private static let allowedHosts: Set<String> = [
        "podbrew.pro",
        "www.podbrew.pro",
        "localhost",
    ]

    public func userContentController(_ userContentController: WKUserContentController,
                                      didReceive message: WKScriptMessage) {
        guard message.name == Self.openSettingsHandlerName else { return }
        // Origin gate: fail-closed. Only respond when the calling frame
        // matches one of our trusted hosts (or a `podbrew` custom scheme on
        // future offline builds). A hijacked remote origin must not be able
        // to open Settings.
        guard let url = message.frameInfo.request.url else {
            NSLog("[MicPermissionBridge] Rejecting openSettings: no frame URL")
            return
        }
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()

        // Fail-closed: scheme AND host must both be present and on the
        // allowlist. Capacitor's offline custom schemes (`capacitor://` and
        // our app's `podbrew://`) serve content from `localhost`, so
        // `localhost` covers both online (`https://podbrew.pro` is allowed
        // separately) and offline cases via `allowedHosts`.
        let trustedScheme = scheme == "https" || scheme == "capacitor" || scheme == "podbrew"
        let trustedHost = !host.isEmpty && Self.allowedHosts.contains(host)

        guard trustedScheme && trustedHost else {
            NSLog("[MicPermissionBridge] Rejecting openSettings from origin: \(url.absoluteString)")
            return
        }
        Self.openAppSettings()
    }

    // MARK: - Private

    private func installUserScript() {
        guard let webView = self.webView else { return }
        // Pre-define `window.PodBrewNative` at documentStart so React code
        // can call `hasMicPermission()` synchronously on first render. The
        // `__micPermission` value is refreshed by `refreshPermissionCache`.
        let source = """
        (function() {
          if (window.PodBrewNative) return;
          window.PodBrewNative = {
            __micPermission: false,
            hasMicPermission: function() { return !!this.__micPermission; },
            openAppSettings: function() {
              try {
                window.webkit.messageHandlers.\(Self.openSettingsHandlerName).postMessage(null);
              } catch (e) { /* bridge not ready */ }
            }
          };
        })();
        """
        let script = WKUserScript(source: source,
                                  injectionTime: .atDocumentStart,
                                  forMainFrameOnly: false)
        webView.configuration.userContentController.addUserScript(script)
    }

    private static func openAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        DispatchQueue.main.async {
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        }
    }
}
