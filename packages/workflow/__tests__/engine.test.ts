import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/v4";

import { createRoleModerator } from "../src/create-role-moderator.js";
import { executeThread } from "../src/engine.js";
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

const demoWorkflow = createRoleModerator<DemoMeta>({
  roles: {
    planner: {
      description: "Demo planner",
      schema: plannerMetaSchema,
      run: async () => ({
        content: "plan-body",
        meta: { plan: "do-it", files: ["a.ts"] },
      }),
    },
    coder: {
      description: "Demo coder",
      schema: coderMetaSchema,
      run: async () => ({
        content: "code-body",
        meta: { diff: "+ok" },
      }),
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
});

describe("executeThread", () => {
  test("writes RFC-001 `.data.jsonl` start + role records and `.info.jsonl` logs", async () => {
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
          isDryRun: false,
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
      expect(lines.length).toBe(3);

      const start = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(start.name).toBe("demo-flow");
      expect(start.hash).toBe(hash);
      expect(start.threadId).toBe(threadId);
      expect(typeof start.timestamp).toBe("number");

      const params = start.parameters as Record<string, unknown>;
      expect(params.prompt).toBe("Fix the login redirect bug in #3");
      const opts = params.options as Record<string, unknown>;
      expect(opts.isDryRun).toBe(false);
      expect(opts.maxRounds).toBe(5);

      const role1 = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      expect(role1.role).toBe("planner");
      expect(role1.content).toBe("plan-body");
      expect(role1.meta).toEqual({ plan: "do-it", files: ["a.ts"] });
      expect(typeof role1.timestamp).toBe("number");

      const role2 = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
      expect(role2.role).toBe("coder");

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
            },
          ],
        },
        {
          isDryRun: false,
          maxRounds: 5,
          signal: ac.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: "01SRC1111111111111111111",
          prefilledDiskSteps: [
            {
              role: "planner",
              content: "plan-body",
              meta: { plan: "do-it", files: ["a.ts"] },
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
          isDryRun: false,
          maxRounds: 0,
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
