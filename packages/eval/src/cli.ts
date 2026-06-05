#!/usr/bin/env node
import { Command } from "commander";
import {
  registerDiffCommand,
  registerListCommand,
  registerReportCommand,
  registerRunCommand,
} from "./commands/index.js";

// eslint-disable-next-line -- dynamic import for version
const pkg = await import("../package.json", { with: { type: "json" } });

const program = new Command();

program
  .name("uwf-eval")
  .description("Evaluate uwf workflow quality with real agents")
  .version(pkg.default.version, "-V, --version");

registerRunCommand(program);
registerReportCommand(program);
registerDiffCommand(program);
registerListCommand(program);

program.parse();
