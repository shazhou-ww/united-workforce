import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { JudgeEntry, TaskLimits, TaskManifest } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJudgeEntry(raw: unknown, index: number): JudgeEntry {
  if (!isRecord(raw)) {
    throw new Error(`judges[${index}]: expected object`);
  }
  const name = raw.name;
  if (typeof name !== "string" || name === "") {
    throw new Error(`judges[${index}]: name is required`);
  }
  const weight = typeof raw.weight === "number" ? raw.weight : 0;
  const builtin = raw.builtin === true;
  const entry = typeof raw.entry === "string" ? raw.entry : null;
  const schema = typeof raw.schema === "string" ? raw.schema : null;
  if (!builtin && entry === null) {
    throw new Error(`judges[${index}] "${name}": non-builtin judge must have entry`);
  }
  return { name, weight, builtin, entry, schema };
}

function parseLimits(raw: unknown): TaskLimits {
  if (!isRecord(raw)) {
    return { maxSteps: 20, timeoutMinutes: 30 };
  }
  return {
    maxSteps: typeof raw.maxSteps === "number" ? raw.maxSteps : 20,
    timeoutMinutes: typeof raw.timeoutMinutes === "number" ? raw.timeoutMinutes : 30,
  };
}

/** Parse and validate a task.yaml file into a TaskManifest. */
export function parseTaskManifest(yamlText: string): TaskManifest {
  const raw = parseYaml(yamlText) as unknown;
  if (!isRecord(raw)) {
    throw new Error("task.yaml must be a YAML mapping");
  }
  const name = raw.name;
  if (typeof name !== "string" || name === "") {
    throw new Error("task.yaml: name is required");
  }
  const description = typeof raw.description === "string" ? raw.description : "";
  const workflow = raw.workflow;
  if (typeof workflow !== "string" || workflow === "") {
    throw new Error("task.yaml: workflow is required");
  }
  const prompt = raw.prompt;
  if (typeof prompt !== "string" || prompt === "") {
    throw new Error("task.yaml: prompt is required");
  }
  const limits = parseLimits(raw.limits);
  const judgesRaw = raw.judges;
  if (!Array.isArray(judgesRaw) || judgesRaw.length === 0) {
    throw new Error("task.yaml: at least one judge is required");
  }
  const judges: JudgeEntry[] = [];
  for (let i = 0; i < judgesRaw.length; i++) {
    judges.push(parseJudgeEntry(judgesRaw[i], i));
  }
  return { name, description, workflow, prompt, limits, judges };
}

/** Load and parse task.yaml from a directory. */
export async function loadTaskManifest(taskDir: string): Promise<TaskManifest> {
  const yamlPath = join(taskDir, "task.yaml");
  const text = await readFile(yamlPath, "utf8");
  return parseTaskManifest(text);
}
