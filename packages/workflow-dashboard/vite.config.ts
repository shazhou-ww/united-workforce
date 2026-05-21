import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { elysiaPlugin } from "./vite-dev.ts";

// biome-ignore lint/style/noDefaultExport: Vite loads config from default export.
export default defineConfig({
  plugins: [react(), tailwindcss(), elysiaPlugin()],
  root: ".",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
  },
});
