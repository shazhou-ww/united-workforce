import type { Target } from "@uncaged/workflow-protocol";
import mustache from "mustache";

import type { EvaluateResult, Result } from "./types.js";

// Disable HTML escaping — prompts are plain text, not HTML.
mustache.escape = (text: string) => text;

const START_ROLE = "$START";
const UNIT_STATUS = "_";

type LastOutput = Record<string, unknown> & { status: string };

export function evaluate(
  graph: Record<string, Record<string, Target>>,
  lastRole: string,
  lastOutput: LastOutput,
): Result<EvaluateResult, Error> {
  const status = lastRole === START_ROLE ? UNIT_STATUS : lastOutput.status;

  const roleTargets = graph[lastRole];
  if (roleTargets === undefined) {
    return {
      ok: false,
      error: new Error(`no transitions defined for role "${lastRole}"`),
    };
  }

  const target = roleTargets[status];
  if (target === undefined) {
    return {
      ok: false,
      error: new Error(`no transition for role "${lastRole}" with status "${status}"`),
    };
  }

  try {
    const prompt = mustache.render(target.prompt, lastOutput);
    return { ok: true, value: { role: target.role, prompt } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
