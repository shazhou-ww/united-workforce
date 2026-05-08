import * as z from "zod/v4";

import { err, ok, type Result } from "../util/index.js";

import type { LlmError, LlmExtractArgs } from "./types.js";

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonSchemaMeta(json: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = json;
  return rest;
}

function readToolName(parametersSchema: Record<string, unknown>): string {
  const title = parametersSchema.title;
  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }
  return "extract";
}

function readToolDescription(parametersSchema: Record<string, unknown>): string {
  const d = parametersSchema.description;
  if (typeof d === "string" && d.trim().length > 0) {
    return d.trim();
  }
  return "Extract structured data from the input text.";
}

/** Builds OpenAI function-tool metadata from a Zod meta schema (same naming rules as single-shot extract). */
export function extractFunctionToolFromZodSchema(schema: z.ZodType<unknown>): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} {
  const rawJsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const parameters = stripJsonSchemaMeta(rawJsonSchema);
  return {
    name: readToolName(parameters),
    description: readToolDescription(parameters),
    parameters,
  };
}

function readToolArgumentsJson(parsed: unknown, previewSource: string): Result<string, LlmError> {
  if (!isRecord(parsed)) {
    return err({ kind: "invalid_response_json", message: "Top-level JSON is not an object" });
  }

  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  const first = choices[0];
  if (!isRecord(first)) {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  const messageObj = first.message;
  if (!isRecord(messageObj)) {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  const toolCalls = messageObj.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  const call0 = toolCalls[0];
  if (!isRecord(call0)) {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  const fn = call0.function;
  if (!isRecord(fn)) {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  const argsRaw = fn.arguments;
  if (typeof argsRaw !== "string") {
    return err({ kind: "no_tool_call", preview: previewSource.slice(0, 500) });
  }

  return ok(argsRaw);
}

export function llmErrorToCause(error: LlmError): Error {
  switch (error.kind) {
    case "http_error":
      return new Error(`HTTP ${error.status}: ${error.body.slice(0, 500)}`);
    case "invalid_response_json":
      return new Error(error.message);
    case "no_tool_call":
      return new Error(`No tool call in response: ${error.preview}`);
    case "tool_arguments_invalid_json":
      return new Error(error.message);
    case "schema_validation_failed":
      return new Error(error.message);
    case "network_error":
      return new Error(error.message);
  }
}

async function performLlmExtract<T>(
  options: LlmExtractArgs<T> & { userContent: string },
): Promise<Result<T, LlmError>> {
  const extractTool = extractFunctionToolFromZodSchema(options.schema);

  const body = {
    model: options.provider.model,
    messages: [
      {
        role: "system" as const,
        content: "Extract the requested information from the provided text. Be precise.",
      },
      { role: "user" as const, content: options.userContent },
    ],
    tools: [
      {
        type: "function" as const,
        function: {
          name: extractTool.name,
          description: extractTool.description,
          parameters: extractTool.parameters,
        },
      },
    ],
    tool_choice: { type: "function" as const, function: { name: extractTool.name } },
  };

  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(options.provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ kind: "network_error", message });
  }

  const responseText = await response.text();
  if (!response.ok) {
    return err({ kind: "http_error", status: response.status, body: responseText.slice(0, 4000) });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ kind: "invalid_response_json", message });
  }

  const argsJson = readToolArgumentsJson(parsed, responseText);
  if (!argsJson.ok) {
    return argsJson;
  }

  let argsParsed: unknown;
  try {
    argsParsed = JSON.parse(argsJson.value) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ kind: "tool_arguments_invalid_json", message });
  }

  const validated = options.schema.safeParse(argsParsed);
  if (!validated.success) {
    return err({
      kind: "schema_validation_failed",
      message: validated.error.message,
    });
  }

  return ok(validated.data);
}

/** Single LLM extract attempt over OpenAI-compatible chat completions with forced tool call. */
export async function llmExtract<T>(options: LlmExtractArgs<T>): Promise<Result<T, LlmError>> {
  return performLlmExtract({ ...options, userContent: options.text });
}
