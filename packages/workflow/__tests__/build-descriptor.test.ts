import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";

import { buildDescriptor } from "../src/build-descriptor.js";
import { END } from "../src/types.js";
import { validateWorkflowDescriptor } from "../src/workflow-descriptor.js";

describe("buildDescriptor", () => {
  test("produces a descriptor that validates and includes JSON schemas per role", () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
    });

    type M = { analyst: z.infer<typeof schema> };

    const descriptor = buildDescriptor<M>({
      description: "Demo workflow",
      roles: {
        analyst: {
          description: "Analyzes input",
          schema,
          run: async () => ({ content: "", meta: { title: "", count: 0 } }),
        },
      },
      moderator: () => END,
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
});
