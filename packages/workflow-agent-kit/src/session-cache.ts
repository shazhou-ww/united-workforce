import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ThreadId } from "@uncaged/workflow-protocol";

import { resolveStorageRoot } from "./storage.js";

type SessionCache = Record<string, string>;

function getCachePath(): string {
  return join(resolveStorageRoot(), "cache", "agent-sessions.json");
}

function cacheKey(threadId: ThreadId, role: string): string {
  return `${threadId}:${role}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCache(): Promise<SessionCache> {
  const path = getCachePath();
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
    throw e;
  }
}

async function writeCache(cache: SessionCache): Promise<void> {
  const path = getCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

/** Read the cached session ID for a thread+role pair. */
export async function getCachedSessionId(threadId: ThreadId, role: string): Promise<string | null> {
  const cache = await readCache();
  const sessionId = cache[cacheKey(threadId, role)];
  return sessionId ?? null;
}

/** Write the session ID for a thread+role pair into the cache. */
export async function setCachedSessionId(
  threadId: ThreadId,
  role: string,
  sessionId: string,
): Promise<void> {
  const cache = await readCache();
  cache[cacheKey(threadId, role)] = sessionId;
  await writeCache(cache);
}
