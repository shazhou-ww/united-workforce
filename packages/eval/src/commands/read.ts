import type { EvalRunPayload, EvalStore } from "../storage/index.js";
import type { EvalListEntry } from "./types.js";

/** Variable prefix and suffix for eval run pointers (`@uwf/eval/<task>/latest`). */
const EVAL_VAR_PREFIX = "@uwf/eval/";
const EVAL_VAR_SUFFIX = "/latest";

/** Read a single eval-run payload from CAS. Returns null when the node is absent. */
export function readEvalRun(evalStore: EvalStore, hash: string): EvalRunPayload | null {
  const node = evalStore.store.cas.get(hash);
  if (node === null) {
    return null;
  }
  return node.payload as EvalRunPayload;
}

/**
 * Read every indexed eval run by scanning `@uwf/eval/*\/latest` variables and
 * loading the referenced CAS node. Dangling pointers are skipped.
 */
export function readEvalEntries(evalStore: EvalStore): EvalListEntry[] {
  const { store, varStore } = evalStore;
  const entries: EvalListEntry[] = [];
  for (const variable of varStore.list()) {
    if (!variable.name.startsWith(EVAL_VAR_PREFIX) || !variable.name.endsWith(EVAL_VAR_SUFFIX)) {
      continue;
    }
    const node = store.cas.get(variable.value);
    if (node === null) {
      continue;
    }
    const payload = node.payload as EvalRunPayload;
    entries.push({
      task: payload.task,
      overall: payload.overall,
      timestamp: payload.timestamp,
      hash: variable.value,
    });
  }
  return entries;
}
