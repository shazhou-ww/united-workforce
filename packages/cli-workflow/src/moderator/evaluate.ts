import type { Target } from "@uncaged/workflow-protocol";
import mustache from "mustache";

import type { EvaluateResult, Result } from "./types.js";

// Disable HTML escaping — prompts are plain text, not HTML.
mustache.escape = (text: string) => text;

const START_ROLE = "$START";
const UNIT_STATUS = "_";

type LastOutput = Record<string, unknown>;

const STATUS_KEY = "$status";

export function evaluate(
  graph: Record<string, Record<string, Target>>,
  lastRole: string,
  lastOutput: LastOutput,
): Result<EvaluateResult, Error> {
  const status =
    lastRole === START_ROLE
      ? UNIT_STATUS
      : typeof lastOutput[STATUS_KEY] === "string"
        ? (lastOutput[STATUS_KEY] as string)
        : UNIT_STATUS;

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
    const location = target.location !== null ? mustache.render(target.location, lastOutput) : null;
    return { ok: true, value: { role: target.role, prompt, location } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
