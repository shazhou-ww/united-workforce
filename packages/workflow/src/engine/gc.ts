import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CasStore, createCasStore } from "../cas/index.js";
import { err, getGlobalCasDir, ok, type Result } from "../util/index.js";
import { parseThreadDataJsonl } from "./fork-thread.js";
import type { GcResult } from "./types.js";

async function listThreadDataJsonlPaths(storageRoot: string): Promise<Result<string[], string>> {
  const logsRoot = join(storageRoot, "logs");
  const paths: string[] = [];
  let hashes: string[];
  try {
    hashes = await readdir(logsRoot);
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code === "ENOENT") {
      return ok([]);
    }
    return err(`failed to read logs directory: ${String(e)}`);
  }

  for (const hash of hashes) {
    const dir = join(logsRoot, hash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const fileName of entries) {
      if (fileName.endsWith(".data.jsonl")) {
        paths.push(join(dir, fileName));
      }
    }
  }

  paths.sort();
  return ok(paths);
}

async function collectActiveRefsFromDataPaths(
  dataPaths: string[],
): Promise<Result<Set<string>, string>> {
  const activeRefs = new Set<string>();
  for (const dataPath of dataPaths) {
    let text: string;
    try {
      text = await readFile(dataPath, "utf8");
    } catch (e) {
      return err(`failed to read ${dataPath}: ${String(e)}`);
    }
    const parsed = parseThreadDataJsonl(text);
    if (!parsed.ok) {
      return err(`${dataPath}: ${parsed.error}`);
    }
    for (const step of parsed.value.roleSteps) {
      for (const ref of step.refs) {
        activeRefs.add(ref);
      }
    }
  }
  return ok(activeRefs);
}

async function deleteCasNotInSet(
  cas: CasStore,
  activeRefs: Set<string>,
): Promise<Result<string[], string>> {
  let listed: string[];
  try {
    listed = await cas.list();
  } catch (e) {
    return err(`failed to list cas entries: ${String(e)}`);
  }

  const deletedHashes: string[] = [];
  for (const hash of listed) {
    if (activeRefs.has(hash)) {
      continue;
    }
    try {
      await cas.delete(hash);
    } catch (e) {
      return err(`failed to delete cas ${hash}: ${String(e)}`);
    }
    deletedHashes.push(hash);
  }

  deletedHashes.sort();
  return ok(deletedHashes);
}

/**
 * Mark-and-sweep CAS GC: collect `refs` from all thread `.data.jsonl` files under `storageRoot`,
 * then delete CAS blobs not referenced by any surviving thread data.
 */
export async function garbageCollectCas(storageRoot: string): Promise<Result<GcResult, string>> {
  const pathsResult = await listThreadDataJsonlPaths(storageRoot);
  if (!pathsResult.ok) {
    return pathsResult;
  }
  const paths = pathsResult.value;

  const refsResult = await collectActiveRefsFromDataPaths(paths);
  if (!refsResult.ok) {
    return refsResult;
  }
  const activeRefs = refsResult.value;

  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const deletedResult = await deleteCasNotInSet(cas, activeRefs);
  if (!deletedResult.ok) {
    return deletedResult;
  }
  const deletedHashes = deletedResult.value;

  return ok({
    scannedThreads: paths.length,
    activeRefs: activeRefs.size,
    deletedEntries: deletedHashes.length,
    deletedHashes,
  });
}
