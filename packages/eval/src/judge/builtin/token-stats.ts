import { createLogger } from "@united-workforce/util";

import { EVAL_JUDGE_TOKEN_STATS_SCHEMA } from "../../storage/index.js";
import { readStepDetail, readThreadSteps } from "./read-steps.js";
import type { BuiltinJudgeOutput } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const LOG_RESULT = "T7KQ3M9P";

type PerStepStats = {
  role: string;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  duration: number;
};

/**
 * Informational judge: aggregate token usage across every step. Always scores
 * 1.0 — it never penalizes a run, it only reports usage. Steps with null usage
 * contribute zeros.
 */
export async function runTokenStatsJudge(threadId: string): Promise<BuiltinJudgeOutput> {
  const steps = readThreadSteps(threadId);

  let totalInput = 0;
  let totalOutput = 0;
  let totalTurns = 0;
  const perStep: PerStepStats[] = [];

  for (const step of steps) {
    const detail = readStepDetail(step.hash);
    const usage = detail.usage;
    const inputTokens = usage !== null ? usage.inputTokens : 0;
    const outputTokens = usage !== null ? usage.outputTokens : 0;
    const turns = usage !== null ? usage.turns : 0;
    const duration = usage !== null ? usage.duration : 0;

    totalInput += inputTokens;
    totalOutput += outputTokens;
    totalTurns += turns;

    perStep.push({ role: step.role, inputTokens, outputTokens, turns, duration });
  }

  log(LOG_RESULT, `token-stats thread=${threadId} in=${totalInput} out=${totalOutput}`);

  return {
    score: 1.0,
    data: { totalInput, totalOutput, totalTurns, perStep },
    schema: EVAL_JUDGE_TOKEN_STATS_SCHEMA,
  };
}
