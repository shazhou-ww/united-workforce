# Test Spec: uwf setup model connectivity validation (#335)

## Context

File: `packages/cli-workflow/src/commands/setup.ts`
Test file: `packages/cli-workflow/src/__tests__/setup-validate.test.ts`

After `cmdSetup` writes config, it should send a test chat completion request to verify the configured model is reachable. If validation fails, warn the user (don't abort — config is already saved).

## Implementation Notes

- Add a `validateModel(baseUrl, apiKey, model)` function that sends a minimal chat completion request (`POST /chat/completions` with `messages: [{role:"user",content:"hi"}]`, `max_tokens: 1`)
- Returns `Result<void, string>` — ok if 2xx response, error with reason string otherwise
- Use `AbortSignal.timeout(15_000)` for the request
- Both `cmdSetup` and `cmdSetupInteractive` should call it after saving config
- `cmdSetup` returns validation result in its return object: `{ ...existing, validation: { ok: true } | { ok: false, error: string } }`
- `cmdSetupInteractive` prints a warning to console if validation fails, success message if it passes
- Use the project logger (`createLogger`) — no raw `console.log` except in interactive CLI output (per CLAUDE.md)

## Test Cases (vitest)

### 1. `validateModel` — success path
- Mock `fetch` to return `{ status: 200, ok: true, json: () => ({}) }`
- Call `validateModel(baseUrl, apiKey, model)`
- Assert returns `{ ok: true, value: undefined }`
- Assert fetch was called with correct URL (`${baseUrl}/chat/completions`), correct headers (`Authorization: Bearer ${apiKey}`), correct body (model, messages, max_tokens: 1)

### 2. `validateModel` — HTTP error (401 unauthorized)
- Mock `fetch` to return `{ status: 401, ok: false, statusText: "Unauthorized" }`
- Call `validateModel(baseUrl, apiKey, model)`
- Assert returns `{ ok: false, error: <string containing "401"> }`

### 3. `validateModel` — HTTP error (404 model not found)
- Mock `fetch` to return `{ status: 404, ok: false, statusText: "Not Found" }`
- Assert returns `{ ok: false, error: <string containing "404"> }`

### 4. `validateModel` — network timeout
- Mock `fetch` to throw `DOMException` with name `AbortError`
- Assert returns `{ ok: false, error: <string containing "timeout" or "unreachable"> }`

### 5. `validateModel` — network error (DNS failure, connection refused)
- Mock `fetch` to throw `TypeError("fetch failed")`
- Assert returns `{ ok: false, error: <string mentioning connectivity> }`

### 6. `cmdSetup` — includes validation result on success
- Mock global `fetch` for `/chat/completions` to succeed
- Call `cmdSetup({ provider, baseUrl, apiKey, model, storageRoot })`
- Assert returned object has `validation: { ok: true, value: undefined }`
- Assert config files are still written (existing behavior preserved)

### 7. `cmdSetup` — includes validation result on failure (config still saved)
- Mock global `fetch` for `/chat/completions` to return 401
- Call `cmdSetup({ ... })`
- Assert returned object has `validation: { ok: false, error: ... }`
- Assert `config.yaml` and `.env` are still written (validation failure doesn't prevent saving)

### 8. `cmdSetupInteractive` — prints success message on validation pass
- Mock `fetch` for both `/models` and `/chat/completions` to succeed
- Mock stdin to provide valid selections
- Capture console output
- Assert output contains a success message like "Model verified" or "✓"

### 9. `cmdSetupInteractive` — prints warning on validation failure
- Mock `fetch`: `/models` succeeds, `/chat/completions` returns 401
- Mock stdin for valid selections
- Capture console output
- Assert output contains a warning about model not being reachable and suggests trying a different model

### 10. `validateModel` — request body correctness
- Mock `fetch` to capture the request body
- Call `validateModel(baseUrl, apiKey, "test-model")`
- Assert body is `{ model: "test-model", messages: [{role: "user", content: "hi"}], max_tokens: 1 }`

## Export Requirements

- `validateModel` must be exported (for direct unit testing)
- Signature: `async function validateModel(baseUrl: string, apiKey: string, model: string): Promise<Result<void, string>>`
- `Result` type: `{ ok: true; value: T } | { ok: false; error: E }` (project convention)

## Files to Create/Modify

- **New**: `packages/cli-workflow/src/__tests__/setup-validate.test.ts` — all test cases above
- **Modify**: `packages/cli-workflow/src/commands/setup.ts` — add `validateModel`, integrate into `cmdSetup` and `cmdSetupInteractive`
