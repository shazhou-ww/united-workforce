import { createLogger } from "@united-workforce/util";

import { EVAL_JUDGE_FRONTMATTER_SCHEMA } from "../../storage/index.js";
import { readStepDetail, readThreadSteps } from "./read-steps.js";
import type { BuiltinJudgeOutput } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const LOG_RESULT = "F2QH7R4M";

type InvalidStep = {
  stepIndex: number;
  role: string;
  errors: string[];
};

/** Validate a single step's frontmatter, returning a list of errors (empty = valid). */
function validateStepFrontmatter(frontmatter: Record<string, unknown>): string[] {
  if (Object.keys(frontmatter).length === 0) {
    return ["step has no frontmatter"];
  }
  const status = frontmatter.$status;
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
    if (step === undefined) continue;
    const detail = readStepDetail(step.hash);
    const errors = validateStepFrontmatter(detail.frontmatter);
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
