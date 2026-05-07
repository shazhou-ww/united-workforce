import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/v4";

import { createWorkflow } from "../src/create-workflow.js";
import { executeThread } from "../src/engine.js";
import { createExtract } from "../src/extract-fn.js";
import { buildForkPlan, parseThreadDataJsonl } from "../src/fork-thread.js";
import { createLogger } from "../src/logger.js";
import { END } from "../src/types.js";

const phaseSchema = z.object({
  hash: z.string(),
  title: z.string(),
});

const plannerMetaSchema = z.object({
  phases: z.array(phaseSchema),
});

type RefsDemoMeta = {
  planner: z.infer<typeof plannerMetaSchema>;
};

function installMockChatCompletions(sequence: ReadonlyArray<Record<string, unknown>>): () => void {
  const origFetch = globalThis.fetch;
  let i = 0;
  const mockFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const args = sequence[i] ?? sequence[sequence.length - 1];
    if (args === undefined) {
      throw new Error("installMockChatCompletions: empty sequence");
    }
    i += 1;
    void input;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const tools = body.tools;
    const firstTool =
      Array.isArray(tools) && tools.length > 0 && tools[0] !== null && typeof tools[0] === "object"
        ? (tools[0] as Record<string, unknown>)
        : null;
    const fn =
      firstTool !== null ? (firstTool.function as Record<string, unknown> | undefined) : undefined;
    const toolName = typeof fn?.name === "string" ? fn.name : "extract";
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: toolName,
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  globalThis.fetch = Object.assign(mockFetch, {
    preconnect: origFetch.preconnect.bind(origFetch),
  }) as typeof fetch;
  return () => {
    globalThis.fetch = origFetch;
  };
}

const refsDemoExtract = createExtract({
  baseUrl: "http://127.0.0.1:9",
  apiKey: "test",
  model: "test",
});

const refsDemoWorkflow = createWorkflow<RefsDemoMeta>(
  {
    roles: {
      planner: {
        description: "Planner with phase hashes",
        systemPrompt: "Plan.",
        extractPrompt: "Extract phases with CAS hashes.",
        schema: plannerMetaSchema,
        extractRefs: (meta) => meta.phases.map((p) => p.hash),
      },
    },
    moderator: (ctx) => (ctx.steps.length === 0 ? "planner" : END),
  },
  {
    agent: async () => "plan-output",
  },
  refsDemoExtract,
);

describe("RoleStep refs tracking", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("parseThreadDataJsonl reads refs and defaults missing refs to []", () => {
    const text = `{"name":"demo","hash":"C9NMV6V2TQT81","threadId":"01AAA1111111111111111111","parameters":{"prompt":"hi","options":{"maxRounds":5}},"timestamp":100}
{"role":"planner","content":"p","meta":{},"refs":["H111AAAAAAAAA","H222AAAAAAAAA"],"timestamp":101}
{"role":"coder","content":"c","meta":{},"timestamp":102}
`;
    const r = parseThreadDataJsonl(text);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.roleSteps[0]?.refs).toEqual(["H111AAAAAAAAA", "H222AAAAAAAAA"]);
    expect(r.value.roleSteps[1]?.refs).toEqual([]);
  });

  test("executeThread persists refs from extractRefs on role yields", async () => {
    restoreFetch = installMockChatCompletions([
      {
        phases: [
          { hash: "C9NMV6V2TQT81", title: "phase-a" },
          { hash: "C9NMV6V2TQT82", title: "phase-b" },
        ],
      },
    ]);

    const root = await mkdtemp(join(tmpdir(), "wf-refs-"));
    try {
      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const hash = "C9NMV6V2TQT81";
      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const infoPath = join(root, "logs", hash, `${threadId}.info.jsonl`);
      await mkdir(join(root, "logs", hash), { recursive: true });

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const result = await executeThread(
        refsDemoWorkflow,
        "refs-demo",
        { prompt: "task", steps: [] },
        {
          maxRounds: 5,
          signal: ac.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: null,
          prefilledDiskSteps: null,
        },
        { threadId, hash, dataJsonlPath: dataPath, infoJsonlPath: infoPath },
        logger,
      );

      expect(result.returnCode).toBe(0);

      const dataText = await readFile(dataPath, "utf8");
      const lines = dataText
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      expect(lines.length).toBe(2);

      const role1 = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      expect(role1.role).toBe("planner");
      expect(role1.refs).toEqual(["C9NMV6V2TQT81", "C9NMV6V2TQT82"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("buildForkPlan carries refs on historical steps", () => {
    const text = `{"name":"demo","hash":"C9NMV6V2TQT81","threadId":"01AAA1111111111111111111","parameters":{"prompt":"hi","options":{"maxRounds":5}},"timestamp":100}
{"role":"planner","content":"p","meta":{},"refs":["KEEPREFAAAAAA"],"timestamp":101}
{"role":"coder","content":"c","meta":{},"refs":["CODERHASHAAAA"],"timestamp":102}
`;
    const plan = buildForkPlan(text, null);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.value.historicalSteps.length).toBe(1);
    expect(plan.value.historicalSteps[0]?.refs).toEqual(["KEEPREFAAAAAA"]);
  });
});
