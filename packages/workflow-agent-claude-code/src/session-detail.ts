import { bootstrap, putSchema, type Store } from "@uncaged/json-cas";

import { CLAUDE_CODE_DETAIL_SCHEMA, CLAUDE_CODE_RAW_OUTPUT_SCHEMA } from "./schemas.js";
import type { ClaudeCodeDetailPayload, ClaudeCodeParsedResult } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse Claude Code JSON stdout (`claude -p --output-format json`). */
export function parseClaudeCodeJsonOutput(stdout: string): ClaudeCodeParsedResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const sessionId = parsed.session_id;
  const result = parsed.result;
  const subtype = parsed.subtype;

  if (typeof sessionId !== "string" || typeof result !== "string" || typeof subtype !== "string") {
    return null;
  }

  return {
    type: typeof parsed.type === "string" ? parsed.type : "result",
    subtype: subtype as ClaudeCodeParsedResult["subtype"],
    result,
    sessionId,
    numTurns: typeof parsed.num_turns === "number" ? parsed.num_turns : 0,
    totalCostUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0,
    durationMs: typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0,
  };
}

type ClaudeCodeSchemaHashes = {
  detail: string;
  rawOutput: string;
};

async function registerSchemas(store: Store): Promise<ClaudeCodeSchemaHashes> {
  await bootstrap(store);
  const [detail, rawOutput] = await Promise.all([
    putSchema(store, CLAUDE_CODE_DETAIL_SCHEMA),
    putSchema(store, CLAUDE_CODE_RAW_OUTPUT_SCHEMA),
  ]);
  return { detail, rawOutput };
}

/** Store parsed Claude Code result as a CAS detail node. */
export async function storeClaudeCodeDetail(
  store: Store,
  parsed: ClaudeCodeParsedResult,
): Promise<{ detailHash: string; output: string; sessionId: string }> {
  const schemas = await registerSchemas(store);

  const detail: ClaudeCodeDetailPayload = {
    sessionId: parsed.sessionId,
    numTurns: parsed.numTurns,
    totalCostUsd: parsed.totalCostUsd,
    durationMs: parsed.durationMs,
    subtype: parsed.subtype,
  };

  const detailHash = await store.put(schemas.detail, detail);
  return { detailHash, output: parsed.result, sessionId: parsed.sessionId };
}

/** Fallback: store raw text output when JSON parsing fails. */
export async function storeClaudeCodeRawOutput(store: Store, rawOutput: string): Promise<string> {
  const schemas = await registerSchemas(store);
  return store.put(schemas.rawOutput, { text: rawOutput });
}
