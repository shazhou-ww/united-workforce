import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveStorageRoot } from "@uncaged/workflow-agent-kit";
import type { ThreadId } from "@uncaged/workflow-protocol";

type HermesSessionCache = Record<string, string>;

function getCachePath(): string {
  return join(resolveStorageRoot(), "cache", "hermes-sessions.json");
}

function cacheKey(threadId: ThreadId, role: string): string {
  return `${threadId}:${role}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCache(): Promise<HermesSessionCache> {
  const path = getCachePath();
  try {
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw)) {
      return {};
    }
    const cache: HermesSessionCache = {};
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

async function writeCache(cache: HermesSessionCache): Promise<void> {
  const path = getCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function isResumeDisabled(): boolean {
  // Hermes ACP session/resume is broken: _restore fails for custom providers
  // because resolve_runtime_provider("custom") throws and base_url/api_mode
  // are lost in the fallback path.  Resume silently creates a new session
  // (different sessionId, no history), causing empty-text responses.
  // See: https://github.com/NousResearch/hermes-agent/issues/13489
  // Disable by default until upstream fixes the bug.  Set UWF_HERMES_RESUME=1
  // to opt back in.
  const enableFlag = process.env.UWF_HERMES_RESUME;
  if (enableFlag === "1" || enableFlag === "true") {
    return false;
  }
  return true;
}

export async function getCachedSessionId(threadId: ThreadId, role: string): Promise<string | null> {
  const cache = await readCache();
  const sessionId = cache[cacheKey(threadId, role)];
  return sessionId ?? null;
}

export async function setCachedSessionId(
  threadId: ThreadId,
  role: string,
  sessionId: string,
): Promise<void> {
  const cache = await readCache();
  cache[cacheKey(threadId, role)] = sessionId;
  await writeCache(cache);
}
