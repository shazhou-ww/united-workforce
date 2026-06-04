import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { VarStore } from "@ocas/core";
import { bootstrap, type Store } from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";

import type { EvalStore } from "./types.js";

/** Variable name prefix for eval run pointers (`@uwf/eval/<task>/latest`). */
const EVAL_VAR_PREFIX = "@uwf/eval/";

/**
 * Resolve the global CAS directory shared by all uwf and ocas tools.
 * Priority: `OCAS_HOME` → default ~/.ocas (matches uwf CLI's getGlobalCasDir).
 */
function getGlobalCasDir(): string {
  const primary = process.env.OCAS_HOME;
  if (primary !== undefined && primary !== "") {
    return primary;
  }
  return join(homedir(), ".ocas");
}

/**
 * Open the unified OCAS store on the filesystem.
 * Shares the same CAS + variable backend as the uwf CLI.
 */
export async function createEvalStore(): Promise<EvalStore> {
  const casDir = getGlobalCasDir();
  await mkdir(casDir, { recursive: true });
  const cas = createFsStore(casDir);
  const { var: varStore, tag } = createSqliteVarStore(join(casDir, "vars"), cas);
  const store: Store = { cas, var: varStore, tag };
  bootstrap(store);
  return { store, varStore };
}

/** Set the `@uwf/eval/<task>/latest` variable to point at a run hash. */
export function setEvalLatest(varStore: VarStore, taskName: string, runHash: string): void {
  varStore.set(`${EVAL_VAR_PREFIX}${taskName}/latest`, runHash);
}
