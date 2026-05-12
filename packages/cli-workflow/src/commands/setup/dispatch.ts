import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { printCliError, printCliLine, printCliWarn } from "../../cli-output.js";
import { cmdSetup, printSetupSummary } from "./setup.js";
import type { SetupCliArgs } from "./types.js";

type OpenAiModelEntry = {
  id: string;
};

type OpenAiModelsResponse = {
  data: OpenAiModelEntry[];
};

function usageSetup(): string {
  return [
    "uncaged-workflow setup — configure workflow.yaml providers and default model",
    "",
    "Non-interactive (agent mode):",
    "  uncaged-workflow setup \\",
    "    --provider <name> \\",
    "    --base-url <url> \\",
    "    --api-key <key> \\",
    "    --default-model <provider/model> \\",
    "    [--init-workspace <name>]",
    "",
    "Interactive: run with no flags (prompts for each value).",
    "",
    "Storage: uses the same root as other commands (see UNCAGED_WORKFLOW_STORAGE_ROOT).",
  ].join("\n");
}

function requireNext(argv: string[], i: number, flag: string): Result<string, string> {
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    return err(`${flag} requires a value`);
  }
  return ok(next);
}

type ParsedSetup = SetupCliArgs | "interactive" | "help";

type SetupFlagField = "provider" | "baseUrl" | "apiKey" | "defaultModel" | "initWorkspaceName";

const SETUP_FLAG_TO_FIELD: Record<string, SetupFlagField> = {
  "--provider": "provider",
  "--base-url": "baseUrl",
  "--api-key": "apiKey",
  "--default-model": "defaultModel",
  "--init-workspace": "initWorkspaceName",
};

function emptyFlagState(): Record<SetupFlagField, string | null> {
  return {
    provider: null,
    baseUrl: null,
    apiKey: null,
    defaultModel: null,
    initWorkspaceName: null,
  };
}

function finalizeParsedSetup(
  state: Record<SetupFlagField, string | null>,
): Result<ParsedSetup, string> {
  const hasAnyFlag =
    state.provider !== null ||
    state.baseUrl !== null ||
    state.apiKey !== null ||
    state.defaultModel !== null ||
    state.initWorkspaceName !== null;

  if (!hasAnyFlag) {
    return ok("interactive");
  }

  if (state.provider === null) {
    return err(
      "non-interactive setup requires --provider (or omit all flags for interactive mode)",
    );
  }

  const missing: string[] = [];
  if (state.baseUrl === null) {
    missing.push("--base-url");
  }
  if (state.apiKey === null) {
    missing.push("--api-key");
  }
  if (state.defaultModel === null) {
    missing.push("--default-model");
  }
  if (missing.length > 0) {
    return err(`missing required flag(s): ${missing.join(", ")}`);
  }

  const b = state.baseUrl;
  const k = state.apiKey;
  const m = state.defaultModel;
  if (b === null || k === null || m === null) {
    return err("internal: missing required flags after validation");
  }

  return ok({
    provider: state.provider,
    baseUrl: b,
    apiKey: k,
    defaultModel: m,
    initWorkspaceName: state.initWorkspaceName,
  });
}

function parseSetupArgv(argv: string[]): Result<ParsedSetup, string> {
  const state = emptyFlagState();

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) {
      break;
    }
    if (tok === "--help" || tok === "-h") {
      return ok("help");
    }
    const field = SETUP_FLAG_TO_FIELD[tok];
    if (field === undefined) {
      return err(`unknown argument: ${tok}`);
    }
    const v = requireNext(argv, i, tok);
    if (!v.ok) {
      return v;
    }
    state[field] = v.value;
    i++;
  }

  return finalizeParsedSetup(state);
}

async function promptLine(
  rl: { question: (q: string) => Promise<string> },
  label: string,
): Promise<string> {
  const raw = await rl.question(label);
  return raw.trim();
}

/** Read a line with terminal echo disabled (for secrets). */
async function promptSecret(label: string): Promise<string> {
  process.stdout.write(label);
  return new Promise((resolve) => {
    let buf = "";
    const rawWasSet = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      for (const c of chunk.toString()) {
        if (c === "\n" || c === "\r" || c === "\u0004") {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(rawWasSet);
          }
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        }
        if (c === "\u007F" || c === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (c === "\u0003") {
          process.exit(130);
        }
        buf += c;
        process.stdout.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}

/** Fetch available models from an OpenAI-compatible /models endpoint. */
async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as OpenAiModelsResponse;
    if (!Array.isArray(body.data)) {
      return [];
    }
    const NON_CHAT_RE =
      /speech|embed|image|video|audio|ocr|rerank|tts|asr|paraformer|sambert|cosyvoice|wordart|wanx|wan2|flux|stable-diffusion|z-image|s2s|livetranslate|realtime|gui-/i;
    return body.data
      .map((m) => m.id)
      .filter((id) => !NON_CHAT_RE.test(id))
      .sort();
  } catch {
    return [];
  }
}

async function collectInteractiveSetup(): Promise<Result<SetupCliArgs, string>> {
  const rl = createInterface({ input, output });
  try {
    printCliLine("Configure the LLM provider that workflow agents will use.\n");

    const provider = await promptLine(
      rl,
      "Provider name — a short label for this LLM service (e.g. openai, dashscope): ",
    );
    if (provider === "") {
      return err("provider name must not be empty");
    }
    const baseUrl = await promptLine(
      rl,
      "OpenAI-compatible API base URL\n  (e.g. https://api.openai.com/v1, https://dashscope.aliyuncs.com/compatible-mode/v1): ",
    );
    if (baseUrl === "") {
      return err("base URL must not be empty");
    }

    // Close readline before raw-mode secret prompt, reopen after.
    rl.close();
    const apiKey = await promptSecret("API key for this provider: ");
    if (apiKey === "") {
      return err("API key must not be empty");
    }
    const rl2 = createInterface({ input, output });

    // Try to list available models from the provider.
    printCliLine("\nFetching available models...");
    const models = await fetchAvailableModels(baseUrl, apiKey);
    let modelPrompt: string;
    if (models.length > 0) {
      printCliLine(`Available models (${models.length}):`);
      const cols = process.stdout.columns || 80;
      const maxLen = Math.max(...models.map((m) => m.length));
      const colWidth = maxLen + 4;
      const numCols = Math.max(1, Math.floor(cols / colWidth));
      for (let i = 0; i < models.length; i += numCols) {
        const row = models.slice(i, i + numCols);
        printCliLine("  " + row.map((m) => m.padEnd(colWidth)).join(""));
      }
      modelPrompt = `\nDefault model: `;
    } else {
      printCliWarn("Could not fetch models (API may not support /models endpoint).");
      modelPrompt = `Default model (e.g. qwen-plus, gpt-4o): `;
    }

    const modelName = await promptLine(rl2, modelPrompt);
    if (modelName === "") {
      rl2.close();
      return err("default model must not be empty");
    }
    // Strip provider prefix if user included one (e.g. pasted "MiniMax/MiniMax-M2.7").
    const bare = modelName.includes("/") ? modelName.split("/").pop()! : modelName;
    const defaultModel = `${provider}/${bare}`;

    const wsPath = await promptLine(
      rl2,
      "\nWorkflow workspace path (default: ./workflows, type 'skip' to skip): ",
    );
    rl2.close();

    const initWorkspaceName =
      wsPath.toLowerCase() === "skip" ? null : wsPath === "" ? "./workflows" : wsPath;

    return ok({
      provider,
      baseUrl,
      apiKey,
      defaultModel,
      initWorkspaceName,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function dispatchSetup(storageRoot: string, argv: string[]): Promise<number> {
  const parsed = parseSetupArgv(argv);
  if (!parsed.ok) {
    printCliError(`${parsed.error}\n\n${usageSetup()}`);
    return 1;
  }
  if (parsed.value === "help") {
    printCliLine(usageSetup());
    return 0;
  }

  let args: SetupCliArgs;
  if (parsed.value === "interactive") {
    const collected = await collectInteractiveSetup();
    if (!collected.ok) {
      printCliError(collected.error);
      return 1;
    }
    args = collected.value;
  } else {
    args = parsed.value;
  }

  const result = await cmdSetup(storageRoot, args);
  if (!result.ok) {
    printCliError(result.error);
    return 1;
  }
  printSetupSummary(result.value);
  return 0;
}
