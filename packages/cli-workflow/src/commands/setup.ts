import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Result } from "@uncaged/workflow-util";
import { parse, stringify } from "yaml";

/**
 * Send a minimal chat completion request to verify the model is reachable.
 * Returns ok on 2xx, error with reason string otherwise.
 */
export async function validateModel(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<Result<void, string>> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true, value: undefined };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "Request timed out — model endpoint unreachable" };
    }
    return { ok: false, error: `Network error — could not reach endpoint (${String(err)})` };
  }
}

/**
 * Preset provider list — embedded to avoid runtime YAML loading dependency.
 * Keep in sync with providers.yaml in cli-workflow.
 */
const PRESET_PROVIDERS = [
  // International
  { name: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1" },
  { name: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "venice", label: "Venice", baseUrl: "https://api.venice.ai/api/v1" },
  // China
  {
    name: "dashscope",
    label: "DashScope (Alibaba)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  { name: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { name: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1" },
  {
    name: "volcengine",
    label: "Volcengine (ByteDance)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  { name: "kimi", label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/v1" },
  { name: "glm", label: "GLM (Zhipu AI)", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { name: "stepfun", label: "StepFun", baseUrl: "https://api.stepfun.com/v1" },
  { name: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io/v1" },
  // Local
  { name: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1" },
] as const;

type SetupArgs = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  agent?: string | undefined;
  storageRoot: string;
};

function getConfigPath(root: string): string {
  return join(root, "config.yaml");
}

function getEnvPath(root: string): string {
  return join(root, ".env");
}

/**
 * Load existing config.yaml or return empty structure.
 */
function loadExistingConfig(configPath: string): Record<string, unknown> {
  try {
    if (existsSync(configPath)) {
      const raw = parse(readFileSync(configPath, "utf8")) as unknown;
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
      }
    }
  } catch {
    // ignore parse errors, start fresh
  }
  return {};
}

/**
 * Load existing .env as key=value map.
 */
function loadEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
        }
      }
    }
  } catch {
    // ignore
  }
  return env;
}

function saveEnvFile(envPath: string, env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
}

function apiKeyEnvName(providerName: string): string {
  return `${providerName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

/**
 * Discover uwf-* agent binaries in PATH.
 * Returns sorted list of binary names (e.g., ["uwf-hermes", "uwf-claude-code"]).
 */
async function _discoverAgents(): Promise<string[]> {
  try {
    // Use which -a to find all uwf-* binaries in PATH
    const proc = Bun.spawn(["which", "-a", "uwf-hermes", "uwf-claude-code", "uwf-cursor"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      // Try alternative approach: search PATH directories manually
      const pathEnv = process.env.PATH || "";
      const pathDirs = pathEnv.split(":").filter((d) => d.length > 0);
      const agents = new Set<string>();

      for (const dir of pathDirs) {
        try {
          if (!existsSync(dir)) continue;
          const { readdirSync, statSync } = await import("node:fs");
          const entries = readdirSync(dir);

          for (const entry of entries) {
            if (!entry.startsWith("uwf-") || entry === "uwf") continue;
            const fullPath = join(dir, entry);
            try {
              const stat = statSync(fullPath);
              // Check if executable (owner, group, or other has execute bit)
              if (stat.isFile() && (stat.mode & 0o111) !== 0) {
                agents.add(entry);
              }
            } catch {
              // Skip if can't stat
            }
          }
        } catch {
          // Skip inaccessible directories
        }
      }

      return Array.from(agents).sort();
    }

    // Parse which output - each line is a path to a binary
    const paths = text
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    const agents = new Set<string>();

    for (const path of paths) {
      const basename = path.split("/").pop();
      if (basename?.startsWith("uwf-") && basename !== "uwf") {
        agents.add(basename);
      }
    }

    return Array.from(agents).sort();
  } catch {
    // If all fails, return empty array
    return [];
  }
}

/**
 * Merge setup args into config.yaml structure. Non-destructive — preserves existing entries.
 */
function mergeConfig(existing: Record<string, unknown>, args: SetupArgs): Record<string, unknown> {
  const providers = (
    typeof existing.providers === "object" && existing.providers !== null
      ? { ...(existing.providers as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  const envName = apiKeyEnvName(args.provider);
  providers[args.provider] = { baseUrl: args.baseUrl, apiKeyEnv: envName };

  const models = (
    typeof existing.models === "object" && existing.models !== null
      ? { ...(existing.models as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  models.default = { provider: args.provider, name: args.model };

  const agents = (
    typeof existing.agents === "object" && existing.agents !== null
      ? { ...(existing.agents as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  const agentName = args.agent ?? "hermes";
  if (Object.keys(agents).length === 0) {
    agents.hermes = { command: "uwf-hermes", args: [] };
  }

  return {
    ...existing,
    providers,
    models,
    agents,
    defaultAgent: existing.defaultAgent ?? agentName,
    defaultModel: existing.defaultModel ?? "default",
  };
}

/**
 * Non-interactive setup. All required args provided via CLI flags.
 */
export async function cmdSetup(args: SetupArgs): Promise<Record<string, unknown>> {
  const { storageRoot } = args;
  mkdirSync(storageRoot, { recursive: true });

  const configPath = getConfigPath(storageRoot);
  const envPath = getEnvPath(storageRoot);

  const existing = loadExistingConfig(configPath);
  const merged = mergeConfig(existing, args);

  writeFileSync(configPath, stringify(merged, { indent: 2 }), "utf8");

  // Write API key to .env
  const envName = apiKeyEnvName(args.provider);
  const envData = loadEnvFile(envPath);
  envData[envName] = args.apiKey;
  saveEnvFile(envPath, envData);

  // Validate model connectivity
  const validation = await validateModel(args.baseUrl, args.apiKey, args.model);

  return {
    configPath,
    envPath,
    provider: args.provider,
    model: args.model,
    defaultAgent: merged.defaultAgent,
    validation,
  };
}

/** Read a line with terminal echo disabled (for secrets). */
async function promptSecret(label: string): Promise<string> {
  process.stdout.write(label);
  return new Promise((resolve) => {
    const rawWasSet = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let buf = "";
    const onData = (chunk: string) => {
      for (const c of chunk.toString()) {
        if (c === "\n" || c === "\r" || c === "\u0004") {
          if (process.stdin.isTTY) process.stdin.setRawMode(rawWasSet);
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
          if (process.stdin.isTTY) process.stdin.setRawMode(rawWasSet);
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
async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id: string }[] };
    if (!Array.isArray(body.data)) return [];
    const NON_CHAT =
      /speech|embed|image|video|audio|ocr|rerank|tts|asr|paraformer|sambert|cosyvoice|wordart|wanx|wan2|flux|stable-diffusion|gui-/i;
    return body.data
      .map((m) => m.id)
      .filter((id) => !NON_CHAT.test(id))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Interactive setup — prompts user for provider, API key, model.
 */
export async function cmdSetupInteractive(storageRoot: string): Promise<Record<string, unknown>> {
  const rl = createInterface({ input, output });

  try {
    console.log("Configure LLM provider for uwf workflow agents.\n");

    // 1. Provider selection
    const numWidth = String(PRESET_PROVIDERS.length + 1).length;
    console.log("Select a provider:\n");
    for (let i = 0; i < PRESET_PROVIDERS.length; i++) {
      const p = PRESET_PROVIDERS[i];
      if (!p) continue;
      const num = String(i + 1).padStart(numWidth);
      console.log(`  ${num}) ${p.label.padEnd(28)} ${p.baseUrl}`);
    }
    const customNum = String(PRESET_PROVIDERS.length + 1).padStart(numWidth);
    console.log(`  ${customNum}) Custom (enter name and URL manually)\n`);

    const choice = (await rl.question(`Choose [1-${PRESET_PROVIDERS.length + 1}]: `)).trim();
    const choiceNum = Number.parseInt(choice, 10);
    if (Number.isNaN(choiceNum) || choiceNum < 1 || choiceNum > PRESET_PROVIDERS.length + 1) {
      throw new Error(`Invalid choice: ${choice}`);
    }

    let providerName: string;
    let baseUrl: string;

    if (choiceNum <= PRESET_PROVIDERS.length) {
      const selected = PRESET_PROVIDERS[choiceNum - 1];
      if (!selected) throw new Error("Invalid selection");
      providerName = selected.name;
      baseUrl = selected.baseUrl;
      console.log(`\n  → ${selected.label} (${selected.baseUrl})\n`);
    } else {
      providerName = (await rl.question("Provider name (e.g. my-proxy): ")).trim();
      if (!providerName) throw new Error("Provider name required");
      baseUrl = (await rl.question("OpenAI-compatible API base URL: ")).trim();
      if (!baseUrl) throw new Error("Base URL required");
    }

    // 2. API key
    rl.close();
    const apiKey = await promptSecret("API key: ");
    if (!apiKey) throw new Error("API key required");

    // 3. Model selection
    const rl2 = createInterface({ input, output });
    console.log("\nFetching available models...");
    const models = await fetchModels(baseUrl, apiKey);

    let model: string;
    if (models.length > 0) {
      console.log(`\nAvailable models (${models.length}):\n`);
      const nw = String(models.length).length;
      // Multi-column layout
      const maxLen = models.reduce((m, s) => Math.max(m, s.length), 0);
      const colWidth = nw + 2 + maxLen + 4; // "  N) name    "
      const termCols = process.stdout.columns || 100;
      const cols = Math.max(1, Math.floor(termCols / colWidth));
      const rows = Math.ceil(models.length / cols);
      for (let r = 0; r < rows; r++) {
        let line = "";
        for (let c = 0; c < cols; c++) {
          const idx = c * rows + r;
          if (idx >= models.length) break;
          const num = String(idx + 1).padStart(nw);
          const name = (models[idx] ?? "").padEnd(maxLen);
          line += `  ${num}) ${name}  `;
        }
        console.log(line.trimEnd());
      }
      console.log(`\nChoose a number, or type a model name directly.`);
      const modelInput = (await rl2.question(`Default model [1-${models.length}]: `)).trim();
      if (!modelInput) throw new Error("Model required");
      const modelNum = Number.parseInt(modelInput, 10);
      if (!Number.isNaN(modelNum) && modelNum >= 1 && modelNum <= models.length) {
        model = models[modelNum - 1] ?? modelInput;
      } else {
        model = modelInput;
      }
    } else {
      console.log("Could not fetch models. Enter model name manually.");
      model = (await rl2.question("Default model (e.g. qwen-plus, gpt-4o): ")).trim();
      if (!model) throw new Error("Model required");
    }

    rl2.close();

    console.log(`  → ${providerName}/${model}\n`);

    const setupResult = await cmdSetup({
      provider: providerName,
      baseUrl,
      apiKey,
      model,
      storageRoot,
    });

    // Show validation result
    if (setupResult.validation && typeof setupResult.validation === "object") {
      const v = setupResult.validation as { ok: boolean; error?: string };
      if (v.ok) {
        console.log("✓ Model verified — connection successful.\n");
      } else {
        console.log(`\n⚠ Warning: Could not reach model — ${v.error}`);
        console.log(
          "  Config saved, but you may want to try a different model or check your API key.\n",
        );
      }
    }

    console.log("Setup complete! Get started:\n");
    console.log("  uwf workflow put <workflow.yaml>   Register a workflow");
    console.log('  uwf thread start <name> -p "..."   Start a thread');
    console.log("  uwf thread step <thread-id>        Execute next step");
    console.log("");

    return null as unknown as Record<string, unknown>;
  } finally {
    rl.close();
  }
}
