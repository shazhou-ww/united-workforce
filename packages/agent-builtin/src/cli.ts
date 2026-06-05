#!/usr/bin/env node

// eslint-disable-next-line -- dynamic import for version
const pkg = await import("../package.json", { with: { type: "json" } });
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  process.stdout.write(`${pkg.default.version}\n`);
  process.exit(0);
}

import { createBuiltinAgent } from "./agent.js";

const main = createBuiltinAgent();
void main();
