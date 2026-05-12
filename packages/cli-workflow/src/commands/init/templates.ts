export function templatePackageJson(templateName: string): string {
  return `${JSON.stringify(
    {
      name: `template-${templateName}`,
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@uncaged/workflow-runtime": "^0.1.0",
        zod: "^4.0.0",
      },
    },
    null,
    2,
  )}\n`;
}

export function templateTsconfigJson(): string {
  return `${JSON.stringify(
    {
      extends: "../../tsconfig.json",
      compilerOptions: {
        rootDir: "src",
        outDir: "dist",
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

export function templateRolesTs(): string {
  return `import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

export const HELLO_TEMPLATE_DESCRIPTION =
  "Minimal starter template: one greeter role, then END.";

export type HelloTemplateMeta = {
  greeter: {
    message: string;
  };
};

const greeterMetaSchema = z.object({
  message: z.string(),
});

export const greeterRole: RoleDefinition<HelloTemplateMeta["greeter"]> = {
  description: "Says hello — replace with your first role.",
  systemPrompt: "You are a helpful assistant. Reply with one short friendly sentence.",
  schema: greeterMetaSchema,
  extractRefs: null,
};
`;
}

export function templateModeratorTs(): string {
  return `import { END, START, type ModeratorTable } from "@uncaged/workflow-runtime";

import type { HelloTemplateMeta } from "./roles.js";

export const helloTemplateTable: ModeratorTable<HelloTemplateMeta> = {
  [START]: [{ condition: "FALLBACK", role: "greeter" }],
  greeter: [{ condition: "FALLBACK", role: END }],
};
`;
}

export function templateIndexTs(): string {
  return `import type { WorkflowDefinition } from "@uncaged/workflow-runtime";

import { helloTemplateTable } from "./moderator.js";
import {
  HELLO_TEMPLATE_DESCRIPTION,
  type HelloTemplateMeta,
  greeterRole,
} from "./roles.js";

export {
  HELLO_TEMPLATE_DESCRIPTION,
  type HelloTemplateMeta,
  greeterRole,
} from "./roles.js";
export { helloTemplateTable } from "./moderator.js";

export const helloTemplateWorkflowDefinition: WorkflowDefinition<HelloTemplateMeta> = {
  description: HELLO_TEMPLATE_DESCRIPTION,
  roles: {
    greeter: greeterRole,
  },
  table: helloTemplateTable,
};
`;
}
