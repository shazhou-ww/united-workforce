import { unlinkSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPidAlive } from "../background/index.js";
import type { AcquireSlotOptions, SlotHandle } from "./types.js";

/** Default concurrency limit when no config or flag is provided. */
export const DEFAULT_MAX_RUNNING = 2;

/** Default poll interval (ms) for waiting on a slot. */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Get the path to the slots directory.
 */
export function getSlotsDir(storageRoot: string): string {
  return join(storageRoot, "slots");
}

/**
 * Count active slot files (alive PIDs only). Cleans stale slots as a side-effect.
 */
export async function countActiveSlots(storageRoot: string): Promise<number> {
  const slotsDir = getSlotsDir(storageRoot);
  let files: string[];
  try {
    files = await readdir(slotsDir);
  } catch {
    return 0;
  }

  let count = 0;
  for (const file of files) {
    if (!file.endsWith(".slot")) {
      continue;
    }
    const pidStr = file.slice(0, -5);
    const pid = Number(pidStr);
    if (Number.isNaN(pid)) {
      continue;
    }
    if (isPidAlive(pid)) {
      count++;
    }
  }
  return count;
}

/**
 * Remove slot files whose PIDs are no longer alive.
 * Returns the number of stale slots cleaned.
 */
export async function cleanStaleSlots(storageRoot: string): Promise<number> {
  const slotsDir = getSlotsDir(storageRoot);
  let files: string[];
  try {
    files = await readdir(slotsDir);
  } catch {
    return 0;
  }

  let cleaned = 0;
  for (const file of files) {
    if (!file.endsWith(".slot")) {
      continue;
    }
    const pidStr = file.slice(0, -5);
    const pid = Number(pidStr);
    if (Number.isNaN(pid)) {
      continue;
    }
    if (!isPidAlive(pid)) {
      try {
        await rm(join(slotsDir, file), { force: true });
        cleaned++;
      } catch {
        // Ignore removal errors (race with another cleanup)
      }
    }
  }
  return cleaned;
}

/**
 * Create a slot file for the current process. Returns the path to the created file.
 */
async function writeSlotFile(storageRoot: string): Promise<string> {
  const slotsDir = getSlotsDir(storageRoot);
  await mkdir(slotsDir, { recursive: true });
  const slotPath = join(slotsDir, `${process.pid}.slot`);
  await writeFile(slotPath, "", "utf8");
  return slotPath;
}

/**
 * Remove a slot file. Idempotent — silently ignores missing file.
 */
async function removeSlotFile(slotPath: string): Promise<void> {
  try {
    await rm(slotPath, { force: true });
  } catch {
    // Already removed or race condition — safe to ignore
  }
}

function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal !== null) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Try to claim a slot. Returns the slot path on success, null if a race was
 * detected (post-write count exceeds maxRunning → rolls back).
 */
async function tryClaimSlot(storageRoot: string, maxRunning: number): Promise<string | null> {
  const slotPath = await writeSlotFile(storageRoot);
  const postWriteCount = await countActiveSlots(storageRoot);
  if (postWriteCount > maxRunning) {
    await removeSlotFile(slotPath);
    return null;
  }
  return slotPath;
}

function createSlotHandle(slotPath: string): SlotHandle {
  let released = false;
  return {
    slotPath,
    release: async () => {
      if (released) return;
      released = true;
      await removeSlotFile(slotPath);
    },
  };
}

type ResolvedOptions = {
  onWaiting: ((info: string) => void) | null;
  onAcquired: (() => void) | null;
  pollIntervalMs: number;
  signal: AbortSignal | null;
};

function resolveOptions(options: Partial<AcquireSlotOptions>): ResolvedOptions {
  return {
    onWaiting: options.onWaiting ?? null,
    onAcquired: options.onAcquired ?? null,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    signal: options.signal ?? null,
  };
}

function notifyWaiting(opts: ResolvedOptions, waited: boolean, message: string): boolean {
  if (!waited && opts.onWaiting !== null) {
    opts.onWaiting(message);
    return true;
  }
  return waited;
}

/**
 * Acquire a concurrency slot. If all slots are occupied, polls until one is available.
 *
 * Race protection: after writing the slot file, double-checks countActiveSlots.
 * If the count exceeds maxRunning, rolls back (removes own slot) and retries.
 */
export async function acquireSlot(
  storageRoot: string,
  maxRunning: number,
  options: Partial<AcquireSlotOptions> = {},
): Promise<SlotHandle> {
  const opts = resolveOptions(options);
  let waited = false;

  while (true) {
    await cleanStaleSlots(storageRoot);

    const currentCount = await countActiveSlots(storageRoot);
    if (currentCount >= maxRunning) {
      waited = notifyWaiting(opts, waited, `${currentCount}/${maxRunning} running`);
      await sleep(opts.pollIntervalMs, opts.signal);
      continue;
    }

    const slotPath = await tryClaimSlot(storageRoot, maxRunning);
    if (slotPath === null) {
      waited = notifyWaiting(opts, waited, `race detected, retrying`);
      await sleep(opts.pollIntervalMs, opts.signal);
      continue;
    }

    if (waited && opts.onAcquired !== null) {
      opts.onAcquired();
    }
    return createSlotHandle(slotPath);
  }
}

/**
 * Alias for SlotHandle.release() — explicit function form for callers that
 * prefer passing the handle as an argument.
 */
export async function releaseSlot(handle: SlotHandle): Promise<void> {
  await handle.release();
}

/**
 * Install process signal handlers that release the slot on SIGINT/SIGTERM.
 * Returns a cleanup function that removes the handlers (call on normal exit).
 */
export function installSlotCleanup(handle: SlotHandle): () => void {
  const cleanup = () => {
    try {
      unlinkSync(handle.slotPath);
    } catch {
      // Already removed
    }
  };

  const onSignal = () => {
    cleanup();
    process.exit(1);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // Return a function to uninstall the handlers
  return () => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };
}
