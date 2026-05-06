import { createRoleModerator, END, type RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

type Roles = {
  greeter: { greeting: string };
};

const greeterMetaSchema = z.object({
  greeting: z.string(),
});

export const descriptor = {
  description: "A simple hello world workflow",
  roles: {
    greeter: {
      description: "Generates a greeting",
      schema: {
        type: "object",
        properties: { greeting: { type: "string" } },
        required: ["greeting"],
      },
    },
  },
};

const greeter: RoleDefinition<Roles["greeter"]> = {
  description: "Generates a greeting",
  schema: greeterMetaSchema,
  run: async (ctx) => ({
    content: `Hello, ${ctx.start.content}`,
    meta: { greeting: "Hello!" },
  }),
};

export const run = createRoleModerator<Roles>({
  roles: { greeter },
  moderator(ctx) {
    return ctx.steps.length === 0 ? "greeter" : END;
  },
});
