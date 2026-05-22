import { createMemoryStore, putSchema } from "@uncaged/json-cas";
import { describe, expect, test } from "vitest";

import { tryFrontmatterFastPath } from "../src/frontmatter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JSON Schema that exactly matches the AgentFrontmatter fields. */
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

/** JSON Schema that requires a non-frontmatter field — fast path must not satisfy it. */
const STRICT_SCHEMA = {
  type: "object",
  properties: {
    requiredField: { type: "string" },
  },
  required: ["requiredField"],
  additionalProperties: false,
};

async function makeStoreWithSchema(schema: Record<string, unknown>) {
  const store = createMemoryStore();
  const schemaHash = await putSchema(store, schema);
  return { store, schemaHash };
}

// ── Happy path ─────────────────────────────────────────────────────────────────

describe("tryFrontmatterFastPath — happy path", () => {
  test("parses valid frontmatter and returns outputHash + stripped body", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(FRONTMATTER_SCHEMA);

    const raw = [
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

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);

    expect(result).not.toBeNull();
    expect(result?.body).toContain("## Summary");
    expect(result?.body).toContain("Work is complete.");
    expect(result?.body).not.toContain("status: done");
    expect(typeof result?.outputHash).toBe("string");
    expect((result?.outputHash ?? "").length).toBeGreaterThan(0);
  });

  test("stored CAS node payload matches frontmatter fields", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(FRONTMATTER_SCHEMA);

    const raw =
      "---\nstatus: done\nnext: null\nconfidence: null\nartifacts: []\nscope: role\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).not.toBeNull();

    const node = store.get(result!.outputHash);
    expect(node).not.toBeNull();
    const payload = node!.payload as Record<string, unknown>;
    expect(payload.status).toBe("done");
    expect(payload.next).toBeNull();
    expect(payload.confidence).toBeNull();
    expect(payload.artifacts).toEqual([]);
    expect(payload.scope).toBe("role");
  });
});

// ── Fallback: no frontmatter ───────────────────────────────────────────────────

describe("tryFrontmatterFastPath — fallback: no frontmatter", () => {
  test("returns null for plain markdown without frontmatter block", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(FRONTMATTER_SCHEMA);

    const result = await tryFrontmatterFastPath(
      "This is plain markdown without any frontmatter.",
      schemaHash,
      store,
    );

    expect(result).toBeNull();
  });
});

// ── Fallback: invalid frontmatter ─────────────────────────────────────────────

describe("tryFrontmatterFastPath — fallback: invalid frontmatter", () => {
  test("returns null when confidence is out of range [0, 1]", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(FRONTMATTER_SCHEMA);

    const raw = "---\nstatus: done\nconfidence: 1.5\nscope: role\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).toBeNull();
  });

  test("returns null when next contains whitespace", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(FRONTMATTER_SCHEMA);

    const raw = "---\nstatus: done\nnext: some role\nscope: role\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).toBeNull();
  });
});

// ── Fallback: schema mismatch ─────────────────────────────────────────────────

describe("tryFrontmatterFastPath — fallback: schema mismatch", () => {
  test("returns null when outputSchema requires fields not in frontmatter", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(STRICT_SCHEMA);

    const raw = "---\nstatus: done\nscope: role\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).toBeNull();
  });
});
