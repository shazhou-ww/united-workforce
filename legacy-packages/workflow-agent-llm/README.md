# @uncaged/workflow-agent-llm

`AgentFn` adapter that calls an OpenAI-compatible `POST /chat/completions` endpoint using `LlmProvider` from `@uncaged/workflow-runtime`.

Single-turn: system text is the current role’s `systemPrompt`, user text is the thread’s initial prompt (`ctx.start.content`). Errors from HTTP, JSON, or empty choices are thrown as `Error` with a JSON payload string.

## Install

```bash
bun add @uncaged/workflow-agent-llm @uncaged/workflow-runtime zod
```

In this monorepo: `"@uncaged/workflow-agent-llm": "workspace:*"`, `"@uncaged/workflow-runtime": "workspace:*"` (and satisfy `zod` ^4 as required by `@uncaged/workflow-runtime`).

## Usage

```typescript
import { createLlmAdapter } from "@uncaged/workflow-agent-llm";

const agent = createLlmAdapter({
  baseUrl: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-mini",
});
```

## API overview

| Export | Description |
|--------|-------------|
| `createLlmAdapter(provider)` | `LlmProvider` → `AgentFn` |
| `chatCompletionText({ provider, messages })` | Low-level `Result<string, LlmChatError>` helper |
| `LlmMessage` | `{ role: "system" \| "user" \| "assistant"; content: string }` |
| `LlmChatError` | Discriminated error kinds for failed completions |
