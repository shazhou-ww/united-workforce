import { describe, expect, test } from "bun:test";
import { validateWorkflowDescriptor } from "@uncaged/workflow";
import * as z from "zod/v4";

import { buildDescriptorFromRoles } from "../src/build-descriptor.js";

describe("buildDescriptorFromRoles", () => {
  test("produces a descriptor that validates and includes JSON schemas per role", () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
    });

    const descriptor = buildDescriptorFromRoles({
      description: "Demo workflow",
      roles: {
        analyst: {
          name: "analyst",
          schema,
          description: "Analyzes input",
        },
      },
    });

    const validated = validateWorkflowDescriptor(descriptor);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }

    expect(validated.value.description).toBe("Demo workflow");
    const analyst = validated.value.roles.analyst;
    expect(analyst.description).toBe("Analyzes input");
    expect(analyst.schema.type).toBe("object");
    const props = analyst.schema.properties as Record<string, unknown>;
    expect(props.title).toMatchObject({ type: "string" });
    expect(props.count).toMatchObject({ type: "number" });
  });

  test("uses empty description when spec.description is null", () => {
    const descriptor = buildDescriptorFromRoles({
      description: "W",
      roles: {
        x: {
          name: "x",
          schema: z.object({ n: z.number() }),
          description: null,
        },
      },
    });

    const validated = validateWorkflowDescriptor(descriptor);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.value.roles.x.description).toBe("");
  });

  test("throws when role key and spec.name diverge", () => {
    expect(() =>
      buildDescriptorFromRoles({
        description: "W",
        roles: {
          a: {
            name: "b",
            schema: z.object({ n: z.number() }),
            description: null,
          },
        },
      }),
    ).toThrow(/must match spec.name/);
  });
});
