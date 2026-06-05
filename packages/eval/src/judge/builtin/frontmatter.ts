import { createLogger } from "@united-workforce/util";
import { parse as parseYaml } from "yaml";

import { EVAL_JUDGE_FRONTMATTER_SCHEMA } from "../../storage/index.js";
import { readThreadSteps } from "./read-steps.js";
import type { BuiltinJudgeOutput } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const LOG_RESULT = "F2QH7R4M";

const FENCE = "---";

type InvalidStep = {
  stepIndex: number;
  role: string;
  errors: string[];
};

/**
 * Extract the YAML frontmatter block from a step output. Returns the inner YAML
 * string when the output starts with a `---\n` block closed by a `\n---` fence,
 * otherwise null.
 */
function extractFrontmatterYaml(output: unknown): string | null {
  if (typeof output !== "string") {
    return null;
  }
  if (!output.startsWith(`${FENCE}\n`)) {
    return null;
  }
  const rest = output.slice(FENCE.length + 1);
  const closeIndex = rest.indexOf(`\n${FENCE}`);
  if (closeIndex === -1) {
    return null;
  }
  return rest.slice(0, closeIndex);
}

/** Validate a single step's frontmatter, returning a list of errors (empty = valid). */
function validateStepFrontmatter(output: unknown): string[] {
  // CAS stores the extracted output as a JSON object after the extract pipeline.
  // Accept both: parsed object (from step.output) or raw markdown string.
  if (typeof output === "object" && output !== null && !Array.isArray(output)) {
    const status = (output as Record<string, unknown>).$status;
    if (typeof status !== "string" || status.trim() === "") {
      return ["$status field is missing or not a non-empty string"];
    }
    return [];
  }

  const yaml = extractFrontmatterYaml(output);
  if (yaml === null) {
    return ["output does not begin with a valid '---' frontmatter block"];
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [`frontmatter YAML failed to parse: ${message}`];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return ["frontmatter is not a YAML mapping"];
  }

  const status = (parsed as Record<string, unknown>).$status;
  if (typeof status !== "string" || status.trim() === "") {
    return ["$status field is missing or not a non-empty string"];
  }

  return [];
}

/**
 * Deterministic judge: every step's agent output must contain valid YAML
 * frontmatter with a non-empty `$status` field. Score = stepsValid / stepsTotal
 * (0 when there are no steps).
 */
export async function runFrontmatterJudge(threadId: string): Promise<BuiltinJudgeOutput> {
  const steps = readThreadSteps(threadId);

  const invalidSteps: InvalidStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const errors = validateStepFrontmatter(step.output);
    if (errors.length > 0) {
      invalidSteps.push({ stepIndex: i, role: step.role, errors });
    }
  }

  const stepsTotal = steps.length;
  const stepsValid = stepsTotal - invalidSteps.length;
  const score = stepsTotal > 0 ? stepsValid / stepsTotal : 0;

  log(LOG_RESULT, `frontmatter thread=${threadId} valid=${stepsValid}/${stepsTotal}`);

  return {
    score,
    data: { stepsTotal, stepsValid, invalidSteps },
    schema: EVAL_JUDGE_FRONTMATTER_SCHEMA,
  };
}
