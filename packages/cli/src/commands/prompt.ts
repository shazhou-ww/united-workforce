import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAdapterDevelopingReference,
  generateUsageReference,
  generateWorkflowAuthoringReference,
} from "@united-workforce/util";

// CLI package version (for bootstrap prompt — uwf --version prints this)
// Walk up from __dirname to find the nearest package.json (works from both src/ and dist/)
function _findCliVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@united-workforce/cli") {
        return pkg.version ?? "0.0.0";
      }
    } catch {
      // not found, keep walking
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}
const CLI_VERSION = _findCliVersion();

export {
  generateAdapterDevelopingReference as cmdPromptAdapterDeveloping,
  generateUsageReference as cmdPromptUsage,
  generateWorkflowAuthoringReference as cmdPromptWorkflowAuthoring,
};

const PROMPT_ENTRIES: ReadonlyArray<{ name: string; generate: () => string }> = [
  { name: "usage", generate: generateUsageReference },
  { name: "workflow-authoring", generate: generateWorkflowAuthoringReference },
  { name: "adapter-developing", generate: generateAdapterDevelopingReference },
];

export function cmdPromptList(): ReadonlyArray<string> {
  return PROMPT_ENTRIES.map((e) => e.name);
}

export function cmdPromptBootstrap(): string {
  return `# uwf Bootstrap

Set up or upgrade uwf (United Workforce) — from zero to running your first workflow.

## Scenario A: Fresh Install

### Step 0 — Environment pre-flight check

Run ALL checks below BEFORE installing anything. If any check fails, fix it first — do NOT skip ahead.

\`\`\`bash
# 1. Node.js
node --version   # need v20+
# FIX: install via nvm (https://github.com/nvm-sh/nvm) or your OS package manager

# 2. Package manager — pnpm (preferred) or npm
pnpm --version || npm --version
# FIX for pnpm: corepack enable pnpm   (Node 20+)
#   or: npm install -g pnpm
# If pnpm is not an option, npm works too — adjust install commands below

# 3. Global bin directory is in PATH
# For pnpm:
pnpm bin -g       # prints the global bin directory
# For npm:
npm prefix -g     # global prefix; bin is <prefix>/bin
# The directory printed above MUST be in your PATH.
# Test: echo \\$PATH | tr ':' '\\\\n'
# FIX: add the missing directory to your shell's startup file
#   (e.g. ~/.bashrc, ~/.zshrc, ~/.profile, or fish config):
#   export PATH="<global-bin-dir>:$PATH"
\`\`\`

**All checks must pass before continuing.** If you had to modify PATH, verify the change persists by opening a new shell or sourcing your shell config.

### Step 1 — Install the CLI and pick an integration path

uwf reaches an LLM/agent backend through one of two paths after Phase 4
cleanup (#381):

- **Sumeru gateway via broker (preferred)** — your gateway runs out-of-process
  and listens on \`http://host:port\`. The broker
  (\`@united-workforce/broker\`) calls its \`send\` / \`resume\` / \`poke\` HTTP
  endpoints. Most agents (chat sessions, hosted services, CLI subprocesses you
  wrap) should ship as gateways.
- **In-process \`createAgent\` adapter** — a local Node binary that runs inside
  the same process as \`uwf\`. Used for tools-bearing OpenAI-compatible loops
  (\`@united-workforce/agent-builtin\` ships \`uwf-builtin\`) or scripted E2E
  fixtures (\`@united-workforce/agent-mock\` ships \`uwf-mock\`).

**Install the uwf CLI** with pnpm or npm:

\`\`\`bash
pnpm add -g @united-workforce/cli       # or: npm install -g @united-workforce/cli
\`\`\`

If you plan to use the in-process built-in adapter, install it too:

\`\`\`bash
pnpm add -g @united-workforce/agent-builtin   # ships uwf-builtin
\`\`\`

**Verify that \`uwf\` is available in PATH:**

\`\`\`bash
uwf --version          # should print ${CLI_VERSION}
\`\`\`

If \`uwf\` is not found, the global bin directory is not in the current shell's PATH. **You must fix this before continuing:**

1. Find where the binary was installed:
   \`\`\`bash
   pnpm bin -g       # for pnpm
   npm prefix -g     # for npm (bin is <prefix>/bin)
   \`\`\`
2. Add the directory to PATH permanently by appending to the user's shell config (e.g. \`~/.bashrc\`, \`~/.zshrc\`, \`~/.profile\`, or fish config):
   \`\`\`bash
   export PATH="<global-bin-dir>:$PATH"
   \`\`\`
3. Source the updated config or open a new shell, then re-verify the command works.

**Legacy note:** The old per-agent CLI binaries and their npm packages have
been moved to \`legacy-packages/\` and are no longer published. If you
previously installed any \`@united-workforce/agent-*\` package targeting an
external chat CLI, uninstall it and either run a Sumeru gateway or use
\`uwf-builtin\`.

### Step 2 — Configure default agent

Run the interactive wizard:

\`\`\`bash
uwf setup
\`\`\`

Or configure non-interactively:

\`\`\`bash
uwf setup --agent <adapter-command>
\`\`\`

**Note:** \`--agent\` takes an alias declared in your \`agents\` map (e.g. \`builtin\`, \`my-gateway\`) — **not** an adapter command name. Each alias resolves to a \`{host, gateway}\` Sumeru endpoint that the broker contacts over HTTP. \`uwf thread exec --agent\` additionally accepts an inline \`"<host> <gateway>"\` pair for ad-hoc routing.

Config is saved to \`~/.uwf/config.yaml\`:

\`\`\`yaml
agents:
  my-gateway:
    host: http://127.0.0.1:7900
    gateway: my-gateway
defaultAgent: my-gateway
agentOverrides: {}
\`\`\`

**LLM configuration** is per-adapter — Sumeru gateways own their own provider/model/API-key settings, and in-process adapters store theirs under \`~/.uwf/agents/<name>.yaml\`. The engine config (\`~/.uwf/config.yaml\`) is LLM-free.

Verify with \`cat ~/.uwf/config.yaml\`.

### Step 3 — Install skills

Run each command and create a skill from its output:

\`\`\`bash
uwf prompt usage               # → save as skill "uwf-usage"
uwf prompt workflow-authoring  # → save as skill "uwf-workflow-authoring"
uwf prompt adapter-developing  # → save as skill "uwf-adapter-developing"
\`\`\`

Each command outputs a complete SKILL.md with YAML frontmatter. Use your agent framework's skill creation API to save them (e.g. \`skill_manage(action='create', name='uwf-usage', content=<output>)\`).

Verify skills are installed by listing them (e.g. \`skills_list()\`) and confirming all three appear.

**⚠ After saving all skills, start a new session** so the agent loads the updated skill content. Skills saved in the current session are not active until the next session.

### Step 4 — Verify end-to-end

Create a minimal workflow file to test your setup:

\`\`\`bash
cat > /tmp/hello.yaml << 'YAML'
name: hello
description: Minimal smoke test
roles:
  greeter:
    description: "Greet the user"
    goal: "Respond with a friendly greeting"
    capabilities: []
    procedure: "Write a short greeting based on the prompt."
    output: "A greeting message."
    frontmatter:
      type: object
      properties:
        $status: { const: done }
        message: { type: string }
      required: [$status, message]
graph:
  $START:
    new: { role: greeter, prompt: "Say hello to the user." }
    resume: { role: greeter, prompt: "Greet the user again." }
  greeter:
    done: { role: "$END", prompt: "Done." }
YAML
\`\`\`

Then run:

\`\`\`bash
uwf thread start /tmp/hello.yaml -p "Hello, world!"
uwf thread exec <thread-id>
uwf thread show <thread-id>
\`\`\`

If the thread reaches \`$END\` with status \`end\`, the setup is working.

To verify suspend/resume and poke:

\`\`\`bash
# After a role yields with $status: "$SUSPEND", resume the suspended thread:
uwf thread resume <thread-id> -p "Additional context for the agent"

# Re-run the head step's agent with a supplementary prompt (replaces head step):
uwf thread poke <thread-id> -p "Try again with this hint"
\`\`\`

## Scenario B: Upgrade from Previous Version

### Step 1 — Update packages

\`\`\`bash
# Using pnpm
pnpm add -g @united-workforce/cli@latest

# Using npm
npm install -g @united-workforce/cli@latest
\`\`\`

\`\`\`bash
uwf --version   # should print ${CLI_VERSION}
\`\`\`

Also update any in-process adapter you have installed (skip if you only use
Sumeru gateways via the broker):

\`\`\`bash
# pnpm
pnpm add -g @united-workforce/agent-builtin@latest

# npm
npm install -g @united-workforce/agent-builtin@latest
\`\`\`

If you previously had any \`@united-workforce/agent-*\` package targeting an
external chat CLI installed globally, uninstall it — those packages are
archived under \`legacy-packages/\` as of #381 and no longer published. Reach
the same backends via a Sumeru gateway in \`~/.uwf/config.yaml\` instead.

### Step 2 — Regenerate skills

Skill content is bundled with the CLI — always regenerate after upgrading:

\`\`\`bash
uwf prompt usage               # → update skill "uwf-usage"
uwf prompt workflow-authoring  # → update skill "uwf-workflow-authoring"
uwf prompt adapter-developing  # → update skill "uwf-adapter-developing"
\`\`\`

**⚠ After updating skills, start a new session** to load the new skill content.

### Step 3 — Migrate workflow YAML files (if needed)

Check the changelog for breaking changes. Known migrations:

- **v0.2.0**: \`$START._\` → \`$START.new\` + \`$START.resume\`. All workflow YAML files must be updated:
  \`\`\`yaml
  # Before (v0.1.x)
  $START:
    _: { role: planner, prompt: "..." }

  # After (v0.2.0+)
  $START:
    new: { role: planner, prompt: "..." }
    resume: { role: planner, prompt: "Review previous run and continue." }
  \`\`\`

Update all \`.workflows/\` and \`.workflow/\` YAML files in your projects. \`uwf workflow add\` will reject files with the old \`_\` syntax.

- **v0.2.1**: \`$status: { enum: [value] }\` → \`$status: { const: "value" }\`. The validator no longer accepts \`enum\` for \`$status\`. Update all workflow YAML files:
  \`\`\`yaml
  # Before (v0.2.0)
  $status: { enum: [done] }
  $status: { type: string, enum: ["ready", "failed"] }

  # After (v0.2.1+)
  $status: { const: "done" }
  # For multi-exit, use oneOf with const (unchanged)
  \`\`\`

- **v0.4.0**: Thread status \`completed\` → \`end\`. Update scripts that filter \`--status completed\` to use \`--status end\`. Legacy on-disk \`status: completed\` is normalized to \`end\` on read.
- **v0.4.0**: \`$SUSPEND\` is now an engine-level coroutine yield, not a graph target. Workflows that routed to \`role: "$SUSPEND"\` must emit \`$status: "$SUSPEND"\` with a \`reason\` from the role output instead. The thread becomes \`suspended\`; continue with \`uwf thread resume\`.

### Step 4 — Verify

\`\`\`bash
uwf thread start <your-workflow> -p "upgrade test"
uwf thread exec <thread-id>
\`\`\`

## Available prompts

\`\`\`bash
uwf prompt list                # list available prompt names
uwf prompt usage               # CLI usage guide
uwf prompt workflow-authoring  # workflow YAML design guide
uwf prompt adapter-developing  # building agent adapters
uwf prompt bootstrap           # this guide
\`\`\`

## What's next — introduce uwf to the user

After setup is complete, give the user a brief introduction to what uwf can do
and invite them to try it. Cover these three things:

1. **Run workflows** — execute pre-built workflows to automate multi-step tasks.
   Setup auto-registers example workflows, ready to use immediately.
2. **Create workflows** — design custom YAML workflows for their own recurring tasks
   (code review, issue triage, release pipelines, etc.). Use \`uwf prompt workflow-authoring\`
   for the authoring guide.
3. **Debug & improve workflows** — iterate on workflow definitions, inspect thread state
   with \`uwf thread show\`, replay failed steps with \`uwf thread poke\`, and refine
   role procedures based on real execution results.

**Discover & try built-in examples:**

Run \`uwf workflow list\` to see which workflows are registered (setup auto-registers
several built-in examples). Show the user what's available, then invite them to try
one — for instance, suggest a fun debate topic like "AI 是否会抢了人类的工作？" and
offer to kick it off for them.
`;
}
