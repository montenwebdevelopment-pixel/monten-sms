import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SITE_URL = "https://montensms.com";

const isNativePlatform = Capacitor.isNativePlatform();
const secureStorageReady = isNativePlatform
  ? SecureStorage.setKeyPrefix("monten-sms-auth")
  : Promise.resolve();

const nativeAuthStorage = isNativePlatform
  ? {
      async getItem(key: string): Promise<string | null> {
        await secureStorageReady;
        const secureValue = await SecureStorage.getItem(key);
        if (secureValue !== null) {
          window.localStorage.removeItem(key);
          return secureValue;
        }

        const legacyValue = window.localStorage.getItem(key);
        if (legacyValue !== null) {
          await SecureStorage.setItem(key, legacyValue);
          window.localStorage.removeItem(key);
        }
        return legacyValue;
      },
      async setItem(key: string, value: string): Promise<void> {
        await secureStorageReady;
        await SecureStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      },
      async removeItem(key: string): Promise<void> {
        await secureStorageReady;
        await SecureStorage.removeItem(key);
        window.localStorage.removeItem(key);
      },
    }
  : undefined;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    ...(nativeAuthStorage ? { storage: nativeAuthStorage } : {}),
  },
});

export const EDGE_FUNCTION_BASE = `${supabaseUrl}/functions/v1`;

export type EmailFunctionResult = { ok: true } | { ok: false; status: number; error: string; code?: string };

export async function callEmailFunction(payload: Record<string, unknown>): Promise<EmailFunctionResult> {
  try {
    const res = await fetch(`${EDGE_FUNCTION_BASE}/send-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.success) return { ok: true };
    return {
      ok: false,
      status: res.status,
      error: typeof body?.error === "string" ? body.error : "Something went wrong. Please try again shortly.",
      code: typeof body?.code === "string" ? body.code : undefined,
    };
  } catch {
    return { ok: false, status: 0, error: "We couldn't reach the server. Check your connection and try again." };
  }
}
