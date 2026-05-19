import { describe, expect, test } from "bun:test";

import { spawnCli } from "../src/index.js";

const noTimeout = { cwd: null, timeoutMs: null } as const;

describe("spawnCli", () => {
  test("resolves ok stdout on zero exit", async () => {
    const run = await spawnCli("echo", ["spawn-cli-ok"], { ...noTimeout });
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.trim()).toBe("spawn-cli-ok");
    }
  });

  test("resolves err on non-zero exit", async () => {
    const run = await spawnCli("false", [], { ...noTimeout });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error.kind).toBe("non_zero_exit");
    }
  });

  test("resolves err on timeout", async () => {
    const run = await spawnCli("sleep", ["10"], { cwd: null, timeoutMs: 80 });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error.kind).toBe("timeout");
    }
  });

  test("resolves err when spawn fails", async () => {
    const run = await spawnCli("definitely-missing-executable-7f2a9c1b", [], { ...noTimeout });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error.kind).toBe("spawn_failed");
    }
  });
});
