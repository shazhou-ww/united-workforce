import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashWorkflowBundleBytes } from "../src/hash.js";
import {
  readWorkflowRegistry,
  registerWorkflowVersion,
  writeWorkflowRegistry,
} from "../src/registry.js";
import { type AgentContext, START } from "../src/types.js";
import { workflowAsAgent } from "../src/workflow-as-agent.js";

function makeAgentCtx(params: { depth: number; prompt: string; maxRounds: number }): AgentContext {
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
  };
}

const childBundleSource = `export const descriptor = {
  description: "child-test",
  roles: {
    agent: {
      description: "agent",
      schema: { type: "object", properties: {}, additionalProperties: true },
    },
  },
};
export async function* run(input) {
  yield { role: "agent", content: "child-body", meta: {}, refs: [] };
  return { returnCode: 0, summary: "child-done:" + input.prompt };
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
      const out = await agent(makeAgentCtx({ depth: 0, prompt: "x", maxRounds: 5 }));
      expect(out).toContain("not found in registry");
      expect(out).toContain("missing-wf");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("runs registered workflow and returns child summary string", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-waa-ok-"));
    try {
      await installChildWorkflow(root);
      const agent = workflowAsAgent("child-wf", { storageRoot: root });
      const out = await agent(makeAgentCtx({ depth: 0, prompt: "hello-parent", maxRounds: 5 }));
      expect(out).toBe("child-done:hello-parent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("enforces depth limit (returns error string, does not throw)", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-waa-depth-"));
    try {
      const agent = workflowAsAgent("child-wf", { storageRoot: root });
      const out = await agent(makeAgentCtx({ depth: 3, prompt: "x", maxRounds: 5 }));
      expect(out).toContain("depth limit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
