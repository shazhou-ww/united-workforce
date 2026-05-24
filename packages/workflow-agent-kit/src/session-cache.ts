import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ThreadId } from "@uncaged/workflow-protocol";

import { resolveStorageRoot } from "./storage.js";

type SessionCache = Record<string, string>;

export function getCachePath(agentName: string): string {
  return join(resolveStorageRoot(), "cache", `${agentName}-sessions.json`);
}

function cacheKey(threadId: ThreadId, role: string): string {
  return `${threadId}:${role}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCache(agentName: string): Promise<SessionCache> {
  const path = getCachePath(agentName);
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

async function writeCache(agentName: string, cache: SessionCache): Promise<void> {
  const path = getCachePath(agentName);
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
): Promise<string | null> {
  const cache = await readCache(agentName);
  const sessionId = cache[cacheKey(threadId, role)];
  return sessionId ?? null;
}

/** Write the session ID for a thread+role pair into the cache. */
export async function setCachedSessionId(
  agentName: string,
  threadId: ThreadId,
  role: string,
  sessionId: string,
): Promise<void> {
  const cache = await readCache(agentName);
  cache[cacheKey(threadId, role)] = sessionId;
  await writeCache(agentName, cache);
}
