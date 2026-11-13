import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const adminRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(adminRoot, "..");

export default defineConfig(({ command, mode }) => {
  const env = {
    ...loadEnv(mode, projectRoot, ""),
    ...process.env,
  };
  const standalone = mode === "standalone";

  if (command === "build" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required to build the admin dashboard.");
  }

  return {
    root: adminRoot,
    envDir: projectRoot,
    base: "/admin/monten500/",
    plugins: [react()],
    build: {
      outDir: standalone ? resolve(projectRoot, "dist-admin") : resolve(projectRoot, "dist/admin/monten500"),
      emptyOutDir: true,
    },
  };
});
