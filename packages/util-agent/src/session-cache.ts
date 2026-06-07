import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ThreadId } from "@united-workforce/protocol";

type SessionCache = Record<string, string>;

export function getCachePath(agentName: string, storageRoot: string): string {
  return join(storageRoot, "cache", `${agentName}-sessions.json`);
}

function cacheKey(threadId: ThreadId, role: string): string {
  return `${threadId}:${role}`;
}

function askCacheKey(stepHash: string): string {
  return `${stepHash}:ask`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCache(agentName: string, storageRoot: string): Promise<SessionCache> {
  const path = getCachePath(agentName, storageRoot);
  try {
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw)) {
      return {};
    }
    const cache: SessionCache = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value !== "") {
        cache[key] = value;
      }
    }
    return cache;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    // Treat JSON parse errors as empty cache
    if (err.name === "SyntaxError") {
      return {};
    }
    throw e;
  }
}

async function writeCache(
  agentName: string,
  storageRoot: string,
  cache: SessionCache,
): Promise<void> {
  const path = getCachePath(agentName, storageRoot);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  // Atomic write: write to temp file then rename to avoid partial reads on concurrent access.
  // NOTE: Current workflow execution is serial (execFileSync), so true concurrency doesn't occur.
  // This is a safety net for future parallel execution.
  const tmpPath = join(dir, `.${agentName}-sessions.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmpPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

/** Read the cached session ID for a thread+role pair. */
export async function getCachedSessionId(
  agentName: string,
  threadId: ThreadId,
  role: string,
  storageRoot: string,
): Promise<string | null> {
  const cache = await readCache(agentName, storageRoot);
  const sessionId = cache[cacheKey(threadId, role)];
  return sessionId ?? null;
}

/** Write the session ID for a thread+role pair into the cache. */
export async function setCachedSessionId(
  agentName: string,
  threadId: ThreadId,
  role: string,
  sessionId: string,
  storageRoot: string,
): Promise<void> {
  const cache = await readCache(agentName, storageRoot);
  cache[cacheKey(threadId, role)] = sessionId;
  await writeCache(agentName, storageRoot, cache);
}

/**
 * Read the cached ask-session ID for a stepHash.
 *
 * Ask sessions are forked side conversations spawned by `step ask` from a
 * specific completed step. They share the per-agent cache file with exec
 * sessions but use the `<stepHash>:ask` key shape so the two namespaces
 * never collide.
 */
export async function getAskSessionId(
  agentName: string,
  stepHash: string,
  storageRoot: string,
): Promise<string | null> {
  const cache = await readCache(agentName, storageRoot);
  const sessionId = cache[askCacheKey(stepHash)];
  return sessionId ?? null;
}

/** Write the ask-session ID for a stepHash into the cache. */
export async function setAskSessionId(
  agentName: string,
  stepHash: string,
  sessionId: string,
  storageRoot: string,
): Promise<void> {
  const cache = await readCache(agentName, storageRoot);
  cache[askCacheKey(stepHash)] = sessionId;
  await writeCache(agentName, storageRoot, cache);
}
