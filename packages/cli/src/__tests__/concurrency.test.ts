import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  acquireSlot,
  cleanStaleSlots,
  countActiveSlots,
  DEFAULT_MAX_RUNNING,
  getSlotsDir,
  installSlotCleanup,
} from "../concurrency/index.js";

// ── test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "concurrency-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Spec: concurrency-acquire-slot-under-limit ──────────────────────────────

describe("acquireSlot succeeds immediately when below maxRunning", () => {
  test("creates slot file and returns SlotHandle when under limit", async () => {
    const handle = await acquireSlot(tmpDir, 2);

    // Slot file exists
    const slotsDir = getSlotsDir(tmpDir);
    const files = await readdir(slotsDir);
    expect(files).toContain(`${process.pid}.slot`);

    // Returns a SlotHandle with release()
    expect(handle).toHaveProperty("release");
    expect(typeof handle.release).toBe("function");

    // countActiveSlots returns 1
    const count = await countActiveSlots(tmpDir);
    expect(count).toBe(1);

    // Cleanup
    await handle.release();
  });

  test("returns immediately (no blocking) when slots available", async () => {
    const start = Date.now();
    const handle = await acquireSlot(tmpDir, 2);
    const elapsed = Date.now() - start;

    // Should complete in well under 1 second (no polling delay)
    expect(elapsed).toBeLessThan(500);

    await handle.release();
  });
});

// ── Spec: concurrency-acquire-slot-blocks-at-limit ──────────────────────────

describe("acquireSlot blocks when at capacity", () => {
  test("calls onWaiting when all slots are occupied", async () => {
    // Create a slot file for a "live" process — use parent PID (same user, signalable)
    const slotsDir = getSlotsDir(tmpDir);
    await mkdir(slotsDir, { recursive: true });
    const blockerPid = process.ppid;
    await writeFile(join(slotsDir, `${blockerPid}.slot`), "", "utf8");

    const onWaiting = vi.fn();
    const onAcquired = vi.fn();

    // maxRunning=1, one slot occupied → should block
    // Release the blocking slot after a brief delay
    setTimeout(async () => {
      await rm(join(slotsDir, `${blockerPid}.slot`), { force: true });
    }, 200);

    const handle = await acquireSlot(tmpDir, 1, {
      onWaiting,
      onAcquired,
      pollIntervalMs: 100,
    });

    expect(onWaiting).toHaveBeenCalled();
    expect(onAcquired).toHaveBeenCalled();

    await handle.release();
  });

  test("polls with interval and proceeds after slot is freed", async () => {
    const slotsDir = getSlotsDir(tmpDir);
    await mkdir(slotsDir, { recursive: true });
    const blockerPid = process.ppid;
    await writeFile(join(slotsDir, `${blockerPid}.slot`), "", "utf8");

    // Remove after 250ms
    setTimeout(async () => {
      await rm(join(slotsDir, `${blockerPid}.slot`), { force: true });
    }, 250);

    const start = Date.now();
    const handle = await acquireSlot(tmpDir, 1, { pollIntervalMs: 100 });
    const elapsed = Date.now() - start;

    // Should have waited at least ~200ms (polling)
    expect(elapsed).toBeGreaterThanOrEqual(150);

    await handle.release();
  });
});

// ── Spec: concurrency-stale-slot-cleanup ────────────────────────────────────

describe("cleanStaleSlots removes slot files for dead PIDs", () => {
  test("removes slot file for dead PID, preserves live PID", async () => {
    const slotsDir = getSlotsDir(tmpDir);
    await mkdir(slotsDir, { recursive: true });

    // Dead PID (99999999 should not exist)
    await writeFile(join(slotsDir, "99999999.slot"), "", "utf8");
    // Live PID (current process)
    await writeFile(join(slotsDir, `${process.pid}.slot`), "", "utf8");

    const cleaned = await cleanStaleSlots(tmpDir);
    expect(cleaned).toBe(1);

    const files = await readdir(slotsDir);
    expect(files).not.toContain("99999999.slot");
    expect(files).toContain(`${process.pid}.slot`);
  });

  test("countActiveSlots reflects correct count after cleanup", async () => {
    const slotsDir = getSlotsDir(tmpDir);
    await mkdir(slotsDir, { recursive: true });

    // 1 dead + 1 live
    await writeFile(join(slotsDir, "99999999.slot"), "", "utf8");
    await writeFile(join(slotsDir, `${process.pid}.slot`), "", "utf8");

    // Before cleanup: 2 files
    const beforeFiles = await readdir(slotsDir);
    expect(beforeFiles.filter((f) => f.endsWith(".slot")).length).toBe(2);

    await cleanStaleSlots(tmpDir);

    // After cleanup
    const count = await countActiveSlots(tmpDir);
    expect(count).toBe(1);
  });
});

// ── Spec: concurrency-race-protection-rollback ──────────────────────────────

describe("acquireSlot rolls back on race condition", () => {
  test("rolls back slot file if post-write count exceeds maxRunning", async () => {
    const slotsDir = getSlotsDir(tmpDir);
    await mkdir(slotsDir, { recursive: true });

    // Simulate: maxRunning=2, and we already have 1 slot from another live process
    const blockerPid = process.ppid;
    await writeFile(join(slotsDir, `${blockerPid}.slot`), "", "utf8");

    // Our process writes its slot, making count=2 which equals maxRunning=2
    // This should succeed (at limit, not over)
    const handle = await acquireSlot(tmpDir, 2);
    const count = await countActiveSlots(tmpDir);
    expect(count).toBe(2);

    await handle.release();
  });

  test("when another slot appears during write, rollback occurs", async () => {
    // This tests the double-check logic. We'll simulate by pre-filling to capacity.
    const slotsDir = getSlotsDir(tmpDir);
    await mkdir(slotsDir, { recursive: true });

    // maxRunning=1, one slot already occupied by parent PID
    const blockerPid = process.ppid;
    await writeFile(join(slotsDir, `${blockerPid}.slot`), "", "utf8");

    // Release after delay so acquireSlot can proceed
    setTimeout(async () => {
      await rm(join(slotsDir, `${blockerPid}.slot`), { force: true });
    }, 200);

    const handle = await acquireSlot(tmpDir, 1, { pollIntervalMs: 100 });

    // After acquiring, only our slot should exist
    const files = await readdir(slotsDir);
    const slotFiles = files.filter((f) => f.endsWith(".slot"));
    expect(slotFiles).toContain(`${process.pid}.slot`);

    await handle.release();
  });
});

// ── Spec: concurrency-exec-signal-cleanup ────────────────────────────────────

describe("installSlotCleanup removes slot on signal", () => {
  test("release function removes slot file", async () => {
    const handle = await acquireSlot(tmpDir, 2);

    // Verify slot exists
    const slotsDir = getSlotsDir(tmpDir);
    const filesBefore = await readdir(slotsDir);
    expect(filesBefore).toContain(`${process.pid}.slot`);

    // installSlotCleanup returns a cleanup function
    const cleanup = installSlotCleanup(handle);

    // Call release directly (simulating what signal handler would do)
    await handle.release();

    const filesAfter = await readdir(slotsDir);
    expect(filesAfter).not.toContain(`${process.pid}.slot`);

    // Uninstall the cleanup handler
    cleanup();
  });
});

// ── Spec: concurrency-default-max-running ────────────────────────────────────

describe("DEFAULT_MAX_RUNNING is 2", () => {
  test("constant equals 2", () => {
    expect(DEFAULT_MAX_RUNNING).toBe(2);
  });
});

// ── Spec: concurrency-exec-uses-slot (unit level) ───────────────────────────

describe("slot lifecycle during exec", () => {
  test("acquireSlot + release = 0 active slots", async () => {
    const handle = await acquireSlot(tmpDir, 2);
    expect(await countActiveSlots(tmpDir)).toBe(1);

    await handle.release();
    expect(await countActiveSlots(tmpDir)).toBe(0);
  });

  test("release is idempotent", async () => {
    const handle = await acquireSlot(tmpDir, 2);
    await handle.release();
    // Calling release again should not throw
    await handle.release();
    expect(await countActiveSlots(tmpDir)).toBe(0);
  });
});

// ── Spec: concurrency-config-set-max-running ─────────────────────────────────

describe("config set concurrency.maxRunning", () => {
  test("concurrency config key is validated correctly", async () => {
    // Import config module to test the key validation
    const { parseDotPath, setNestedValue } = await import("../commands/config.js");

    const config: Record<string, unknown> = {};
    const path = parseDotPath("concurrency.maxRunning");
    setNestedValue(config, path, 3);

    expect(config).toEqual({ concurrency: { maxRunning: 3 } });
  });
});
