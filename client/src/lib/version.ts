export const APP_VERSION = "1.3.0";
export const BUILD_DATE = "2026-02-12 12:29 UTC";
export const BUILD_ID = "20260212-1229";

export function getVersionString(): string {
  return `v${APP_VERSION} (Build: ${BUILD_DATE})`;
}
