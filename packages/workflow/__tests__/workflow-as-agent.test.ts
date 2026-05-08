import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentContext, START } from "@uncaged/workflow-runtime";
import { createCasStore } from "../src/cas/cas.js";
import { hashWorkflowBundleBytes } from "../src/cas/hash.js";
import { parseMerkleNode } from "../src/cas/merkle.js";
import {
  readWorkflowRegistry,
  registerWorkflowVersion,
  writeWorkflowRegistry,
} from "../src/registry/registry.js";
import { workflowAsAgent } from "../src/workflow-as-agent.js";

function makeAgentCtx(params: {
  storageRoot: string;
  depth: number;
  prompt: string;
  maxRounds: number;
}): AgentContext {
  const ts = Date.now();
  return {
    threadId: "01PARENT000000000000000001AA",
    depth: params.depth,
    start: {
      role: START,
      content: params.prompt,
      meta: { maxRounds: params.maxRounds },
      timestamp: ts,
    },
    steps: [],
    currentRole: {
      name: "caller",
      systemPrompt: "caller",
    },
    cas: createCasStore(join(params.storageRoot, "agent-ctx-cas")),
  };
}

const childBundleSource = `import { putContentMerkleNode } from "@uncaged/workflow";

export const descriptor = {
  description: "child-test",
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

describe("workflowAsAgent", () => {
  test("returns error when workflow name is not registered", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-waa-missing-"));
    try {
      const agent = workflowAsAgent("missing-wf", { storageRoot: root });
      const out = await agent(
        makeAgentCtx({ storageRoot: root, depth: 0, prompt: "x", maxRounds: 5 }),
      );
      expect(out).toContain("not found in registry");
      expect(out).toContain("missing-wf");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("runs registered workflow and returns child thread root CAS hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-waa-ok-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "workflow.yaml"),
        `config:
  maxDepth: 3
  providers:
    stub:
      baseUrl: http://127.0.0.1:9
      apiKey: test
  models:
    default: stub/m
workflows: {}
`,
        "utf8",
      );
      await installChildWorkflow(root);
      const agent = workflowAsAgent("child-wf", { storageRoot: root });
      const out = await agent(
        makeAgentCtx({ storageRoot: root, depth: 0, prompt: "hello-parent", maxRounds: 5 }),
      );
      const cas = createCasStore(join(root, "cas"));
      const threadYaml = await cas.get(out);
      expect(threadYaml).not.toBeNull();
      const node = parseMerkleNode(threadYaml ?? "");
      expect(node.type).toBe("thread");
      const payload = node.payload as Record<string, unknown>;
      expect(payload.workflow).toBe("child-wf");
      const resultObj = payload.result as Record<string, unknown>;
      expect(resultObj.summary).toBe("child-done:hello-parent");
      expect(node.children.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("enforces depth limit (returns error string, does not throw)", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-waa-depth-"));
    try {
      const agent = workflowAsAgent("child-wf", { storageRoot: root });
      const out = await agent(
        makeAgentCtx({ storageRoot: root, depth: 3, prompt: "x", maxRounds: 5 }),
      );
      expect(out).toContain("depth limit");
      expect(out).toContain("max 3");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses registry config maxDepth when set", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-waa-maxdepth-cfg-"));
    try {
      await installChildWorkflow(root);
      const reg = await readWorkflowRegistry(root);
      expect(reg.ok).toBe(true);
      if (!reg.ok) {
        return;
      }
      const withCfg = {
        ...reg.value,
        config: {
          maxDepth: 2,
          supervisorInterval: 3,
          providers: {
            local: {
              baseUrl: "http://127.0.0.1:9",
              apiKey: "k",
            },
          },
          models: {
            default: "local/m",
            extract: "local/m",
          },
        },
      };
      const wr = await writeWorkflowRegistry(root, withCfg);
      expect(wr.ok).toBe(true);

      const agent = workflowAsAgent("child-wf", { storageRoot: root });
      const okOut = await agent(
        makeAgentCtx({ storageRoot: root, depth: 1, prompt: "nest-once", maxRounds: 5 }),
      );
      expect(okOut).not.toContain("depth limit");

      const badOut = await agent(
        makeAgentCtx({ storageRoot: root, depth: 2, prompt: "x", maxRounds: 5 }),
      );
      expect(badOut).toContain("depth limit");
      expect(badOut).toContain("max 2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
