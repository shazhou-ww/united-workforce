import type { ModeratorContext, WorkflowPayload } from "@uncaged/workflow-protocol";
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

function findByRole(
  steps: ModeratorContext["steps"],
  role: string,
  direction: "first" | "last",
): unknown {
  if (direction === "last") {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].role === role) {
        return steps[i].output;
      }
    }
  } else {
    for (const step of steps) {
      if (step.role === role) {
        return step.output;
      }
    }
  }
  return undefined;
}

async function evaluateJsonata(
  expression: string,
  context: ModeratorContext,
): Promise<Result<unknown, Error>> {
  try {
    const expr = jsonata(expression);
    expr.registerFunction(
      "first",
      (role: string) => findByRole(context.steps, role, "first"),
      "<s:x>",
    );
    expr.registerFunction(
      "last",
      (role: string) => findByRole(context.steps, role, "last"),
      "<s:x>",
    );
    const result = await expr.evaluate(context);
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

export async function evaluate(
  workflow: WorkflowPayload,
  context: ModeratorContext,
): Promise<Result<string, Error>> {
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

    const evalResult = await evaluateJsonata(conditionDef.expression, context);
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
