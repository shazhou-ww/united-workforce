import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { pathExists } from "../../fs-utils.js";

import {
  templateIndexTs,
  templateModeratorTs,
  templatePackageJson,
  templateRolesTs,
  templateTsconfigJson,
} from "./templates.js";
import type { CmdInitTemplateSuccess } from "./types.js";
import { validateWorkspaceSegment } from "./validate.js";

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
