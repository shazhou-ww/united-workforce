import { describe, expect, test } from "vitest";

import { buildOutputFormatInstruction } from "../src/build-output-format-instruction.js";

describe("buildOutputFormatInstruction", () => {
  test("always includes the frontmatter example block", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toContain("---");
    expect(result).toContain("status: done");
    expect(result).toContain("confidence:");
    expect(result).toContain("scope: role");
  });

  test("always marks frontmatter as the primary deliverable", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toContain("primary deliverable");
  });

  test("lists fields from a flat object schema", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string" },
        confidence: { type: "number" },
      },
    };
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`status`");
    expect(result).toContain("`confidence`");
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
  });

  test("lists union of fields from a oneOf schema", () => {
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
    expect(result).toContain("`foo`");
    expect(result).toContain("`bar`");
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
  });

  test("includes focus reminder about role scope", () => {
    const result = buildOutputFormatInstruction({});
    expect(result).toContain("Focus exclusively on YOUR role");
  });
});
