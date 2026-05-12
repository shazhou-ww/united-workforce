import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { printCliError, printCliLine } from "../../cli-output.js";
import { cmdSetup, printSetupSummary } from "./setup.js";
import type { SetupCliArgs } from "./types.js";

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

async function collectInteractiveSetup(): Promise<Result<SetupCliArgs, string>> {
  const rl = createInterface({ input, output });
  try {
    const provider = await promptLine(rl, "Provider name (e.g. openai, dashscope): ");
    if (provider === "") {
      return err("provider name must not be empty");
    }
    const baseUrl = await promptLine(rl, "Base URL: ");
    if (baseUrl === "") {
      return err("base URL must not be empty");
    }
    // Note: readline does not support masked input; API key is visible during entry.
    // Acceptable for a local dev CLI — not a production-facing prompt.
    const apiKey = await promptLine(rl, "API key: ");
    if (apiKey === "") {
      return err("API key must not be empty");
    }
    const defaultModel = await promptLine(rl, "Default model (provider/model): ");
    if (defaultModel === "") {
      return err("default model must not be empty");
    }
    const yn = await promptLine(
      rl,
      "Initialize a workflow workspace under the current directory? (y/n): ",
    );
    const lower = yn.toLowerCase();
    let initWorkspaceName: string | null = null;
    if (lower === "y" || lower === "yes") {
      const name = await promptLine(rl, "Workspace directory name: ");
      if (name === "") {
        return err("workspace name must not be empty");
      }
      initWorkspaceName = name;
    } else if (lower !== "n" && lower !== "no" && lower !== "") {
      return err('expected "y" or "n" for workspace init prompt');
    }
    return ok({
      provider,
      baseUrl,
      apiKey,
      defaultModel,
      initWorkspaceName,
    });
  } finally {
    rl.close();
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
