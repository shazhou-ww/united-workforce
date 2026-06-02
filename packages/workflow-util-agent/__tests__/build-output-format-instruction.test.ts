import { describe, expect, test } from "bun:test";

import { buildOutputFormatInstruction } from "../src/build-output-format-instruction.js";

const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ready", "insufficient_info"] },
    plan: { type: "string" },
  },
  required: ["status"],
  additionalProperties: false,
};

const REVIEWER_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
  },
  required: ["approved"],
  additionalProperties: false,
};

describe("buildOutputFormatInstruction", () => {
  test("always includes the frontmatter example block", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toContain("---");
    expect(result).not.toContain("status: done");
    expect(result).not.toContain("confidence:");
    expect(result).not.toContain("scope: role");
  });

  test("always marks frontmatter as the primary deliverable", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toContain("primary deliverable");
  });

  test("generates planner-specific YAML example from schema", () => {
    const result = buildOutputFormatInstruction(PLANNER_SCHEMA);
    expect(result).toContain("status: ready  # required | ready | insufficient_info");
    expect(result).toContain("plan: <string>");
    expect(result).not.toContain("status: done");
    expect(result).not.toContain("confidence:");
    expect(result).not.toContain("artifacts:");
  });

  test("generates reviewer-specific YAML example from schema", () => {
    const result = buildOutputFormatInstruction(REVIEWER_SCHEMA);
    expect(result).toContain("approved: true  # required | true | false");
    expect(result).not.toContain("status:");
  });

  test("lists fields from a flat object schema with required marker", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["status"],
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`status` (required)");
    expect(result).toContain("`confidence`");
    expect(result).not.toContain("`confidence` (required)");
    expect(result).toContain("status: <string>  # required");
    expect(result).toContain("confidence: <number>");
  });

  test("lists union of fields from an anyOf schema", () => {
    const schema = {
      anyOf: [
        {
          type: "object",
          properties: { alpha: { type: "string" } },
        },
        {
          type: "object",
          properties: { beta: { type: "number" } },
        },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`alpha`");
    expect(result).toContain("`beta`");
    expect(result).toContain("alpha: <string>");
    expect(result).toContain("beta: <number>");
  });

  test("lists union of fields from a oneOf schema (no discriminant — flat merge)", () => {
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: { foo: { type: "string" } },
        },
        {
          type: "object",
          properties: { bar: { type: "boolean" } },
        },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    // No discriminant detected → falls back to flat merge
    expect(result).toContain("`foo`");
    expect(result).toContain("`bar`");
    expect(result).toContain("foo: <string>");
    expect(result).toContain("bar: true  # true | false");
  });

  test("renders per-variant instructions for discriminated oneOf", () => {
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: {
            $status: { const: "ready" },
            plan: { type: "string" },
          },
          required: ["$status", "plan"],
        },
        {
          type: "object",
          properties: {
            $status: { const: "insufficient_info" },
          },
          required: ["$status"],
        },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("Choose ONE of the following variants");
    expect(result).toContain("When `$status: ready`");
    expect(result).toContain("When `$status: insufficient_info`");
    expect(result).toContain("plan: <string>");
    // The insufficient_info variant should NOT mention plan
    const insufficientBlock = result.split("When `$status: insufficient_info`")[1];
    expect(insufficientBlock).not.toContain("plan:");
  });

  test("renders per-variant for single-enum discriminant", () => {
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: {
            $status: { type: "string", enum: ["approved"] },
            branch: { type: "string" },
          },
          required: ["$status"],
        },
        {
          type: "object",
          properties: {
            $status: { type: "string", enum: ["rejected"] },
            comments: { type: "string" },
          },
          required: ["$status"],
        },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("When `$status: approved`");
    expect(result).toContain("When `$status: rejected`");
    expect(result).toContain("branch: <string>");
    expect(result).toContain("comments: <string>");
  });

  test("falls back gracefully for a non-object schema with no properties", () => {
    const result = buildOutputFormatInstruction({ type: "string" });
    expect(result).toContain("schema fields will be extracted automatically");
  });

  test("does not list a field more than once for a union with overlapping keys", () => {
    const schema = {
      anyOf: [
        { type: "object", properties: { shared: { type: "string" } } },
        { type: "object", properties: { shared: { type: "number" } } },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    const matches = [...result.matchAll(/`shared`/g)];
    expect(matches.length).toBe(1);
    expect(result).toContain("shared: <string>");
  });

  test("marks required when any union variant requires the field", () => {
    const schema = {
      anyOf: [
        {
          type: "object",
          properties: { shared: { type: "string" } },
          required: ["shared"],
        },
        { type: "object", properties: { shared: { type: "number" } } },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`shared` (required)");
    expect(result).toContain("shared: <string>  # required");
  });

  test("explicitly forbids extra frontmatter fields", () => {
    const result = buildOutputFormatInstruction(PLANNER_SCHEMA);
    expect(result).toMatch(/\b(only|exclusively)\b.*fields/i);
    expect(result).toMatch(/do not add (extra|additional|other) fields/i);
  });

  test("forbids extra fields even for empty schema", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toMatch(/do not add (extra|additional|other) fields/i);
  });

  test("forbids extra fields for anyOf/oneOf schemas", () => {
    const schema = {
      anyOf: [
        { type: "object", properties: { alpha: { type: "string" } } },
        { type: "object", properties: { beta: { type: "number" } } },
      ],
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toMatch(/do not add (extra|additional|other) fields/i);
  });

  test("includes focus reminder about role scope", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toContain("Focus exclusively on YOUR role");
  });
});
