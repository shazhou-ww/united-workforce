import { createExtract, createWorkflow, END, type RoleDefinition } from "@uncaged/workflow";
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
  systemPrompt: "You greet the user briefly.",
  extractPrompt: "Extract the greeting string produced for the user.",
  schema: greeterMetaSchema,
};

const extract = createExtract({
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "",
});

export const run = createWorkflow<Roles>(
  {
    roles: { greeter },
    moderator(ctx) {
      return ctx.steps.length === 0 ? "greeter" : END;
    },
  },
  {
    agent: async (ctx) => `Hello, ${ctx.start.content}`,
  },
  extract,
);
