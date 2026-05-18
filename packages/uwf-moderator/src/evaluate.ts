import type { ModeratorContext, WorkflowPayload } from "@uncaged/uwf-protocol";
import jsonata from "jsonata";

import type { Result } from "./types.js";

const START_ROLE = "$START";

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0 && !Number.isNaN(value);
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  return true;
}

function evaluateJsonata(expression: string, context: ModeratorContext): Result<unknown, Error> {
  try {
    const result = jsonata(expression).evaluate(context);
    return { ok: true, value: result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function currentRole(context: ModeratorContext): string {
  if (context.steps.length === 0) {
    return START_ROLE;
  }
  return context.steps[context.steps.length - 1].role;
}

export function evaluate(
  workflow: WorkflowPayload,
  context: ModeratorContext,
): Result<string, Error> {
  const role = currentRole(context);
  const transitions = workflow.graph[role];
  if (transitions === undefined) {
    return {
      ok: false,
      error: new Error(`no transitions defined for role "${role}"`),
    };
  }

  for (const transition of transitions) {
    if (transition.condition === null) {
      return { ok: true, value: transition.role };
    }

    const conditionDef = workflow.conditions[transition.condition];
    if (conditionDef === undefined) {
      return {
        ok: false,
        error: new Error(`unknown condition "${transition.condition}"`),
      };
    }

    const evalResult = evaluateJsonata(conditionDef.expression, context);
    if (!evalResult.ok) {
      return evalResult;
    }
    if (isTruthy(evalResult.value)) {
      return { ok: true, value: transition.role };
    }
  }

  return {
    ok: false,
    error: new Error(`no transition matched for role "${role}"`),
  };
}
