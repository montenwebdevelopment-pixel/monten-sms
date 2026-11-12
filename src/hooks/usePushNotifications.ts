import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { useAuth } from "../context/AuthContext";
import { registerPushDevice, requestPushPermission, resetAndroidPushRegistration, setCurrentPushToken } from "../lib/native";

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
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const tokenRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(session?.user.id ?? null);
  const registeredRef = useRef("");
  const registeringRef = useRef("");
  const listenersReadyRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    const registration = PushNotifications.addListener("registration", (token: Token) => {
      tokenRef.current = token.value;
      setCurrentPushToken(token.value);
      const userId = userIdRef.current;
      if (!userId) return;

      const key = `${userId}:${token.value}`;
      if (registeredRef.current === key || registeringRef.current === key) return;
      registeringRef.current = key;
      void registerPushDevice(token.value)
        .then(() => { registeredRef.current = key; })
        .catch((error: unknown) => console.error("[push] Device registration failed.", error))
        .finally(() => {
          if (registeringRef.current === key) registeringRef.current = "";
        });
    });
    const registrationError = PushNotifications.addListener("registrationError", (error) => {
      resetAndroidPushRegistration();
      console.error("[push] FCM registration failed.", error);
    });
    const action = PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const route = String(notification.data?.route ?? "");
      navigate(notificationRoutes.has(route) ? route : "/dashboard/notifications");
    });

    const listenerHandles = Promise.all([registration, registrationError, action]);
    listenersReadyRef.current = listenerHandles.then(() => undefined);

    return () => {
      listenersReadyRef.current = Promise.resolve();
      void listenerHandles
        .then((handles) => Promise.all(handles.map((handle) => handle.remove())))
        .catch((error: unknown) => console.error("[push] Could not remove notification listeners.", error));
    };
  }, [navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    userIdRef.current = session?.user.id ?? null;
    if (!session?.user.id) {
      registeredRef.current = "";
      registeringRef.current = "";
      return;
    }
    if (loading) return;

    let active = true;
    void (async () => {
      try {
        await listenersReadyRef.current;
        if (active) await requestPushPermission({ automatic: true });
      } catch (error) {
        console.error("[push] Could not initialize notifications; the app will continue.", error);
      }
    })();

    if (tokenRef.current) {
      const key = `${session.user.id}:${tokenRef.current}`;
      if (registeredRef.current !== key && registeringRef.current !== key) {
        registeringRef.current = key;
        void registerPushDevice(tokenRef.current)
          .then(() => {
            registeredRef.current = key;
          })
          .catch((error: unknown) => console.error("[push] Device registration failed.", error))
          .finally(() => {
            if (registeringRef.current === key) registeringRef.current = "";
          });
      }
    }

    return () => {
      active = false;
    };
  }, [loading, session?.user.id]);
}
