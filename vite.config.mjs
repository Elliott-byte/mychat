import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    // Output is served by wrangler as static assets (see assets.directory in wrangler.jsonc)
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // Used only by `npm run dev:ui` for hot reload: proxy /api to the local wrangler.
    // The Origin header must be rewritten to match the wrangler origin, or the
    // Worker's same-origin check rejects every state-changing request with 403.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        headers: { Origin: "http://127.0.0.1:8787" },
      },
    },
  },
});
