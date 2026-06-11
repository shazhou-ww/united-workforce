import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunningThreadItem, ThreadId } from "@united-workforce/protocol";

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
 * Read the process start time from /proc/<pid>/stat (field 22, starttime).
 * Returns the value in clock ticks since boot, or null on non-Linux systems
 * or when the process does not exist.
 */
export function getProcessStartTime(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // /proc/<pid>/stat format: pid (comm) state ... field22_starttime ...
    // The comm field can contain spaces and parentheses, so we find the last ')' first
    const closeParenIdx = stat.lastIndexOf(")");
    if (closeParenIdx === -1) {
      return null;
    }
    // Fields after (comm) start at index 2 (state is field 3, index 2 in 0-based after split)
    // starttime is field 22 (1-based), which is index 19 in the fields after ')'
    const fieldsAfterComm = stat
      .slice(closeParenIdx + 2)
      .trim()
      .split(" ");
    // Field indices after comm (0-based): 0=state(3), 1=ppid(4), ..., 19=starttime(22)
    const startTimeStr = fieldsAfterComm[19];
    if (startTimeStr === undefined) {
      return null;
    }
    const startTime = Number(startTimeStr);
    if (Number.isNaN(startTime)) {
      return null;
    }
    return startTime;
  } catch {
    // /proc not available (non-Linux) or process doesn't exist
    return null;
  }
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
 * Validate that a running marker still refers to the same process.
 * Checks both that the PID is alive AND that its start time matches.
 * Returns false if:
 *   - The PID is no longer alive
 *   - The PID is alive but its start time doesn't match (PID was recycled)
 * Returns true if:
 *   - PID is alive AND start times match
 *   - PID is alive AND marker has null processStartTime (backward compat / non-Linux)
 */
export function isMarkerValid(marker: RunningMarker): boolean {
  if (!isPidAlive(marker.pid)) {
    return false;
  }

  // If marker has no processStartTime (legacy marker or non-Linux at creation time),
  // fall back to PID-alive-only check for backward compatibility
  if (marker.processStartTime === null) {
    return true;
  }

  // Verify process identity by comparing start times
  const actualStartTime = getProcessStartTime(marker.pid);

  // If we can't read the actual start time (non-Linux runtime), trust PID-alive check
  if (actualStartTime === null) {
    return true;
  }

  // Start times must match — if they differ, PID was recycled
  return marker.processStartTime === actualStartTime;
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
 * Handles legacy markers that lack processStartTime by defaulting to null.
 */
export async function readMarker(
  storageRoot: string,
  threadId: ThreadId,
): Promise<RunningMarker | null> {
  const markerPath = getMarkerPath(storageRoot, threadId);
  try {
    const content = await readFile(markerPath, "utf8");
    const raw = JSON.parse(content) as Record<string, unknown>;
    // Normalize legacy markers that lack processStartTime
    const marker: RunningMarker = {
      thread: raw.thread as ThreadId,
      workflow: raw.workflow as string,
      pid: raw.pid as number,
      startedAt: raw.startedAt as number,
      processStartTime: typeof raw.processStartTime === "number" ? raw.processStartTime : null,
    };
    return marker;
  } catch {
    return null;
  }
}

/**
 * List all running threads, filtering out stale markers.
 * A marker is stale if the PID is dead or if the PID was recycled
 * (processStartTime mismatch).
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

    if (!isMarkerValid(marker)) {
      // Stale marker - process no longer exists or PID was recycled
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
 * Returns the marker if running (and process identity is verified), null otherwise.
 * Automatically deletes stale markers (dead PID or recycled PID).
 */
export async function isThreadRunning(
  storageRoot: string,
  threadId: ThreadId,
): Promise<RunningMarker | null> {
  const marker = await readMarker(storageRoot, threadId);
  if (marker === null) {
    return null;
  }

  if (!isMarkerValid(marker)) {
    // Stale marker — PID dead or recycled
    await deleteMarker(storageRoot, threadId);
    return null;
  }

  return marker;
}
