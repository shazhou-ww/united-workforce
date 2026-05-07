import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow";

import { pathExists } from "./fs-utils.js";

export type CmdInitWorkspaceSuccess = {
  rootPath: string;
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

export function cmdInitTemplate(_parentDir: string, _templateName: string): Result<void, string> {
  return err("not implemented yet");
}
