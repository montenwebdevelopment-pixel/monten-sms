import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "./supabase";

type CapacitorGlobal = { isNativePlatform?: () => boolean };
const notifiedOtpIds = new Set<string>();
let currentPushToken: string | null = null;

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

export async function requestPushPermission(): Promise<boolean> {
  if (!isNativeApp()) {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  }

  try {
    if (Capacitor.getPlatform() === "android") {
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive !== "granted") {
        permission = await PushNotifications.requestPermissions();
      }
      if (permission.receive !== "granted") return false;
      await PushNotifications.register();
      return true;
    }

    await LocalNotifications.requestPermissions();
    const status = await LocalNotifications.checkPermissions();
    return status.display === "granted";
  } catch {
    return false;
  }
}

export async function notifyOtpReceived(otpId?: string): Promise<void> {
  if (isNativeApp()) return;
  if (otpId && notifiedOtpIds.has(otpId)) return;
  if (otpId) {
    notifiedOtpIds.add(otpId);
    if (notifiedOtpIds.size > 100) {
      const oldest = notifiedOtpIds.values().next().value;
      if (oldest) notifiedOtpIds.delete(oldest);
    }
  }

  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("MONTEN SMS", { body: "Your verification code is ready. Open the app to view it." });
}

export async function registerPushDevice(token: string): Promise<void> {
  const { error } = await supabase.functions.invoke("push-device", {
    body: { action: "register", token },
  });
  if (error) throw error;
}

export async function unregisterPushDevice(token: string): Promise<void> {
  const { error } = await supabase.functions.invoke("push-device", {
    body: { action: "unregister", token },
  });
  if (error) throw error;
}

export function setCurrentPushToken(token: string): void {
  currentPushToken = token;
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  if (!currentPushToken) return;
  const { error } = await supabase.functions.invoke("push-device", {
    body: { action: "unregister", token: currentPushToken },
  });
  if (error) throw error;
}

export async function recordSecurityEvent(event: "login" | "password_changed"): Promise<void> {
  const { error } = await supabase.functions.invoke("push-device", {
    body: { action: "security_event", event },
  });
  if (error) throw error;
}
