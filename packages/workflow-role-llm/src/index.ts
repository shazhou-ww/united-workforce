export {
  buildDescriptorFromRoles,
  decorateRole,
  extractMetaOrThrow,
  type LlmError,
  type LlmExtractArgs,
  type LlmMessage,
  type LlmProvider,
  llmErrorToCause,
  llmExtract,
  llmExtractWithRetry,
  type MetaExtractConfig,
  type OnFailOptions,
  onFail,
  type RoleDecorator,
  type RoleDescriptorInput,
  type WithDryRunOptions,
  withDryRun,
} from "@uncaged/workflow-util-role";
export { chatCompletionText, createLlmAdapter, type LlmChatError } from "./create-llm-adapter.js";
export { type CreateRoleArgs, createRole } from "./create-role.js";
