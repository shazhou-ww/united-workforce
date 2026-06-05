import { EVAL_JUDGE_UPSTREAM_SCHEMA } from "../../storage/index.js";
import type { BuiltinJudgeOutput } from "./types.js";

/**
 * LLM-as-judge: measures how well each role consumed the relevant outputs from
 * upstream steps.
 *
 * TODO: LLM-as-judge — needs provider config to call LLM API. Returns a stub
 * (score 0, empty perStep) until the LLM call path is wired up.
 */
export async function runUpstreamJudge(_threadId: string): Promise<BuiltinJudgeOutput> {
  return {
    score: 0,
    data: { perStep: [] },
    schema: EVAL_JUDGE_UPSTREAM_SCHEMA,
  };
}
