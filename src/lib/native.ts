import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "./supabase";

type CapacitorGlobal = { isNativePlatform?: () => boolean };
const notifiedOtpIds = new Set<string>();
let currentPushToken: string | null = null;
let automaticAndroidPromptAttempted = false;
let androidPermissionRequest: Promise<boolean> | null = null;
let androidRegistrationRequest: Promise<void> | null = null;
let androidRegistrationAttempted = false;

const androidPromptStorageKey = "monten.android-notification-permission-requested";

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
function hasAndroidPromptBeenAttempted(): boolean {
  if (automaticAndroidPromptAttempted) return true;
  try {
    automaticAndroidPromptAttempted = window.localStorage.getItem(androidPromptStorageKey) === "true";
  } catch (error) {
    console.warn("[push] Could not read notification permission preference.", error);
  }
  return automaticAndroidPromptAttempted;
}

function markAndroidPromptAttempted(): void {
  automaticAndroidPromptAttempted = true;
  try {
    window.localStorage.setItem(androidPromptStorageKey, "true");
  } catch (error) {
    console.warn("[push] Could not persist notification permission preference.", error);
  }
}

async function registerAndroidPush(): Promise<void> {
  if (!import.meta.env.VITE_FCM_CONFIGURED) {
    console.warn("[push] Firebase Android configuration is missing; device registration was skipped.");
    return;
  }
  if (androidRegistrationAttempted) return;
  if (androidRegistrationRequest) return androidRegistrationRequest;

  androidRegistrationAttempted = true;
  androidRegistrationRequest = (async () => {
    await PushNotifications.createChannel({
      id: "monten_updates",
      name: "MONTEN SMS updates",
      description: "Wallet, purchase, security and service notifications",
      importance: 3,
      visibility: 0,
    });
    await PushNotifications.register();
  })()
    .catch((error: unknown) => {
      androidRegistrationAttempted = false;
      throw error;
    })
    .finally(() => {
      androidRegistrationRequest = null;
    });
  return androidRegistrationRequest;
}

export function resetAndroidPushRegistration(): void {
  androidRegistrationAttempted = false;
}

export async function requestPushPermission(options: { automatic?: boolean } = {}): Promise<boolean> {
  if (!isNativeApp()) {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  }

  try {
    if (Capacitor.getPlatform() === "android") {
      const permission = await PushNotifications.checkPermissions();
      let granted = permission.receive === "granted";

      if (!granted) {
        const canRequest = permission.receive === "prompt" || permission.receive === "prompt-with-rationale";
        if (!canRequest || (options.automatic && hasAndroidPromptBeenAttempted())) return false;
        if (options.automatic) markAndroidPromptAttempted();

        if (!androidPermissionRequest) {
          androidPermissionRequest = PushNotifications.requestPermissions()
            .then((result) => result.receive === "granted")
            .finally(() => {
              androidPermissionRequest = null;
            });
        }
        granted = await androidPermissionRequest;
      }

      if (!granted) return false;
      try {
        await registerAndroidPush();
      } catch (error) {
        console.error("[push] Device registration failed; the app will continue without push registration.", error);
      }
      return granted;
    }

    await LocalNotifications.requestPermissions();
    const status = await LocalNotifications.checkPermissions();
    return status.display === "granted";
  } catch (error) {
    console.error("[push] Could not request notification permission.", error);
    return false;
  }
}

// The body deliberately omits the code so it is not shown on a locked screen.
export async function notifyOtpReceived(otpId?: string): Promise<void> {
  if (!isNativeApp()) {
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
