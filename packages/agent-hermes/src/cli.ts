#!/usr/bin/env node

import { createHermesAgent } from "./hermes.js";
import { isResumeDisabled } from "./session-cache.js";

const resumeDisabled = isResumeDisabled(process.env.UWF_HERMES_RESUME ?? null);
const main = createHermesAgent(resumeDisabled);
void main();
