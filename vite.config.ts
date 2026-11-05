import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// Fontsource CSS lists a .woff fallback after each .woff2 source. The app only
// runs in WebKit, which always picks woff2, so drop the fallback to keep the
// bundled fonts from being emitted twice.
function fontsourceWoff2Only(): Plugin {
  return {
    name: "scholium-fontsource-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/@fontsource/") || !id.endsWith(".css")) return null;

      return {
        code: code.replace(/,\s*url\([^)]+\.woff\)\s*format\(["']woff["']\)/g, ""),
        map: null,
      };
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [fontsourceWoff2Only(), react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
