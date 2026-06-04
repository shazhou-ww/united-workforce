#!/usr/bin/env node

import { createClaudeCodeAgent } from "./claude-code.js";

const model = process.env.CLAUDE_MODEL ?? null;
const main = createClaudeCodeAgent(model);
void main();
