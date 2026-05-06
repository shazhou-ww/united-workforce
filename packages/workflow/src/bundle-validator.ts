import { isBuiltin } from "node:module";

import * as acorn from "acorn";
import type { Node, Program } from "acorn";

import { err, ok, type Result } from "./result.js";

export type WorkflowBundleValidationInput = {
  /** Absolute or relative path (used for `.esm.js` suffix checks). */
  filePath: string;
  /** UTF-8 source of the bundle. */
  source: string;
};

function endsWithEsmJs(path: string): boolean {
  return path.endsWith(".esm.js");
}

function isAllowedImportSpecifier(spec: string): boolean {
  if (spec.length === 0) {
    return false;
  }
  if (spec.startsWith(".") || spec.startsWith("/")) {
    return false;
  }
  return isBuiltin(spec);
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    const val = (node as Record<string, unknown>)[key];
    if (val === null || val === undefined) {
      continue;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item !== null && typeof item === "object" && "type" in item) {
          walk(item as Node, visit);
        }
      }
    } else if (typeof val === "object" && "type" in val) {
      walk(val as Node, visit);
    }
  }
}

function programHasDefaultExport(body: readonly Node[]): boolean {
  for (const stmt of body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      return true;
    }
  }
  return false;
}

/**
 * Validate RFC-001 bundle rules: single-file ESM shape, default export,
 * no dynamic `import()`, static imports restricted to Node builtins.
 */
export function validateWorkflowBundle(input: WorkflowBundleValidationInput): Result<void, string> {
  if (!endsWithEsmJs(input.filePath)) {
    return err('workflow bundle file must use the ".esm.js" suffix');
  }

  let ast: Node;
  try {
    ast = acorn.parse(input.source, {
      ecmaVersion: 2022,
      sourceType: "module",
      locations: false,
    }) as Node;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to parse module: ${message}`);
  }

  if (ast.type !== "Program") {
    return err("internal error: expected Program root");
  }

  const program = ast as Program;
  if (!programHasDefaultExport(program.body)) {
    return err("workflow bundle must have a default export");
  }

  let walkError: string | null = null;
  walk(ast, (n) => {
    if (walkError !== null) {
      return;
    }
    if (n.type === "ImportExpression") {
      walkError = "dynamic import() is not allowed in workflow bundles";
      return;
    }
    if (n.type === "ImportDeclaration") {
      const src = n.source;
      if (src.type !== "Literal" || typeof src.value !== "string") {
        walkError = "only static string import specifiers are allowed";
        return;
      }
      if (!isAllowedImportSpecifier(src.value)) {
        walkError = `disallowed import specifier "${src.value}" (only Node built-ins are allowed)`;
      }
      return;
    }
    if (n.type === "ExportNamedDeclaration" && n.source !== null && n.source !== undefined) {
      const src = n.source;
      if (src.type !== "Literal" || typeof src.value !== "string") {
        walkError = "only static string re-export specifiers are allowed";
        return;
      }
      if (!isAllowedImportSpecifier(src.value)) {
        walkError = `disallowed re-export specifier "${src.value}" (only Node built-ins are allowed)`;
      }
      return;
    }
    if (n.type === "ExportAllDeclaration") {
      const src = n.source;
      if (src.type !== "Literal" || typeof src.value !== "string") {
        walkError = "only static string export-all specifiers are allowed";
        return;
      }
      if (!isAllowedImportSpecifier(src.value)) {
        walkError = `disallowed export-all specifier "${src.value}" (only Node built-ins are allowed)`;
      }
      return;
    }
    if (n.type === "CallExpression") {
      const c = n.callee;
      if (c.type === "Identifier" && c.name === "require") {
        walkError = "require() is not allowed in workflow bundles";
      }
    }
  });

  if (walkError !== null) {
    return err(walkError);
  }

  return ok(undefined);
}
