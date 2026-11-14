import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isNativePlatform = Capacitor.isNativePlatform();
const secureStorageReady = isNativePlatform
  ? SecureStorage.setKeyPrefix("monten-sms-admin-auth")
  : Promise.resolve();

const nativeAuthStorage = isNativePlatform
  ? {
      async getItem(key: string): Promise<string | null> {
        await secureStorageReady;
        return SecureStorage.getItem(key);
      },
      async setItem(key: string, value: string): Promise<void> {
        await secureStorageReady;
        await SecureStorage.setItem(key, value);
      },
      async removeItem(key: string): Promise<void> {
        await secureStorageReady;
        await SecureStorage.removeItem(key);
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
