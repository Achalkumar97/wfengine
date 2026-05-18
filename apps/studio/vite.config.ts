import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type PluginOption } from "vite";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev proxy: Studio calls `/runs/*` relative to Vite; forwards to the wfengine API.
 * If you see `ECONNREFUSED 127.0.0.1:30001` while the API uses another PORT, set
 * `VITE_WFENGINE_DEV_API_PORT` to match `PORT`, or set `VITE_WFENGINE_API` — its port
 * is used as the proxy target when the explicit override is omitted.
 */
function resolveDevApiPort(env: Record<string, string>): string {
  const override = env.VITE_WFENGINE_DEV_API_PORT?.trim();
  if (override && /^\d+$/.test(override)) return override;
  const api = env.VITE_WFENGINE_API?.trim();
  if (api) {
    try {
      const u = new URL(api);
      if (u.port) return u.port;
      return u.protocol === "https:" ? "443" : "80";
    } catch {
      /* fall through */
    }
  }
  return "30001";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, thisDir, "");
  const port = resolveDevApiPort(env);
  const target = `http://127.0.0.1:${port}`;

  return {
    // Hoisted workspace `vite` vs `apps/studio/node_modules/vite` — duplicate types; runtime is fine.
    plugins: [tailwindcss(), react()].flat() as PluginOption[],
    server: {
      port: 5173,
      proxy: {
        "/runs": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
      },
    },
    preview: {
      allowedHosts: [".up.railway.app"],
    },
  };
});
