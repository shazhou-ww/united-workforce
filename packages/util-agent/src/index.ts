// Public surface of @united-workforce/util-agent.
//
// Phase 4 cleanup (#381): the per-agent CLI binaries (uwf-hermes,
// uwf-claude-code, uwf-sumeru) moved to legacy-packages/ and the engine now
// routes through @united-workforce/broker. The adapter-only helpers
// (session-cache, buildContext, parseArgv, AgentCleanupFn / AgentContinueFn /
// AgentForkFn / AgentRunFn / AgentOptions / AdapterOutput) are no longer part
// of the public API — they remain implementation details of `createAgent` for
// the in-process adapters (agent-builtin, agent-mock) but are not re-exported.
//
// buildContinuationPrompt and buildThreadProgress are still public — the broker
// path (broker-step.ts) assembles the full agent prompt using them (#387).
export { buildContinuationPrompt } from "./build-continuation-prompt.js";
export { buildOutputFormatInstruction } from "./build-output-format-instruction.js";
export { buildRolePrompt } from "./build-role-prompt.js";
export { buildThreadProgress } from "./build-thread-progress.js";
export type { FrontmatterFastPathResult } from "./frontmatter.js";
export { buildSuspendOutput, tryFrontmatterFastPath, trySuspendFastPath } from "./frontmatter.js";
export { buildFrontmatterRetryPrompt } from "./frontmatter-retry-prompt.js";
export { createAgent, mergeUsage } from "./run.js";
export { registerAgentSchemas } from "./schemas.js";
export { getConfigPath, getEnvPath, loadWorkflowConfig, resolveStorageRoot } from "./storage.js";
export type { AgentContext, AgentRunResult } from "./types.js";
