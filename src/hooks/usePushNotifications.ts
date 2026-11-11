import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { useAuth } from "../context/AuthContext";
import { registerPushDevice, setCurrentPushToken } from "../lib/native";

const notificationRoutes = new Set([
  "/dashboard/dashboard",
  "/dashboard/buy-numbers",
  "/dashboard/email-otp",
  "/dashboard/fund-wallet",
  "/dashboard/transactions",
  "/dashboard/purchased-numbers",
  "/dashboard/notifications",
  "/dashboard/account-settings",
]);

export function usePushNotifications() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const tokenRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(session?.user.id ?? null);
  const registeredRef = useRef("");

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    const registration = PushNotifications.addListener("registration", (token: Token) => {
      tokenRef.current = token.value;
      setCurrentPushToken(token.value);
      const userId = userIdRef.current;
      if (!userId || registeredRef.current === `${userId}:${token.value}`) return;

      void registerPushDevice(token.value)
        .then(() => { registeredRef.current = `${userId}:${token.value}`; })
        .catch((error: unknown) => console.error("[push] Device registration failed.", error));
    });
    const registrationError = PushNotifications.addListener("registrationError", (error) => {
      console.error("[push] FCM registration failed.", error);
    });
    const action = PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const route = String(notification.data?.route ?? "");
      navigate(notificationRoutes.has(route) ? route : "/dashboard/notifications");
    });

    const listenerHandles = Promise.all([registration, registrationError, action]);
    void PushNotifications.checkPermissions()
      .then((permission) => {
        if (permission.receive !== "granted") return undefined;
        return PushNotifications.createChannel({
          id: "monten_updates",
          name: "MONTEN SMS updates",
          description: "Wallet, purchase, security and service notifications",
          importance: 3,
          visibility: 0,
        }).then(() => PushNotifications.register());
      })
      .catch((error: unknown) => console.error("[push] Could not initialize FCM.", error));

    return () => {
      void listenerHandles.then((handles) => Promise.all(handles.map((handle) => handle.remove())));
    };
  }, [navigate]);

  useEffect(() => {
    userIdRef.current = session?.user.id ?? null;
    if (!session?.user.id) {
      registeredRef.current = "";
      return;
    }
    if (!tokenRef.current) return;

    const key = `${session.user.id}:${tokenRef.current}`;
    if (registeredRef.current === key) return;
    void registerPushDevice(tokenRef.current)
      .then(() => { registeredRef.current = key; })
      .catch((error: unknown) => console.error("[push] Device registration failed.", error));
  }, [session?.user.id]);
}
