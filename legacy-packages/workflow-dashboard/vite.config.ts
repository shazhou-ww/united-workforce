import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteLimitLinePlugin } from "./plugins/vite-limit-line-plugin.js";

// biome-ignore lint/style/noDefaultExport: Vite loads config from default export.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...viteLimitLinePlugin({ maxReactFCLines: 300, maxFileLines: 600 }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7860",
        changeOrigin: true,
      },
    },
  },
});
