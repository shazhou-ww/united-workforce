import { rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow";

import { readTextFileIfExists } from "./fs-utils.js";
import { resolveThreadDataPath } from "./thread-scan.js";

export async function cmdThreadShow(
  storageRoot: string,
  threadId: string,
): Promise<Result<string, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const text = await readTextFileIfExists(dataPath);
  if (text === null) {
    return err(`thread data missing: ${threadId}`);
  }
  return ok(text.endsWith("\n") ? text.slice(0, -1) : text);
}

export async function cmdThreadRemove(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }

  const dir = dirname(dataPath);
  const infoPath = join(dir, `${threadId}.info.jsonl`);
  const runningPath = join(dir, `${threadId}.running`);
  const casPath = join(dir, `${threadId}.cas`);

  await unlink(dataPath);
  await unlink(infoPath).catch(() => {});
  await unlink(runningPath).catch(() => {});
  await rm(casPath, { recursive: true, force: true });

  return ok(undefined);
}
