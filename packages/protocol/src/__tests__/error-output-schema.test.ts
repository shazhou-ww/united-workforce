import { bootstrap, createMemoryStore, putSchema, validate } from "@ocas/core";
import { describe, expect, test } from "vitest";
import { ERROR_OUTPUT_SCHEMA } from "../schemas.js";

function setup() {
  const store = createMemoryStore();
  bootstrap(store);
  const errorSchemaHash = putSchema(store, ERROR_OUTPUT_SCHEMA);
  return { store, errorSchemaHash };
}

describe("ERROR_OUTPUT_SCHEMA", () => {
  test("E1. validates payload with $status='error' and error message", () => {
    const { store, errorSchemaHash } = setup();
    const hash = store.cas.put(errorSchemaHash, {
      $status: "error",
      error: "boom",
    });
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("E2. rejects payload with $status other than 'error'", () => {
    const { store, errorSchemaHash } = setup();
    const hash = store.cas.put(errorSchemaHash, { $status: "ready", error: "boom" });
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("E3. rejects payload missing 'error' field", () => {
    const { store, errorSchemaHash } = setup();
    const hash = store.cas.put(errorSchemaHash, { $status: "error" });
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("E4. accepts optional 'phase' field", () => {
    const { store, errorSchemaHash } = setup();
    const hash = store.cas.put(errorSchemaHash, {
      $status: "error",
      error: "frontmatter validation failed",
      phase: "frontmatter_extraction",
    });
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("E5. rejects unknown additional properties", () => {
    const { store, errorSchemaHash } = setup();
    const hash = store.cas.put(errorSchemaHash, {
      $status: "error",
      error: "boom",
      unexpected: "field",
    });
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });
});
