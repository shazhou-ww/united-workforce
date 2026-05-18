#!/usr/bin/env bun
// Mock agent for smoke testing
import { createAgent } from "../packages/uwf-agent-kit/src/index.js";

const agent = createAgent({
  name: "mock",
  run: async (ctx) => {
    return `Mock output for role ${ctx.role}: task was "${ctx.prompt}"`;
  },
});

await agent();
