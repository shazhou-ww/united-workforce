import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";
import { collectCasRefs } from "../src/collect-cas-refs.js";

const phaseSchema = z.object({
  hash: z.string().meta({ casRef: true }),
  title: z.string(),
});

const plannerMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("planned"),
    phases: z.array(phaseSchema),
  }),
  z.object({
    status: z.literal("aborted"),
    reason: z.string(),
  }),
]);

describe("collectCasRefs", () => {
  test("1. flat field with casRef annotation", () => {
    const schema = z.object({
      completedPhase: z.string().meta({ casRef: true }),
    });
    expect(collectCasRefs(schema, { completedPhase: "BHAAAAAAAAAAA" })).toEqual(["BHAAAAAAAAAAA"]);
  });

  test("2. plain string without annotation is ignored", () => {
    const schema = z.object({
      summary: z.string(),
      completedPhase: z.string().meta({ casRef: true }),
    });
    expect(
      collectCasRefs(schema, {
        summary: "done",
        completedPhase: "BHBBBBBBBBBBB",
      }),
    ).toEqual(["BHBBBBBBBBBBB"]);
  });

  test("3. nested array of objects collects each annotated hash", () => {
    const schema = z.object({
      phases: z.array(phaseSchema),
    });
    expect(
      collectCasRefs(schema, {
        phases: [
          { hash: "BH11111111111", title: "setup" },
          { hash: "BH22222222222", title: "impl" },
        ],
      }),
    ).toEqual(["BH11111111111", "BH22222222222"]);
  });

  test("4. discriminatedUnion — planner planned branch", () => {
    expect(
      collectCasRefs(plannerMetaSchema, {
        status: "planned",
        phases: [
          { hash: "BH33333333333", title: "a" },
          { hash: "BH44444444444", title: "b" },
        ],
      }),
    ).toEqual(["BH33333333333", "BH44444444444"]);
  });

  test("4b. discriminatedUnion — planner aborted branch", () => {
    expect(
      collectCasRefs(plannerMetaSchema, {
        status: "aborted",
        reason: "missing workspace",
      }),
    ).toEqual([]);
  });

  test("5. null and undefined annotated fields are skipped", () => {
    const schema = z.object({
      ref: z.string().meta({ casRef: true }).nullable(),
      optionalRef: z.string().meta({ casRef: true }).optional(),
    });
    expect(collectCasRefs(schema, { ref: null, optionalRef: undefined })).toEqual([]);
    expect(collectCasRefs(schema, { ref: "BH55555555555", optionalRef: undefined })).toEqual([
      "BH55555555555",
    ]);
  });

  test("6. mixed annotated and plain fields at multiple levels", () => {
    const schema = z.object({
      label: z.string(),
      phase: z.object({
        hash: z.string().meta({ casRef: true }),
        title: z.string(),
      }),
      tags: z.array(z.string()),
    });
    expect(
      collectCasRefs(schema, {
        label: "coder",
        phase: { hash: "BH66666666666", title: "fix" },
        tags: ["a", "b"],
      }),
    ).toEqual(["BH66666666666"]);
  });

  test("7. empty phases array yields no refs", () => {
    expect(
      collectCasRefs(plannerMetaSchema, {
        status: "planned",
        phases: [],
      }),
    ).toEqual([]);
  });
});
