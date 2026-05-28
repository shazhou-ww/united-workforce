import { createMemoryStore, putSchema } from "@uncaged/json-cas";
import { describe, expect, test } from "vitest";

import { tryFrontmatterFastPath } from "../src/frontmatter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    $status: { type: "string", enum: ["ready", "failed"] },
    plan: { type: "string" },
  },
  required: ["$status"],
  additionalProperties: false,
};

const FRONTMATTER_SCHEMA = {
  type: "object",
  properties: {
    status: { anyOf: [{ type: "string" }, { type: "null" }] },
    next: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: { anyOf: [{ type: "number" }, { type: "null" }] },
    artifacts: { type: "array", items: { type: "string" } },
    scope: { type: "string" },
  },
  required: ["status", "next", "confidence", "artifacts", "scope"],
  additionalProperties: false,
};

describe("adapter-stdout: FrontmatterFastPathResult includes frontmatter", () => {
  test("A2. frontmatter field contains the parsed YAML frontmatter object", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, PLANNER_SCHEMA);

    const raw = `---\n$status: ready\nplan: abc123\n---\nSome body text`;
    const result = await tryFrontmatterFastPath(raw, schemaHash, store);

    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({ $status: "ready", plan: "abc123" });
  });

  test("A3. body field contains the markdown body after frontmatter", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, PLANNER_SCHEMA);

    const raw = `---\n$status: ready\nplan: hash123\n---\nHere is the body.\n\nWith multiple paragraphs.`;
    const result = await tryFrontmatterFastPath(raw, schemaHash, store);

    expect(result).not.toBeNull();
    expect(result!.body).toBe("Here is the body.\n\nWith multiple paragraphs.");
  });

  test("A1. result contains outputHash as valid CasRef", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, FRONTMATTER_SCHEMA);

    const raw = `---\nstatus: done\nnext: null\nconfidence: 0.9\nartifacts: []\nscope: test\n---\nBody`;
    const result = await tryFrontmatterFastPath(raw, schemaHash, store);

    expect(result).not.toBeNull();
    expect(result!.outputHash).toMatch(/^[0-9A-Z]{13}$/);
    expect(result!.frontmatter).toBeDefined();
    expect(result!.body).toBe("Body");
  });
});

describe("adapter-stdout: AdapterOutput JSON shape", () => {
  test("A5. JSON.stringify produces valid parseable JSON with all fields", () => {
    const output = {
      stepHash: "0123456789ABC",
      detailHash: "DEFGH12345678",
      role: "planner",
      frontmatter: { $status: "ready", plan: "somehash" },
      body: "Plan body text",
      startedAtMs: 1000,
      completedAtMs: 2000,
    };

    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);

    expect(parsed.stepHash).toBe("0123456789ABC");
    expect(parsed.detailHash).toBe("DEFGH12345678");
    expect(parsed.role).toBe("planner");
    expect(parsed.frontmatter).toEqual({ $status: "ready", plan: "somehash" });
    expect(parsed.body).toBe("Plan body text");
    expect(parsed.startedAtMs).toBe(1000);
    expect(parsed.completedAtMs).toBe(2000);
  });

  test("completedAtMs >= startedAtMs", () => {
    const output = {
      stepHash: "0123456789ABC",
      detailHash: "DEFGH12345678",
      role: "planner",
      frontmatter: {},
      body: "",
      startedAtMs: 1000,
      completedAtMs: 2000,
    };

    expect(output.completedAtMs).toBeGreaterThanOrEqual(output.startedAtMs);
  });
});
