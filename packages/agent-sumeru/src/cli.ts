#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

// eslint-disable-next-line -- dynamic import for version
const pkg = await import("../package.json", { with: { type: "json" } });
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  process.stdout.write(`${pkg.default.version}\n`);
  process.exit(0);
}

import { resolveStorageRoot } from "@united-workforce/util-agent";
import { createSumeruAgent } from "./sumeru.js";

const storageRoot = resolveStorageRoot(process.env.UWF_HOME ?? null);
const main = createSumeruAgent(storageRoot);
void main();
