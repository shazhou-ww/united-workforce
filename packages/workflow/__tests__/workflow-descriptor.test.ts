import { describe, expect, test } from "bun:test";
import { validateWorkflowDescriptor } from "../src/bundle/workflow-descriptor.js";

describe("validateWorkflowDescriptor", () => {
  // 1. Valid minimal descriptor
  test("accepts a minimal descriptor with empty roles", () => {
    const result = validateWorkflowDescriptor({ description: "x", roles: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBe("x");
      expect(result.value.roles).toEqual({});
    }
  });

  // 2. Valid descriptor with one role
  test("accepts a descriptor with one role", () => {
    const result = validateWorkflowDescriptor({
      description: "workflow",
      roles: {
        solver: { description: "solves things", schema: { type: "object" } },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBe("workflow");
      expect(result.value.roles.solver.description).toBe("solves things");
      expect(result.value.roles.solver.schema).toEqual({ type: "object" });
    }
  });

  // 3. Valid descriptor with multiple roles
  test("accepts a descriptor with multiple roles", () => {
    const result = validateWorkflowDescriptor({
      description: "multi",
      roles: {
        a: { description: "role a", schema: {} },
        b: { description: "role b", schema: { type: "string" } },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value.roles)).toEqual(["a", "b"]);
    }
  });

  // 4-6. Root is null / array / string / number / undefined
  test("rejects null", () => {
    const result = validateWorkflowDescriptor(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor must be a non-array object");
  });

  test("rejects an array", () => {
    const result = validateWorkflowDescriptor([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor must be a non-array object");
  });

  test("rejects a string", () => {
    const result = validateWorkflowDescriptor("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor must be a non-array object");
  });

  test("rejects a number", () => {
    const result = validateWorkflowDescriptor(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor must be a non-array object");
  });

  test("rejects undefined", () => {
    const result = validateWorkflowDescriptor(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor must be a non-array object");
  });

  // 7-8. Missing or non-string description
  test("rejects missing description", () => {
    const result = validateWorkflowDescriptor({ roles: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.description must be a string");
  });

  test("rejects numeric description", () => {
    const result = validateWorkflowDescriptor({ description: 123, roles: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.description must be a string");
  });

  test("rejects null description", () => {
    const result = validateWorkflowDescriptor({ description: null, roles: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.description must be a string");
  });

  test("rejects boolean description", () => {
    const result = validateWorkflowDescriptor({ description: true, roles: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.description must be a string");
  });

  // 9-11. Missing / null / array roles
  test("rejects missing roles", () => {
    const result = validateWorkflowDescriptor({ description: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles must be a non-array object");
  });

  test("rejects null roles", () => {
    const result = validateWorkflowDescriptor({ description: "x", roles: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles must be a non-array object");
  });

  test("rejects array roles", () => {
    const result = validateWorkflowDescriptor({ description: "x", roles: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles must be a non-array object");
  });

  // 12-13. Role entry is null / array
  test("rejects null role entry", () => {
    const result = validateWorkflowDescriptor({ description: "x", roles: { bad: null } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles.bad must be a non-array object");
  });

  test("rejects array role entry", () => {
    const result = validateWorkflowDescriptor({ description: "x", roles: { bad: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles.bad must be a non-array object");
  });

  // 14-15. Role missing description / non-string description
  test("rejects role with missing description", () => {
    const result = validateWorkflowDescriptor({
      description: "x",
      roles: { r: { schema: {} } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles.r.description must be a string");
  });

  test("rejects role with non-string description", () => {
    const result = validateWorkflowDescriptor({
      description: "x",
      roles: { r: { description: 99, schema: {} } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles.r.description must be a string");
  });

  // 16-18. Role schema null / array / missing
  test("rejects role with null schema", () => {
    const result = validateWorkflowDescriptor({
      description: "x",
      roles: { r: { description: "d", schema: null } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("descriptor.roles.r.schema must be a non-array object");
  });

  test("rejects role with array schema", () => {
    const result = validateWorkflowDescriptor({
      description: "x",
      roles: { r: { description: "d", schema: [] } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("descriptor.roles.r.schema must be a non-array object");
  });

  test("rejects role with missing schema", () => {
    const result = validateWorkflowDescriptor({
      description: "x",
      roles: { r: { description: "d" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("descriptor.roles.r.schema must be a non-array object");
  });

  // 19. First role valid, second role invalid
  test("rejects at first invalid role when earlier roles are valid", () => {
    const result = validateWorkflowDescriptor({
      description: "x",
      roles: {
        good: { description: "ok", schema: {} },
        bad: { description: 123, schema: {} },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("descriptor.roles.bad.description must be a string");
  });
});
