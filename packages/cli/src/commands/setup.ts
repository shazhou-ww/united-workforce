import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { cmdWorkflowAdd } from "./workflow.js";

export type SetupArgs = {
  agent: string;
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
    const text = execFileSync("which", ["-a", "uwf-hermes", "uwf-claude-code", "uwf-cursor"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return _parseWhichOutput(text);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Terminator/backspace helpers (kept for reuse + test coverage)
// ──────────────────────────────────────────────────────────────────────────────

/** Returns true for newline, carriage return, or EOF (EOT). */
export function _isTerminator(c: string): boolean {
  return c === "\n" || c === "\r" || c === "\u0004";
}

/** Returns true for DEL or backspace. */
export function _isBackspace(c: string): boolean {
  return c === "\u007f" || c === "\b";
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
    console.log("    npm i -g @united-workforce/agent-hermes");
    console.log("    npm i -g @united-workforce/agent-claude-code\n");
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

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Default Sumeru host used when seeding a fresh agents.<alias> entry.
 * Phase 3 (#380) breaking change — agents are routed through the broker via
 * `host` + `gateway`, replacing the legacy `command` + `args` CLI binary
 * path.
 */
const DEFAULT_SUMERU_HOST = "http://127.0.0.1:7900";

/**
 * Merge setup args into config.yaml structure. Non-destructive — preserves
 * existing entries (including agentOverrides). Engine config is LLM-free, so
 * legacy provider/model fields are dropped on rewrite.
 */
function mergeConfig(existing: Record<string, unknown>, args: SetupArgs): Record<string, unknown> {
  const agents = (
    typeof existing.agents === "object" && existing.agents !== null
      ? { ...(existing.agents as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  const agentName = _agentNameFromBinary(args.agent);
  if (!agents[agentName]) {
    agents[agentName] = { host: DEFAULT_SUMERU_HOST, gateway: agentName };
  }

  const merged: Record<string, unknown> = {
    agents,
    defaultAgent: agentName,
  };
  if (existing.agentOverrides !== undefined) {
    merged.agentOverrides = existing.agentOverrides;
  }
  return merged;
}

/**
 * Check if the configured adapter binary (and its dependencies) are in PATH.
 * Returns warnings array — empty means all good.
 */
export function _checkAdapterAvailability(agentName: string): string[] {
  const warnings: string[] = [];
  const binary = `uwf-${agentName}`;

  try {
    execFileSync("which", [binary], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    warnings.push(
      `${binary} not found in PATH. Install it: pnpm add -g @united-workforce/agent-${agentName}`,
    );
    return warnings; // skip dependency check if adapter itself is missing
  }

  // uwf-hermes depends on hermes CLI
  if (agentName === "hermes") {
    try {
      execFileSync("which", ["hermes"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      warnings.push(
        'hermes CLI not found in PATH (required by uwf-hermes). Fix: export PATH="$HOME/.hermes/hermes-agent/.venv/bin:$PATH"',
      );
    }
  }

  return warnings;
}

// ──────────────────────────────────────────────────────────────────────────────
// Bundled example workflows
// ──────────────────────────────────────────────────────────────────────────────

/** Resolve the examples/ directory bundled with the CLI package. */
function _findExamplesDir(): string | null {
  // Walk up from this file (src/commands/ or dist/commands/) to the package root
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "examples");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Register bundled example workflows. Non-destructive — silently skips
 * any that fail (e.g. already registered with same hash).
 * Returns list of successfully registered workflow names.
 */
export async function _registerBundledExamples(storageRoot: string): Promise<string[]> {
  const examplesDir = _findExamplesDir();
  if (examplesDir === null) return [];

  const registered: string[] = [];
  const files = readdirSync(examplesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    try {
      const result = await cmdWorkflowAdd(storageRoot, join(examplesDir, file));
      registered.push(result.name);
      console.error(`  ✓ ${result.name}`);
    } catch {
      // Skip silently — workflow may already exist or be invalid
    }
  }

  return registered;
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Non-interactive setup. Engine config is LLM-free — only writes
 * agents + defaultAgent. Each adapter owns its own LLM configuration.
 */
export async function cmdSetup(args: SetupArgs): Promise<Record<string, unknown>> {
  const { storageRoot } = args;
  mkdirSync(storageRoot, { recursive: true });

  const configPath = getConfigPath(storageRoot);

  const existing = loadExistingConfig(configPath);
  const merged = mergeConfig(existing, args);

  writeFileSync(configPath, stringify(merged, { indent: 2 }), "utf8");

  // Print config path to stderr (stdout is reserved for JSON output)
  console.error(`Config saved to ${configPath} ✓`);

  // Check adapter availability
  const agentName = _agentNameFromBinary(args.agent);
  const adapterWarnings = _checkAdapterAvailability(agentName);
  for (const w of adapterWarnings) {
    console.error(`⚠ ${w}`);
  }

  // Auto-register bundled example workflows
  const registeredExamples = await _registerBundledExamples(storageRoot);

  return {
    configPath,
    defaultAgent: merged.defaultAgent,
    adapterWarnings,
    registeredExamples,
  };
}

/**
 * Interactive setup — prompts the user only for the default agent.
 * Each adapter owns its own LLM configuration.
 */
export async function cmdSetupInteractive(storageRoot: string): Promise<Record<string, unknown>> {
  const rl = createInterface({ input, output });
  try {
    console.log("Configure default agent for uwf workflow.\n");

    const agentName = await _promptAgentSelection(rl);
    rl.close();

    await cmdSetup({ agent: agentName, storageRoot });
    console.log("Setup complete! Get started:\n");
    console.log("  uwf workflow list                  List available workflows");
    console.log("  uwf workflow add <workflow.yaml>    Register a workflow");
    console.log('  uwf thread start <name> -p "..."    Start a thread');
    console.log("  uwf thread exec <thread-id>         Execute next step");
    console.log("");

    return null as unknown as Record<string, unknown>;
  } finally {
    rl.close();
  }
}
