# iOS Native Bridge Prep

This folder holds the iOS-side counterpart to the Android `NativeBridge` so the
mic-permission recovery flow works identically on both platforms. It contains
files that **cannot run inside Replit** because the iOS Capacitor project
(`ios/`) and CocoaPods aren't set up here — you must do that one-time setup on
a Mac with Xcode installed.

## Why this exists

The web app (`client/src/lib/nativeBridge.ts`) calls into a global
`window.PodBrewNative` object whenever it needs to:

- check the current mic permission **synchronously** (so React renders the
  right state on first paint after the user returns from Settings), or
- open the OS Settings page for our app (so a denied mic isn't a dead-end).

On Android, this is wired up in `MainActivity.NativeBridge`. On iOS, the
equivalent is `MicPermissionBridge.swift` in this folder.

The web side is already updated: `nativeBridge.ts`,
`useMicPermissionWatcher.ts`, `voice-assistant.tsx`,
`mic-permission-recovery-dialog.tsx`, and `podcast-generator.tsx` all treat
iOS the same as Android once the bridge below is installed.

## One-time iOS setup (do this on a Mac)

1. From the project root, run:

   ```bash
   npx cap add ios
   npx cap sync ios
   ```

   This creates the `ios/` folder.

2. Open `ios/App/App.xcworkspace` in Xcode.

3. **Add the bridge file to the Xcode project**:
   - In Xcode's Project Navigator, right-click the `App` group → "Add Files to
     'App'…"
   - Pick `ios-prep/MicPermissionBridge.swift` (uncheck "Copy items if
     needed" if you'd rather keep the source-of-truth in `ios-prep/`, but
     copying is fine too).
   - Make sure the file is added to the `App` target.

4. **Set the root view controller class to the bridge subclass**:
   - Open `ios/App/App/Main.storyboard`.
   - Select the root `Bridge View Controller`.
   - In the Identity Inspector, change the Class from
     `CAPBridgeViewController` to `MicPermissionBridgeViewController`.
   - Module should auto-resolve to `App`.

5. **Add the mic usage description** to `ios/App/App/Info.plist`:

   ```xml
   <key>NSMicrophoneUsageDescription</key>
   <string>PodBrew uses your microphone for the voice assistant and to
   transcribe podcast topic ideas.</string>
   ```

   Without this, iOS will silently kill the app the first time
   `getUserMedia` is called.

6. From the project root run `npx cap sync ios` again to copy the latest web
   build into the iOS app, then build & run on a **real device** (mic
   permission prompts don't reliably appear in the iOS Simulator).

## Verifying it works

After install, on a real iPhone:

1. Open PodBrew → tap the floating mic button → grant permission once → close
   the app from the app switcher.
2. Settings → PodBrew → toggle Microphone OFF.
3. Re-open PodBrew → tap the mic button. The "Microphone access blocked"
   panel should appear with an **Open App Settings** button.
4. Tap **Open App Settings** → flip Microphone back ON → swipe back to
   PodBrew. The dialog should auto-dismiss within a fraction of a second of
   the app coming to the foreground (no manual "Check again" tap needed).

If step 4 doesn't auto-dismiss, the most common cause is that the root view
controller wasn't switched to `MicPermissionBridgeViewController` in step 4
above — the cache won't refresh on `viewWillAppear` without it.

## Why the code lives here instead of in `ios/`

Replit can't run CocoaPods or `npx cap add ios`, so creating the `ios/`
folder here would just produce a half-broken project that breaks the next
time someone pulls the repo on a Mac. Keeping the Swift file in `ios-prep/`
means:

- The web side can keep iterating without waiting on a Mac build.
- When you're ready to ship to TestFlight, you do the Xcode steps above
  exactly once and the bridge is in place.

## Related files

- `client/src/lib/nativeBridge.ts` — cross-platform JS API.
- `client/src/hooks/useMicPermissionWatcher.ts` — auto-recovers mic state
  when the app returns to the foreground.
- `android/app/src/main/java/com/podbrew/app/MainActivity.java` — the
  Android counterpart this bridge mirrors.
