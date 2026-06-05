#!/usr/bin/env node
import { Command } from "commander";
import {
  registerDiffCommand,
  registerListCommand,
  registerReportCommand,
  registerRunCommand,
} from "./commands/index.js";

const program = new Command();

program
  .name("uwf-eval")
  .description("Evaluate uwf workflow quality with real agents")
  .version("0.1.0");

registerRunCommand(program);
registerReportCommand(program);
registerDiffCommand(program);
registerListCommand(program);

program.parse();
