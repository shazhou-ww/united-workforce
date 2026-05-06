import { describe, expect, test } from "bun:test";

import { jsonSchemaToTypeString } from "../src/json-schema-to-ts.js";

describe("jsonSchemaToTypeString", () => {
  test("maps primitives and object required fields", () => {
    const schema = {
      type: "object",
      properties: {
        plan: { type: "string" },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["plan", "files"],
    };
    expect(jsonSchemaToTypeString(schema)).toBe("{ plan: string; files: string[] }");
  });

  test("marks non-required object properties as nullable union", () => {
    const schema = {
      type: "object",
      properties: {
        n: { type: "number" },
      },
      required: [],
    };
    expect(jsonSchemaToTypeString(schema)).toBe("{ n: number | null }");
  });

  test("handles boolean and integer", () => {
    expect(jsonSchemaToTypeString({ type: "boolean" })).toBe("boolean");
    expect(jsonSchemaToTypeString({ type: "integer" })).toBe("number");
  });

  test("handles enum as literal union", () => {
    expect(jsonSchemaToTypeString({ enum: ["a", "b"] })).toBe(`"a" | "b"`);
  });
});
