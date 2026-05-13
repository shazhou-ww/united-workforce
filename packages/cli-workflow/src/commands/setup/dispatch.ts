import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve as resolvePath } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { createLogger } from "@uncaged/workflow-util";

import { printCliError, printCliLine, printCliWarn } from "../../cli-output.js";

const setupDispatchLog = createLogger({ sink: { kind: "stderr" } });
import { loadPresetProviders } from "./preset-providers.js";
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
  return new Promise((fulfill) => {
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
          fulfill(buf.trim());
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
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(rawWasSet);
          }
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
      setupDispatchLog("R5KH7WM3", `GET ${url} returned ${res.status}`);
      return [];
    }
    const body = (await res.json()) as OpenAiModelsResponse;
    if (!Array.isArray(body.data)) {
      return [];
    }
    // Filter out non-chat models. Some patterns are DashScope-specific (sambert, cosyvoice,
    // wordart, wanx, wan2, paraformer) but harmless for other providers.
    const NON_CHAT_RE =
      /speech|embed|image|video|audio|ocr|rerank|tts|asr|paraformer|sambert|cosyvoice|wordart|wanx|wan2|flux|stable-diffusion|z-image|s2s|livetranslate|realtime|gui-/i;
    return body.data
      .map((m) => m.id)
      .filter((id) => !NON_CHAT_RE.test(id))
      .sort();
  } catch (e) {
    setupDispatchLog("V8NQ4JT6", `fetch models failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function collectInteractiveSetup(): Promise<Result<SetupCliArgs, string>> {
  const rl = createInterface({ input, output });
  try {
    printCliLine("Configure the LLM provider that workflow agents will use.\n");

    const presets = loadPresetProviders();
    const numWidth = String(presets.length + 1).length;
    printCliLine("Select a provider:\n");
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i]!;
      const num = String(i + 1).padStart(numWidth);
      printCliLine(`  ${num}) ${p.label.padEnd(28)} ${p.baseUrl}`);
    }
    const customNum = String(presets.length + 1).padStart(numWidth);
    printCliLine(`  ${customNum}) Custom (enter name and URL manually)`);
    printCliLine("");

    const choice = await promptLine(rl, `Choose [1-${presets.length + 1}]: `);
    const choiceNum = Number.parseInt(choice, 10);
    if (Number.isNaN(choiceNum) || choiceNum < 1 || choiceNum > presets.length + 1) {
      rl.close();
      return err(`invalid choice: ${choice}`);
    }

    let provider: string;
    let baseUrl: string;
    if (choiceNum <= presets.length) {
      const selected = presets[choiceNum - 1]!;
      provider = selected.name;
      baseUrl = selected.baseUrl;
      printCliLine(`\n  → ${selected.label} (${baseUrl})\n`);
    } else {
      provider = await promptLine(rl, "Provider name (e.g. my-proxy): ");
      if (provider === "") {
        return err("provider name must not be empty");
      }
      baseUrl = await promptLine(rl, "OpenAI-compatible API base URL: ");
      if (baseUrl === "") {
        return err("base URL must not be empty");
      }
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
    let selectedModel: string;
    if (models.length > 0) {
      printCliLine(`\nAvailable models (${models.length}):\n`);
      const cols = process.stdout.columns || 80;
      const nw = String(models.length).length; // number width
      // Each cell: "  <num>) <model>  " — prefix is 2 + nw + 2 = nw+4
      const prefixLen = nw + 4;
      const maxModelLen = Math.max(...models.map((m) => m.length));
      const cellWidth = prefixLen + maxModelLen + 2; // +2 gap between columns
      const numCols = Math.max(1, Math.floor(cols / cellWidth));
      for (let i = 0; i < models.length; i += numCols) {
        const cells: string[] = [];
        for (let j = i; j < Math.min(i + numCols, models.length); j++) {
          const num = String(j + 1).padStart(nw);
          cells.push(`  ${num}) ${(models[j]!).padEnd(maxModelLen + 2)}`);
        }
        printCliLine(cells.join(""));
      }
      printCliLine(`\nChoose a number, or type a model name directly.`);
      const modelInput = await promptLine(rl2, `Default model [1-${models.length}]: `);
      if (modelInput === "") {
        rl2.close();
        return err("default model must not be empty");
      }
      const modelNum = Number.parseInt(modelInput, 10);
      if (!Number.isNaN(modelNum) && modelNum >= 1 && modelNum <= models.length) {
        selectedModel = models[modelNum - 1]!;
      } else {
        // Treat as a literal model name.
        selectedModel = modelInput;
      }
    } else {
      printCliWarn("Could not fetch models (API may not support /models endpoint).");
      const modelInput = await promptLine(rl2, `Default model (e.g. qwen-plus, gpt-4o): `);
      if (modelInput === "") {
        rl2.close();
        return err("default model must not be empty");
      }
      selectedModel = modelInput;
    }
    // Strip provider prefix if user included one (e.g. pasted "MiniMax/MiniMax-M2.7").
    const bare = selectedModel.includes("/") ? selectedModel.split("/").pop()! : selectedModel;
    const defaultModel = `${provider}/${bare}`;
    printCliLine(`  → ${defaultModel}`);

    let initWorkspaceName: string | null = null;
    // Loop until a valid workspace path is provided or the user skips.
    while (true) {
      const wsPath = await promptLine(
        rl2,
        "\nWorkflow workspace path (default: ./workflows, type 'skip' to skip): ",
      );
      if (wsPath.toLowerCase() === "skip") {
        break;
      }
      const candidate = wsPath === "" ? "./workflows" : wsPath;
      // Validate path before passing to cmdSetup.
      const resolved = resolvePath(process.cwd(), candidate);
      if (existsSync(resolved)) {
        printCliWarn(`directory already exists: ${resolved}`);
        printCliLine("Please enter a different path, or type 'skip' to skip.");
        continue;
      }
      initWorkspaceName = candidate;
      break;
    }
    rl2.close();

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
