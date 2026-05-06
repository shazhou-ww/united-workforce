import { createRoleModerator, END, type Role } from "@uncaged/workflow";

type Roles = {
  greeter: { greeting: string };
};

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

const greeter: Role<Roles["greeter"]> = async (ctx) => ({
  content: `Hello, ${ctx.start.content}`,
  meta: { greeting: "Hello!" },
});

export default createRoleModerator<Roles>({
  roles: { greeter },
  moderator(ctx) {
    return ctx.steps.length === 0 ? "greeter" : END;
  },
});
