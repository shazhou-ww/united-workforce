import { describe, expect, test, vi } from "vitest";
const mock = vi.fn;
import type { CasStore } from "@uncaged/workflow-cas";
import type { ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

import { createAgentAdapter } from "../src/index.js";

// ── Minimal test fixtures ─────────────────────────────────────────────────────

function makeCtx(): ThreadContext {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    bundleHash: "TESTHASH00001",
    start: {
      role: "START" as const,
      content: "test task",
      meta: {},
      timestamp: 1,
      parentState: null,
    },
    steps: [],
  };
}

function makeCas(): CasStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  let seq = 0;
  return {
    store,
    async put(content: string) {
      const hash = `HASH${String(++seq).padStart(9, "0")}`;
      store.set(hash, content);
      return hash;
    },
    async get(hash: string) {
      return store.get(hash) ?? null;
    },
    async delete(hash: string) {
      store.delete(hash);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

// ── Frontmatter-compatible schema ─────────────────────────────────────────────

// Schema that maps directly to AgentFrontmatter fields so happy path works.
const FrontmatterSchema = z.object({
  status: z.union([
    z.literal("done"),
    z.literal("needs_input"),
    z.literal("in_progress"),
    z.literal("failed"),
    z.null(),
  ]),
  next: z.union([z.string(), z.null()]),
  confidence: z.union([z.number(), z.null()]),
  artifacts: z.array(z.string()),
  scope: z.union([z.literal("role"), z.literal("thread")]),
});

type FrontmatterMeta = z.infer<typeof FrontmatterSchema>;

// ── Happy path ────────────────────────────────────────────────────────────────

describe("createAgentAdapter — happy path (valid frontmatter satisfies schema)", () => {
  test("returns meta from frontmatter without calling runtime.extract", async () => {
    const cas = makeCas();
    const extractMock = mock(async () => {
      throw new Error("runtime.extract must not be called in happy path");
    });
    const runtime: WorkflowRuntime = { cas, extract: extractMock as WorkflowRuntime["extract"] };

    const rawOutput = [
      "---",
      "status: done",
      "next: reviewer",
      "confidence: 0.9",
      "artifacts: [src/foo.ts]",
      "scope: role",
      "---",
      "",
      "## Summary",
      "Work is complete.",
    ].join("\n");

    const agentFn = mock(async (_ctx: ThreadContext, _opts: null) => rawOutput);
    const extractOpts = mock(async () => null);

    const adapter = createAgentAdapter<null>(agentFn, extractOpts);
    const roleFn = adapter<FrontmatterMeta>("test prompt", FrontmatterSchema);
    const result = await roleFn(makeCtx(), runtime);

    // Meta must come from frontmatter
    expect(result.meta.status).toBe("done");
    expect(result.meta.next).toBe("reviewer");
    expect(result.meta.confidence).toBe(0.9);
    expect(result.meta.artifacts).toEqual(["src/foo.ts"]);
    expect(result.meta.scope).toBe("role");
    expect(result.childThread).toBeNull();

    // LLM extract must NOT have been called
    expect(extractMock).not.toHaveBeenCalled();

    // CAS should store the body (without frontmatter) as the CAS node payload
    const storedContent = [...cas.store.values()][0] ?? "";
    expect(storedContent).toContain("## Summary");
    expect(storedContent).toContain("Work is complete.");
    // The frontmatter block itself must not appear in the stored payload
    expect(storedContent).not.toContain("status: done\n");
  });

  test("body stored in CAS does not include the frontmatter block", async () => {
    const cas = makeCas();
    const runtime: WorkflowRuntime = {
      cas,
      extract: mock(async () => {
        throw new Error("must not be called");
      }) as WorkflowRuntime["extract"],
    };

    const rawOutput =
      "---\nstatus: done\nnext: null\nconfidence: null\nscope: role\n---\n\nThe actual work content here.";

    const adapter = createAgentAdapter<null>(
      mock(async () => rawOutput),
      mock(async () => null),
    );
    const roleFn = adapter<FrontmatterMeta>("prompt", FrontmatterSchema);
    await roleFn(makeCtx(), runtime);

    // CAS node wraps content as `payload: <body>`; check the payload contains only body
    const stored = [...cas.store.values()][0] ?? "";
    expect(stored).toContain("The actual work content here.");
    // The frontmatter block must be stripped
    expect(stored).not.toContain("status: done");
  });
});

// ── Fallback path ─────────────────────────────────────────────────────────────

describe("createAgentAdapter — fallback path (no frontmatter)", () => {
  test("calls runtime.extract when output has no frontmatter block", async () => {
    const cas = makeCas();
    const expectedMeta: FrontmatterMeta = {
      status: "done",
      next: null,
      confidence: null,
      artifacts: [],
      scope: "role",
    };

    const extractFn = mock(async (_schema: unknown, _hash: string) => ({
      meta: expectedMeta as Record<string, unknown>,
      contentPayload: "plain text output",
      refs: [],
    }));
    const runtime: WorkflowRuntime = { cas, extract: extractFn as WorkflowRuntime["extract"] };

    const rawOutput = "This is plain markdown without any frontmatter.";
    const adapter = createAgentAdapter<null>(
      mock(async () => rawOutput),
      mock(async () => null),
    );
    const roleFn = adapter<FrontmatterMeta>("prompt", FrontmatterSchema);
    const result = await roleFn(makeCtx(), runtime);

    // runtime.extract must have been called once
    expect(extractFn).toHaveBeenCalledTimes(1);
    expect(result.meta).toEqual(expectedMeta);
    expect(result.childThread).toBeNull();

    // CAS should store the full raw output (as CAS node payload)
    const stored = [...cas.store.values()][0] ?? "";
    expect(stored).toContain(rawOutput);
  });

  test("falls back to runtime.extract when frontmatter is structurally invalid", async () => {
    const cas = makeCas();
    const expectedMeta: FrontmatterMeta = {
      status: null,
      next: null,
      confidence: null,
      artifacts: [],
      scope: "role",
    };
    const extractFn = mock(async () => ({
      meta: expectedMeta as Record<string, unknown>,
      contentPayload: "",
      refs: [],
    }));
    const runtime: WorkflowRuntime = { cas, extract: extractFn as WorkflowRuntime["extract"] };

    // confidence out of range — validateFrontmatter will reject
    const rawOutput = "---\nstatus: done\nconfidence: 1.5\nscope: role\n---\n\nBody.";
    const adapter = createAgentAdapter<null>(
      mock(async () => rawOutput),
      mock(async () => null),
    );
    const roleFn = adapter<FrontmatterMeta>("prompt", FrontmatterSchema);
    await roleFn(makeCtx(), runtime);

    expect(extractFn).toHaveBeenCalledTimes(1);
  });

  test("falls back when frontmatter fields do not satisfy schema", async () => {
    const cas = makeCas();

    // Schema requires a mandatory non-null string field that frontmatter cannot provide
    const StrictSchema = z.object({
      requiredField: z.string(),
    });

    const extractFn = mock(async () => ({
      meta: { requiredField: "from-llm" } as Record<string, unknown>,
      contentPayload: "",
      refs: [],
    }));
    const runtime: WorkflowRuntime = { cas, extract: extractFn as WorkflowRuntime["extract"] };

    const rawOutput = "---\nstatus: done\nscope: role\n---\n\nBody.";
    const adapter = createAgentAdapter<null>(
      mock(async () => rawOutput),
      mock(async () => null),
    );
    const roleFn = adapter<{ requiredField: string }>("prompt", StrictSchema);
    await roleFn(makeCtx(), runtime);

    // frontmatter has no `requiredField`, so schema parse fails → fallback
    expect(extractFn).toHaveBeenCalledTimes(1);
  });
});
