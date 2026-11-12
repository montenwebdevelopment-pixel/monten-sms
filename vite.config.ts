import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type FirebaseAndroidConfig = {
  project_info?: {
    project_id?: string;
    project_number?: string;
  };
  client?: Array<{
    client_info?: {
      mobilesdk_app_id?: string;
      android_client_info?: {
        package_name?: string;
      };
    };
    api_key?: Array<{ current_key?: string }>;
  }>;
};

function hasAndroidFirebaseConfig(): boolean {
  const configPath = resolve(process.cwd(), "android", "app", "google-services.json");
  if (!existsSync(configPath)) return false;

  let config: FirebaseAndroidConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as FirebaseAndroidConfig;
  } catch {
    throw new Error("android/app/google-services.json must contain valid Firebase Android configuration.");
  }

  const client = config.client?.find(
    (candidate) => candidate.client_info?.android_client_info?.package_name === "com.montensms.app",
  );
  if (
    !config.project_info?.project_id ||
    !config.project_info.project_number ||
    !client?.client_info?.mobilesdk_app_id ||
    !client.api_key?.some((key) => key.current_key)
  ) {
    throw new Error("Firebase Android configuration must include a complete client for com.montensms.app.");
  }

  return true;
}

export default defineConfig(({ command, mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ""),
    ...process.env,
  };

  if (command === "build" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required to build the app.");
  }

  return {
    base: "./",
    plugins: [react()],
    define: {
      "import.meta.env.VITE_FCM_CONFIGURED": JSON.stringify(hasAndroidFirebaseConfig()),
    },
  };
});
