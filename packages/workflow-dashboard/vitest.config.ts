import path from "node:path";
import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest loads config from default export.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
