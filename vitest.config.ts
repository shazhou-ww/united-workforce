import { defineConfig } from "vitest/config";

/**
 * Repo-root Vitest config.
 *
 * `proman test` runs `pnpm exec vitest run` from the repo root, which
 * discovers test files via Vitest's default glob. Without an explicit
 * `exclude`, vitest walks every directory under the repo root including
 * `legacy-packages/` — Phase 4 cleanup (#381) archived three adapter
 * packages there, outside the pnpm workspace, and their tsconfig
 * `extends` chains no longer resolve.
 *
 * Use the default `include` so per-package tests under `packages/<pkg>/__tests__/`
 * and `packages/<pkg>/src/__tests__/` continue to be discovered, but extend
 * `exclude` with `legacy-packages/**` so archived tests are skipped.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "legacy-packages/**",
    ],
  },
});
