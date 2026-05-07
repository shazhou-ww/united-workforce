import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow";

import { pathExists } from "./fs-utils.js";

export type CmdInitWorkspaceSuccess = {
  rootPath: string;
};

export type CmdInitTemplateSuccess = {
  templatePath: string;
};

function validateWorkspaceSegment(name: string): Result<void, string> {
  if (name.length === 0) {
    return err("workspace name must not be empty");
  }
  if (name === "." || name === "..") {
    return err("invalid workspace name");
  }
  if (name.includes("/") || name.includes("\\")) {
    return err("workspace name must not contain path separators");
  }
  return ok(undefined);
}

function rootPackageJson(workspaceName: string): string {
  return `${JSON.stringify(
    {
      name: workspaceName,
      private: true,
      type: "module",
      workspaces: ["templates/*", "workflows"],
    },
    null,
    2,
  )}\n`;
}

function workflowsPackageJson(): string {
  return `${JSON.stringify(
    {
      name: "workflows",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@uncaged/workflow": "^0.1.0",
        zod: "^4.0.0",
      },
    },
    null,
    2,
  )}\n`;
}

function biomeJson(): string {
  return `${JSON.stringify(
    {
      $schema: "https://biomejs.dev/schemas/2.4.14/schema.json",
      files: {
        includes: ["**", "!**/node_modules", "!**/dist"],
      },
      formatter: {
        indentWidth: 2,
      },
      linter: {
        enabled: true,
        rules: {
          recommended: true,
        },
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
      },
    },
    null,
    2,
  )}\n`;
}

function agentsMd(): string {
  return `# AGENTS

Placeholder: coding agent instructions for this workflow workspace will be added in a later phase.
`;
}

function readmeMd(workspaceName: string): string {
  return `# ${workspaceName}

Local workflow development workspace (Bun monorepo).

## Layout

- \`templates/\` — reusable workflow definition packages (roles + moderator), no agent binding
- \`workflows/\` — workflow instances that bind templates to agents and export \`run\` + \`descriptor\`

## Commands

\`\`\`sh
bun install
bun run check   # after you add scripts / Biome
uncaged-workflow add <name> <bundle.esm.js>
uncaged-workflow run <name>
\`\`\`

Create this skeleton with:

\`\`\`sh
uncaged-workflow init workspace ${workspaceName}
\`\`\`
`;
}

export async function cmdInitWorkspace(
  parentDir: string,
  workspaceName: string,
): Promise<Result<CmdInitWorkspaceSuccess, string>> {
  const validated = validateWorkspaceSegment(workspaceName);
  if (!validated.ok) {
    return validated;
  }

  const rootPath = join(parentDir, workspaceName);
  if (await pathExists(rootPath)) {
    return err(`directory already exists: ${rootPath}`);
  }

  await mkdir(rootPath, { recursive: false });
  await mkdir(join(rootPath, "templates"), { recursive: false });
  await mkdir(join(rootPath, "workflows"), { recursive: false });

  await Promise.all([
    writeFile(join(rootPath, "package.json"), rootPackageJson(workspaceName), "utf8"),
    writeFile(join(rootPath, "biome.json"), biomeJson(), "utf8"),
    writeFile(join(rootPath, "tsconfig.json"), tsconfigJson(), "utf8"),
    writeFile(join(rootPath, "AGENTS.md"), agentsMd(), "utf8"),
    writeFile(join(rootPath, "README.md"), readmeMd(workspaceName), "utf8"),
    writeFile(join(rootPath, "templates", ".gitkeep"), "", "utf8"),
    writeFile(join(rootPath, "workflows", "package.json"), workflowsPackageJson(), "utf8"),
  ]);

  return ok({ rootPath });
}

function hasTemplatesWorkspaceGlob(workspaces: unknown): boolean {
  return Array.isArray(workspaces) && workspaces.includes("templates/*");
}

async function readPackageJsonWorkspaces(dir: string): Promise<unknown | null> {
  const pkgPath = join(dir, "package.json");
  if (!(await pathExists(pkgPath))) {
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("workspaces" in parsed)) {
    return null;
  }
  return (parsed as { workspaces: unknown }).workspaces;
}

/** Resolve uncaged-workflow workspace root (package.json with `templates/*` in `workspaces`). */
async function findWorkflowWorkspaceRoot(startDir: string): Promise<Result<string, string>> {
  let dir = resolve(startDir);
  for (;;) {
    const workspaces = await readPackageJsonWorkspaces(dir);
    if (workspaces !== null && hasTemplatesWorkspaceGlob(workspaces)) {
      return ok(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return err(
        'not inside a workflow workspace (no package.json with workspaces containing "templates/*")',
      );
    }
    dir = parent;
  }
}

function templatePackageJson(templateName: string): string {
  return `${JSON.stringify(
    {
      name: `template-${templateName}`,
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@uncaged/workflow": "^0.1.0",
        zod: "^4.0.0",
      },
    },
    null,
    2,
  )}\n`;
}

function templateTsconfigJson(): string {
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

function templateRolesTs(): string {
  return `import type { RoleDefinition } from "@uncaged/workflow";
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
  extractPrompt: "Extract the assistant's greeting as message.",
  schema: greeterMetaSchema,
  extractRefs: null,
};
`;
}

function templateModeratorTs(): string {
  return `import { END, type Moderator, type ModeratorContext } from "@uncaged/workflow";

import type { HelloTemplateMeta } from "./roles.js";

export const helloTemplateModerator: Moderator<HelloTemplateMeta> = (
  ctx: ModeratorContext<HelloTemplateMeta>,
) => {
  if (ctx.steps.length === 0) {
    return "greeter";
  }
  return END;
};
`;
}

function templateIndexTs(): string {
  return `import type { WorkflowDefinition } from "@uncaged/workflow";

import { helloTemplateModerator } from "./moderator.js";
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
export { helloTemplateModerator } from "./moderator.js";

export const helloTemplateWorkflowDefinition: WorkflowDefinition<HelloTemplateMeta> = {
  description: HELLO_TEMPLATE_DESCRIPTION,
  roles: {
    greeter: greeterRole,
  },
  moderator: helloTemplateModerator,
};
`;
}

export async function cmdInitTemplate(
  startDir: string,
  templateName: string,
): Promise<Result<CmdInitTemplateSuccess, string>> {
  const validated = validateWorkspaceSegment(templateName);
  if (!validated.ok) {
    return validated;
  }

  const rootResult = await findWorkflowWorkspaceRoot(startDir);
  if (!rootResult.ok) {
    return rootResult;
  }

  const workspaceRoot = rootResult.value;
  const templateDir = join(workspaceRoot, "templates", templateName);
  if (await pathExists(templateDir)) {
    return err(`template already exists: ${templateDir}`);
  }

  await mkdir(join(templateDir, "src"), { recursive: true });

  await Promise.all([
    writeFile(join(templateDir, "package.json"), templatePackageJson(templateName), "utf8"),
    writeFile(join(templateDir, "tsconfig.json"), templateTsconfigJson(), "utf8"),
    writeFile(join(templateDir, "src", "roles.ts"), templateRolesTs(), "utf8"),
    writeFile(join(templateDir, "src", "moderator.ts"), templateModeratorTs(), "utf8"),
    writeFile(join(templateDir, "src", "index.ts"), templateIndexTs(), "utf8"),
  ]);

  return ok({ templatePath: templateDir });
}
