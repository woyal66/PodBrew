import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.podbrew.app',
  appName: 'PodBrew',
  webDir: 'dist/public',
  server: {
    url: 'https://podbrew.pro',
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000000',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#000000',
      overlaysWebView: false
    },
    Haptics: {
      selectionDuration: 30
    },
    SocialLogin: {
      google: {
        webClientId: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com',
        // iosClientId: obtain from Google Cloud Console → iOS OAuth 2.0 client for com.podbrew.app
        // Format: XXXXXXXXXX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
        iosClientId: process.env.GOOGLE_IOS_CLIENT_ID || 'YOUR_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com',
      }
    }
  },
  ios: {
    backgroundColor: '#000000',
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    limitsNavigationsToAppBoundDomains: true,
    allowsLinkPreview: false,
    scheme: 'podbrew'
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
