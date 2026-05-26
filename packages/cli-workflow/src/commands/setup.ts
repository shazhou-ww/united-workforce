import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

// ──────────────────────────────────────────────────────────────────────────────
// Extracted helpers — _discoverAgents
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Scans directories from a PATH string for uwf-* executables.
 */
export async function _searchPathDirs(pathEnv: string): Promise<string[]> {
  if (!pathEnv) return [];
  const dirs = pathEnv.split(":").filter((d) => d.length > 0);
  const agents = new Set<string>();
  for (const dir of dirs) {
    _scanDirForAgents(dir, agents);
  }
  return Array.from(agents).sort();
}

function _scanDirForAgents(dir: string, agents: Set<string>): void {
  try {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (!entry.startsWith("uwf-") || entry === "uwf") continue;
      if (_isExecutableFile(join(dir, entry))) {
        agents.add(entry);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

function _isExecutableFile(fullPath: string): boolean {
  try {
    const s = statSync(fullPath);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Parses the stdout of `which -a` into sorted unique basenames.
 */
export function _parseWhichOutput(text: string): string[] {
  if (!text) return [];
  const agents = new Set<string>();
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    const basename = line.split("/").pop() ?? "";
    if (basename.startsWith("uwf-") && basename !== "uwf") {
      agents.add(basename);
    }
  }
  return Array.from(agents).sort();
}

/**
 * Discover uwf-* agent binaries in PATH.
 * Returns sorted list of binary names (e.g., ["uwf-hermes", "uwf-claude-code"]).
 */
export async function _discoverAgents(): Promise<string[]> {
  try {
    const agents = await _tryWhichDiscovery();
    if (agents !== null) return agents;
    return await _searchPathDirs(process.env.PATH ?? "");
  } catch {
    return [];
  }
}

async function _tryWhichDiscovery(): Promise<string[] | null> {
  try {
    const proc = Bun.spawn(["which", "-a", "uwf-hermes", "uwf-claude-code", "uwf-cursor"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode !== 0) return null;
    return _parseWhichOutput(text);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Extracted helpers — onData closure (promptSecret)
// ──────────────────────────────────────────────────────────────────────────────

/** Returns true for newline, carriage return, or EOF (EOT). */
export function _isTerminator(c: string): boolean {
  return c === "\n" || c === "\r" || c === "";
}

/** Returns true for DEL or backspace. */
export function _isBackspace(c: string): boolean {
  return c === "" || c === "\b";
}

// ──────────────────────────────────────────────────────────────────────────────
// Extracted helpers — cmdSetupInteractive
// ──────────────────────────────────────────────────────────────────────────────

type ProviderEntry = { name: string; label: string; baseUrl: string };

/** Prints the numbered provider list and custom option to stdout. */
export function _printProviderMenu(providers: readonly ProviderEntry[]): void {
  const numWidth = String(providers.length + 1).length;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (!p) continue;
    const num = String(i + 1).padStart(numWidth);
    console.log(`  ${num}) ${p.label.padEnd(28)} ${p.baseUrl}`);
  }
  const customNum = String(providers.length + 1).padStart(numWidth);
  console.log(`  ${customNum}) Custom (enter name and URL manually)\n`);
}

/** Resolves a numeric choice string to a preset provider, or null for custom/invalid. */
export function _resolveProviderChoice(
  choice: string,
  providers: readonly ProviderEntry[],
): { providerName: string; baseUrl: string } | null {
  const n = Number.parseInt(choice, 10);
  if (Number.isNaN(n) || n < 1 || n > providers.length) return null;
  const p = providers[n - 1];
  if (!p) return null;
  return { providerName: p.name, baseUrl: p.baseUrl };
}

/** Resolves numeric index or literal model name to a model string. */
export function _resolveModelChoice(input: string, models: string[]): string {
  const n = Number.parseInt(input, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= models.length) {
    return models[n - 1] ?? input;
  }
  return input;
}

/** Prints the multi-column model list to stdout. */
export function _printModelMenu(models: string[], termCols: number): void {
  const nw = String(models.length).length;
  const maxLen = models.reduce((m, s) => Math.max(m, s.length), 0);
  const colWidth = nw + 2 + maxLen + 4;
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
}

// ──────────────────────────────────────────────────────────────────────────────
// Agent selection prompt
// ──────────────────────────────────────────────────────────────────────────────

/** Known agent binary → display label mapping. */
const KNOWN_AGENTS: Record<string, string> = {
  "uwf-hermes": "Hermes (hermes-agent)",
  "uwf-claude-code": "Claude Code",
  "uwf-cursor": "Cursor",
  "uwf-builtin": "Built-in (lightweight, no external agent)",
};

/** Extract short agent name from binary name: uwf-claude-code → claude-code */
export function _agentNameFromBinary(binary: string): string {
  return binary.replace(/^uwf-/, "");
}

/** Prints numbered agent list to stdout. */
export function _printAgentMenu(agents: string[]): void {
  const numWidth = String(agents.length).length;
  for (let i = 0; i < agents.length; i++) {
    const bin = agents[i] ?? "";
    const label = KNOWN_AGENTS[bin] ?? bin;
    const num = String(i + 1).padStart(numWidth);
    console.log(`  ${num}) ${label}  (${bin})`);
  }
  console.log("");
}

/**
 * Interactive agent selection. Discovers uwf-* binaries, lets user pick default.
 * Returns short agent name (e.g. "hermes", "claude-code").
 */
export async function _promptAgentSelection(
  rl: ReturnType<typeof createInterface>,
): Promise<string> {
  console.log("Discovering installed agents...\n");
  const agents = await _discoverAgents();

  if (agents.length === 0) {
    console.log("  No uwf-* agent binaries found in PATH.\n");
    console.log("  Install one first, for example:");
    console.log("    npm i -g @uncaged/workflow-agent-hermes");
    console.log("    npm i -g @uncaged/workflow-agent-claude-code\n");
    const manual = (
      await rl.question("Agent binary name (e.g. uwf-hermes), or press Enter to skip: ")
    ).trim();
    if (!manual) return "hermes";
    return _agentNameFromBinary(manual.startsWith("uwf-") ? manual : `uwf-${manual}`);
  }

  if (agents.length === 1) {
    const name = _agentNameFromBinary(agents[0] ?? "uwf-hermes");
    const label = KNOWN_AGENTS[agents[0] ?? ""] ?? agents[0];
    console.log(`  Found 1 agent: ${label} — auto-selected.\n`);
    return name;
  }

  console.log(`  Found ${agents.length} agents:\n`);
  _printAgentMenu(agents);
  const choice = (await rl.question(`Choose default agent [1-${agents.length}]: `)).trim();
  const n = Number.parseInt(choice, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= agents.length) {
    const selected = agents[n - 1] ?? "uwf-hermes";
    const name = _agentNameFromBinary(selected);
    console.log(`  → ${name}\n`);
    return name;
  }
  // Treat as literal name
  const name = _agentNameFromBinary(choice.startsWith("uwf-") ? choice : `uwf-${choice}`);
  console.log(`  → ${name}\n`);
  return name;
}

type ValidationResult = { ok: boolean; error: string | null };

/** Prints the model validation result to stdout. */
export function _printValidationResult(validation: ValidationResult): void {
  if (validation.ok) {
    console.log("✓ Model verified — connection successful.\n");
  } else {
    console.log(`\n⚠ Warning: Could not reach model — ${validation.error}`);
    console.log(
      "  Config saved, but you may want to try a different model or check your API key.\n",
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Merge setup args into config.yaml structure. Non-destructive — preserves existing entries.
 */
function mergeConfig(existing: Record<string, unknown>, args: SetupArgs): Record<string, unknown> {
  const providers = (
    typeof existing.providers === "object" && existing.providers !== null
      ? { ...(existing.providers as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  providers[args.provider] = { baseUrl: args.baseUrl, apiKey: args.apiKey };

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
  // Ensure the selected agent has an entry
  if (!agents[agentName]) {
    agents[agentName] = { command: `uwf-${agentName}`, args: [] };
  }

  return {
    ...existing,
    providers,
    models,
    agents,
    defaultAgent: agentName,
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

  const existing = loadExistingConfig(configPath);
  const merged = mergeConfig(existing, args);

  writeFileSync(configPath, stringify(merged, { indent: 2 }), "utf8");

  // Validate model connectivity
  const validation = await validateModel(args.baseUrl, args.apiKey, args.model);

  return {
    configPath,
    provider: args.provider,
    model: args.model,
    defaultAgent: merged.defaultAgent,
    validation,
  };
}

type SecretState = {
  buf: string;
  rawWasSet: boolean;
  resolve: (value: string) => void;
  onData: (chunk: string) => void;
};

function _handleSecretTerminator(state: SecretState): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(state.rawWasSet);
  process.stdin.pause();
  process.stdin.removeListener("data", state.onData);
  process.stdout.write("\n");
  state.resolve(state.buf.trim());
}

function _handleSecretBackspace(state: SecretState): void {
  if (state.buf.length > 0) {
    state.buf = state.buf.slice(0, -1);
    process.stdout.write("\b \b");
  }
}

function _handleSecretChar(c: string, state: SecretState): boolean {
  if (_isTerminator(c)) {
    _handleSecretTerminator(state);
    return true;
  }
  if (_isBackspace(c)) {
    _handleSecretBackspace(state);
    return false;
  }
  if (c === "") {
    if (process.stdin.isTTY) process.stdin.setRawMode(state.rawWasSet);
    process.exit(130);
  }
  state.buf += c;
  process.stdout.write("*");
  return false;
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

    const state: SecretState = { buf: "", rawWasSet, resolve, onData: () => {} };
    state.onData = (chunk: string) => {
      for (const c of chunk.toString()) {
        if (_handleSecretChar(c, state)) return;
      }
    };
    process.stdin.on("data", state.onData);
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

async function _promptProviderSelection(
  rl: ReturnType<typeof createInterface>,
): Promise<{ providerName: string; baseUrl: string }> {
  console.log("Select a provider:\n");
  _printProviderMenu(PRESET_PROVIDERS);

  const choice = (await rl.question(`Choose [1-${PRESET_PROVIDERS.length + 1}]: `)).trim();
  const choiceNum = Number.parseInt(choice, 10);
  if (Number.isNaN(choiceNum) || choiceNum < 1 || choiceNum > PRESET_PROVIDERS.length + 1) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  const preset = _resolveProviderChoice(choice, PRESET_PROVIDERS);
  if (preset) {
    const selected = PRESET_PROVIDERS[choiceNum - 1];
    if (selected) {
      console.log(`\n  → ${selected.label} (${selected.baseUrl})\n`);
    }
    return preset;
  }

  const providerName = (await rl.question("Provider name (e.g. my-proxy): ")).trim();
  if (!providerName) throw new Error("Provider name required");
  const baseUrl = (await rl.question("OpenAI-compatible API base URL: ")).trim();
  if (!baseUrl) throw new Error("Base URL required");
  return { providerName, baseUrl };
}

async function _promptModelSelection(
  rl: ReturnType<typeof createInterface>,
  baseUrl: string,
  apiKey: string,
): Promise<string> {
  console.log("\nFetching available models...");
  const models = await fetchModels(baseUrl, apiKey);

  if (models.length === 0) {
    console.log("Could not fetch models. Enter model name manually.");
    const model = (await rl.question("Default model (e.g. qwen-plus, gpt-4o): ")).trim();
    if (!model) throw new Error("Model required");
    return model;
  }
  console.log(`\nAvailable models (${models.length}):\n`);
  _printModelMenu(models, process.stdout.columns || 100);
  console.log(`\nChoose a number, or type a model name directly.`);
  const modelInput = (await rl.question(`Default model [1-${models.length}]: `)).trim();
  if (!modelInput) throw new Error("Model required");
  return _resolveModelChoice(modelInput, models);
}

/**
 * Interactive setup — prompts user for provider, API key, model.
 */
export async function cmdSetupInteractive(storageRoot: string): Promise<Record<string, unknown>> {
  const rl = createInterface({ input, output });

  try {
    console.log("Configure LLM provider for uwf workflow agents.\n");

    const { providerName, baseUrl } = await _promptProviderSelection(rl);

    // 2. API key
    rl.close();
    const apiKey = await promptSecret("API key: ");
    if (!apiKey) throw new Error("API key required");

    // 3. Model selection
    const rl2 = createInterface({ input, output });
    const model = await _promptModelSelection(rl2, baseUrl, apiKey);
    rl2.close();
    console.log(`  → ${providerName}/${model}\n`);

    // 4. Agent discovery & selection
    const rl3 = createInterface({ input, output });
    const agentName = await _promptAgentSelection(rl3);
    rl3.close();

    const setupResult = await cmdSetup({
      provider: providerName,
      baseUrl,
      apiKey,
      model,
      agent: agentName,
      storageRoot,
    });

    // Show validation result
    if (setupResult.validation && typeof setupResult.validation === "object") {
      _printValidationResult(setupResult.validation as ValidationResult);
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
