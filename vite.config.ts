import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
      "import.meta.env.VITE_FCM_CONFIGURED": JSON.stringify(
        existsSync(resolve(process.cwd(), "android", "app", "google-services.json")),
      ),
    },
  };
});
