#!/usr/bin/env bun

import { runCli } from "./cli-dispatch.js";
import { resolveWorkflowStorageRoot } from "./storage-env.js";

const argv = process.argv.slice(2);
const storageRoot = resolveWorkflowStorageRoot();
const code = await runCli(storageRoot, argv);
process.exit(code);
