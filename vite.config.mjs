import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    // 构建产物给 wrangler 当静态资源用(见 wrangler.jsonc 的 assets.directory)
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // 只用于 `npm run dev:ui` 的热更新开发:把 /api 转发给本地 wrangler
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
