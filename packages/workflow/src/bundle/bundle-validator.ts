import { isBuiltin } from "node:module";
import type {
  CallExpression,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ExportSpecifier,
  FunctionDeclaration,
  ImportDeclaration,
  Node,
  Program,
  VariableDeclaration,
} from "acorn";

/** Acorn Node with index-access for property traversal. */
type AcornNode = Node & { [key: string]: unknown };

/**
 * Narrow an Acorn Node to a specific AST subtype after a `.type` guard.
 * Avoids double-cast (`as unknown as T`) by going through AcornNode.
 */
function narrowNode<T extends Node>(node: Node): T {
  return node as unknown as T;
}

import * as acorn from "acorn";

import { err, ok, type Result } from "../util/result.js";

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
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:")) {
    return false;
  }
  if (spec === "@uncaged/workflow") {
    return true;
  }
  return isBuiltin(spec);
}

function pushNestedAstNodes(value: unknown, out: Node[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === "object" && "type" in item) {
        out.push(item as Node);
      }
    }
    return;
  }
  if (typeof value === "object" && "type" in value) {
    out.push(value as Node);
  }
}

function collectChildNodes(node: Node): Node[] {
  const children: Node[] = [];
  for (const key of Object.keys(node)) {
    const val = (node as AcornNode)[key];
    pushNestedAstNodes(val, children);
  }
  return children;
}

function walkAst(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of collectChildNodes(node)) {
    walkAst(child, visit);
  }
}

function exportSpecifierExportedName(spec: ExportSpecifier): string | null {
  if (spec.exported.type !== "Identifier") {
    return null;
  }
  return spec.exported.name;
}

function exportNamedDeclReExportsDefault(named: ExportNamedDeclaration): boolean {
  if (named.source !== null && named.source !== undefined) {
    return false;
  }
  return named.specifiers.some(
    (spec) => spec.type === "ExportSpecifier" && exportSpecifierExportedName(spec) === "default",
  );
}

function programUsesDefaultExport(program: Program): boolean {
  for (const stmt of program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      return true;
    }
    if (stmt.type === "ExportNamedDeclaration" && exportNamedDeclReExportsDefault(stmt)) {
      return true;
    }
  }
  return false;
}

function bindingInitializerIsCallable(init: Node): boolean {
  return (
    init.type === "FunctionExpression" ||
    init.type === "ArrowFunctionExpression" ||
    init.type === "CallExpression"
  );
}

function variableDeclarationBindsCallableName(stmt: VariableDeclaration, name: string): boolean {
  for (const decl of stmt.declarations) {
    if (decl.id.type !== "Identifier" || decl.id.name !== name) {
      continue;
    }
    const init = decl.init;
    if (init === null || init === undefined) {
      continue;
    }
    if (bindingInitializerIsCallable(init)) {
      return true;
    }
  }
  return false;
}

function programDeclaresCallableExportBinding(program: Program, name: string): boolean {
  for (const stmt of program.body) {
    if (stmt.type === "FunctionDeclaration") {
      const fd = stmt as FunctionDeclaration;
      const id = fd.id;
      if (id !== null && id !== undefined && id.type === "Identifier" && id.name === name) {
        return true;
      }
    }
    if (stmt.type === "VariableDeclaration" && variableDeclarationBindsCallableName(stmt, name)) {
      return true;
    }
  }
  return false;
}

function namedExportDeclExportsRunCallable(named: ExportNamedDeclaration): boolean {
  const decl = named.declaration;
  if (decl === null || decl === undefined) {
    return false;
  }
  if (decl.type === "FunctionDeclaration") {
    const id = decl.id;
    return id !== null && id !== undefined && id.type === "Identifier" && id.name === "run";
  }
  if (decl.type === "VariableDeclaration") {
    return variableDeclarationBindsCallableName(decl, "run");
  }
  return false;
}

function findRunExportLocalBindingName(program: Program): string | null {
  for (const stmt of program.body) {
    if (stmt.type !== "ExportNamedDeclaration") {
      continue;
    }
    const named = stmt as ExportNamedDeclaration;
    if (named.source !== null && named.source !== undefined) {
      continue;
    }
    for (const spec of named.specifiers) {
      if (spec.type !== "ExportSpecifier" || exportSpecifierExportedName(spec) !== "run") {
        continue;
      }
      const loc = spec.local;
      if (loc.type !== "Identifier") {
        return null;
      }
      return loc.name;
    }
  }
  return null;
}

function runExportIsCallable(program: Program): boolean {
  for (const stmt of program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const named = stmt as ExportNamedDeclaration;
      if (namedExportDeclExportsRunCallable(named)) {
        return true;
      }
    }
  }

  const exportBinding = findRunExportLocalBindingName(program);
  if (exportBinding !== null) {
    return programDeclaresCallableExportBinding(program, exportBinding);
  }
  return false;
}

function namedExportDeclExportsDescriptor(named: ExportNamedDeclaration): boolean {
  const decl = named.declaration;
  if (decl === null || decl === undefined || decl.type !== "VariableDeclaration") {
    return false;
  }
  for (const d of decl.declarations) {
    if (d.id.type === "Identifier" && d.id.name === "descriptor") {
      return true;
    }
  }
  return false;
}

function functionDeclarationNamed(stmt: FunctionDeclaration, name: string): boolean {
  const id = stmt.id;
  return id !== null && id !== undefined && id.type === "Identifier" && id.name === name;
}

function variableDeclarationNames(stmt: VariableDeclaration, name: string): boolean {
  for (const decl of stmt.declarations) {
    if (decl.id.type === "Identifier" && decl.id.name === name) {
      return true;
    }
  }
  return false;
}

function programDeclaresBindingName(program: Program, name: string): boolean {
  for (const stmt of program.body) {
    if (
      stmt.type === "FunctionDeclaration" &&
      functionDeclarationNamed(stmt as FunctionDeclaration, name)
    ) {
      return true;
    }
    if (stmt.type === "VariableDeclaration" && variableDeclarationNames(stmt, name)) {
      return true;
    }
  }
  return false;
}

function findDescriptorExportLocalBindingName(program: Program): string | null {
  for (const stmt of program.body) {
    if (stmt.type !== "ExportNamedDeclaration") {
      continue;
    }
    const named = stmt as ExportNamedDeclaration;
    if (named.source !== null && named.source !== undefined) {
      continue;
    }
    for (const spec of named.specifiers) {
      if (spec.type !== "ExportSpecifier" || exportSpecifierExportedName(spec) !== "descriptor") {
        continue;
      }
      const loc = spec.local;
      if (loc.type !== "Identifier") {
        return null;
      }
      return loc.name;
    }
  }
  return null;
}

function descriptorExportExists(program: Program): boolean {
  for (const stmt of program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const named = stmt as ExportNamedDeclaration;
      if (namedExportDeclExportsDescriptor(named)) {
        return true;
      }
    }
  }
  const binding = findDescriptorExportLocalBindingName(program);
  if (binding === null) {
    return false;
  }
  return programDeclaresBindingName(program, binding);
}

function stringLiteralModuleSpecifier(src: Node): string | null {
  if (src.type !== "Literal" || typeof (src as AcornNode).value !== "string") {
    return null;
  }
  return (src as AcornNode).value as string;
}

function validateImportDeclaration(node: ImportDeclaration): string | null {
  const spec = stringLiteralModuleSpecifier(node.source);
  if (spec === null) {
    return "only static string import specifiers are allowed";
  }
  if (!isAllowedImportSpecifier(spec)) {
    return `disallowed import specifier "${spec}" (only Node built-ins and "@uncaged/workflow" are allowed)`;
  }
  return null;
}

function validateExportSource(
  src: Node,
  staticMessage: string,
  disallowedPrefix: string,
): string | null {
  const spec = stringLiteralModuleSpecifier(src);
  if (spec === null) {
    return staticMessage;
  }
  if (!isAllowedImportSpecifier(spec)) {
    return `${disallowedPrefix} "${spec}" (only Node built-ins and "@uncaged/workflow" are allowed)`;
  }
  return null;
}

function validateExportNamedDeclaration(node: ExportNamedDeclaration): string | null {
  if (node.source === null || node.source === undefined) {
    return null;
  }
  return validateExportSource(
    node.source,
    "only static string re-export specifiers are allowed",
    "disallowed re-export specifier",
  );
}

function validateExportAllDeclaration(node: ExportAllDeclaration): string | null {
  return validateExportSource(
    node.source,
    "only static string export-all specifiers are allowed",
    "disallowed export-all specifier",
  );
}

function validateRequireCall(node: CallExpression): string | null {
  const callee = node.callee;
  if (callee.type === "Identifier" && callee.name === "require") {
    return "require() is not allowed in workflow bundles";
  }
  return null;
}

function bundleConstraintViolationForNode(node: Node): string | null {
  if (node.type === "ImportExpression") {
    return "dynamic import() is not allowed in workflow bundles";
  }
  if (node.type === "ImportDeclaration") {
    return validateImportDeclaration(narrowNode<ImportDeclaration>(node));
  }
  if (node.type === "ExportNamedDeclaration") {
    return validateExportNamedDeclaration(narrowNode<ExportNamedDeclaration>(node));
  }
  if (node.type === "ExportAllDeclaration") {
    return validateExportAllDeclaration(narrowNode<ExportAllDeclaration>(node));
  }
  if (node.type === "CallExpression") {
    return validateRequireCall(narrowNode<CallExpression>(node));
  }
  return null;
}

/**
 * Validate RFC-001 bundle rules: single-file ESM shape, named exports `run` + `descriptor`,
 * no default export, no dynamic `import()`, static imports restricted to Node builtins plus `@uncaged/workflow`.
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

  if (programUsesDefaultExport(program)) {
    return err('workflow bundle must not use default export; use "export const run" instead');
  }

  if (!runExportIsCallable(program)) {
    return err(
      'workflow bundle must export run as a callable (e.g. "export const run = async function* (...)")',
    );
  }

  if (!descriptorExportExists(program)) {
    return err(
      'workflow bundle must export descriptor (e.g. "export const descriptor = { description, roles }")',
    );
  }

  let violation: string | null = null;
  walkAst(ast, (node) => {
    if (violation !== null) {
      return;
    }
    const next = bundleConstraintViolationForNode(node);
    if (next !== null) {
      violation = next;
    }
  });

  if (violation !== null) {
    return err(violation);
  }

  return ok(undefined);
}
