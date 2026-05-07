import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/v4";

import { createCasStore } from "../src/cas.js";
import { createWorkflow } from "../src/create-workflow.js";
import { executeThread } from "../src/engine.js";
import { createExtract } from "../src/extract-fn.js";
import { createLogger } from "../src/logger.js";
import {
  createContentMerkleNode,
  getContentMerklePayload,
  parseMerkleNode,
  serializeMerkleNode,
} from "../src/merkle.js";
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
      const cas = createCasStore(join(root, "cas"));

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
        { threadId, hash, dataJsonlPath: dataPath, infoJsonlPath: infoPath, cas },
        logger,
      );

      expect(result.returnCode).toBe(0);
      expect(typeof result.rootHash).toBe("string");
      expect(result.rootHash.length).toBeGreaterThan(0);

      const rootYaml = await cas.get(result.rootHash);
      expect(rootYaml).not.toBeNull();
      const rootNode = parseMerkleNode(rootYaml ?? "");
      expect(rootNode.type).toBe("thread");
      const rootPayload = rootNode.payload as Record<string, unknown>;
      expect(rootPayload.workflow).toBe("demo-flow");
      expect(rootPayload.threadId).toBe(threadId);
      const rootResult = rootPayload.result as Record<string, unknown>;
      expect(rootResult.returnCode).toBe(0);
      expect(rootNode.children.length).toBe(2);

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
      expect(typeof role1.contentHash).toBe("string");
      expect(await getContentMerklePayload(cas, String(role1.contentHash))).toBe("plan-body");
      expect(role1.meta).toEqual({ plan: "do-it", files: ["a.ts"] });
      expect(role1.refs).toEqual([role1.contentHash]);
      expect(typeof role1.timestamp).toBe("number");

      const role2 = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
      expect(role2.role).toBe("coder");
      expect(role2.refs).toEqual([role2.contentHash]);

      const step1Yaml = await cas.get(rootNode.children[0] ?? "");
      const step2Yaml = await cas.get(rootNode.children[1] ?? "");
      expect(step1Yaml).not.toBeNull();
      expect(step2Yaml).not.toBeNull();
      const step1Node = parseMerkleNode(step1Yaml ?? "");
      const step2Node = parseMerkleNode(step2Yaml ?? "");
      expect(step1Node.type).toBe("step");
      expect(step2Node.type).toBe("step");
      expect(step1Node.children).toEqual([String(role1.contentHash)]);
      expect(step2Node.children).toEqual([String(role2.contentHash)]);
      const step1Payload = step1Node.payload as Record<string, unknown>;
      expect(step1Payload.role).toBe("planner");
      expect(step1Payload.meta).toEqual({ plan: "do-it", files: ["a.ts"] });

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
      const cas = createCasStore(join(root, "cas"));
      const plannerHash = await cas.put(serializeMerkleNode(createContentMerkleNode("plan-body")));

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const histTs = 9_000_000;
      const mergedPlannerRefs = ["CAS111AAAAAAA", plannerHash];
      const result = await executeThread(
        demoWorkflow,
        "demo-flow",
        {
          prompt: "continue from planner",
          steps: [
            {
              role: "planner",
              contentHash: plannerHash,
              meta: { plan: "do-it", files: ["a.ts"] },
              refs: mergedPlannerRefs,
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
              contentHash: plannerHash,
              meta: { plan: "do-it", files: ["a.ts"] },
              refs: mergedPlannerRefs,
              timestamp: histTs,
            },
          ],
        },
        { threadId, hash, dataJsonlPath: dataPath, infoJsonlPath: infoPath, cas },
        logger,
      );

      expect(result.returnCode).toBe(0);
      expect(typeof result.rootHash).toBe("string");

      const rootYaml = await cas.get(result.rootHash);
      const rootNode = parseMerkleNode(rootYaml ?? "");
      expect(rootNode.children.length).toBe(2);

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
      expect(role0.refs).toEqual(mergedPlannerRefs);

      const role1 = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
      expect(role1.role).toBe("coder");
      expect(await getContentMerklePayload(cas, String(role1.contentHash))).toBe("code-body");
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
      const cas = createCasStore(join(root, "cas"));

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
        { threadId, hash, dataJsonlPath: dataPath, infoJsonlPath: infoPath, cas },
        logger,
      );

      expect(result.returnCode).toBe(0);
      expect(typeof result.rootHash).toBe("string");

      const rootYaml = await cas.get(result.rootHash);
      const rootNode = parseMerkleNode(rootYaml ?? "");
      expect(rootNode.type).toBe("thread");
      expect(rootNode.children.length).toBe(0);

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

  test("Merkle DAG: root → step nodes → content for full thread traversal", async () => {
    restoreFetch = installMockChatCompletions([
      { plan: "do-it", files: ["a.ts"] },
      { diff: "+ok" },
    ]);

    const root = await mkdtemp(join(tmpdir(), "wf-engine-dag-"));
    try {
      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const hash = "C9NMV6V2TQT81";
      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const infoPath = join(root, "logs", hash, `${threadId}.info.jsonl`);
      await mkdir(join(root, "logs", hash), { recursive: true });
      const cas = createCasStore(join(root, "cas"));

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const result = await executeThread(
        demoWorkflow,
        "demo-flow",
        { prompt: "DAG test", steps: [] },
        {
          maxRounds: 5,
          depth: 0,
          signal: ac.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: null,
          prefilledDiskSteps: null,
        },
        { threadId, hash, dataJsonlPath: dataPath, infoJsonlPath: infoPath, cas },
        logger,
      );

      const dataText = await readFile(dataPath, "utf8");
      const lines = dataText
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      expect(lines.length).toBe(3);

      const rolePlanner = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      const roleCoder = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;

      const threadYaml = await cas.get(result.rootHash);
      expect(threadYaml).not.toBeNull();
      const threadNode = parseMerkleNode(threadYaml ?? "");
      expect(threadNode.type).toBe("thread");

      const bodies: string[] = [];
      for (const stepHash of threadNode.children) {
        const stepYaml = await cas.get(stepHash);
        expect(stepYaml).not.toBeNull();
        const stepNode = parseMerkleNode(stepYaml ?? "");
        expect(stepNode.type).toBe("step");
        expect(stepNode.children.length).toBe(1);
        const contentHash = stepNode.children[0];
        expect(contentHash).toBeDefined();
        const body = await getContentMerklePayload(cas, contentHash ?? "");
        expect(body).not.toBeNull();
        bodies.push(body ?? "");
      }

      expect(bodies.sort()).toEqual(["code-body", "plan-body"].sort());
      expect(rolePlanner.role).toBe("planner");
      expect(roleCoder.role).toBe("coder");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
