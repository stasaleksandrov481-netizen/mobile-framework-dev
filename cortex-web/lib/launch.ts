// Site opening and Android beta publication are separate events.
// Server time is authoritative; neither date alone authorizes signup or an APK.
export const SITE_OPEN_AT = "2026-11-17T18:00:00+03:00";
export const SITE_OPEN_MS = Date.parse(SITE_OPEN_AT);
export const ANDROID_BETA_AT = "2026-11-20T00:00:00+03:00";
export const ANDROID_BETA_MS = Date.parse(ANDROID_BETA_AT);

export function siteOpeningStarted(now = Date.now()): boolean {
  return now >= SITE_OPEN_MS;
}

export function androidBetaStarted(now = Date.now()): boolean {
  return now >= ANDROID_BETA_MS;
}
