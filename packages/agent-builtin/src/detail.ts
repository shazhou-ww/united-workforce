import { bootstrap, putSchema, type Store } from "@ocas/core";

import { BUILTIN_DETAIL_SCHEMA, BUILTIN_TURN_SCHEMA } from "./schemas.js";
import { readSessionTurns } from "./session.js";
import type { BuiltinDetailPayload } from "./types.js";

type BuiltinSchemaHashes = {
  turn: string;
  detail: string;
};

export async function registerBuiltinSchemas(store: Store): Promise<BuiltinSchemaHashes> {
  await bootstrap(store);
  const [turn, detail] = await Promise.all([
    putSchema(store, BUILTIN_TURN_SCHEMA),
    putSchema(store, BUILTIN_DETAIL_SCHEMA),
  ]);
  return { turn, detail };
}

/** Read session jsonl, persist each turn to CAS, return detail hash. */
export async function storeBuiltinDetail(
  store: Store,
  storageRoot: string,
  sessionId: string,
  model: string,
  startedAtMs: number,
  nowMs: number = Date.now(),
): Promise<{ detailHash: string; turnCount: number }> {
  const schemas = await registerBuiltinSchemas(store);
  const turns = await readSessionTurns(storageRoot, sessionId);

  const turnHashes: string[] = [];
  for (const turn of turns) {
    const hash = await store.put(schemas.turn, turn);
    turnHashes.push(hash);
  }

  const duration = Math.max(0, nowMs - startedAtMs);
  const detail: BuiltinDetailPayload = {
    sessionId,
    model,
    duration,
    turnCount: turnHashes.length,
    turns: turnHashes,
  };
  const detailHash = await store.put(schemas.detail, detail);
  return { detailHash, turnCount: turnHashes.length };
}
