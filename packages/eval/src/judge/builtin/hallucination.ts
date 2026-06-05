import { EVAL_JUDGE_HALLUCINATION_SCHEMA } from "../../storage/index.js";
import type { BuiltinJudgeOutput } from "./types.js";

/**
 * LLM-as-judge: detects claims in each step's output that are not grounded in
 * the available context (hallucinations).
 *
 * TODO: LLM-as-judge — needs provider config to call LLM API. Returns a stub
 * (score 0, empty perStep) until the LLM call path is wired up.
 */
export async function runHallucinationJudge(_threadId: string): Promise<BuiltinJudgeOutput> {
  return {
    score: 0,
    data: { perStep: [] },
    schema: EVAL_JUDGE_HALLUCINATION_SCHEMA,
  };
}
