import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { JSONSchema, Store } from "@ocas/core";
import { putSchema } from "@ocas/core";
import type { CasRef } from "@united-workforce/protocol";
import { createLogger } from "@united-workforce/util";

import type { JudgeOutput } from "../judge/index.js";
import {
  runFrontmatterJudge,
  runHallucinationJudge,
  runTokenStatsJudge,
  runUpstreamJudge,
} from "../judge/index.js";
import type { EvalJudgeRecord, EvalRunPayload } from "../storage/index.js";
import { EVAL_RUN_SCHEMA, setEvalLatest } from "../storage/index.js";
import type { JudgeEntry } from "../task/index.js";
import type {
  CollectInput,
  CollectResult,
  JudgeRunner,
  JudgeRunOutput,
  JudgeSummary,
} from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const LOG_JUDGE = "CT6N3P2K";
const LOG_STORED = "CT9V2Q7M";

/** Permissive schema for judge data without a dedicated schema (e.g. builtin placeholders). */
const GENERIC_DATA_SCHEMA: JSONSchema = { type: "object" };

/**
 * Compute the weighted overall score. Judges with weight 0 are informational
 * and do not affect the result (they contribute 0 to both numerator and
 * denominator). Returns 0 when total weight is 0.
 */
export function computeOverall(judges: ReadonlyArray<{ score: number; weight: number }>): number {
  let totalWeight = 0;
  let weighted = 0;
  for (const judge of judges) {
    totalWeight += judge.weight;
    weighted += judge.score * judge.weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

/** Run a task-provided judge script: `node <entry> <cwd> <threadId>`. */
async function runTaskJudge(
  taskDir: string,
  workDir: string,
  threadId: string,
  judge: JudgeEntry,
): Promise<JudgeRunOutput> {
  if (judge.entry === null) {
    throw new Error(`judge "${judge.name}" is not builtin but has no entry`);
  }
  const entryPath = resolve(taskDir, judge.entry);

  let stdout: string;
  try {
    stdout = execFileSync("node", [entryPath, workDir, threadId], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`judge "${judge.name}" failed: ${message}`);
  }

  const line = stdout.trim().split("\n").pop()?.trim() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`judge "${judge.name}" stdout is not valid JSON: ${line || "(empty)"}`);
  }
  const output = parsed as JudgeOutput;
  if (typeof output.score !== "number") {
    throw new Error(`judge "${judge.name}" output missing numeric score`);
  }

  const schema =
    judge.schema !== null ? await loadSchema(resolve(taskDir, judge.schema)) : GENERIC_DATA_SCHEMA;
  return { score: output.score, data: output.data, schema };
}

/** Load and parse an OCAS JSON Schema file. */
async function loadSchema(path: string): Promise<JSONSchema> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as JSONSchema;
}

/** Dispatch a builtin judge by name. Throws on an unknown builtin name. */
async function runBuiltinJudge(name: string, threadId: string): Promise<JudgeRunOutput> {
  switch (name) {
    case "frontmatter-compliance":
      return runFrontmatterJudge(threadId);
    case "upstream-consumption":
      return runUpstreamJudge(threadId);
    case "hallucination":
      return runHallucinationJudge(threadId);
    case "token-stats":
      return runTokenStatsJudge(threadId);
    default:
      throw new Error(`unknown builtin judge "${name}"`);
  }
}

/**
 * Default judge runner. Builtin judges are dispatched by name; task judges spawn
 * their entry script.
 */
const defaultJudgeRunner: JudgeRunner = async (taskDir, workDir, threadId, judge) => {
  if (judge.builtin) {
    return runBuiltinJudge(judge.name, threadId);
  }
  return runTaskJudge(taskDir, workDir, threadId, judge);
};

/** Persist judge data to CAS under its schema and return the CAS hash. */
async function storeJudgeData(store: Store, schema: JSONSchema, data: unknown): Promise<CasRef> {
  const schemaHash = await putSchema(store, schema);
  return (await store.cas.put(schemaHash, data)) as CasRef;
}

/**
 * Run all judges, store their data and the overall eval-run record in CAS, then
 * index the run under `@uwf/eval/<task>/latest`.
 */
export async function collect(
  input: CollectInput,
  runJudge: JudgeRunner = defaultJudgeRunner,
): Promise<CollectResult> {
  const { evalStore, taskDir, workDir, threadId, manifest, config } = input;
  const { store, varStore } = evalStore;

  const records: EvalJudgeRecord[] = [];
  for (const judge of manifest.judges) {
    const result = await runJudge(taskDir, workDir, threadId, judge);
    const dataHash = await storeJudgeData(store, result.schema, result.data);
    records.push({ name: judge.name, score: result.score, weight: judge.weight, dataHash });
    log(LOG_JUDGE, `judge=${judge.name} score=${result.score} weight=${judge.weight}`);
  }

  const overall = computeOverall(records);

  const payload: EvalRunPayload = {
    task: manifest.name,
    config,
    threadId,
    judges: records,
    overall,
    timestamp: Date.now(),
  };

  const schemaHash = await putSchema(store, EVAL_RUN_SCHEMA);
  const runHash = (await store.cas.put(schemaHash, payload)) as string;
  setEvalLatest(varStore, manifest.name, runHash);
  log(LOG_STORED, `stored eval-run task=${manifest.name} hash=${runHash} overall=${overall}`);

  const judges: JudgeSummary[] = records.map((r) => ({
    name: r.name,
    score: r.score,
    weight: r.weight,
  }));
  return { runHash, overall, judges };
}
