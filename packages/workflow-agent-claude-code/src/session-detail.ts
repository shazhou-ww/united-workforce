import { bootstrap, putSchema, type Store } from "@uncaged/json-cas";

import {
  CLAUDE_CODE_DETAIL_SCHEMA,
  CLAUDE_CODE_RAW_OUTPUT_SCHEMA,
  CLAUDE_CODE_TURN_SCHEMA,
} from "./schemas.js";
import type {
  ClaudeCodeDetailPayload,
  ClaudeCodeParsedResult,
  ClaudeCodeToolCall,
  ClaudeCodeTurnPayload,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Extract tool calls from an assistant message content array.
 */
function extractToolCalls(content: unknown[]): ClaudeCodeToolCall[] {
  const calls: ClaudeCodeToolCall[] = [];
  for (const item of content) {
    if (isRecord(item) && item.type === "tool_use" && typeof item.name === "string") {
      calls.push({
        name: item.name,
        input: typeof item.input === "string" ? item.input : JSON.stringify(item.input ?? {}),
      });
    }
  }
  return calls;
}

/**
 * Extract text content from a message content array.
 */
function extractTextContent(content: unknown[]): string {
  const texts: string[] = [];
  for (const item of content) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  return texts.join("\n");
}

/**
 * Extract tool result content from a user message content array.
 */
function extractToolResultContent(content: unknown[]): string {
  const results: string[] = [];
  for (const item of content) {
    if (isRecord(item) && item.type === "tool_result") {
      const text = typeof item.content === "string" ? item.content : "";
      results.push(text);
    }
  }
  return results.join("\n");
}

/**
 * Parse Claude Code stream-json (NDJSON) output.
 * Each line is a JSON object with type: "system" | "assistant" | "user" | "result".
 */
export function parseClaudeCodeStreamOutput(stdout: string): ClaudeCodeParsedResult | null {
  const lines = stdout.trim().split("\n");
  const turns: ClaudeCodeTurnPayload[] = [];
  let resultLine: Record<string, unknown> | null = null;
  let model = "";
  let turnIndex = 0;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const type = parsed.type;

    if (type === "system" && typeof parsed.model === "string") {
      model = parsed.model;
    }

    if (type === "assistant" && isRecord(parsed.message)) {
      const msg = parsed.message;
      const content = Array.isArray(msg.content) ? msg.content : [];
      const textContent = extractTextContent(content as unknown[]);
      const toolCalls = extractToolCalls(content as unknown[]);

      // Only record turns that have actual content
      if (textContent !== "" || toolCalls.length > 0) {
        turns.push({
          index: turnIndex++,
          role: "assistant",
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : null,
        });
      }
    }

    if (type === "user" && isRecord(parsed.message)) {
      const msg = parsed.message;
      const content = Array.isArray(msg.content) ? msg.content : [];
      const resultContent = extractToolResultContent(content as unknown[]);

      if (resultContent !== "") {
        turns.push({
          index: turnIndex++,
          role: "tool_result",
          content: resultContent,
          toolCalls: null,
        });
      }
    }

    if (type === "result") {
      resultLine = parsed;
    }
  }

  if (resultLine === null) return null;

  const sessionId = resultLine.session_id;
  const result = resultLine.result;
  const subtype = resultLine.subtype;

  if (typeof sessionId !== "string" || typeof result !== "string" || typeof subtype !== "string") {
    return null;
  }

  const usage = isRecord(resultLine.usage) ? resultLine.usage : {};

  return {
    type: safeString(resultLine.type, "result"),
    subtype: subtype as ClaudeCodeParsedResult["subtype"],
    result,
    sessionId,
    numTurns: safeNumber(resultLine.num_turns),
    totalCostUsd: safeNumber(resultLine.total_cost_usd),
    durationMs: safeNumber(resultLine.duration_ms),
    model,
    stopReason: safeString(resultLine.stop_reason),
    usage: {
      inputTokens: safeNumber(usage.input_tokens),
      outputTokens: safeNumber(usage.output_tokens),
      cacheReadInputTokens: safeNumber(usage.cache_read_input_tokens),
      cacheCreationInputTokens: safeNumber(usage.cache_creation_input_tokens),
    },
    turns,
  };
}

/**
 * Legacy: parse Claude Code plain JSON output (non-streaming).
 * Falls back when stream-json is not available.
 */
export function parseClaudeCodeJsonOutput(stdout: string): ClaudeCodeParsedResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const sessionId = parsed.session_id;
  const result = parsed.result;
  const subtype = parsed.subtype;

  if (typeof sessionId !== "string" || typeof result !== "string" || typeof subtype !== "string") {
    return null;
  }

  const usage = isRecord(parsed.usage) ? parsed.usage : {};

  return {
    type: safeString(parsed.type, "result"),
    subtype: subtype as ClaudeCodeParsedResult["subtype"],
    result,
    sessionId,
    numTurns: safeNumber(parsed.num_turns),
    totalCostUsd: safeNumber(parsed.total_cost_usd),
    durationMs: safeNumber(parsed.duration_ms),
    model: "",
    stopReason: safeString(parsed.stop_reason),
    usage: {
      inputTokens: safeNumber(usage.input_tokens),
      outputTokens: safeNumber(usage.output_tokens),
      cacheReadInputTokens: safeNumber(usage.cache_read_input_tokens),
      cacheCreationInputTokens: safeNumber(usage.cache_creation_input_tokens),
    },
    turns: [],
  };
}

type ClaudeCodeSchemaHashes = {
  detail: string;
  turn: string;
  rawOutput: string;
};

async function registerSchemas(store: Store): Promise<ClaudeCodeSchemaHashes> {
  await bootstrap(store);
  const [detail, turn, rawOutput] = await Promise.all([
    putSchema(store, CLAUDE_CODE_DETAIL_SCHEMA),
    putSchema(store, CLAUDE_CODE_TURN_SCHEMA),
    putSchema(store, CLAUDE_CODE_RAW_OUTPUT_SCHEMA),
  ]);
  return { detail, turn, rawOutput };
}

/** Store parsed Claude Code result with per-turn breakdown as CAS detail nodes. */
export async function storeClaudeCodeDetail(
  store: Store,
  parsed: ClaudeCodeParsedResult,
): Promise<{ detailHash: string; output: string; sessionId: string }> {
  const schemas = await registerSchemas(store);

  // Store each turn as an individual CAS node
  const turnHashes: string[] = [];
  for (const turn of parsed.turns) {
    const hash = await store.put(schemas.turn, turn);
    turnHashes.push(hash);
  }

  const detail: ClaudeCodeDetailPayload = {
    sessionId: parsed.sessionId,
    model: parsed.model,
    subtype: parsed.subtype,
    durationMs: parsed.durationMs,
    numTurns: parsed.numTurns,
    totalCostUsd: parsed.totalCostUsd,
    stopReason: parsed.stopReason,
    usage: parsed.usage,
    turns: turnHashes,
  };

  const detailHash = await store.put(schemas.detail, detail);
  return { detailHash, output: parsed.result, sessionId: parsed.sessionId };
}

/** Fallback: store raw text output when JSON parsing fails. */
export async function storeClaudeCodeRawOutput(store: Store, rawOutput: string): Promise<string> {
  const schemas = await registerSchemas(store);
  return store.put(schemas.rawOutput, { text: rawOutput });
}
