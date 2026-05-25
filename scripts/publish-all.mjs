#!/usr/bin/env node
/**
 * publish-all.mjs — 小橘 🍊
 *
 * Replaces workspace:^ with pinned versions, publishes all packages
 * in dependency order, then restores workspace:^ references.
 *
 * Usage: node scripts/publish-all.mjs [--tag alpha] [--dry-run]
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;
const dryRun = args.includes("--dry-run");

const publishOrder = [
  "workflow-protocol",
  "workflow-util",
  "workflow-util-agent",
  "workflow-agent-hermes",
  "workflow-agent-builtin",
  "cli-workflow",
];

const root = new URL("..", import.meta.url).pathname;
const originals = new Map();

// Step 1: Collect all package versions
const versions = new Map();
for (const name of publishOrder) {
  const pkgPath = join(root, "packages", name, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  versions.set(pkg.name, pkg.version);
}

// Step 2: Replace workspace:^ with pinned versions
for (const name of publishOrder) {
  const pkgPath = join(root, "packages", name, "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  originals.set(pkgPath, raw);

  const pkg = JSON.parse(raw);
  for (const depKey of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[depKey];
    if (!deps) continue;
    for (const [depName, depVer] of Object.entries(deps)) {
      if (depVer === "workspace:^" && versions.has(depName)) {
        deps[depName] = `^${versions.get(depName)}`;
      }
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Step 3: Publish
let failed = false;
for (const name of publishOrder) {
  const pkgDir = join(root, "packages", name);
  const tagFlag = tag ? `--tag ${tag}` : "";
  const cmd = `npm publish --access public ${tagFlag}`;

  console.log(`📦 ${name}...`);

  if (dryRun) {
    console.log(`  (dry-run) ${cmd}`);
    continue;
  }

  try {
    const out = execSync(cmd, { cwd: pkgDir, stdio: "pipe" }).toString().trim();
    console.log(`  ✅ published`);
  } catch (err) {
    console.error(`  ❌ failed: ${err.message}`);
    failed = true;
    break;
  }
}

// Step 4: Restore workspace:^ references
for (const [pkgPath, raw] of originals) {
  writeFileSync(pkgPath, raw);
}

if (failed) {
  process.exit(1);
}

console.log(dryRun ? "\n✅ Dry run complete" : "\n✅ All packages published");
