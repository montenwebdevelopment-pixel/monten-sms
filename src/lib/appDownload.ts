export type Platform = "android" | "ios" | "other";

export const APK_DOWNLOAD_URL =
  "https://egalqcwprmlyukzwnqyn.supabase.co/storage/v1/object/public/app-downloads/monten-sms.apk?download=monten-sms.apk";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ reports as Mac, but declares touch support.
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "other";
}

export async function handleAppDownload(): Promise<{ ok: boolean }> {
  const platform = detectPlatform();

  if (platform === "ios") return { ok: false };

  window.location.href = APK_DOWNLOAD_URL;
  return { ok: true };
}
