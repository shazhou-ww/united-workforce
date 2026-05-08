import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { END } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";
import { createCasStore } from "../src/cas/cas.js";
import { hashWorkflowBundleBytes } from "../src/cas/hash.js";
import { getContentMerklePayload, parseMerkleNode } from "../src/cas/merkle.js";
import { createWorkflow } from "../src/engine/create-workflow.js";
import { executeThread } from "../src/engine/engine.js";
import {
  readWorkflowRegistry,
  registerWorkflowVersion,
  writeWorkflowRegistry,
} from "../src/registry/registry.js";
import { createLogger } from "../src/util/logger.js";
import { workflowAsAgent } from "../src/workflow-as-agent.js";

const callerMetaSchema = z.object({ done: z.literal(true) });

type ParentMeta = {
  caller: z.infer<typeof callerMetaSchema>;
};

function installMockChatCompletions(sequence: ReadonlyArray<Record<string, unknown>>): () => void {
  const origFetch = globalThis.fetch;
  let i = 0;
  const mockFetch = async (
    _input: Parameters<typeof fetch>[0],
    _init?: RequestInit,
  ): Promise<Response> => {
    const args = sequence[i] ?? sequence[sequence.length - 1];
    if (args === undefined) {
      throw new Error("installMockChatCompletions: empty sequence");
    }
    i += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(args) } }],
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

const PARENT_REGISTRY_WITH_CONFIG = `config:
  maxDepth: 3
  providers:
    stub:
      baseUrl: http://127.0.0.1:9
      apiKey: test
  models:
    default: stub/m
workflows: {}
`;

const childBundleSource = `import { putContentMerkleNode } from "@uncaged/workflow";

export const descriptor = {
  description: "child-integration",
  roles: {
    agent: {
      description: "agent",
      schema: { type: "object", properties: {}, additionalProperties: true },
    },
  },
};
export async function* run(thread, runtime) {
  const cas = runtime.cas;
  const h = await putContentMerkleNode(cas, "child-body");
  yield { role: "agent", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "child-done:" + thread.start.content };
}
`;

async function installChildWorkflow(storageRoot: string): Promise<{ hash: string }> {
  const bytes = new TextEncoder().encode(childBundleSource);
  const hash = hashWorkflowBundleBytes(bytes);
  await mkdir(join(storageRoot, "bundles"), { recursive: true });
  await writeFile(join(storageRoot, "bundles", `${hash}.esm.js`), childBundleSource, "utf8");
  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    throw reg.error;
  }
  const next = registerWorkflowVersion(reg.value, "child-wf", hash, Date.now());
  const wr = await writeWorkflowRegistry(storageRoot, next);
  if (!wr.ok) {
    throw wr.error;
  }
  return { hash };
}

describe("workflowAsAgent integration", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("createWorkflow parent invokes nested workflow via workflowAsAgent", async () => {
    restoreFetch = installMockChatCompletions([{ done: true }]);

    const root = await mkdtemp(join(tmpdir(), "wf-waa-int-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "workflow.yaml"), PARENT_REGISTRY_WITH_CONFIG, "utf8");
      const { hash: childHash } = await installChildWorkflow(root);

      const parentWorkflow = createWorkflow<ParentMeta>(
        {
          roles: {
            caller: {
              description: "delegates to child workflow",
              systemPrompt: "system",
              extractPrompt: "extract done flag",
              schema: callerMetaSchema,
              extractRefs: null,
            },
          },
          moderator: (ctx) => (ctx.steps.length === 0 ? "caller" : END),
        },
        { agent: workflowAsAgent("child-wf", { storageRoot: root }), overrides: null },
      );

      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const parentHash = "C9NMV6V2TQT81";
      const dataPath = join(root, "logs", parentHash, `${threadId}.data.jsonl`);
      const infoPath = join(root, "logs", parentHash, `${threadId}.info.jsonl`);
      await mkdir(join(root, "logs", parentHash), { recursive: true });
      const cas = createCasStore(join(root, "cas"));

      const logger = createLogger({ sink: { kind: "file", path: infoPath } });
      const ac = new AbortController();

      const result = await executeThread(
        parentWorkflow,
        "parent-wf",
        { prompt: "from-parent", steps: [] },
        {
          maxRounds: 5,
          depth: 0,
          signal: ac.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: null,
          prefilledDiskSteps: null,
          storageRoot: root,
        },
        { threadId, hash: parentHash, dataJsonlPath: dataPath, infoJsonlPath: infoPath, cas },
        logger,
      );

      expect(result.returnCode).toBe(0);
      expect(typeof result.rootHash).toBe("string");

      const parentText = await readFile(dataPath, "utf8");
      const parentLines = parentText
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      expect(parentLines.length).toBe(2);
      const callerLine = JSON.parse(parentLines[1] ?? "{}") as Record<string, unknown>;
      expect(callerLine.role).toBe("caller");
      const childRootHash = await getContentMerklePayload(cas, String(callerLine.contentHash));
      expect(childRootHash).not.toBeNull();
      const childThreadYaml = await cas.get(childRootHash ?? "");
      expect(childThreadYaml).not.toBeNull();
      const childThreadNode = parseMerkleNode(childThreadYaml ?? "");
      expect(childThreadNode.type).toBe("thread");
      const childPayload = childThreadNode.payload as Record<string, unknown>;
      expect(childPayload.workflow).toBe("child-wf");
      const childResult = childPayload.result as Record<string, unknown>;
      expect(childResult.summary).toBe("child-done:from-parent");

      const childDir = join(root, "logs", childHash);
      const childFiles = await readdir(childDir);
      const childDataName = childFiles.find((n) => n.endsWith(".data.jsonl"));
      expect(childDataName).toBeDefined();

      const childText = await readFile(join(childDir, childDataName ?? ""), "utf8");
      const childStart = JSON.parse(
        childText
          .trim()
          .split("\n")
          .filter((l) => l !== "")[0] ?? "{}",
      ) as Record<string, unknown>;
      expect(childStart.forkFrom).toEqual({ threadId });
      const childOpts = (childStart.parameters as Record<string, unknown>).options as Record<
        string,
        unknown
      >;
      expect(childOpts.depth).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
