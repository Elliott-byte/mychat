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
    // Used only by `npm run dev:ui` for hot reload: proxy /api to the local wrangler
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
