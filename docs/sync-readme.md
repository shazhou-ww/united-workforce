# Sync README

When updating README.md files in this monorepo, follow these conventions.

## Scope

- Root `README.md` — project overview and navigation hub
- Per-package `packages/*/README.md` — each package self-contained

## Root README Structure

The root README should have these sections in order:

1. **Title and one-liner** — stateless workflow engine driven by single-step CLI
2. **Overview** — 2-3 paragraphs explaining what it does and key concepts
3. **Architecture** — dependency layer diagram (text-based)
4. **Packages** — table with ALL packages from packages/ directory, columns: Package, Description, Type (cli/lib/agent/app)
5. **Quick Start** — install, build, register workflow, start thread, run step
6. **CLI Reference** — brief command list, detailed usage in cli README
7. **Development** — pnpm install / build / check / test

## Per-Package README Structure

Each package README should have:

1. **Title** — package name
2. **One-line description** — matching package.json
3. **Overview** — what it does, where it sits in the architecture, dependencies
4. **Installation** — pnpm add (for libs) or "included as binary" (for cli/agents)
5. **API** (lib packages) — all exports from src/index.ts with type signatures, grouped by category, minimal usage examples
6. **CLI Usage** (cli/agent packages) — command reference with examples
7. **Internal Structure** — brief src/ file organization
8. **Configuration** (if applicable)

## Execution Steps

### Step 1: Gather current state
For each package read:
- package.json (name, version, description, dependencies, bin)
- src/index.ts (public API exports)
- Existing README.md (preserve hand-written content worth keeping)

### Step 2: Update root README
- Ensure ALL packages in packages/ directory are listed in the table
- Update CLI command reference from uwf --help output
- Keep Quick Start examples valid

### Step 3: Write/update each package README
- Follow the per-package structure
- API section MUST match actual src/index.ts exports — never invent
- For agent packages: document CLI binary name, how it is invoked
- For lib packages: document exported types and functions
- Internal structure: list actual files in src/

### Step 4: Verify
- All relative links work
- Package names match package.json
- No references to removed/renamed packages
- pnpm run build still passes

## Guidelines

- Only document what src/index.ts actually exports
- Root README summarizes, package READMEs go into detail
- Verify CLI examples against actual commands
- Preserve existing good prose when updating
- English for all README content
