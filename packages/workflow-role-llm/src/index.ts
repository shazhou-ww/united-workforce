export {
  decorateRole,
  type OnFailOptions,
  onFail,
  type RoleDecorator,
  type WithDryRunOptions,
  withDryRun,
} from "@uncaged/workflow-util-role";
export { buildDescriptorFromRoles, type RoleDescriptorInput } from "./build-descriptor.js";
export { chatCompletionText, createLlmAdapter, type LlmChatError } from "./create-llm-adapter.js";
export { type CreateRoleArgs, createRole } from "./create-role.js";
export { extractMetaOrThrow } from "./extract-meta.js";
export {
  type LlmError,
  type LlmExtractArgs,
  type LlmProvider,
  llmErrorToCause,
  llmExtract,
  llmExtractWithRetry,
} from "./llm-extract.js";
export type { LlmMessage, MetaExtractConfig } from "./types.js";
