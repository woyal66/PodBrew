/**
 * Back-compat shim. The bridge moved to `./nativeBridge` when iOS support was
 * added (Task #122). New code should import from `@/lib/nativeBridge` directly.
 */
export {
  isNativeAndroid,
  isNativeIOS,
  isNativeMobile,
  hasNativeBridge,
  nativeHasMicPermission,
  openNativeAppSettings,
  openAndroidAppSettings,
} from "./nativeBridge";
