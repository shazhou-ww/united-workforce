import type { Target } from "@united-workforce/protocol";
import mustache from "mustache";

import type { EvaluateResult, Result } from "./types.js";

// Disable HTML escaping — prompts are plain text, not HTML.
mustache.escape = (text: string) => text;

type LastOutput = Record<string, unknown>;

const STATUS_KEY = "$status";

export function evaluate(
  graph: Record<string, Record<string, Target>>,
  lastRole: string,
  lastOutput: LastOutput,
): Result<EvaluateResult, Error> {
  let status: string;
  if (typeof lastOutput[STATUS_KEY] === "string") {
    status = lastOutput[STATUS_KEY] as string;
  } else {
    return {
      ok: false,
      error: new Error(`agent output for role "${lastRole}" is missing required "$status" string`),
    };
  }

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
    if (prompt.trim() === "") {
      return {
        ok: false,
        error: new Error(
          `edge prompt resolved to empty string for role "${target.role}" (template: "${target.prompt}"). Check that upstream output includes required variables.`,
        ),
      };
    }

    const location = target.location !== null ? mustache.render(target.location, lastOutput) : null;
    return { ok: true, value: { role: target.role, prompt, location } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
