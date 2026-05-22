import { createFilter, type Plugin } from "vite";

type LimitLineOverride = {
  files: string;
  maxReactFCLines: number | null;
  maxFileLines: number | null;
};

type LimitLineOptions = {
  maxReactFCLines: number;
  maxFileLines: number;
  include: RegExp;
  exclude: RegExp | null;
  overrides: Array<LimitLineOverride>;
};

const DEFAULT_OPTIONS: LimitLineOptions = {
  maxReactFCLines: 300,
  maxFileLines: 600,
  include: /\.[tj]sx$/,
  exclude: null,
  overrides: [],
};

type ResolvedLimits = {
  maxReactFCLines: number | null;
  maxFileLines: number | null;
};

type ComponentInfo = {
  name: string;
  startLine: number;
  lineCount: number;
};

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

// --- AST types (Rolldown ESTree subset) ---

type Identifier = {
  type: "Identifier";
  name: string;
};

type MemberExpression = {
  type: "MemberExpression";
  object: AstExpression;
  property: Identifier;
};

type CallExpression = {
  type: "CallExpression";
  callee: AstExpression;
  arguments: Array<AstExpression>;
};

type AstExpression =
  | Identifier
  | MemberExpression
  | CallExpression
  | {
      type: string;
      [key: string]: unknown;
    };

type VariableDeclarator = {
  id: Identifier | null;
  init: AstExpression | null;
};

type AstStatement = {
  type: string;
  id: Identifier | null;
  declaration: AstStatement | null;
  declarations: Array<VariableDeclarator>;
  body: Array<AstStatement>;
  [key: string]: unknown;
};

type AstProgram = {
  type: "Program";
  body: Array<AstStatement>;
};

// --- AST helpers ---

function isFunctionLike(node: AstExpression): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

const WRAPPER_NAMES = new Set(["memo", "forwardRef", "lazy"]);

function isWrapperCall(node: AstExpression): boolean {
  if (node.type !== "CallExpression") return false;
  const call = node as CallExpression;
  const callee = call.callee;

  if (callee.type === "Identifier") {
    return WRAPPER_NAMES.has((callee as Identifier).name);
  }

  if (callee.type === "MemberExpression") {
    const member = callee as MemberExpression;
    return member.property.type === "Identifier" && WRAPPER_NAMES.has(member.property.name);
  }

  return false;
}

function extractComponentNames(ast: AstProgram): Array<string> {
  const names: Array<string> = [];

  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" && node.id && PASCAL_CASE.test(node.id.name)) {
      names.push(node.id.name);
      continue;
    }

    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const decl = node.declaration;
      if (decl.type === "FunctionDeclaration" && decl.id && PASCAL_CASE.test(decl.id.name)) {
        names.push(decl.id.name);
        continue;
      }
      if (decl.type === "VariableDeclaration") {
        collectNamesFromVarDeclaration(decl, names);
        continue;
      }
    }

    if (node.type === "VariableDeclaration") {
      collectNamesFromVarDeclaration(node, names);
    }
  }

  return names;
}

function collectNamesFromVarDeclaration(node: AstStatement, names: Array<string>): void {
  for (const declarator of node.declarations ?? []) {
    if (!declarator.id || !PASCAL_CASE.test(declarator.id.name) || !declarator.init) continue;
    const init = declarator.init;
    if (isFunctionLike(init)) {
      names.push(declarator.id.name);
    } else if (isWrapperCall(init)) {
      const args = (init as CallExpression).arguments;
      if (args.length > 0 && isFunctionLike(args[0])) {
        names.push(declarator.id.name);
      }
    }
  }
}

// --- Source measurement ---

function measureComponentInSource(name: string, lines: Array<string>): ComponentInfo | null {
  const fnPattern = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*[(<]`);
  const varPattern = new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*[=:]`);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const isFnDecl = fnPattern.test(trimmed);
    const isVarDecl = varPattern.test(trimmed);
    if (!isFnDecl && !isVarDecl) continue;

    if (isFnDecl) {
      const result = measureFromParams(i, lines);
      if (result) return { ...result, name };
      return null;
    }
    const result = measureFromArrow(i, lines);
    if (result) return { ...result, name };
    return null;
  }

  return null;
}

// function Foo(...) { ... } — skip params via parens, then brace-match the body
function measureFromParams(startLine: number, lines: Array<string>): ComponentInfo | null {
  let parenDepth = 0;
  let pastParams = false;
  let braceDepth = 0;

  for (let j = startLine; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (!pastParams) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") {
          parenDepth--;
          if (parenDepth === 0) pastParams = true;
        }
      } else {
        if (ch === "{") braceDepth++;
        else if (ch === "}") {
          braceDepth--;
          if (braceDepth === 0) {
            return { name: "", startLine: startLine + 1, lineCount: j - startLine + 1 };
          }
        }
      }
    }
  }

  return null;
}

// const Foo = (...) => { ... } / const Foo = memo((...) => { ... })
// Find `=>` first, then brace-match from there to skip type annotations in params
function measureFromArrow(startLine: number, lines: Array<string>): ComponentInfo | null {
  let arrowFound = false;
  let braceDepth = 0;
  let foundBrace = false;

  for (let j = startLine; j < lines.length; j++) {
    const line = lines[j];
    for (let c = 0; c < line.length; c++) {
      if (!arrowFound) {
        if (line[c] === "=" && line[c + 1] === ">") {
          arrowFound = true;
          c++;
        }
        continue;
      }
      if (line[c] === "{") {
        braceDepth++;
        foundBrace = true;
      } else if (line[c] === "}") {
        braceDepth--;
        if (foundBrace && braceDepth === 0) {
          return { name: "", startLine: startLine + 1, lineCount: j - startLine + 1 };
        }
      }
    }
  }

  return null;
}

// --- Config resolution ---

function createLimitResolver(options: LimitLineOptions): (id: string) => ResolvedLimits {
  const matchers = options.overrides.map((override) => ({
    match: createFilter(override.files),
    maxReactFCLines: override.maxReactFCLines,
    maxFileLines: override.maxFileLines,
  }));

  return (id: string): ResolvedLimits => {
    let maxReactFCLines: number | null = options.maxReactFCLines;
    let maxFileLines: number | null = options.maxFileLines;

    for (const matcher of matchers) {
      if (matcher.match(id)) {
        maxReactFCLines = matcher.maxReactFCLines;
        maxFileLines = matcher.maxFileLines;
      }
    }

    return { maxReactFCLines, maxFileLines };
  };
}

function shouldProcess(id: string, options: LimitLineOptions): boolean {
  return (
    options.include.test(id) &&
    !id.includes("node_modules") &&
    (options.exclude === null || !options.exclude.test(id))
  );
}

// --- Plugin ---

function viteLimitLinePlugin(userOptions: Partial<LimitLineOptions> = {}): Array<Plugin> {
  const options: LimitLineOptions = {
    ...DEFAULT_OPTIONS,
    ...userOptions,
    overrides: userOptions.overrides ?? [],
  };
  const resolve = createLimitResolver(options);

  const rawCodeCache = new Map<string, string>();

  return [
    {
      name: "vite-plugin-limit-line:pre",
      enforce: "pre",

      transform(code, id) {
        if (!shouldProcess(id, options)) return null;

        rawCodeCache.set(id, code);

        const limits = resolve(id);
        if (limits.maxFileLines === null) return null;

        const totalLines = code.split("\n").length;
        if (totalLines > limits.maxFileLines) {
          this.error(
            [
              `[vite-limit-line] File too long: ${totalLines} lines (limit: ${limits.maxFileLines})`,
              `  file: ${id}`,
              "",
              "How to fix:",
              "  Split this file into smaller modules — extract related types, helpers,",
              "  or sub-components into separate files and re-export from an index.ts.",
            ].join("\n"),
          );
        }

        return null;
      },
    },
    {
      name: "vite-plugin-limit-line:fc",

      transform(code, id) {
        if (!shouldProcess(id, options)) return null;

        const limits = resolve(id);
        if (limits.maxReactFCLines === null) return null;

        const ast = this.parse(code) as unknown as AstProgram;
        const componentNames = extractComponentNames(ast);
        if (componentNames.length === 0) return null;

        const raw = rawCodeCache.get(id) ?? code;
        rawCodeCache.delete(id);
        const rawLines = raw.split("\n");

        const maxFCLines = limits.maxReactFCLines;
        const violations: Array<ComponentInfo> = [];
        for (const name of componentNames) {
          const info = measureComponentInSource(name, rawLines);
          if (info && info.lineCount > maxFCLines) {
            violations.push(info);
          }
        }

        if (violations.length > 0) {
          const details = violations
            .map(
              (v) =>
                `  ${v.name} (line ${v.startLine}): ${v.lineCount} lines (limit: ${maxFCLines})`,
            )
            .join("\n");

          this.error(
            [
              `[vite-limit-line] React component too long in ${id}:`,
              details,
              "",
              "How to fix:",
              "  Break each oversized component into smaller ones. Extract reusable",
              "  sections into child components, move complex logic into custom hooks,",
              "  and keep each component focused on a single responsibility.",
            ].join("\n"),
          );
        }

        return null;
      },

      buildEnd() {
        rawCodeCache.clear();
      },
    },
  ];
}

export type { LimitLineOptions, LimitLineOverride };
export { viteLimitLinePlugin };
