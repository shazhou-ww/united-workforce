import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/v4";

import { createWorkflow } from "../src/create-workflow.js";
import { executeThread } from "../src/engine.js";
import { createExtract } from "../src/extract-fn.js";
import { createLogger } from "../src/logger.js";
import { END } from "../src/types.js";

const plannerMetaSchema = z.object({
  plan: z.string(),
  files: z.array(z.string()),
});

const coderMetaSchema = z.object({
  diff: z.string(),
});

type DemoMeta = {
  planner: z.infer<typeof plannerMetaSchema>;
  coder: z.infer<typeof coderMetaSchema>;
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

const demoExtract = createExtract({
  baseUrl: "http://127.0.0.1:9",
  apiKey: "test",
  model: "test",
});

const demoWorkflow = createWorkflow<DemoMeta>(
  {
    roles: {
      planner: {
        description: "Demo planner",
        systemPrompt: "You are a planner.",
        extractPrompt: "Extract plan text and affected files list.",
        schema: plannerMetaSchema,
        extractRefs: null,
      },
      coder: {
        description: "Demo coder",
        systemPrompt: "You are a coder.",
        extractPrompt: "Extract the code diff summary.",
        schema: coderMetaSchema,
        extractRefs: null,
      },
    },
    moderator: (ctx) => {
      if (ctx.steps.length === 0) {
        return "planner";
      }
      if (ctx.steps.length === 1) {
        return "coder";
      }
      return END;
    },
  },
  {
    agent: async () => "unused",
    overrides: {
      planner: async () => "plan-body",
      coder: async () => "code-body",
    },
  },
  demoExtract,
);

describe("executeThread", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("writes RFC-001 `.data.jsonl` start + role records and `.info.jsonl` logs", async () => {
    restoreFetch = installMockChatCompletions([
      { plan: "do-it", files: ["a.ts"] },
      { diff: "+ok" },
    ]);

    const root = await mkdtemp(join(tmpdir(), "wf-engine-"));
    try {
      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const hash = "C9NMV6V2TQT81";
      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const infoPath = join(root, "logs", hash, `${threadId}.info.jsonl`);
      await mkdir(join(root, "logs", hash), { recursive: true });

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const result = await executeThread(
        demoWorkflow,
        "demo-flow",
        { prompt: "Fix the login redirect bug in #3", steps: [] },
        {
          maxRounds: 5,
          depth: 0,
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
      expect(lines.length).toBe(3);

      const start = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(start.name).toBe("demo-flow");
      expect(start.hash).toBe(hash);
      expect(start.threadId).toBe(threadId);
      expect(typeof start.timestamp).toBe("number");

      const params = start.parameters as Record<string, unknown>;
      expect(params.prompt).toBe("Fix the login redirect bug in #3");
      const opts = params.options as Record<string, unknown>;
      expect(opts.maxRounds).toBe(5);
      expect(opts.depth).toBe(0);
      expect(Object.keys(opts).sort()).toEqual(["depth", "maxRounds"]);

      const role1 = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      expect(role1.role).toBe("planner");
      expect(role1.content).toBe("plan-body");
      expect(role1.meta).toEqual({ plan: "do-it", files: ["a.ts"] });
      expect(role1.refs).toEqual([]);
      expect(typeof role1.timestamp).toBe("number");

      const role2 = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
      expect(role2.role).toBe("coder");
      expect(role2.refs).toEqual([]);

      const infoText = await readFile(infoPath, "utf8");
      const infoLines = infoText
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      expect(infoLines.length).toBeGreaterThan(0);
      const log0 = JSON.parse(infoLines[0] ?? "{}") as Record<string, unknown>;
      expect(typeof log0.tag).toBe("string");
      expect(String(log0.tag).length).toBe(8);
      expect(typeof log0.content).toBe("string");
      expect(typeof log0.timestamp).toBe("number");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("pre-filled ThreadInput.steps skips roles already present", async () => {
    restoreFetch = installMockChatCompletions([{ diff: "+ok" }]);

    const root = await mkdtemp(join(tmpdir(), "wf-engine-fork-"));
    try {
      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const hash = "C9NMV6V2TQT81";
      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const infoPath = join(root, "logs", hash, `${threadId}.info.jsonl`);
      await mkdir(join(root, "logs", hash), { recursive: true });

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const histTs = 9_000_000;
      const result = await executeThread(
        demoWorkflow,
        "demo-flow",
        {
          prompt: "continue from planner",
          steps: [
            {
              role: "planner",
              content: "plan-body",
              meta: { plan: "do-it", files: ["a.ts"] },
              refs: ["CAS111AAAAAAA"],
            },
          ],
        },
        {
          maxRounds: 5,
          depth: 0,
          signal: ac.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: "01SRC1111111111111111111",
          prefilledDiskSteps: [
            {
              role: "planner",
              content: "plan-body",
              meta: { plan: "do-it", files: ["a.ts"] },
              refs: ["CAS111AAAAAAA"],
              timestamp: histTs,
            },
          ],
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
      expect(lines.length).toBe(3);

      const start = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(start.forkFrom).toEqual({ threadId: "01SRC1111111111111111111" });

      const role0 = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      expect(role0.role).toBe("planner");
      expect(role0.timestamp).toBe(histTs);
      expect(role0.refs).toEqual(["CAS111AAAAAAA"]);

      const role1 = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
      expect(role1.role).toBe("coder");
      expect(role1.content).toBe("code-body");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("respects maxRounds=0 (start record only)", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-engine-max0-"));
    try {
      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const hash = "C9NMV6V2TQT81";
      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const infoPath = join(root, "logs", hash, `${threadId}.info.jsonl`);
      await mkdir(join(root, "logs", hash), { recursive: true });

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const result = await executeThread(
        demoWorkflow,
        "demo-flow",
        { prompt: "hello", steps: [] },
        {
          maxRounds: 0,
          depth: 0,
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
      expect(lines.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
