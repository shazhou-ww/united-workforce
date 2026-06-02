import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { createLogger } from "@united-workforce/util";

import type { BuiltinTurnPayload } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

function sessionsDir(storageRoot: string): string {
  return join(storageRoot, "sessions");
}

function sessionFile(storageRoot: string, sessionId: string): string {
  return join(sessionsDir(storageRoot), `${sessionId}.jsonl`);
}

/** Ensure sessions directory exists. */
export async function initSessionDir(storageRoot: string): Promise<void> {
  await mkdir(sessionsDir(storageRoot), { recursive: true });
}

/** Append a turn to the session jsonl file. */
export async function appendSessionTurn(
  storageRoot: string,
  sessionId: string,
  turn: BuiltinTurnPayload,
): Promise<void> {
  const line = `${JSON.stringify(turn)}\n`;
  await appendFile(sessionFile(storageRoot, sessionId), line, "utf-8");
  log("3XQVN8KR", `session ${sessionId} appended ${turn.role} turn`);
}

/** Read all turns from session jsonl. Returns empty array if file does not exist. */
export async function readSessionTurns(
  storageRoot: string,
  sessionId: string,
): Promise<BuiltinTurnPayload[]> {
  try {
    const content = await readFile(sessionFile(storageRoot, sessionId), "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    return lines.map((l) => JSON.parse(l) as BuiltinTurnPayload);
  } catch {
    return [];
  }
}

/** Remove session jsonl file (called after detail is persisted to step CAS). */
export async function removeSession(storageRoot: string, sessionId: string): Promise<void> {
  try {
    await rm(sessionFile(storageRoot, sessionId));
    log("7FWDP2MJ", `session ${sessionId} removed`);
  } catch {
    // already gone — fine
  }
}
