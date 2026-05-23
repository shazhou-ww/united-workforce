import { bootstrap, putSchema, type Store } from "@uncaged/json-cas";

import { BUILTIN_DETAIL_SCHEMA, BUILTIN_TURN_SCHEMA } from "./schemas.js";
import type {
  BuiltinDetailPayload,
  BuiltinLoopTurn,
  BuiltinToolCall,
  BuiltinTurnPayload,
  BuiltinTurnRole,
} from "./types.js";

function mapToolCalls(calls: NonNullable<BuiltinLoopTurn["toolCalls"]>): BuiltinToolCall[] {
  return calls.map((call) => ({
    name: call.name,
    args: call.args,
  }));
}

function loopTurnToAssistantPayload(turn: BuiltinLoopTurn, index: number): BuiltinTurnPayload {
  return {
    index,
    role: "assistant",
    content: turn.assistantContent ?? "",
    toolCalls:
      turn.toolCalls !== null && turn.toolCalls.length > 0 ? mapToolCalls(turn.toolCalls) : null,
    reasoning: null,
  };
}

function loopTurnToToolPayloads(turn: BuiltinLoopTurn, startIndex: number): BuiltinTurnPayload[] {
  if (turn.toolResults === null || turn.toolResults.length === 0) {
    return [];
  }
  const payloads: BuiltinTurnPayload[] = [];
  let index = startIndex;
  for (const result of turn.toolResults) {
    payloads.push({
      index,
      role: "tool" as BuiltinTurnRole,
      content: result.content,
      toolCalls: null,
      reasoning: null,
    });
    index += 1;
  }
  return payloads;
}

/** Last assistant message with non-empty text. */
export function extractFinalAssistantText(turns: BuiltinLoopTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn === undefined) {
      continue;
    }
    const text = turn.assistantContent;
    if (text !== null && text.trim() !== "") {
      return text;
    }
  }
  return "";
}

type BuiltinSchemaHashes = {
  turn: string;
  detail: string;
};

async function registerBuiltinSchemas(store: Store): Promise<BuiltinSchemaHashes> {
  await bootstrap(store);
  const [turn, detail] = await Promise.all([
    putSchema(store, BUILTIN_TURN_SCHEMA),
    putSchema(store, BUILTIN_DETAIL_SCHEMA),
  ]);
  return { turn, detail };
}

export async function storeBuiltinDetail(
  store: Store,
  sessionId: string,
  model: string,
  startedAtMs: number,
  turns: BuiltinLoopTurn[],
  nowMs: number = Date.now(),
): Promise<{ detailHash: string; output: string }> {
  const schemas = await registerBuiltinSchemas(store);
  const turnHashes: string[] = [];
  let turnIndex = 0;

  for (const loopTurn of turns) {
    const assistant = loopTurnToAssistantPayload(loopTurn, turnIndex);
    const assistantHash = await store.put(schemas.turn, assistant);
    turnHashes.push(assistantHash);
    turnIndex += 1;

    const toolPayloads = loopTurnToToolPayloads(loopTurn, turnIndex);
    for (const toolPayload of toolPayloads) {
      const toolHash = await store.put(schemas.turn, toolPayload);
      turnHashes.push(toolHash);
      turnIndex += 1;
    }
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
  const output = extractFinalAssistantText(turns);
  return { detailHash, output };
}
