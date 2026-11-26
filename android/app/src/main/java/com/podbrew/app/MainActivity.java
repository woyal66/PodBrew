package com.podbrew.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Plugin;

import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

  private static final int REQUEST_RECORD_AUDIO = 1001;

  // Origins we are willing to grant the embedded WebView's RESOURCE_AUDIO_CAPTURE
  // for. The WebView is locked to https://podbrew.pro via capacitor.config.ts
  // (server.url + allowMixedContent=false), but checking the request origin
  // explicitly here protects the mic if a navigation, redirect, or future
  // config change ever loaded a different origin into the WebView.
  private static final String[] TRUSTED_MIC_ORIGINS = new String[]{
      "https://podbrew.pro",
      "https://www.podbrew.pro"
  };

  private static boolean isTrustedMicOrigin(android.net.Uri origin) {
    if (origin == null) return false;
    String url = origin.toString();
    for (String trusted : TRUSTED_MIC_ORIGINS) {
      if (trusted.equals(url)) return true;
    }
    return false;
  }

  // When the embedded WebView asks for the mic but Android hasn't granted
  // RECORD_AUDIO yet, we stash the PermissionRequest here, prompt the user
  // with the system dialog, and grant or deny it from
  // onRequestPermissionsResult. WebChromeClient callbacks run on the UI
  // thread, so this field is touched only on that thread.
  private PermissionRequest pendingWebViewMicRequest;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Initializes the Bridge
    this.init(savedInstanceState, new ArrayList<Class<? extends Plugin>>() {{
      // Additional plugins you've installed go here
      // Ex: add(TotallyAwesomePlugin.class);
    }});

    // WebView mic bridge.
    //
    // Capacitor's default WebChromeClient does not reliably grant the
    // WebView's RESOURCE_AUDIO_CAPTURE request, even when the host app has
    // RECORD_AUDIO at the OS level — which is why the Voice Assistant works
    // in mobile Chrome (Chrome owns its own permission flow) but fails
    // inside the installed app with "microphone access blocked".
    //
    // We extend BridgeWebChromeClient so all of Capacitor's other behaviour
    // (file picker, geolocation, console proxying, etc.) is preserved, and
    // intercept only the audio-capture branch:
    //   - If RECORD_AUDIO is already granted, grant the WebView immediately.
    //   - Otherwise, prompt the user with the standard Android dialog and
    //     forward grant/deny to the WebView from onRequestPermissionsResult.
    // Triggering the prompt on first WebView use (instead of on app launch)
    // also gives Android the trigger it needs to expose the Microphone
    // toggle under Settings → Apps → PodBrew → Permissions.
    this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        if (request == null) return;
        boolean wantsAudio = false;
        for (String r : request.getResources()) {
          if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
            wantsAudio = true;
            break;
          }
        }
        if (!wantsAudio) {
          // Defer everything else (file picker, video capture, geolocation,
          // midi, etc.) to Capacitor's default handling.
          super.onPermissionRequest(request);
          return;
        }

        // Origin-gate the mic. If the WebView ever loads a non-PodBrew origin
        // (redirect, misconfiguration, future change), refuse the mic
        // request rather than forwarding it to the OS.
        if (!isTrustedMicOrigin(request.getOrigin())) {
          request.deny();
          return;
        }

        if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) {
          request.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
          return;
        }

        // If a previous WebView request is still pending (e.g. the user
        // ignored the dialog and tapped the mic again), deny the older one
        // so the WebView promise resolves and we don't leak callbacks.
        if (pendingWebViewMicRequest != null) {
          try { pendingWebViewMicRequest.deny(); } catch (Throwable ignored) {}
        }
        pendingWebViewMicRequest = request;
        ActivityCompat.requestPermissions(
            MainActivity.this,
            new String[]{ Manifest.permission.RECORD_AUDIO },
            REQUEST_RECORD_AUDIO);
      }

      @Override
      public void onPermissionRequestCanceled(final PermissionRequest request) {
        // The WebView gave up on this request before we resolved it (page
        // navigated, frame destroyed, etc.). Drop our reference so the next
        // request starts fresh.
        if (pendingWebViewMicRequest == request) {
          pendingWebViewMicRequest = null;
        }
        super.onPermissionRequestCanceled(request);
      }
    });

    // Native bridge for the in-app permission-recovery UX.
    //
    // The WebView locks the loaded origin to https://podbrew.pro
    // (capacitor.config.ts → server.url, plus allowMixedContent=false), so
    // these methods are only reachable from PodBrew's own JS. They give the
    // web layer a reliable way to:
    //   - openAppSettings(): launch Settings → Apps → PodBrew → Permissions.
    //     The previous JS path used @capacitor/app's openUrl(), which
    //     doesn't exist on v7 and silently failed.
    //   - hasMicPermission(): read the OS-level RECORD_AUDIO grant directly,
    //     bypassing any stale per-origin state in the WebView's JS
    //     Permissions API after a denial.
    this.bridge.getWebView().addJavascriptInterface(
        new NativeBridge(this), "PodBrewNative");
  }

  // Bridge object exposed to the WebView as `window.PodBrewNative`. Methods
  // annotated with @JavascriptInterface are callable from JS.
  //
  // IMPORTANT: @JavascriptInterface methods run on a binder thread, NOT the
  // UI thread. Anything that touches the activity's view hierarchy or starts
  // a new Activity must be posted back to the UI thread.
  public static class NativeBridge {
    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
      this.activity = activity;
    }

    /**
     * Synchronously verifies the WebView's currently loaded main-frame origin
     * is on TRUSTED_MIC_ORIGINS. Returns false on any failure (no WebView,
     * unreadable URL, parse failure, untrusted host) so the bridge fails
     * closed. Both bridge methods consult this so a future navigation-
     * allowlist regression can't quietly expose them.
     */
    private boolean isCurrentOriginTrusted() {
      try {
        // Bridge.getWebView() must be touched on the UI thread on some
        // builds; reading the URL field is safe but defer any view mutation
        // to the caller's UI-thread block.
        final java.util.concurrent.atomic.AtomicReference<String> urlRef =
            new java.util.concurrent.atomic.AtomicReference<>(null);
        final java.util.concurrent.CountDownLatch latch =
            new java.util.concurrent.CountDownLatch(1);
        activity.runOnUiThread(() -> {
          try {
            android.webkit.WebView wv = activity.bridge.getWebView();
            if (wv != null) urlRef.set(wv.getUrl());
          } catch (Throwable ignored) {}
          latch.countDown();
        });
        // Tight bound so a stuck UI thread can't hang the binder thread.
        if (!latch.await(250, java.util.concurrent.TimeUnit.MILLISECONDS)) return false;
        String url = urlRef.get();
        if (url == null) return false;
        Uri parsed = Uri.parse(url);
        String scheme = parsed.getScheme();
        String host = parsed.getHost();
        if (scheme == null || host == null) return false;
        return isTrustedMicOrigin(Uri.parse(scheme + "://" + host));
      } catch (Throwable t) {
        return false;
      }
    }

    @JavascriptInterface
    public boolean hasMicPermission() {
      // Fail-closed origin gate parity with openAppSettings(): only a trusted
      // PodBrew origin may probe the system mic-permission state through this
      // bridge. The exposed datum (a single boolean) is low-sensitivity, but
      // gating it keeps the bridge surface uniformly safe.
      if (!isCurrentOriginTrusted()) return false;
      return ContextCompat.checkSelfPermission(
          activity, Manifest.permission.RECORD_AUDIO)
          == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void openAppSettings() {
      // Origin-check on the binder thread so we don't even hop to the UI
      // thread on an untrusted page.
      if (!isCurrentOriginTrusted()) return;
      activity.runOnUiThread(() -> {

        try {
          Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
          intent.setData(Uri.fromParts("package", activity.getPackageName(), null));
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          activity.startActivity(intent);
        } catch (Throwable t) {
          // Some OEM builds restrict this intent. Fall back to the generic
          // settings panel so the user at least lands somewhere actionable.
          try {
            Intent fallback = new Intent(Settings.ACTION_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(fallback);
          } catch (Throwable ignored) {}
        }
      });
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != REQUEST_RECORD_AUDIO) return;
    PermissionRequest pending = pendingWebViewMicRequest;
    if (pending == null) return;
    pendingWebViewMicRequest = null;
    boolean granted = grantResults.length > 0
        && grantResults[0] == PackageManager.PERMISSION_GRANTED;
    try {
      if (granted) {
        pending.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
      } else {
        pending.deny();
      }
    } catch (Throwable ignored) {
      // The WebView could be torn down between the dialog appearing and
      // the user responding (process backgrounded then killed). Nothing
      // else to do — the next mic tap will request again.
    }
  }
}
