#!/usr/bin/env node

import { createMockAgent } from "./mock-agent.js";

const USAGE = "usage: uwf-mock --mock-data <path> --thread <id> --role <role> --prompt <text>";

function getMockDataPath(argv: string[]): string {
  const idx = argv.indexOf("--mock-data");
  if (idx === -1 || idx + 1 >= argv.length || argv[idx + 1] === "") {
    process.stderr.write(`--mock-data is required. ${USAGE}\n`);
    process.exit(1);
  }
  return argv[idx + 1];
}

const mockDataPath = getMockDataPath(process.argv);
const main = createMockAgent(mockDataPath);
void main();
