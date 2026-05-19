import { describe, expect, test } from "vitest";
import * as z from "zod/v4";

import { buildOutputFormatInstruction } from "../src/build-output-format-instruction.js";

describe("buildOutputFormatInstruction", () => {
  test("always includes the frontmatter example block", () => {
    const schema = z.object({ status: z.string() });
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("## Deliverable Format");
    expect(result).toContain("status:");
    expect(result).toContain("confidence:");
    expect(result).toContain("artifacts:");
    expect(result).toContain("scope:");
  });

  test("always includes scope reminder", () => {
    const schema = z.object({ status: z.string() });
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("Focus exclusively on YOUR role's deliverable");
    expect(result).toContain("Do not perform actions outside your role's scope");
  });

  test("lists fields from a flat ZodObject schema", () => {
    const schema = z.object({
      title: z.string(),
      phases: z.array(z.string()),
      reason: z.union([z.string(), z.null()]),
    });
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`title`");
    expect(result).toContain("`phases`");
    expect(result).toContain("`reason`");
  });

  test("lists union of fields from a discriminated union schema", () => {
    const schema = z.discriminatedUnion("status", [
      z.object({ status: z.literal("planned"), phases: z.array(z.string()) }),
      z.object({ status: z.literal("aborted"), reason: z.string() }),
    ]);
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`status`");
    expect(result).toContain("`phases`");
    expect(result).toContain("`reason`");
  });

  test("lists fields from a plain ZodUnion schema", () => {
    const schema = z.union([
      z.object({ kind: z.literal("a"), valueA: z.string() }),
      z.object({ kind: z.literal("b"), valueB: z.number() }),
    ]);
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("`kind`");
    expect(result).toContain("`valueA`");
    expect(result).toContain("`valueB`");
  });

  test("falls back gracefully for a non-object schema (no field list crash)", () => {
    const schema = z.string();
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("## Deliverable Format");
    expect(result).toContain("schema fields will be extracted automatically");
  });

  test("marks frontmatter as the primary deliverable", () => {
    const schema = z.object({ done: z.boolean() });
    const result = buildOutputFormatInstruction(schema);
    expect(result).toContain("primary deliverable");
  });

  test("no field is listed more than once for a union with overlapping keys", () => {
    const schema = z.union([
      z.object({ status: z.literal("a"), shared: z.string() }),
      z.object({ status: z.literal("b"), shared: z.string() }),
    ]);
    const result = buildOutputFormatInstruction(schema);
    const matches = [...result.matchAll(/`shared`/g)];
    expect(matches.length).toBe(1);
  });
});
