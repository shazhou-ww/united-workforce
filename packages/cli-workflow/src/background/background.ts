import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunningThreadItem, ThreadId } from "@uncaged/workflow-protocol";

import type { RunningMarker } from "./types.js";

/**
 * Get the path to the running markers directory.
 */
export function getRunningDir(storageRoot: string): string {
  return join(storageRoot, "running");
}

/**
 * Get the path to a specific thread's marker file.
 */
export function getMarkerPath(storageRoot: string, threadId: ThreadId): string {
  return join(getRunningDir(storageRoot), `${threadId}.json`);
}

/**
 * Check if a PID is still running.
 * Returns true if the process exists, false otherwise.
 */
export function isPidAlive(pid: number): boolean {
  try {
    // process.kill with signal 0 checks existence without killing
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH means process doesn't exist
    return false;
  }
}

/**
 * Create a marker file for a running thread.
 * Writes to a temp file in the same directory, then atomically renames.
 */
export async function createMarker(storageRoot: string, marker: RunningMarker): Promise<void> {
  const runningDir = getRunningDir(storageRoot);
  await mkdir(runningDir, { recursive: true });

  const markerPath = getMarkerPath(storageRoot, marker.thread);
  const tempPath = join(runningDir, `.${marker.thread}-${process.pid}.tmp`);

  const content = JSON.stringify(marker, null, 2);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, markerPath);
}

/**
 * Delete a marker file for a thread.
 */
export async function deleteMarker(storageRoot: string, threadId: ThreadId): Promise<void> {
  const markerPath = getMarkerPath(storageRoot, threadId);
  try {
    await rm(markerPath);
  } catch {
    // Ignore errors if file doesn't exist
  }
}

/**
 * Read a marker file. Returns null if file doesn't exist or is invalid.
 */
export async function readMarker(
  storageRoot: string,
  threadId: ThreadId,
): Promise<RunningMarker | null> {
  const markerPath = getMarkerPath(storageRoot, threadId);
  try {
    const content = await readFile(markerPath, "utf8");
    const marker = JSON.parse(content) as RunningMarker;
    return marker;
  } catch {
    return null;
  }
}

/**
 * List all running threads, filtering out stale markers.
 */
export async function listRunningThreads(storageRoot: string): Promise<RunningThreadItem[]> {
  const runningDir = getRunningDir(storageRoot);

  let files: string[];
  try {
    files = await readdir(runningDir);
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }

  const results: RunningThreadItem[] = [];

  for (const filename of files) {
    if (!filename.endsWith(".json")) {
      continue;
    }

    const threadId = filename.slice(0, -5) as ThreadId;
    const marker = await readMarker(storageRoot, threadId);

    if (marker === null) {
      // Invalid marker file
      continue;
    }

    if (!isPidAlive(marker.pid)) {
      // Stale marker - process no longer exists
      await deleteMarker(storageRoot, threadId);
      continue;
    }

    results.push({
      thread: marker.thread,
      workflow: marker.workflow,
      pid: marker.pid,
      startedAt: marker.startedAt,
    });
  }

  return results;
}

/**
 * Check if a thread is currently executing in the background.
 * Returns the marker if running, null otherwise.
 */
export async function isThreadRunning(
  storageRoot: string,
  threadId: ThreadId,
): Promise<RunningMarker | null> {
  const marker = await readMarker(storageRoot, threadId);
  if (marker === null) {
    return null;
  }

  if (!isPidAlive(marker.pid)) {
    // Stale marker
    await deleteMarker(storageRoot, threadId);
    return null;
  }

  return marker;
}
