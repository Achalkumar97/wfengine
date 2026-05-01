import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";

/**
 * Plain object + `as UserConfig` avoids TS2769 when npm hoists one Vite major (e.g. for Vitest)
 * and `apps/studio` nests another — `Plugin` types from two installs are not assignable.
 */
export default {
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    /** Avoid CORS friction in dev: call `/runs/*` with `VITE_WFENGINE_API=""`. */
    proxy: {
      "/runs": {
        target: "http://localhost:30001",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:30001",
        changeOrigin: true,
      },
    },
  },
} as UserConfig;
