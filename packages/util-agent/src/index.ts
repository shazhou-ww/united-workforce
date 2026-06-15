// Public surface of @united-workforce/util-agent.
//
// Phase 4 cleanup (#381): the per-agent CLI binaries (uwf-hermes,
// uwf-claude-code, uwf-sumeru) moved to legacy-packages/ and the engine now
// routes through @united-workforce/broker. The adapter-only helpers
// (session-cache, buildContinuationPrompt, buildThreadProgress, buildContext,
// parseArgv, AgentCleanupFn / AgentContinueFn / AgentForkFn / AgentRunFn /
// AgentOptions / AdapterOutput) are no longer part of the public API — they
// remain implementation details of `createAgent` for the in-process adapters
// (agent-builtin, agent-mock) but are not re-exported.
export { buildOutputFormatInstruction } from "./build-output-format-instruction.js";
export { buildRolePrompt } from "./build-role-prompt.js";
export type { FrontmatterFastPathResult } from "./frontmatter.js";
export { tryFrontmatterFastPath, trySuspendFastPath } from "./frontmatter.js";
export { buildFrontmatterRetryPrompt } from "./frontmatter-retry-prompt.js";
export { createAgent, mergeUsage } from "./run.js";
export { registerAgentSchemas } from "./schemas.js";
export { getConfigPath, getEnvPath, loadWorkflowConfig, resolveStorageRoot } from "./storage.js";
export type { AgentContext, AgentRunResult } from "./types.js";
