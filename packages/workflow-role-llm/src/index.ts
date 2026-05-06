export { buildDescriptorFromRoles, type RoleDescriptorInput } from "./build-descriptor.js";
export { chatCompletionText, createLlmAdapter, type LlmChatError } from "./create-llm-adapter.js";
export { type CreateRoleArgs, createRole } from "./create-role.js";
export {
  decorateRole,
  type OnFailOptions,
  onFail,
  type RoleDecorator,
  type WithDryRunOptions,
  withDryRun,
} from "./decorators.js";
export {
  extractMetaOrThrow,
  type LlmError,
  type LlmExtractArgs,
  type LlmProvider,
  llmErrorToCause,
  llmExtract,
  llmExtractWithRetry,
} from "./llm-extract.js";
export { schemaDefaults } from "./schema-defaults.js";
export type { LlmMessage, MetaExtractConfig } from "./types.js";
