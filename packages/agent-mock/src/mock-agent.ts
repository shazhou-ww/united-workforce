import { readFile } from "node:fs/promises";

import { bootstrap, type JSONSchema, putSchema, type Store } from "@ocas/core";
import { createLogger } from "@united-workforce/util";
import { type AgentContext, type AgentRunResult, createAgent } from "@united-workforce/util-agent";
import { parse } from "yaml";

import type { MockScenario, MockStep } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const MOCK_DETAIL_SCHEMA: JSONSchema = {
  title: "mock-detail",
  type: "object",
  required: ["sessionId", "role", "stepIndex"],
  properties: {
    sessionId: { type: "string" },
    role: { type: "string" },
    stepIndex: { type: "integer" },
  },
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a YAML mock data document into a {@link MockScenario}. Pure — no I/O. */
export function parseScenario(text: string): MockScenario {
  const raw = parse(text) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.steps)) {
    throw new Error("mock data must be a mapping with a 'steps' array");
  }
  const steps: MockStep[] = raw.steps.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.role !== "string" || typeof entry.output !== "string") {
      throw new Error(`mock step ${i} must have string 'role' and string 'output'`);
    }
    return { role: entry.role, output: entry.output };
  });
  return { steps };
}

async function loadScenario(path: string): Promise<MockScenario> {
  const text = await readFile(path, "utf8");
  return parseScenario(text);
}

/**
 * Pick the scripted step for the given index and verify the moderator routed to
 * the expected role. Throws on out-of-range index or role mismatch so routing
 * bugs surface loudly during E2E runs.
 */
export function selectMockStep(scenario: MockScenario, stepIndex: number, role: string): MockStep {
  const step = scenario.steps[stepIndex];
  if (step === undefined) {
    throw new Error(
      `mock scenario has no step at index ${stepIndex} (total ${scenario.steps.length}); ` +
        `moderator routed to role "${role}"`,
    );
  }
  if (step.role !== role) {
    throw new Error(
      `mock step ${stepIndex} expected role "${step.role}" but moderator routed to "${role}"`,
    );
  }
  return step;
}

/** Persist a minimal detail node so the step node has a valid CAS ref. */
async function storeMockDetail(
  store: Store,
  sessionId: string,
  role: string,
  stepIndex: number,
): Promise<string> {
  await bootstrap(store);
  const schemaHash = await putSchema(store, MOCK_DETAIL_SCHEMA);
  return store.cas.put(schemaHash, { sessionId, role, stepIndex });
}

/**
 * Agent CLI factory: a deterministic, LLM-free agent that replays pre-scripted
 * outputs from a YAML mock data file. The step index is derived by counting the
 * existing steps in the thread's CAS chain (exposed via `ctx.steps`).
 */
export function createMockAgent(mockDataPath: string): () => Promise<void> {
  let lastResult: AgentRunResult | null = null;

  async function run(ctx: AgentContext): Promise<AgentRunResult> {
    const scenario = await loadScenario(mockDataPath);
    const stepIndex = ctx.steps.length;
    log(
      "MK7X2QPV",
      `mock step ${stepIndex} for role "${ctx.role}" (${scenario.steps.length} scripted)`,
    );

    const step = selectMockStep(scenario, stepIndex, ctx.role);
    const sessionId = `mock-${stepIndex}`;
    const detailHash = await storeMockDetail(ctx.store, sessionId, ctx.role, stepIndex);

    const result: AgentRunResult = {
      output: step.output,
      detailHash,
      sessionId,
      assembledPrompt: "",
    };
    lastResult = result;
    return result;
  }

  async function continueRun(
    sessionId: string,
    _message: string,
    _store: Store,
  ): Promise<AgentRunResult> {
    if (lastResult === null) {
      throw new Error("mock continue called before run");
    }
    log("MK3N8RTW", `mock continue for session ${sessionId}, replaying scripted output`);
    return lastResult;
  }

  return createAgent({
    name: "mock",
    run,
    continue: continueRun,
  });
}
