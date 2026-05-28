import { createMemoryStore, putSchema } from "@uncaged/json-cas";
import { describe, expect, test } from "vitest";

import { tryFrontmatterFastPath } from "../src/frontmatter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JSON Schema that matches the new status-only AgentFrontmatter. */
const STATUS_ONLY_SCHEMA = {
  type: "object",
  properties: {
    status: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["status"],
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

/** Role-specific schema (reviewer) — only approved, no standard agent fields. */
const REVIEWER_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
  },
  required: ["approved"],
  additionalProperties: false,
};

/** Role-specific schema (planner) — custom status enum + plan hash. */
const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ready", "insufficient_info"] },
    plan: { type: "string" },
  },
  required: ["status"],
  additionalProperties: false,
};

async function makeStoreWithSchema(schema: Record<string, unknown>) {
  const store = createMemoryStore();
  const schemaHash = await putSchema(store, schema);
  return { store, schemaHash };
}

// ── STANDARD_KEYS ────────────────────────────────────────────────────────────

describe("STANDARD_KEYS contains only status", () => {
  test("STANDARD_KEYS is ['status']", async () => {
    // We verify indirectly: defaultCandidate (no schema fields) returns only { status }
    const { store, schemaHash } = await makeStoreWithSchema({
      type: "object",
      properties: {
        status: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    });

    const raw = "---\nstatus: done\n---\n\nBody.";
    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).not.toBeNull();

    const node = store.get(result!.outputHash);
    expect(node).not.toBeNull();
    const payload = node!.payload as Record<string, unknown>;
    expect(payload.status).toBe("done");
    // Legacy fields must NOT be present
    expect(payload.next).toBeUndefined();
    expect(payload.confidence).toBeUndefined();
    expect(payload.artifacts).toBeUndefined();
    expect(payload.scope).toBeUndefined();
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe("tryFrontmatterFastPath — happy path", () => {
  test("parses valid frontmatter and returns outputHash + stripped body", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(STATUS_ONLY_SCHEMA);

    const raw = ["---", "status: done", "---", "", "## Summary", "Work is complete."].join("\n");

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);

    expect(result).not.toBeNull();
    expect(result?.body).toContain("## Summary");
    expect(result?.body).toContain("Work is complete.");
    expect(result?.body).not.toContain("status: done");
    expect(typeof result?.outputHash).toBe("string");
    expect((result?.outputHash ?? "").length).toBeGreaterThan(0);
  });

  test("stored CAS node payload has only status", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(STATUS_ONLY_SCHEMA);

    const raw = "---\nstatus: done\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).not.toBeNull();

    const node = store.get(result!.outputHash);
    expect(node).not.toBeNull();
    const payload = node!.payload as Record<string, unknown>;
    expect(payload.status).toBe("done");
    expect(Object.keys(payload)).toEqual(["status"]);
  });
});

// ── Legacy fields in input are ignored ──────────────────────────────────────

describe("tryFrontmatterFastPath — legacy fields ignored", () => {
  test("legacy fields in input do not appear in CAS output", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(STATUS_ONLY_SCHEMA);

    const raw =
      "---\nstatus: done\nnext: reviewer\nconfidence: 0.9\nartifacts: [a.ts]\nscope: thread\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).not.toBeNull();

    const node = store.get(result!.outputHash);
    const payload = node!.payload as Record<string, unknown>;
    expect(payload.status).toBe("done");
    expect(payload.next).toBeUndefined();
    expect(payload.confidence).toBeUndefined();
    expect(payload.artifacts).toBeUndefined();
    expect(payload.scope).toBeUndefined();
  });
});

// ── Fallback: no frontmatter ───────────────────────────────────────────────────

describe("tryFrontmatterFastPath — fallback: no frontmatter", () => {
  test("returns null for plain markdown without frontmatter block", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(STATUS_ONLY_SCHEMA);

    const result = await tryFrontmatterFastPath(
      "This is plain markdown without any frontmatter.",
      schemaHash,
      store,
    );

    expect(result).toBeNull();
  });
});

// ── Fallback: schema mismatch ─────────────────────────────────────────────────

describe("tryFrontmatterFastPath — fallback: schema mismatch", () => {
  test("returns null when outputSchema requires fields not in frontmatter", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(STRICT_SCHEMA);

    const raw = "---\nstatus: done\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).toBeNull();
  });
});

// ── Role-specific schema fields ───────────────────────────────────────────────

describe("tryFrontmatterFastPath — role-specific fields", () => {
  test("extracts approved only for reviewer schema (no extra standard fields)", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(REVIEWER_SCHEMA);

    const raw = "---\napproved: true\n---\n\nReview passed.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).not.toBeNull();

    const node = store.get(result!.outputHash);
    expect(node).not.toBeNull();
    const payload = node!.payload as Record<string, unknown>;
    expect(payload).toEqual({ approved: true });
    expect(payload.status).toBeUndefined();
    expect(payload.scope).toBeUndefined();
  });

  test("extracts plan and role-specific status for planner schema", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(PLANNER_SCHEMA);

    const raw = "---\nstatus: ready\nplan: 01HASHPLANNER0001\n---\n\nSpec summary.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).not.toBeNull();

    const node = store.get(result!.outputHash);
    expect(node).not.toBeNull();
    const payload = node!.payload as Record<string, unknown>;
    expect(payload.status).toBe("ready");
    expect(payload.plan).toBe("01HASHPLANNER0001");
    expect(payload.scope).toBeUndefined();
  });

  test("returns null when required role-specific field is missing", async () => {
    const { store, schemaHash } = await makeStoreWithSchema(REVIEWER_SCHEMA);

    const raw = "---\nstatus: done\n---\n\nBody.";

    const result = await tryFrontmatterFastPath(raw, schemaHash, store);
    expect(result).toBeNull();
  });
});
