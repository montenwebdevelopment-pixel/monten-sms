import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";

type CapacitorGlobal = { isNativePlatform?: () => boolean };
const notifiedOtpIds = new Set<string>();

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform() || Boolean((window as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.());
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (isNativeApp()) {
      await Clipboard.write({ string: text });
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// On iOS, remote push needs an Apple Developer account with APNs configured,
// so the shells fall back to scheduled local notifications for OTP alerts.
export async function requestPushPermission(): Promise<boolean> {
  if (!isNativeApp()) {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  }

  try {
    await LocalNotifications.requestPermissions();
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted") return false;

    if (Capacitor.getPlatform() === "android") {
      await PushNotifications.register();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        PushNotifications.addListener("registration", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      PushNotifications.removeAllListeners();
    }
    return true;
  } catch {
    return false;
  }
}

// The body deliberately omits the code so it is not shown on a locked screen.
export async function notifyOtpReceived(otpId?: string): Promise<void> {
  if (otpId && notifiedOtpIds.has(otpId)) return;
  if (otpId) {
    notifiedOtpIds.add(otpId);
    if (notifiedOtpIds.size > 100) {
      const oldest = notifiedOtpIds.values().next().value;
      if (oldest) notifiedOtpIds.delete(oldest);
    }
  }

  if (!isNativeApp()) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("MONTEN SMS", { body: "Your verification code is ready. Open the app to view it." });
    return;
  }

  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now() % 2147483647,
          title: "MONTEN SMS",
          body: "Your verification code is ready. Open the app to view it.",
          schedule: { at: new Date(Date.now() + 1000) },
        },
      ],
    });
  } catch {
    // Notification failures must never break the OTP flow.
  }
}
